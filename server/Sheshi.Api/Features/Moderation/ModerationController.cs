using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

[ApiController]
[Authorize(Roles = Roles.ModeratorOrAdmin)]
[EnableRateLimiting("moderation")]
[Route("api/mod")]
public class ModerationController(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    ModerationActionLogger actionLogger,
    ModerationMetricsService metricsService,
    TokenService tokenService) : ControllerBase
{
    [HttpGet("reports")]
    public async Task<ActionResult<IReadOnlyList<ModReportDto>>> Reports([FromQuery] ReportQuery query, CancellationToken ct = default)
    {
        if (!TryParseStatus(query.Status, out var parsed)) return BadRequest(new { error = "INVALID_STATUS" });
        var roomIdRaw = query.RoomId ?? Request.Query["room_id"].FirstOrDefault();
        var minSeverityRaw = query.MinSeverity ?? Request.Query["min_severity"].FirstOrDefault();
        var repeatOffender = query.RepeatOffender ||
                             (bool.TryParse(Request.Query["repeat_offender"].FirstOrDefault(), out var repeat) && repeat);

        var reportsQuery = db.Reports
            .AsNoTracking()
            .Include(r => r.Message)
            .ThenInclude(m => m.Room)
            .Where(r => r.Status == parsed);

        if (!string.IsNullOrWhiteSpace(query.Reason))
        {
            if (!TryParseReason(query.Reason, out var reason)) return BadRequest(new { error = "INVALID_REASON" });
            reportsQuery = reportsQuery.Where(r => r.Reason == reason);
        }

        if (!string.IsNullOrWhiteSpace(roomIdRaw))
        {
            if (!Guid.TryParse(roomIdRaw, out var roomId)) return BadRequest(new { error = "INVALID_ROOM" });
            reportsQuery = reportsQuery.Where(r => r.Message.RoomId == roomId);
        }

        var limit = Math.Clamp(query.Limit, 1, 100);
        var rawReports = await reportsQuery
            .OrderByDescending(r => r.CreatedAt)
            .Take(500)
            .ToListAsync(ct);

        var reportDtos = await BuildReportDtosAsync(rawReports, ct);

        if (!string.IsNullOrWhiteSpace(minSeverityRaw))
        {
            if (!TryParseSeverity(minSeverityRaw, out var minSeverity))
                return BadRequest(new { error = "INVALID_SEVERITY" });
            reportDtos = reportDtos
                .Where(r => SeverityRank(r.Severity) >= SeverityRank(minSeverity))
                .ToList();
        }

        if (repeatOffender)
            reportDtos = reportDtos.Where(r => r.AuthorOpenReportCount > 1 || r.AuthorOpenFlagCount > 0).ToList();

        reportDtos = query.Sort.ToLowerInvariant() switch
        {
            "newest" => reportDtos.OrderByDescending(r => r.CreatedAt).ToList(),
            "severity" => reportDtos.OrderByDescending(r => SeverityRank(r.Severity)).ThenBy(r => r.CreatedAt).ToList(),
            "oldest" or "" => reportDtos.OrderBy(r => r.CreatedAt).ToList(),
            _ => reportDtos.OrderBy(r => r.CreatedAt).ToList()
        };

        var reports = reportDtos.Take(limit).ToList();

        return Ok(reports);
    }

    [HttpGet("flags")]
    public async Task<ActionResult<IReadOnlyList<ModFlagDto>>> Flags([FromQuery] FlagQuery query, CancellationToken ct = default)
    {
        if (!TryParseFlagStatus(query.Status, out var status)) return BadRequest(new { error = "INVALID_STATUS" });

        var flagsQuery = db.ModerationFlags
            .AsNoTracking()
            .Where(f => f.Status == status);

        if (!string.IsNullOrWhiteSpace(query.Category))
        {
            if (!Enum.TryParse<ModerationCategory>(query.Category, ignoreCase: true, out var category))
                return BadRequest(new { error = "INVALID_CATEGORY" });
            flagsQuery = flagsQuery.Where(f => f.Category == category);
        }

        if (!string.IsNullOrWhiteSpace(query.Severity))
        {
            if (!Enum.TryParse<ModerationSeverity>(query.Severity, ignoreCase: true, out var severity))
                return BadRequest(new { error = "INVALID_SEVERITY" });
            flagsQuery = flagsQuery.Where(f => f.Severity == severity);
        }

        if (!string.IsNullOrWhiteSpace(query.RuleKey))
        {
            var ruleKey = query.RuleKey.Trim();
            flagsQuery = flagsQuery.Where(f => f.RuleKey == ruleKey);
        }

        var limit = Math.Clamp(query.Limit, 1, 100);
        var rawFlags = await flagsQuery
            .OrderBy(f => f.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);

        // Enrich with the flagged message (body, deleted, room) and its author so a moderator
        // sees WHAT was flagged and can act on it — not just an opaque id.
        var messageIds = rawFlags.Select(f => f.MessageId).Distinct().ToArray();
        var authorIds = rawFlags.Select(f => f.AuthorId).Distinct().ToArray();
        var messages = await db.Messages
            .AsNoTracking()
            .Where(m => messageIds.Contains(m.Id))
            .Select(m => new { m.Id, m.Body, m.DeletedAt, RoomSlug = m.Room.Slug })
            .ToDictionaryAsync(m => m.Id, ct);
        var authors = await db.Users
            .AsNoTracking()
            .Where(u => authorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new ModActorDto(u.Id, u.UserName, u.DisplayName), ct);

        var flags = rawFlags.Select(f =>
        {
            var msg = messages.GetValueOrDefault(f.MessageId);
            return new ModFlagDto(
                f.Id, f.MessageId, f.RoomId, f.AuthorId, f.RuleKey,
                f.Category.ToString().ToLowerInvariant(),
                f.Severity.ToString().ToLowerInvariant(),
                f.Score, f.Evidence, f.Status.ToString().ToLowerInvariant(), f.CreatedAt,
                msg?.Body ?? "", msg?.DeletedAt is not null, msg?.RoomSlug ?? "sheshi",
                authors.GetValueOrDefault(f.AuthorId));
        }).ToList();

        return Ok(flags);
    }

    [HttpPost("flags/{id:guid}/resolve")]
    public Task<IActionResult> ResolveFlag(Guid id, CancellationToken ct) =>
        SetFlagStatus(id, ModerationFlagStatus.Resolved, ct);

    [HttpPost("flags/{id:guid}/dismiss")]
    public Task<IActionResult> DismissFlag(Guid id, CancellationToken ct) =>
        SetFlagStatus(id, ModerationFlagStatus.Dismissed, ct);

    [HttpPost("reports/{id:guid}/resolve")]
    public Task<IActionResult> Resolve(Guid id, CancellationToken ct) =>
        SetReportStatus(id, ReportStatus.Resolved, ct);

    [HttpPost("reports/{id:guid}/dismiss")]
    public Task<IActionResult> Dismiss(Guid id, CancellationToken ct) =>
        SetReportStatus(id, ReportStatus.Dismissed, ct);

    [HttpPost("users/{id:guid}/ban")]
    public async Task<IActionResult> Ban(Guid id)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        user.BannedAt ??= DateTimeOffset.UtcNow;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        await tokenService.RevokeAllRefreshTokensAsync(user.Id);
        await actionLogger.LogAsync(User, ModerationActionTypes.UserBanned, "user", user.Id);
        return NoContent();
    }

    [HttpPost("users/{id:guid}/unban")]
    public async Task<IActionResult> Unban(Guid id)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        user.BannedAt = null;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        await actionLogger.LogAsync(User, ModerationActionTypes.UserUnbanned, "user", user.Id);
        return NoContent();
    }

    [Authorize(Roles = Roles.Admin)]
    [HttpPost("users/{id:guid}/roles")]
    public async Task<IActionResult> UpdateRole(Guid id, UpdateRoleRequest request)
    {
        if (!string.Equals(request.Role, Roles.Moderator, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "ONLY_MODERATOR_ROLE_CAN_BE_CHANGED" });

        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        var result = request.Grant
            ? await userManager.AddToRoleAsync(user, Roles.Moderator)
            : await userManager.RemoveFromRoleAsync(user, Roles.Moderator);

        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        await actionLogger.LogAsync(
            User,
            request.Grant ? ModerationActionTypes.RoleGranted : ModerationActionTypes.RoleRemoved,
            "role",
            user.Id,
            Roles.Moderator);
        return NoContent();
    }

    [HttpGet("actions")]
    public async Task<ActionResult<IReadOnlyList<ModActionDto>>> Actions([FromQuery] ActionQuery query, CancellationToken ct = default)
    {
        var actionType = query.ActionType ?? Request.Query["action_type"].FirstOrDefault();
        var targetType = query.TargetType ?? Request.Query["target_type"].FirstOrDefault();
        var actorIdRaw = query.ActorId ?? Request.Query["actor_id"].FirstOrDefault();
        var actionsQuery = db.ModerationActions
            .AsNoTracking()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(actionType))
            actionsQuery = actionsQuery.Where(a => a.ActionType == actionType.Trim());
        if (!string.IsNullOrWhiteSpace(targetType))
            actionsQuery = actionsQuery.Where(a => a.TargetType == targetType.Trim());
        if (!string.IsNullOrWhiteSpace(actorIdRaw))
        {
            if (!Guid.TryParse(actorIdRaw, out var actorId)) return BadRequest(new { error = "INVALID_ACTOR" });
            actionsQuery = actionsQuery.Where(a => a.ActorId == actorId);
        }

        var rawActions = await actionsQuery
            .OrderByDescending(a => a.CreatedAt)
            .Take(Math.Clamp(query.Limit, 1, 200))
            .ToListAsync(ct);

        var actorIds = rawActions.Select(a => a.ActorId).Distinct().ToArray();
        var actors = await db.Users
            .AsNoTracking()
            .Where(u => actorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new ModActorDto(u.Id, u.UserName, u.DisplayName), ct);

        var actions = rawActions.Select(a => new ModActionDto(
            a.Id,
            a.ActorId,
            a.ActionType,
            a.TargetType,
            a.TargetId,
            a.Reason,
            a.CreatedAt,
            actors.GetValueOrDefault(a.ActorId) ?? new ModActorDto(a.ActorId, null, null),
            ParseMetadata(a.MetadataJson))).ToList();

        return Ok(actions);
    }

    [HttpGet("users")]
    public async Task<ActionResult<IReadOnlyList<ModUserDto>>> Users([FromQuery] string? query = null, CancellationToken ct = default)
    {
        query = query?.Trim().ToLowerInvariant();
        var usersQuery = db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(query))
        {
            usersQuery = usersQuery.Where(u =>
                (u.Email != null && u.Email.ToLower().Contains(query)) ||
                (u.UserName != null && u.UserName.ToLower().Contains(query)) ||
                (u.DisplayName != null && u.DisplayName.ToLower().Contains(query)));
        }

        var users = await usersQuery.OrderBy(u => u.Email).Take(25).ToListAsync(ct);
        var result = new List<ModUserDto>();
        foreach (var user in users)
        {
            var roles = await userManager.GetRolesAsync(user);
            result.Add(new ModUserDto(
                user.Id,
                user.Email,
                user.UserName,
                user.DisplayName,
                user.IsBanned,
                roles.Order(StringComparer.Ordinal).ToArray()));
        }

        return Ok(result);
    }

    [HttpGet("metrics")]
    public async Task<ActionResult<ModerationMetricsDto>> Metrics(CancellationToken ct = default) =>
        Ok(await metricsService.GetAsync(ct));

    private async Task<IActionResult> SetReportStatus(Guid id, ReportStatus status, CancellationToken ct)
    {
        var report = await db.Reports.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        var previousStatus = report.Status;
        report.Status = status;
        await db.SaveChangesAsync(ct);
        await actionLogger.LogAsync(
            User,
            status == ReportStatus.Resolved ? ModerationActionTypes.ReportResolved : ModerationActionTypes.ReportDismissed,
            "report",
            report.Id,
            metadataJson: JsonSerializer.Serialize(new Dictionary<string, string>
            {
                ["previous_status"] = previousStatus.ToString().ToLowerInvariant(),
                ["new_status"] = status.ToString().ToLowerInvariant()
            }),
            ct: ct);
        return NoContent();
    }

    private async Task<IActionResult> SetFlagStatus(Guid id, ModerationFlagStatus status, CancellationToken ct)
    {
        var flag = await db.ModerationFlags.SingleOrDefaultAsync(f => f.Id == id, ct);
        if (flag is null) return NotFound();

        flag.Status = status;
        flag.ResolvedAt = DateTimeOffset.UtcNow;
        flag.ResolvedById = User.GetUserId();
        await db.SaveChangesAsync(ct);

        await actionLogger.LogAsync(
            User,
            status == ModerationFlagStatus.Resolved ? ModerationActionTypes.FlagResolved : ModerationActionTypes.FlagDismissed,
            "flag",
            flag.Id,
            metadataJson: JsonSerializer.Serialize(new Dictionary<string, string>
            {
                ["new_status"] = status.ToString().ToLowerInvariant(),
                ["rule_key"] = flag.RuleKey
            }),
            ct: ct);
        return NoContent();
    }

    private async Task<List<ModReportDto>> BuildReportDtosAsync(IReadOnlyList<Report> reports, CancellationToken ct)
    {
        if (reports.Count == 0) return [];

        var messageIds = reports.Select(r => r.MessageId).Distinct().ToArray();
        var authorIds = reports.Select(r => r.Message.AuthorId).Distinct().ToArray();
        var reporterIds = reports.Select(r => r.ReporterId).Distinct().ToArray();
        var userIds = authorIds.Concat(reporterIds).Distinct().ToArray();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new ModActorDto(u.Id, u.UserName, u.DisplayName), ct);

        var reportCounts = await db.Reports
            .AsNoTracking()
            .Where(r => authorIds.Contains(r.Message.AuthorId))
            .GroupBy(r => r.Message.AuthorId)
            .Select(g => new { AuthorId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AuthorId, x => x.Count, ct);

        var openReportCounts = await db.Reports
            .AsNoTracking()
            .Where(r => r.Status == ReportStatus.Open && authorIds.Contains(r.Message.AuthorId))
            .GroupBy(r => r.Message.AuthorId)
            .Select(g => new { AuthorId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AuthorId, x => x.Count, ct);

        var openFlagCounts = await db.ModerationFlags
            .AsNoTracking()
            .Where(f => f.Status == ModerationFlagStatus.Open && authorIds.Contains(f.AuthorId))
            .GroupBy(f => f.AuthorId)
            .Select(g => new { AuthorId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AuthorId, x => x.Count, ct);

        var flagSeverities = await db.ModerationFlags
            .AsNoTracking()
            .Where(f => messageIds.Contains(f.MessageId))
            .Select(f => new { f.MessageId, f.Severity })
            .ToListAsync(ct);
        var maxFlagSeverityByMessage = flagSeverities
            .GroupBy(f => f.MessageId)
            .ToDictionary(g => g.Key, g => g.Select(f => f.Severity).MaxBy(s => SeverityRank(s)));

        var now = DateTimeOffset.UtcNow;
        return reports.Select(r =>
        {
            var authorId = r.Message.AuthorId;
            var severity = maxFlagSeverityByMessage.GetValueOrDefault(r.MessageId);
            severity = MaxSeverity(severity, SeverityFromReason(r.Reason));
            return new ModReportDto(
                r.Id,
                r.MessageId,
                r.ReporterId,
                r.Reason.ToString().ToLowerInvariant(),
                r.Note,
                r.Status.ToString().ToLowerInvariant(),
                r.Message.Body,
                authorId,
                r.Message.RoomId,
                r.Message.Room.Slug,
                severity.ToString().ToLowerInvariant(),
                r.CreatedAt,
                Math.Max(0, (now - r.CreatedAt).TotalHours),
                reportCounts.GetValueOrDefault(authorId),
                openReportCounts.GetValueOrDefault(authorId),
                openFlagCounts.GetValueOrDefault(authorId),
                users.GetValueOrDefault(authorId),
                users.GetValueOrDefault(r.ReporterId));
        }).ToList();
    }

    private static IReadOnlyDictionary<string, string> ParseMetadata(string? metadataJson)
    {
        if (string.IsNullOrWhiteSpace(metadataJson)) return new Dictionary<string, string>();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(metadataJson) ?? new Dictionary<string, string>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, string>();
        }
    }

    private static bool TryParseSeverity(string severity, out ModerationSeverity parsed) =>
        Enum.TryParse(severity, ignoreCase: true, out parsed);

    private static ModerationSeverity SeverityFromReason(ReportReason reason) =>
        reason switch
        {
            ReportReason.Doxxing => ModerationSeverity.High,
            ReportReason.Hate => ModerationSeverity.High,
            ReportReason.Violence => ModerationSeverity.High,
            ReportReason.Spam => ModerationSeverity.Medium,
            _ => ModerationSeverity.Low
        };

    private static ModerationSeverity MaxSeverity(ModerationSeverity left, ModerationSeverity right) =>
        SeverityRank(left) >= SeverityRank(right) ? left : right;

    private static int SeverityRank(string severity) =>
        TryParseSeverity(severity, out var parsed) ? SeverityRank(parsed) : 0;

    private static int SeverityRank(ModerationSeverity severity) =>
        severity switch
        {
            ModerationSeverity.Critical => 4,
            ModerationSeverity.High => 3,
            ModerationSeverity.Medium => 2,
            ModerationSeverity.Low => 1,
            _ => 0
        };

    private static bool TryParseStatus(string status, out ReportStatus parsed)
    {
        parsed = status.ToLowerInvariant() switch
        {
            "open" => ReportStatus.Open,
            "resolved" => ReportStatus.Resolved,
            "dismissed" => ReportStatus.Dismissed,
            _ => default
        };
        return status.ToLowerInvariant() is "open" or "resolved" or "dismissed";
    }

    private static bool TryParseReason(string reason, out ReportReason parsed) =>
        Enum.TryParse(reason, ignoreCase: true, out parsed);

    private static bool TryParseFlagStatus(string status, out ModerationFlagStatus parsed)
    {
        parsed = status.ToLowerInvariant() switch
        {
            "open" => ModerationFlagStatus.Open,
            "resolved" => ModerationFlagStatus.Resolved,
            "dismissed" => ModerationFlagStatus.Dismissed,
            _ => default
        };
        return status.ToLowerInvariant() is "open" or "resolved" or "dismissed";
    }
}
