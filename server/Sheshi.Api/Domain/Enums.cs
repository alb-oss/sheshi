namespace Sheshi.Api.Domain;

public enum ReportReason { Spam, Hate, Doxxing, Violence, Other }

public enum ReportStatus { Open, Resolved, Dismissed }

public static class Roles
{
    public const string User = "user";
    public const string Moderator = "moderator";
    public const string Admin = "admin";
    public const string ModeratorOrAdmin = Moderator + "," + Admin;
}
