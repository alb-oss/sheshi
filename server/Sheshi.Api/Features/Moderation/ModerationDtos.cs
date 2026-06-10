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

public record ModAnalyticsDto(
    ModAnalyticsTotalsDto Totals,
    ModAnalyticsWindowDto Last24Hours,
    ModReportAnalyticsDto Reports,
    ModUserAnalyticsDto Users,
    IReadOnlyList<ModTrendPointDto> Trend,
    IReadOnlyList<ModRoomAnalyticsDto> TopRooms,
    IReadOnlyList<ModPostAnalyticsDto> TopPosts);

public record ModAnalyticsTotalsDto(
    int Rooms,
    int Users,
    int Threads,
    int Replies,
    int Messages,
    int Votes,
    int Reports);

public record ModAnalyticsWindowDto(
    int Users,
    int Threads,
    int Replies,
    int Messages,
    int Votes,
    int Reports);

public record ModReportAnalyticsDto(int Open, int Resolved, int Dismissed);

public record ModUserAnalyticsDto(int Banned, int Moderators, int Admins);

public record ModTrendPointDto(
    string Date,
    int Users,
    int Messages,
    int Votes,
    int Reports);

public record ModRoomAnalyticsDto(
    Guid Id,
    string Name,
    string Slug,
    int Threads,
    int Replies,
    int Votes,
    int Reports,
    DateTimeOffset? LatestActivityAt);

public record ModPostAnalyticsDto(
    Guid Id,
    string Body,
    string RoomName,
    string Author,
    int Depth,
    int Upvotes,
    int Replies,
    DateTimeOffset CreatedAt);
