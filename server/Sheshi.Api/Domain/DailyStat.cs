namespace Sheshi.Api.Domain;

/// <summary>
/// One immutable per-UTC-day snapshot of platform activity, written by the
/// rollup job once a day is complete. Lets the dashboard show long history
/// (30/90 days) as point reads instead of scanning the live tables.
/// </summary>
public class DailyStat
{
    public DateTime Date { get; set; } // UTC date at midnight (primary key)
    public int NewUsers { get; set; }
    public int Messages { get; set; }
    public int Votes { get; set; }
    public int Reports { get; set; }
}
