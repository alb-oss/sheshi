namespace Sheshi.Api.Auth;

public class JwtOptions
{
    public string Issuer { get; set; } = "https://sheshi.local";
    public string Audience { get; set; } = "sheshi-web";
    public string SigningKey { get; set; } = "local_dev_signing_key_change_me_min_32_bytes";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;

    // Name of the HttpOnly cookie that carries the refresh token for browser clients (so JS — and
    // therefore any XSS — can never read it). Mobile keeps using the body token.
    public string RefreshCookieName { get; set; } = "sheshi_rt";
    // Cookie Domain attribute. Empty = host-only (scoped to the API host that set it, e.g.
    // api.sheshi.live), which is the correct default given the web origin is same-site.
    public string CookieDomain { get; set; } = "";
}
