namespace Sheshi.Api.Features.Moderation;

public record ModReportDto(
    Guid Id,
    Guid MessageId,
    Guid ReporterId,
    string Reason,
    string? Note,
    string Status,
    string MessageBody,
    Guid MessageAuthorId);

public record ModUserDto(
    Guid Id,
    string? Email,
    string? Username,
    string? DisplayName,
    bool IsBanned,
    string[] Roles);

public record UpdateRoleRequest(string Role, bool Grant);
