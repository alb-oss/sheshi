# Production Sealed Secrets

This directory is for SOPS-encrypted production secrets.

The committed shape is:

- `production.sops.yaml.example`: plaintext field template with fake values.
- `production.sops.yaml`: real encrypted production values, created with SOPS and safe to commit once every value is real.

The age private key is never committed. On this workstation it was generated at:

```text
.local/secrets/sheshi-production-age-key.txt
```

Back it up in a password manager before relying on it for production.

Create the encrypted file:

```bash
deploy/hetzner/scripts/secrets-template.sh
sops edit deploy/hetzner/secrets/production.sops.yaml
```

Install it on the VM:

```bash
sudo install -d -m 0700 /etc/sops/age
sudo install -m 0600 sheshi-production-age-key.txt /etc/sops/age/keys.txt
sudo SOPS_AGE_KEY_FILE=/etc/sops/age/keys.txt \
  /opt/sheshi/scripts/secrets-apply.sh /opt/sheshi/sealed/production.sops.yaml
```
