namespace Sheshi.Api.Domain;
public enum ReportReason { Spam, Hate, Doxxing, Violence, Other }
public enum ReportStatus { Open, Resolved, Dismissed }
public static class Roles { public const string User = "user", Moderator = "moderator", Admin = "admin"; }
