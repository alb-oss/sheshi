using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

public record AuthorDto(Guid Id, string? Username, string? DisplayName, string? AvatarUrl);

public record MessageDto(
    Guid Id,
    Guid RoomId,
    Guid AuthorId,
    Guid? ParentId,
    Guid RootMessageId,
    int Depth,
    string Body,
    string? ImageUrl,
    DateTimeOffset? DeletedAt,
    DateTimeOffset CreatedAt,
    AuthorDto? Author,
    int Upvotes,
    int ReplyCount,
    bool Voted);

public record PostMessageRequest(Guid RoomId, Guid? ParentId, string Body);

public class PostMessageForm
{
    [FromForm(Name = "room_id")] public Guid RoomId { get; set; }
    [FromForm(Name = "parent_id")] public Guid? ParentId { get; set; }
    [FromForm(Name = "body")] public string? Body { get; set; }
    [FromForm(Name = "image")] public IFormFile? Image { get; set; }
}

public record ReportMessageRequest(ReportReason Reason, string? Note);

public record ThreadDto(MessageDto Root, IReadOnlyList<ReplyNodeDto> Replies);

public record ReplyNodeDto(MessageDto Message, IReadOnlyList<ReplyNodeDto> Replies, int Depth);

public record CursorPageDto<T>(IReadOnlyList<T> Items, string? NextCursor);
