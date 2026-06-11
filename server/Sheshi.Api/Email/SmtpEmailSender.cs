using System.Net;
using System.Net.Mail;

namespace Sheshi.Api.Email;

public class SmtpEmailSender(IConfiguration configuration, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken ct = default) =>
        SendAsync(email, "Rivendos fjalëkalimin — Sheshi", $"Përdor këtë link për të rivendosur fjalëkalimin: {resetUrl}", ct);

    public Task SendEmailConfirmationAsync(string email, string confirmUrl, CancellationToken ct = default) =>
        SendAsync(email, "Konfirmo email-in — Sheshi", $"Përdor këtë link për të konfirmuar email-in tënd: {confirmUrl}", ct);

    private async Task SendAsync(string email, string subject, string body, CancellationToken ct)
    {
        var host = configuration["Smtp:Host"];
        if (string.IsNullOrWhiteSpace(host))
        {
            logger.LogWarning("SMTP host is not configured; email for {Email} was not sent.", email);
            return;
        }

        var port = int.TryParse(configuration["Smtp:Port"], out var parsedPort) ? parsedPort : 25;
        var from = configuration["Smtp:FromEmail"] ?? "no-reply@sheshi.local";
        using var message = new MailMessage(from, email)
        {
            Subject = subject,
            Body = body
        };
        using var client = new SmtpClient(host, port)
        {
            EnableSsl = bool.TryParse(configuration["Smtp:EnableSsl"], out var ssl) && ssl
        };

        var username = configuration["Smtp:Username"];
        var password = configuration["Smtp:Password"];
        if (!string.IsNullOrWhiteSpace(username) && !string.IsNullOrWhiteSpace(password))
            client.Credentials = new NetworkCredential(username, password);

        await client.SendMailAsync(message, ct);
    }
}
