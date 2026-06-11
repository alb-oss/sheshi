using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Rooms;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Features.Messages;

public class MessageService(AppDbContext db, IImageStorage imageStorage, RealtimeNotifier realtime, IMemoryCache cache, MessageEnricher enricher)
{
    private const int MaxDepth = 8;

    public async Task<MessageCreateResult> CreateMessageAsync(
        Guid authorId,
        PostMessageRequest request,
        IFormFile? image,
        CancellationToken ct = default)
    {
        var body = request.Body?.Trim() ?? "";
        if (body.Length == 0) return MessageCreateResult.Failed("EMPTY");
        if (body.Length > 2000) return MessageCreateResult.Failed("TOO_LONG");
        request = request with { Body = body };

        if (!await db.Rooms.AnyAsync(r => r.Id == request.RoomId, ct))
            return MessageCreateResult.Failed("ROOM_NOT_FOUND");

        Message? parent = null;
        if (request.ParentId is not null)
        {
            parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == request.ParentId, ct);
            if (parent is null) return MessageCreateResult.Failed("PARENT_NOT_FOUND");
            if (parent.RoomId != request.RoomId) return MessageCreateResult.Failed("PARENT_ROOM_MISMATCH");
        }

        string? imageUrl = null;
        if (image is not null && image.Length > 0)
        {
            try
            {
                await using var stream = image.OpenReadStream();
                imageUrl = await imageStorage.SaveAsync(stream, image.ContentType, ct);
            }
            catch (ImageStorageException ex)
            {
                return MessageCreateResult.Failed(ex.Code);
            }
        }

        var rootId = parent?.EffectiveRootId ?? Guid.Empty;

        Guid? parentId;
        int depth;
        if (parent is null)
        {
            parentId = request.ParentId;
            depth = 0;
        }
        else if (parent.Depth + 1 > MaxDepth)
        {
            // Reparent to the thread root so the tree can never exceed MaxDepth
            // and recursive traversal/serialization stays bounded.
            parentId = rootId;
            depth = 1;
        }
        else
        {
            parentId = request.ParentId;
            depth = parent.Depth + 1;
        }

        var message = new Message
        {
            Id = Guid.NewGuid(),
            RoomId = request.RoomId,
            AuthorId = authorId,
            ParentId = parentId,
            RootMessageId = rootId,
            Depth = depth,
            Body = request.Body.Trim(),
            ImageUrl = imageUrl
        };
        if (parent is null) message.RootMessageId = message.Id;

        db.Messages.Add(message);
        await db.SaveChangesAsync(ct);

