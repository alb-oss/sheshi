using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Health;

public static class ReadinessChecks
{
    // Storage is verified ONCE per process. A misconfigured object store (e.g. the R2 signing break)
    // fails this readiness gate — and deploy.sh waits on /health/ready, so a bad config fails the deploy
    // and rolls back, caught before any user upload. Once the write succeeds we stop re-probing, so a
    // later transient storage blip can't flip the container unhealthy and take the API down.
    private static volatile bool _storageVerified;

    public static async Task<IResult> CheckAsync(AppDbContext db, IBlobStore blobStore, CancellationToken ct)
    {
        if (!await db.Database.CanConnectAsync(ct))
            return Results.Json(
                new { status = "not-ready", db = "fail" },
                statusCode: StatusCodes.Status503ServiceUnavailable);

        if (!_storageVerified)
        {
            try
            {
                // Fixed key → overwrites, never litters. Exercises the real PutObject path (signing,
                // checksums, creds, connectivity) the way uploads do.
                var probe = System.Text.Encoding.UTF8.GetBytes("ready");
                await blobStore.PutAsync(probe, "health/readiness-probe.txt", "text/plain", ct);
                _storageVerified = true;
            }
            catch (Exception ex)
            {
                return Results.Json(
                    new { status = "not-ready", storage = "fail", error = ex.Message },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        }

        return Results.Text("ready");
    }
}
