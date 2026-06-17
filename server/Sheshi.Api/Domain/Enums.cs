namespace Sheshi.Api.Domain;

public enum ReportReason { Spam, Hate, Doxxing, Violence, Other }

public enum ReportStatus { Open, Resolved, Dismissed }

public enum ModerationCategory { Spam, Hate, Doxxing, Violence, Harassment, Other }

public enum ModerationSeverity { Low, Medium, High, Critical }

public enum ModerationFlagStatus { Open, Resolved, Dismissed }

// Lifecycle of a civic proposal. Pending → Proposed is the moderator-publish gate; Proposed → Approved is
// the supermajority+quorum vote promotion (one-way). Rejected is the moderator decision at the queue.
public enum ProposalStatus { Pending, Proposed, Approved, Rejected }

// The fixed, spec-defined civic categories (Laws / Health / Education / Development). Serialized as
// snake_case strings on the wire ("ligje", "shendetesi", "arsim", "zhvillim").
public enum ProposalCategory { Ligje, Shendetesi, Arsim, Zhvillim }

public static class Roles
{
    public const string User = "user";
    public const string Moderator = "moderator";
    public const string Admin = "admin";
    public const string ModeratorOrAdmin = Moderator + "," + Admin;
}

public static class ModerationActionTypes
{
    public const string ReportResolved = "report_resolved";
    public const string ReportDismissed = "report_dismissed";
    public const string MessageDeleted = "message_deleted";
    public const string UserBanned = "user_banned";
    public const string UserUnbanned = "user_unbanned";
    public const string RoleGranted = "role_granted";
    public const string RoleRemoved = "role_removed";
    public const string RoomCreated = "room_created";
    public const string FlagResolved = "flag_resolved";
    public const string FlagDismissed = "flag_dismissed";
    public const string ProposalPublished = "proposal_published";
    public const string ProposalRejected = "proposal_rejected";
    public const string ProposalClosed = "proposal_closed";
}
