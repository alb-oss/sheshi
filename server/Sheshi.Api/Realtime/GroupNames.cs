namespace Sheshi.Api.Realtime;

public static class GroupNames
{
    public static string Room(Guid roomId) => $"room:{roomId}";
    public static string Thread(Guid messageId) => $"thread:{messageId}";
}
