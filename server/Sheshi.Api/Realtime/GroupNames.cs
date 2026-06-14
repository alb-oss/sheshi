namespace Sheshi.Api.Realtime;

public static class GroupNames
{
    public static string Room(Guid roomId) => $"room:{roomId}";
    public static string Thread(Guid messageId) => $"thread:{messageId}";
    // Single channel every moderator/admin joins to get the live moderation queue.
    public static string Moderators() => "mod:queue";
}