        // Maintain denormalized counters with atomic SQL updates (race-safe).
        if (message.ParentId is null)
        {
            await db.Rooms.Where(r => r.Id == message.RoomId).ExecuteUpdateAsync(s => s
                .SetProperty(r => r.ThreadCount, r => r.ThreadCount + 1)
                .SetProperty(r => r.LatestActivityAt, message.CreatedAt), ct);
        }
        else
        {
            await db.Messages.Where(m => m.Id == message.ParentId)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.ReplyCount, m => m.ReplyCount + 1), ct);
            await db.Rooms.Where(r => r.Id == message.RoomId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.LatestActivityAt, message.CreatedAt), ct);
        }

        var dto = (await enricher.EnrichAsync([message], authorId, ct)).Single();
        cache.Remove(HighlightsCache.Key);
        cache.Remove(RoomsCache.ListKey);
        await realtime.MessageChangedAsync(
            new MessageChangeDto("message.created", message.RoomId, message.RootMessageId, message.Id),
            ct);
        return MessageCreateResult.Created(message, dto);
    }

    public async Task<bool> UpvoteAsync(Guid messageId, Guid userId, CancellationToken ct = default)
    {
        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == messageId, ct);
        if (message is null) return false;

        var inserted = await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Votes" ("MessageId", "UserId", "CreatedAt")
            VALUES ({messageId}, {userId}, {DateTimeOffset.UtcNow})
            ON CONFLICT ("MessageId", "UserId") DO NOTHING
            """, ct);

        // Only a genuinely new vote (not a duplicate) moves the counter.
        if (inserted > 0)
            await db.Messages.Where(m => m.Id == messageId)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.VoteCount, m => m.VoteCount + 1), ct);

        cache.Remove(HighlightsCache.Key);
        await realtime.MessageChangedAsync(
            new MessageChangeDto("vote.changed", message.RoomId, await MessageReader.ResolveRootAsync(db, message, ct), message.Id),
            ct);
        return true;
    }

    public async Task RemoveUpvoteAsync(Guid messageId, Guid userId, CancellationToken ct = default)
    {
        var vote = await db.Votes
            .Include(v => v.Message)
            .SingleOrDefaultAsync(v => v.MessageId == messageId && v.UserId == userId, ct);
        if (vote is null) return;

        var change = new MessageChangeDto(
            "vote.changed",
            vote.Message.RoomId,
            await MessageReader.ResolveRootAsync(db, vote.Message, ct),
            vote.MessageId);

        db.Votes.Remove(vote);
        await db.SaveChangesAsync(ct);
        await db.Messages.Where(m => m.Id == vote.MessageId)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.VoteCount, m => m.VoteCount - 1), ct);
        cache.Remove(HighlightsCache.Key);
        await realtime.MessageChangedAsync(change, ct);
    }

    public async Task<DeleteMessageResult> SoftDeleteAsync(
        Guid messageId,
        Guid userId,
        bool canModerate,
        CancellationToken ct = default)
    {
        var message = await db.Messages.SingleOrDefaultAsync(m => m.Id == messageId, ct);
        if (message is null) return DeleteMessageResult.NotFound();
        if (message.AuthorId != userId && !canModerate) return DeleteMessageResult.Forbidden();

        var wasActive = message.DeletedAt is null;
        message.DeletedAt ??= DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        // Removing a live message drops the relevant counter (idempotent on re-delete).
        if (wasActive)
        {
            if (message.ParentId is null)
                await db.Rooms.Where(r => r.Id == message.RoomId)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.ThreadCount, r => r.ThreadCount - 1), ct);
            else
                await db.Messages.Where(m => m.Id == message.ParentId)
                    .ExecuteUpdateAsync(s => s.SetProperty(m => m.ReplyCount, m => m.ReplyCount - 1), ct);
        }

        var change = new MessageChangeDto(
            "message.deleted",
            message.RoomId,
            await MessageReader.ResolveRootAsync(db, message, ct),
            message.Id);
        cache.Remove(HighlightsCache.Key);
        cache.Remove(RoomsCache.ListKey);
        await realtime.MessageChangedAsync(change, ct);
        return DeleteMessageResult.Deleted(change);
    }

    public async Task<ReportMessageResult> ReportAsync(
        Guid messageId,
        Guid reporterId,
        ReportMessageRequest request,
        CancellationToken ct = default)
    {
        if (!await db.Messages.AnyAsync(m => m.Id == messageId, ct))
            return ReportMessageResult.NotFound();
        if ((request.Note?.Length ?? 0) > 500)
            return ReportMessageResult.Failed("NOTE_TOO_LONG");

        if (await db.Reports.AnyAsync(r => r.MessageId == messageId && r.ReporterId == reporterId, ct))
            return ReportMessageResult.Created();

        db.Reports.Add(new Report
        {
            MessageId = messageId,
            ReporterId = reporterId,
            Reason = request.Reason,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim()
        });
        await db.SaveChangesAsync(ct);

        return ReportMessageResult.Created();
    }

}

public sealed record MessageCreateResult(Message? Entity, MessageDto? Dto, string? Error)
{
    public static MessageCreateResult Created(Message entity, MessageDto dto) => new(entity, dto, null);
    public static MessageCreateResult Failed(string error) => new(null, null, error);
}

public sealed record DeleteMessageResult(bool Found, bool Authorized, MessageChangeDto? Change)
{
    public static DeleteMessageResult NotFound() => new(false, false, null);
    public static DeleteMessageResult Forbidden() => new(true, false, null);
    public static DeleteMessageResult Deleted(MessageChangeDto change) => new(true, true, change);
}

public sealed record ReportMessageResult(bool Found, bool Succeeded, string? Error)
{
    public static ReportMessageResult NotFound() => new(false, false, null);
    public static ReportMessageResult Failed(string error) => new(true, false, error);
    public static ReportMessageResult Created() => new(true, true, null);
}
