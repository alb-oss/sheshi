using System.Security.Claims;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Sheshi.Api.Auth;
using Sheshi.Api.Common;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Messages;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Tests;

/// <summary>
/// Fast, dependency-free unit tests for the pure logic that the HTTP
/// integration suite only exercises indirectly: text clipping, highlight
/// scoring, presence tracking, and claim parsing.
/// </summary>
public class TextTests
{
    [Theory]
    [InlineData(null, 60, null)]
    [InlineData("", 60, null)]
    [InlineData("   ", 60, null)]
    [InlineData("  hi  ", 60, "hi")]
    public void Clip_trims_and_treats_blank_as_null(string? input, int max, string? expected)
    {
        Text.Clip(input, max).Should().Be(expected);
    }

    [Fact]
    public void Clip_caps_length_after_trimming()
    {
        Text.Clip(new string('a', 200), 60).Should().HaveLength(60);
        Text.Clip("  " + new string('b', 10) + "  ", 4).Should().Be("bbbb");
    }
}

public class HighlightsScoreTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void More_replies_score_higher_than_fewer()
    {
        var busy = HighlightsService.Score(0, 0, 10, 20, false, Now.AddHours(-2), Now.AddMinutes(-5), Now);
        var quiet = HighlightsService.Score(0, 0, 1, 1, false, Now.AddHours(-2), Now.AddMinutes(-5), Now);
        busy.Should().BeGreaterThan(quiet);
    }

    [Fact]
    public void Recent_activity_scores_higher_than_stale_for_equal_engagement()
    {
        var fresh = HighlightsService.Score(5, 3, 4, 4, false, Now.AddHours(-3), Now.AddMinutes(-10), Now);
        var stale = HighlightsService.Score(5, 3, 4, 4, false, Now.AddHours(-3), Now.AddDays(-5), Now);
        fresh.Should().BeGreaterThan(stale);
    }

    [Fact]
    public void Replies_with_engagement_get_a_branch_bonus()
    {
        var withChildren = HighlightsService.Score(0, 0, 2, 0, isReply: true, Now.AddHours(-1), Now.AddHours(-1), Now);
        var noChildren = HighlightsService.Score(0, 0, 0, 0, isReply: true, Now.AddHours(-1), Now.AddHours(-1), Now);
        (withChildren - noChildren).Should().BeGreaterThan(18);
    }

    [Fact]
    public void Fresh_tiebreak_rewards_replies_and_votes()
    {
        var stats = new HighlightStats(new Message(), upvotes: 3, directReplies: 2, activityAt: Now)
        {
            Descendants = 4,
            BranchVotes = 5
        };
        HighlightsService.FreshTieBreakScore(stats).Should().Be(2 * 6 + 4 * 2 + 3 * 3 + 5);
    }
}

public class PresenceTrackerTests
{
    [Fact]
    public void Join_counts_distinct_connections_per_room()
    {
        var tracker = new PresenceTracker();
        var room = Guid.NewGuid();

        tracker.JoinRoom("c1", room).Should().Be(1);
        tracker.JoinRoom("c2", room).Should().Be(2);
        tracker.JoinRoom("c2", room).Should().Be(2); // idempotent for the same connection
    }

    [Fact]
    public void Leaving_and_disconnecting_decrements_and_cleans_up()
    {
        var tracker = new PresenceTracker();
        var room = Guid.NewGuid();
        tracker.JoinRoom("c1", room);
        tracker.JoinRoom("c2", room);

        tracker.LeaveRoom("c1", room).Should().Be(1);

        var changed = tracker.Disconnect("c2");
        changed.Should().ContainSingle(p => p.RoomId == room && p.Count == 0);
        tracker.Snapshot().Should().NotContainKey(room); // empty rooms are dropped
    }

