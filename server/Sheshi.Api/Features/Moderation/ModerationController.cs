using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

[ApiController]
[Authorize(Roles = "moderator,admin")]
[Route("api/mod")]
public class ModerationController(
    AppDbContext db,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet("reports")]
    public async Task<ActionResult<IReadOnlyList<ModReportDto>>> Reports([FromQuery] string status = "open", CancellationToken ct = default)
    {
        if (!TryParseStatus(status, out var parsed)) return BadRequest(new { error = "INVALID_STATUS" });

        var reports = await db.Reports
            .AsNoTracking()
            .Where(r => r.Status == parsed)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new ModReportDto(
                r.Id,
                r.MessageId,
                r.ReporterId,
                r.Reason.ToString().ToLowerInvariant(),
                r.Note,
                r.Status.ToString().ToLowerInvariant(),
                r.Message.Body,
                r.Message.AuthorId))
            .ToListAsync(ct);

        return Ok(reports);
    }

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
        return result.Succeeded ? NoContent() : BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });
    }

    [HttpPost("users/{id:guid}/unban")]
    public async Task<IActionResult> Unban(Guid id)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        user.BannedAt = null;
        var result = await userManager.UpdateAsync(user);
        return result.Succeeded ? NoContent() : BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });
    }

    [Authorize(Roles = "admin")]
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

        return result.Succeeded ? NoContent() : BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });
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

    private async Task<IActionResult> SetReportStatus(Guid id, ReportStatus status, CancellationToken ct)
    {
        var report = await db.Reports.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        report.Status = status;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

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
}
