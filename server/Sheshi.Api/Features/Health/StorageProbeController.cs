using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Features.Health;

// TEMPORARY diagnostic: writes a tiny object through the configured IBlobStore (S3/R2 in prod) and
// returns the real outcome — so an upload failure can be pinpointed without server-shell access.
// Auth-gated (any signed-in user) on purpose so it can be probed remotely; it exposes only the error
// type/message (never credentials). Remove or lock to admins once uploads are confirmed healthy.
[ApiController]
[Route("api/health")]
public class StorageProbeController(
    IBlobStore blobStore,
    IOptions<StorageOptions> options,
    ILogger<StorageProbeController> logger) : ControllerBase
{
    [Authorize]
    [HttpGet("storage")]
    public async Task<IActionResult> Storage(CancellationToken ct)
    {
        var provider = options.Value.Provider;
        var bytes = System.Text.Encoding.UTF8.GetBytes("sheshi-storage-probe");
        var name = $"health/probe-{Guid.NewGuid():N}.txt";
        try
        {
            var url = await blobStore.PutAsync(bytes, name, "text/plain", ct);
            return Ok(new { ok = true, provider, url });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Storage health probe failed (provider={Provider})", provider);
            return Ok(new
            {
                ok = false,
                provider,
                errorType = ex.GetType().FullName,
                message = ex.Message,
                inner = ex.InnerException?.Message,
            });
        }
    }
}
