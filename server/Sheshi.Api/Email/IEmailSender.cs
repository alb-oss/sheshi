namespace Sheshi.Api.Email;

public interface IEmailSender
{
    Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken ct = default);
}
