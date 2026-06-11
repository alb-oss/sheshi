using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Auth;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

[ApiController]
[Authorize(Roles = Roles.ModeratorOrAdmin)]
[EnableRateLimiting("moderation")]
[Route("api/mod")]
public class ModerationController(
    ModerationService moderation,
    ILogger<ModerationController> logger) : ControllerBase
{
    [HttpGet("analytics")]
    public async Task<ActionResult<ModAnalyticsDto>> Analytics(CancellationToken ct = default) =>
        Ok(await moderation.BuildAnalyticsAsync(ct));

    [HttpGet("reports")]
    public async Task<ActionResult<IReadOnlyList<ModReportDto>>> Reports([FromQuery] string status = "open", CancellationToken ct = default)
    {
        if (!ModerationService.TryParseStatus(status, out var parsed)) return BadRequest(new { error = "INVALID_STATUS" });
        return Ok(await moderation.ListReportsAsync(parsed, ct));
    }

    [HttpGet("users")]
    public async Task<ActionResult<IReadOnlyList<ModUserDto>>> Users([FromQuery] string? query = null, CancellationToken ct = default) =>
        Ok(await moderation.ListUsersAsync(query, ct));

    [HttpPost("reports/{id:guid}/resolve")]
    public Task<IActionResult> Resolve(Guid id, CancellationToken ct) => SetReportStatus(id, ReportStatus.Resolved, ct);

    [HttpPost("reports/{id:guid}/dismiss")]
    public Task<IActionResult> Dismiss(Guid id, CancellationToken ct) => SetReportStatus(id, ReportStatus.Dismissed, ct);

    [HttpPost("users/{id:guid}/ban")]
    public Task<IActionResult> Ban(Guid id, CancellationToken ct) => SetBan(id, banned: true, "ban", ct);

    [HttpPost("users/{id:guid}/unban")]
    public Task<IActionResult> Unban(Guid id, CancellationToken ct) => SetBan(id, banned: false, "unban", ct);

    [Authorize(Roles = Roles.Admin)]
    [HttpPost("users/{id:guid}/roles")]
    public async Task<IActionResult> UpdateRole(Guid id, UpdateRoleRequest request)
    {
        if (!string.Equals(request.Role, Roles.Moderator, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "ONLY_MODERATOR_ROLE_CAN_BE_CHANGED" });

        var result = await moderation.SetModeratorAsync(id, request.Grant);
        return Finish(result, request.Grant ? "grant_moderator" : "revoke_moderator", id);
    }

    private async Task<IActionResult> SetBan(Guid id, bool banned, string action, CancellationToken ct)
    {
        var result = await moderation.SetBanAsync(id, banned, ct);
        return Finish(result, action, id);
    }

    private async Task<IActionResult> SetReportStatus(Guid id, ReportStatus status, CancellationToken ct)
    {
        if (!await moderation.SetReportStatusAsync(id, status, ct)) return NotFound();
        Audit($"report_{status.ToString().ToLowerInvariant()}", id);
        return NoContent();
    }

    private IActionResult Finish(ModActionResult result, string action, Guid target)
    {
        if (!result.Found) return NotFound();
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors });
        Audit(action, target);
        return NoContent();
    }

    // Privileged moderation actions are audit-logged with the acting moderator's id.
    private void Audit(string action, object target) =>
        logger.LogInformation("Moderation action {Action} on {Target} by {ModeratorId}",
            action, target, User.GetUserId());
}
