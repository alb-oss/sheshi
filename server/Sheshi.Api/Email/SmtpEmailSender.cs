using System.Net;
using System.Net.Mail;
using Sheshi.Api.Configuration;

namespace Sheshi.Api.Email;

public class SmtpEmailSender(IConfiguration configuration, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public async Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken ct = default)
    {
        var host = configuration["Smtp:Host"];
        if (string.IsNullOrWhiteSpace(host))
        {
            logger.LogWarning("SMTP host is not configured; password reset email for {Email} was not sent.", email);
            return;
        }

        var port = int.TryParse(configuration["Smtp:Port"], out var parsedPort) ? parsedPort : 25;
        var from = configuration["Smtp:FromEmail"] ?? "no-reply@sheshi.local";
        using var message = new MailMessage(from, email)
        {
            Subject = "Rivendos fjalëkalimin — Sheshi",
            Body = $"Përdor këtë link për të rivendosur fjalëkalimin: {resetUrl}"
        };
        using var client = new SmtpClient(host, port)
        {
            EnableSsl = bool.TryParse(configuration["Smtp:EnableSsl"], out var ssl) && ssl
        };

        var username = configuration["Smtp:Username"];
        var password = configuration.GetSecretValue("Smtp:Password");
        if (!string.IsNullOrWhiteSpace(username) && !string.IsNullOrWhiteSpace(password))
            client.Credentials = new NetworkCredential(username, password);

        await client.SendMailAsync(message, ct);
    }
}
