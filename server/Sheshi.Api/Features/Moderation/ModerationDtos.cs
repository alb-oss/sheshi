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
    ModActiveUsersDto ActiveUsers,
    ModGrowthDto Growth,
    ModEngagementDto Engagement,
    ModModerationHealthDto ModerationHealth,
    IReadOnlyList<ModTrendPointDto> Trend,
    IReadOnlyList<ModRoomAnalyticsDto> TopRooms,
    IReadOnlyList<ModPostAnalyticsDto> TopPosts,
    IReadOnlyList<ModAuthorAnalyticsDto> TopAuthors);

// Distinct users who posted or voted within each window.
public record ModActiveUsersDto(int Daily, int Weekly, int Monthly);

// Current 7-day window vs the prior 7-day window for the headline metrics.
public record ModGrowthDto(ModGrowthPointDto Users, ModGrowthPointDto Messages, ModGrowthPointDto Votes);

public record ModGrowthPointDto(int Current, int Previous);

// How much discussion threads actually generate.
public record ModEngagementDto(double AnsweredThreadsPct, double AvgRepliesPerThread);

// Moderation health: resolution time, open backlog age, and content-quality rates.
public record ModModerationHealthDto(
    double? AvgResolutionHours,
    double? OpenBacklogAvgAgeHours,
    double ReportsPerThousandMessages,
    double DeletionRatePct);

public record ModAuthorAnalyticsDto(Guid Id, string Author, int Messages);

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
