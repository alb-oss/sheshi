namespace Sheshi.Api.Features.Users;

// The karma economy as a pure function, so it can be reasoned about and unit-tested in isolation.
// Karma is earned ONLY from upvotes other users give you (posting earns nothing; self-votes are excluded
// upstream), and only with diminishing returns so a single viral post can't mint karma.
public static class KarmaCurve
{
    // A message must clear this net (from other users) before it counts at all — a downvoted or ignored
    // post yields 0, never negative.
    public const int MinNet = 1;

    // Full 1:1 credit up to the knee; sub-linear (sqrt) beyond it.
    public const int Knee = 10;

    // Karma a single message earns from its net upvotes by OTHER users.
    // e.g. 0→0, 1→1, 10→10, 11→11, 19→13, 110→20, 1010→41.
    public static int Message(int netFromOthers)
    {
        if (netFromOthers < MinNet) return 0;
        var full = Math.Min(netFromOthers, Knee);
        var beyond = netFromOthers > Knee ? (int)Math.Floor(Math.Sqrt(netFromOthers - Knee)) : 0;
        return full + beyond;
    }

    // Total karma = the dampened sum across the user's messages, floored at 0.
    public static int Total(IEnumerable<int> perMessageNetFromOthers)
        => Math.Max(0, perMessageNetFromOthers.Sum(Message));
}
