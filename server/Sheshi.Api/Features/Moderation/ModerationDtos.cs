using System.Text.Json.Serialization;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

// Closed-set fields are typed as their domain enums (not loose strings): the global
// JsonStringEnumConverter(SnakeCaseLower) in Program.cs serialises them to the same lowercase wire
// tokens the hand-rolled ".ToString().ToLowerInvariant()" produced, so the contract is unchanged while
// the server now refuses to emit a value outside the enum. Open-text fields (RuleKey, Evidence,
// ActionType, TargetType) stay string by design.
public record ModReportDto(
    Guid Id,
    Guid MessageId,
    Guid ReporterId,
    ReportReason Reason,
    string? Note,
    ReportStatus Status,
    string MessageBody,
    Guid MessageAuthorId,
    Guid RoomId,
    string RoomSlug,
    ModerationSeverity Severity,
    DateTimeOffset CreatedAt,
    double AgeHours,
    int AuthorReportCount,
    int AuthorOpenReportCount,
    int AuthorOpenFlagCount,
    ModActorDto? Author,
    ModActorDto? Reporter,
    bool MessageAuthorBanned);

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
    ModerationCategory Category,
    ModerationSeverity Severity,
    double Score,
    string Evidence,
    ModerationFlagStatus Status,
    DateTimeOffset CreatedAt,
    string MessageBody,
    bool MessageDeleted,
    string RoomSlug,
    ModActorDto? Author,
    bool AuthorBanned);

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
