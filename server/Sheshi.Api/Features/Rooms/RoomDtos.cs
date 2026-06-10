namespace Sheshi.Api.Features.Rooms;

public record RoomDto(
    Guid Id,
    string Slug,
    string Name,
    string? Description,
    int ThreadCount,
    DateTimeOffset? LatestActivityAt);

public record CreateRoomRequest(string Name, string? Slug, string? Description);
