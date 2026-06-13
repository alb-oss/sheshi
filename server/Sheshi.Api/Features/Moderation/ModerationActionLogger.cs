using System.Security.Claims;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

public class ModerationActionLogger(AppDbContext db)
{
    public async Task LogAsync(
        ClaimsPrincipal actor,
        string actionType,
        string targetType,
        Guid targetId,
        string? reason = null,
        string? metadataJson = null,
        CancellationToken ct = default)
    {
        var actorIdRaw = actor.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(actorIdRaw, out var actorId))
            throw new InvalidOperationException("Cannot write moderation action without an actor id.");

        var trimmedReason = reason?.Trim();
        db.ModerationActions.Add(new ModerationAction
        {
            ActorId = actorId,
            ActionType = actionType,
            TargetType = targetType,
            TargetId = targetId,
            Reason = string.IsNullOrWhiteSpace(trimmedReason)
                ? null
                : trimmedReason[..Math.Min(trimmedReason.Length, 500)],
            MetadataJson = metadataJson
        });
        await db.SaveChangesAsync(ct);
    }
}
