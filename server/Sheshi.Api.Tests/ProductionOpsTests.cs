using FluentAssertions;

namespace Sheshi.Api.Tests;

public class ProductionOpsTests
{
    private static readonly string RepoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));

    [Fact]
    public void Sops_config_targets_only_production_sealed_secret_files()
    {
        var config = File.ReadAllText(Path.Combine(RepoRoot, ".sops.yaml"));

        config.Should().Contain("path_regex: ^deploy/hetzner/secrets/.*\\.sops\\.yaml$");
        config.Should().Contain("age1s7x558ammztlrxzvth07rayz8wp4wclqh59nhyrvzelz4tranq7sux2qmt");
        config.Should().Contain("encrypted_regex:");
        config.Should().Contain("db_connection_string");
        config.Should().Contain("backup_encryption_key");
    }

    [Fact]
    public void Production_secret_template_lists_every_required_runtime_secret()
    {
        var template = File.ReadAllText(Path.Combine(
            RepoRoot,
            "deploy/hetzner/secrets/production.sops.yaml.example"));

        foreach (var name in RequiredSecretNames)
            template.Should().Contain($"{name}:");
    }

    [Fact]
    public void Deploy_runs_preflight_before_changing_the_persisted_image_tag()
    {
        var deploy = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/scripts/deploy.sh"));
        var preflightIndex = deploy.IndexOf("\"$ROOT/scripts/preflight.sh\" \"$TAG\"", StringComparison.Ordinal);
        var registryLoginIndex = deploy.IndexOf("\n  registry_login_from_stdin\n", StringComparison.Ordinal);
        var setTagIndex = deploy.IndexOf("set_image_tag \"$TAG\"", StringComparison.Ordinal);

        preflightIndex.Should().BeGreaterThan(-1);
        registryLoginIndex.Should().BeGreaterThan(-1);
        setTagIndex.Should().BeGreaterThan(-1);
        preflightIndex.Should().BeLessThan(registryLoginIndex);
        preflightIndex.Should().BeLessThan(setTagIndex);
        deploy.Should().Contain("SHESHI_IMAGE_TAG=\"$TAG\" docker compose --env-file \"$ENV_FILE\" -f \"$COMPOSE\" pull web api");
    }

    [Fact]
    public void Deploy_workflow_uses_short_lived_registry_token_without_persisting_a_pull_secret()
    {
        var workflow = File.ReadAllText(Path.Combine(RepoRoot, ".github/workflows/deploy-production.yml"));
        var deploy = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/scripts/deploy.sh"));

        workflow.Should().Contain("packages: read");
        workflow.Should().Contain("GHCR_TOKEN: ${{ github.token }}");
        workflow.Should().Contain("printf '%s\\n' \"$GHCR_TOKEN\"");
        workflow.Should().Contain("/opt/sheshi/scripts/deploy.sh '$DEPLOY_SHA'");

        deploy.Should().Contain("mktemp -d");
        deploy.Should().Contain("docker login ghcr.io");
        deploy.Should().Contain("docker logout ghcr.io");
        deploy.Should().Contain("rm -rf \"$DOCKER_CONFIG\"");
    }

    [Fact]
    public void Published_images_include_repository_source_labels()
    {
        var publish = File.ReadAllText(Path.Combine(RepoRoot, ".github/workflows/publish-images.yml"));
        var webDockerfile = File.ReadAllText(Path.Combine(RepoRoot, "Dockerfile.web"));
        var apiDockerfile = File.ReadAllText(Path.Combine(RepoRoot, "server/Sheshi.Api/Dockerfile"));

        publish.Should().Contain("org.opencontainers.image.source=https://github.com/alb-oss/sheshi");
        publish.Should().Contain("org.opencontainers.image.revision=${{ github.event.workflow_run.head_sha }}");
        webDockerfile.Should().Contain("org.opencontainers.image.source=\"https://github.com/alb-oss/sheshi\"");
        apiDockerfile.Should().Contain("org.opencontainers.image.source=\"https://github.com/alb-oss/sheshi\"");
    }

    [Fact]
    public void Migration_step_uses_the_new_image_tag()
    {
        var migrate = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/scripts/migrate.sh"));

        migrate.Should().Contain("SHESHI_IMAGE_TAG=\"$TAG\" docker compose");
        migrate.Should().Contain("api --migrate-only");
    }

    [Fact]
    public void Ssh_deploy_command_only_allows_deploying_sha_tags()
    {
        var command = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/scripts/ssh-deploy-command.sh"));

        command.Should().Contain("SSH_ORIGINAL_COMMAND");
        command.Should().Contain("[0-9a-f]{40}");
        command.Should().Contain("exec /opt/sheshi/scripts/deploy.sh");
        command.Should().Contain("Rejected SSH command");
    }

    [Fact]
    public void Bootstrap_script_enforces_host_security_controls()
    {
        var bootstrap = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/scripts/bootstrap-server.sh"));

        bootstrap.Should().Contain("PermitRootLogin no");
        bootstrap.Should().Contain("PasswordAuthentication no");
        bootstrap.Should().Contain("ufw default deny incoming");
        bootstrap.Should().Contain("unattended-upgrades");
        bootstrap.Should().Contain("fail2ban");
        bootstrap.Should().Contain("restrict,command=");
        bootstrap.Should().Contain("-m 0770 \"$ROOT/env\" \"$ROOT/state\"");
        bootstrap.Should().Contain("chmod 0660 \"$ROOT/env/production.env\"");
        bootstrap.Should().Contain("debian|ubuntu");
        bootstrap.Should().Contain("https://download.docker.com/linux/$docker_os");
        bootstrap.Should().NotContain("https://download.docker.com/linux/ubuntu ${VERSION_CODENAME}");
    }

    [Fact]
    public void Caddyfile_sets_baseline_security_headers()
    {
        var caddy = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/Caddyfile"));

        caddy.Should().Contain("Strict-Transport-Security \"max-age=31536000; includeSubDomains\"");
        caddy.Should().Contain("X-Frame-Options \"DENY\"");
        caddy.Should().Contain("X-Content-Type-Options \"nosniff\"");
        caddy.Should().Contain("Referrer-Policy \"strict-origin-when-cross-origin\"");
        caddy.Should().Contain("Permissions-Policy \"geolocation=(), microphone=(), camera=()\"");
    }

    [Fact]
    public void Secrets_apply_rejects_missing_or_placeholder_values()
    {
        var apply = File.ReadAllText(Path.Combine(RepoRoot, "deploy/hetzner/scripts/secrets-apply.sh"));

        foreach (var name in RequiredSecretNames)
            apply.Should().Contain($"\"{name}\"");

        apply.Should().Contain("CHANGE_ME");
        apply.Should().Contain("Secret still contains a placeholder");
        apply.Should().Contain("chmod 640");
    }

    private static readonly string[] RequiredSecretNames =
    [
        "db_password",
        "db_connection_string",
        "jwt_signing_key",
        "smtp_password",
        "object_storage_access_key",
        "object_storage_secret_key",
        "backup_storage_access_key",
        "backup_storage_secret_key",
        "backup_encryption_key"
    ];
}
