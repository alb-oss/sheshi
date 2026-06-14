#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

ROOT="${SHESHI_ROOT:-/opt/sheshi}"
GROUP="${SHESHI_GROUP:-sheshi}"
ADMIN_USER="${SHESHI_ADMIN_USER:-sheshi-admin}"
DEPLOY_USER="${SHESHI_DEPLOY_USER:-sheshi-deploy}"
SSH_PORT="${SHESHI_SSH_PORT:-22}"
SOPS_VERSION="${SHESHI_SOPS_VERSION:-3.12.2}"
SKIP_SSH_HARDENING="${SHESHI_SKIP_SSH_HARDENING:-0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

read_key_value() {
  local value_var="$1"
  local file_var="$2"
  local value="${!value_var:-}"
  local file="${!file_var:-}"

  if [ -n "$value" ]; then
    printf '%s\n' "$value"
  elif [ -n "$file" ] && [ -f "$file" ]; then
    sed -n '1p' "$file"
  fi
}

install_sops() {
  if command -v sops >/dev/null 2>&1; then
    return
  fi

  arch="$(dpkg --print-architecture)"
  case "$arch" in
    amd64) sops_arch="amd64" ;;
    arm64) sops_arch="arm64" ;;
    *) echo "Unsupported architecture for automatic SOPS install: $arch" >&2; exit 1 ;;
  esac

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN
  base="https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}"
  curl -fsSL "$base/sops-v${SOPS_VERSION}.linux.${sops_arch}" -o "$tmp_dir/sops-v${SOPS_VERSION}.linux.${sops_arch}"
  curl -fsSL "$base/sops-v${SOPS_VERSION}.checksums.txt" -o "$tmp_dir/sops-v${SOPS_VERSION}.checksums.txt"
  (cd "$tmp_dir" && sha256sum -c "sops-v${SOPS_VERSION}.checksums.txt" --ignore-missing)
  install -m 0755 "$tmp_dir/sops-v${SOPS_VERSION}.linux.${sops_arch}" /usr/local/bin/sops
}

install_packages() {
  apt-get update
  apt-get install -y \
    age \
    ca-certificates \
    curl \
    fail2ban \
    gnupg \
    jq \
    python3 \
    restic \
    ufw \
    unattended-upgrades

  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu) docker_os="$ID" ;;
    *)
      echo "Unsupported OS for Docker apt repository: ${PRETTY_NAME:-unknown}" >&2
      exit 1
      ;;
  esac

  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL "https://download.docker.com/linux/$docker_os/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  apt-get remove -y docker.io docker-compose docker-doc podman-docker containerd runc 2>/dev/null || true

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$docker_os ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  install_sops
}

configure_users() {
  groupadd -f "$GROUP"

  if ! id "$ADMIN_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --groups sudo "$ADMIN_USER"
    passwd -l "$ADMIN_USER" >/dev/null
  fi

  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --groups "$GROUP",docker "$DEPLOY_USER"
    passwd -l "$DEPLOY_USER" >/dev/null
  else
    usermod -aG "$GROUP",docker "$DEPLOY_USER"
  fi

  cat > "/etc/sudoers.d/$ADMIN_USER" <<EOF
$ADMIN_USER ALL=(ALL) NOPASSWD:ALL
EOF
  chmod 0440 "/etc/sudoers.d/$ADMIN_USER"
}

install_app_files() {
  install -d -o root -g "$GROUP" -m 0750 "$ROOT" "$ROOT/compose" "$ROOT/env" "$ROOT/scripts" "$ROOT/secrets" "$ROOT/sealed" "$ROOT/state"
  install -o root -g "$GROUP" -m 0640 "$REPO_ROOT/deploy/hetzner/docker-compose.prod.yml" "$ROOT/compose/docker-compose.prod.yml"
  install -o root -g "$GROUP" -m 0640 "$REPO_ROOT/deploy/hetzner/Caddyfile" "$ROOT/compose/Caddyfile"
  install -o root -g "$GROUP" -m 0750 "$REPO_ROOT"/deploy/hetzner/scripts/*.sh "$ROOT/scripts/"

  if [ ! -f "$ROOT/env/production.env" ]; then
    install -o root -g "$GROUP" -m 0640 "$REPO_ROOT/deploy/hetzner/production.env.example" "$ROOT/env/production.env"
  fi
}

configure_docker() {
  mkdir -p /etc/docker
  if [ ! -f /etc/docker/daemon.json ]; then
    cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
EOF
    systemctl restart docker
  fi
}

configure_firewall_and_updates() {
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "$SSH_PORT"/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable

  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  systemctl enable --now fail2ban
}

configure_ssh() {
  if [ "$SKIP_SSH_HARDENING" = "1" ]; then
    echo "Skipping SSH hardening because SHESHI_SKIP_SSH_HARDENING=1"
    return
  fi

  admin_key="$(read_key_value SHESHI_ADMIN_PUBLIC_KEY SHESHI_ADMIN_PUBLIC_KEY_FILE)"
  deploy_key="$(read_key_value SHESHI_DEPLOY_PUBLIC_KEY SHESHI_DEPLOY_PUBLIC_KEY_FILE)"

  [ -n "$admin_key" ] || { echo "Set SHESHI_ADMIN_PUBLIC_KEY or SHESHI_ADMIN_PUBLIC_KEY_FILE" >&2; exit 1; }
  [ -n "$deploy_key" ] || { echo "Set SHESHI_DEPLOY_PUBLIC_KEY or SHESHI_DEPLOY_PUBLIC_KEY_FILE" >&2; exit 1; }

  install -d -o "$ADMIN_USER" -g "$ADMIN_USER" -m 0700 "/home/$ADMIN_USER/.ssh"
  printf '%s\n' "$admin_key" > "/home/$ADMIN_USER/.ssh/authorized_keys"
  chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"
  chmod 0600 "/home/$ADMIN_USER/.ssh/authorized_keys"

  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "/home/$DEPLOY_USER/.ssh"
  printf 'restrict,command="%s/scripts/ssh-deploy-command.sh" %s\n' "$ROOT" "$deploy_key" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 0600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

  cat > /etc/ssh/sshd_config.d/99-sheshi-hardening.conf <<EOF
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
EOF

  sshd -t
  systemctl reload ssh || systemctl reload sshd
}

install_packages
configure_users
install_app_files
configure_docker
configure_firewall_and_updates
configure_ssh

echo "Bootstrap complete. Review $ROOT/env/production.env, apply SOPS secrets, then run $ROOT/scripts/preflight.sh."