    [Fact]
    public void Disconnect_reports_every_room_a_connection_was_in()
    {
        var tracker = new PresenceTracker();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        tracker.JoinRoom("c1", a);
        tracker.JoinRoom("c1", b);

        var changed = tracker.Disconnect("c1");
        changed.Select(p => p.RoomId).Should().BeEquivalentTo(new[] { a, b });
    }
}

public class ClaimsPrincipalExtensionsTests
{
    [Fact]
    public void GetUserId_parses_the_name_identifier_claim()
    {
        var id = Guid.NewGuid();
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, id.ToString()) }));
        principal.GetUserId().Should().Be(id);
    }

    [Fact]
    public void GetUserId_returns_null_when_missing_or_malformed()
    {
        new ClaimsPrincipal(new ClaimsIdentity()).GetUserId().Should().BeNull();
        new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, "not-a-guid") }))
            .GetUserId().Should().BeNull();
    }
}

public class SlugTests
{
    [Theory]
    [InlineData("#Lagjja", "lagjja")]
    [InlineData("  Hello World  ", "hello-world")]
    [InlineData("###multi##hash", "multi-hash")]
    [InlineData("Tëma!! e (re)", "t-ma-e-re")]
    [InlineData("", null)]
    [InlineData("###", null)]
    [InlineData("   ", null)]
    public void Normalize_produces_url_safe_slug(string? input, string? expected)
    {
        Slug.Normalize(input).Should().Be(expected);
    }

    [Fact]
    public void Normalize_caps_at_60_characters()
    {
        Slug.Normalize(new string('a', 200)).Should().HaveLength(60);
    }
}

public class LocalFileImageStorageTests
{
    // 1x1 transparent PNG.
    private static readonly byte[] ValidPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=");

    private static LocalFileImageStorage NewStorage(out string dir, long maxBytes = 5_242_880)
    {
        dir = Path.Combine(Path.GetTempPath(), $"sheshi-storage-test-{Guid.NewGuid():N}");
        return new LocalFileImageStorage(Options.Create(new StorageOptions
        {
            UploadPath = dir,
            PublicBaseUrl = "http://localhost:5080/uploads",
            MaxBytes = maxBytes
        }));
    }

    [Fact]
    public async Task SaveAsync_stores_a_valid_png_and_returns_its_url()
    {
        var storage = NewStorage(out var dir);
        try
        {
            using var stream = new MemoryStream(ValidPng);
            var url = await storage.SaveAsync(stream, "image/png");
            url.Should().StartWith("http://localhost:5080/uploads/").And.EndWith(".png");
            Directory.GetFiles(dir).Should().ContainSingle();
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public async Task SaveAsync_rejects_an_unsupported_content_type()
    {
        var storage = NewStorage(out var dir);
        try
        {
            using var stream = new MemoryStream(ValidPng);
            var act = () => storage.SaveAsync(stream, "image/gif");
            (await act.Should().ThrowAsync<ImageStorageException>()).Which.Code.Should().Be("UNSUPPORTED_IMAGE_TYPE");
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public async Task SaveAsync_rejects_bytes_that_are_not_a_real_image()
    {
        var storage = NewStorage(out var dir);
        try
        {
            using var stream = new MemoryStream("<html>not a png</html>"u8.ToArray());
            var act = () => storage.SaveAsync(stream, "image/png");
            (await act.Should().ThrowAsync<ImageStorageException>()).Which.Code.Should().Be("INVALID_IMAGE");
            (Directory.Exists(dir) ? Directory.GetFiles(dir) : []).Should().BeEmpty(); // no leftover temp file
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public async Task SaveAsync_enforces_the_size_cap()
    {
        var storage = NewStorage(out var dir, maxBytes: 8);
        try
        {
            using var stream = new MemoryStream(ValidPng); // larger than 8 bytes
            var act = () => storage.SaveAsync(stream, "image/png");
            (await act.Should().ThrowAsync<ImageStorageException>()).Which.Code.Should().Be("IMAGE_TOO_LARGE");
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }
}
