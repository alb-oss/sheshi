using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

public record AuthorDto(Guid Id, string? Username, string? DisplayName, string? AvatarUrl);

public record MessageDto(
    Guid Id,
    Guid RoomId,
    Guid AuthorId,
    Guid? ParentId,
    string Body,
    string? ImageUrl,
    DateTimeOffset? DeletedAt,
    DateTimeOffset CreatedAt,
    AuthorDto? Author,
    int Upvotes,
    int ReplyCount,
    bool Voted);

public record PostMessageRequest(Guid RoomId, Guid? ParentId, string Body);

public record ReportMessageRequest(ReportReason Reason, string? Note);
