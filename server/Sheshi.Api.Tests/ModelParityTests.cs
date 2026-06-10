using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

public class ModelParityTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public void Model_preserves_supabase_foreign_key_parity()
    {
        using var scope = factory.Services.CreateScope();
        var model = scope.ServiceProvider.GetRequiredService<AppDbContext>().Model;

        var vote = model.FindEntityType(typeof(Vote));
        vote.Should().NotBeNull();
        vote!.GetForeignKeys()
            .Where(fk => HasProperties(fk, nameof(Vote.MessageId)) &&
                         fk.PrincipalEntityType.ClrType == typeof(Message) &&
                         fk.DeleteBehavior == DeleteBehavior.Cascade)
            .Should()
            .ContainSingle();
        vote.GetForeignKeys()
            .Where(fk => HasProperties(fk, nameof(Vote.UserId)) &&
                         fk.PrincipalEntityType.ClrType == typeof(ApplicationUser) &&
                         fk.DeleteBehavior == DeleteBehavior.Cascade)
            .Should()
            .ContainSingle();

        var report = model.FindEntityType(typeof(Report));
        report.Should().NotBeNull();
        report!.GetForeignKeys()
            .Where(fk => HasProperties(fk, nameof(Report.MessageId)) &&
                         fk.PrincipalEntityType.ClrType == typeof(Message) &&
                         fk.DeleteBehavior == DeleteBehavior.Cascade)
            .Should()
            .ContainSingle();
        report.GetForeignKeys()
            .Where(fk => HasProperties(fk, nameof(Report.ReporterId)) &&
                         fk.PrincipalEntityType.ClrType == typeof(ApplicationUser) &&
                         fk.DeleteBehavior == DeleteBehavior.Restrict)
            .Should()
            .ContainSingle();
    }

    [Fact]
    public void Top_level_message_index_supports_keyset_pagination()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var message = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Message));

        message.Should().NotBeNull();
        var index = message!.GetIndexes()
            .Where(i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { nameof(Message.RoomId), nameof(Message.CreatedAt), nameof(Message.Id) }))
            .Should()
            .ContainSingle()
            .Subject;

        index.GetFilter().Should().Be("\"ParentId\" IS NULL");
        index.IsDescending.Should().Equal([false, true, true]);
    }

    private static bool HasProperties(IReadOnlyForeignKey foreignKey, params string[] names) =>
        foreignKey.Properties.Select(p => p.Name).SequenceEqual(names);
}
