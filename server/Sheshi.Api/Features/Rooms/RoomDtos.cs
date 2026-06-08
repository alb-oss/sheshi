namespace Sheshi.Api.Features.Rooms;

public record RoomDto(Guid Id, string Slug, string Name, string? Description);
