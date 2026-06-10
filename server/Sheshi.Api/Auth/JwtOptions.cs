namespace Sheshi.Api.Auth;

public class JwtOptions
{
    public string Issuer { get; set; } = "https://sheshi.local";
    public string Audience { get; set; } = "sheshi-web";
    public string SigningKey { get; set; } = "local_dev_signing_key_change_me_min_32_bytes";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
}
