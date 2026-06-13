using System.Text.Json.Serialization;

namespace Sheshi.Api.Features.Moderation;

public record ModReportDto(
    Guid Id,
    Guid MessageId,
    Guid ReporterId,
    string Reason,
    string? Note,
    string Status,
    string MessageBody,
    Guid MessageAuthorId,
    Guid RoomId,
    string RoomSlug,
    string Severity,
    DateTimeOffset CreatedAt,
    double AgeHours,
    int AuthorReportCount,
    int AuthorOpenReportCount,
    int AuthorOpenFlagCount,
    ModActorDto? Author,
    ModActorDto? Reporter);

public record ReportQuery
{
    public string Status { get; init; } = "open";
    public string? Reason { get; init; }
    [property: JsonPropertyName("room_id")]
    public string? RoomId { get; init; }
    [property: JsonPropertyName("min_severity")]
    public string? MinSeverity { get; init; }
    [property: JsonPropertyName("repeat_offender")]
    public bool RepeatOffender { get; init; }
    public string Sort { get; init; } = "oldest";
    public int Limit { get; init; } = 50;
}

public record ModUserDto(
    Guid Id,
    string? Email,
    string? Username,
    string? DisplayName,
    bool IsBanned,
    string[] Roles);

public record UpdateRoleRequest(string Role, bool Grant);

public record ModActionDto(
    Guid Id,
    Guid ActorId,
    string ActionType,
    string TargetType,
    Guid TargetId,
    string? Reason,
    DateTimeOffset CreatedAt,
    ModActorDto Actor,
    IReadOnlyDictionary<string, string> Metadata);

public record ModActorDto(Guid Id, string? Username, string? DisplayName);

public record ActionQuery
{
    [property: JsonPropertyName("action_type")]
    public string? ActionType { get; init; }
    [property: JsonPropertyName("target_type")]
    public string? TargetType { get; init; }
    [property: JsonPropertyName("actor_id")]
    public string? ActorId { get; init; }
    public int Limit { get; init; } = 100;
}

public record ModFlagDto(
    Guid Id,
    Guid MessageId,
    Guid RoomId,
    Guid AuthorId,
    string RuleKey,
    string Category,
    string Severity,
    double Score,
    string Evidence,
    string Status,
    DateTimeOffset CreatedAt);

public record FlagQuery
{
    public string Status { get; init; } = "open";
    public string? Category { get; init; }
    public string? Severity { get; init; }
    public string? RuleKey { get; init; }
    public int Limit { get; init; } = 50;
}

public record ModerationMetricsDto(
    int OpenReports,
    int OpenFlags,
    [property: JsonPropertyName("average_resolution_hours_7d")]
    double? AverageResolutionHours7d,
    double? OldestOpenItemHours,
    [property: JsonPropertyName("resolved_reports_7d")]
    int ResolvedReports7d,
    [property: JsonPropertyName("bans_7d")]
    int Bans7d,
    [property: JsonPropertyName("deleted_messages_7d")]
    int DeletedMessages7d,
    IReadOnlyList<MetricBucketDto> ReportsByReason,
    IReadOnlyList<MetricBucketDto> FlagsByRule);

public record MetricBucketDto(string Key, int Count);
