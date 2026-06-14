using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;

namespace Sheshi.Api.Health;

public static class ReadinessChecks
{
    public static async Task<IResult> CheckAsync(AppDbContext db, CancellationToken ct)
    {
        var canConnect = await db.Database.CanConnectAsync(ct);
        return canConnect
            ? Results.Text("ready")
            : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
}
