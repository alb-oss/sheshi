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
    string? VideoUrl,
    DateTimeOffset? DeletedAt,
    DateTimeOffset CreatedAt,
    AuthorDto? Author,
    int Score,
    int ReplyCount,
    int MyVote);

public record PostMessageRequest(Guid RoomId, Guid? ParentId, string Body);

public record VoteRequest(int Value);

public record ReportMessageRequest(ReportReason Reason, string? Note);

public record ThreadDto(MessageDto Root, IReadOnlyList<ReplyNodeDto> Replies);

public record ReplyNodeDto(MessageDto Message, IReadOnlyList<ReplyNodeDto> Replies, int Depth);

public record CursorPageDto<T>(IReadOnlyList<T> Items, string? NextCursor);
