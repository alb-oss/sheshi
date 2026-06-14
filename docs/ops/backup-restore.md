# Backup And Restore Runbook

## Backup Schedule

Run this daily from the production VM:

```bash
/opt/sheshi/scripts/backup-now.sh
```

The script dumps Postgres, sends the encrypted backup to Hetzner Object Storage
with restic, prunes old snapshots, and writes `/opt/sheshi/state/last-backup-at`.

## Retention

- 7 daily backups.
- 5 weekly backups.
- 12 monthly backups.

## Restore Drill

Run this monthly from the production VM:

```bash
/opt/sheshi/scripts/restore-drill.sh
```

The drill restores the latest backup into a temporary Postgres container and
checks that the `Rooms` table is queryable.

## Production Restore

1. Stop web and API containers.
2. Keep Postgres stopped until the restore target is selected.
3. Restore the selected encrypted backup from Hetzner Object Storage.
4. Restore into Postgres with `pg_restore`.
5. Start API.
6. Check `/health/ready`.
7. Start web.
8. Check `https://sheshi.al`.

## Manual Snapshot Inspection

```bash
RESTIC_PASSWORD_FILE=/opt/sheshi/secrets/backup_encryption_key \
AWS_ACCESS_KEY_ID="$(cat /opt/sheshi/secrets/object_storage_access_key)" \
AWS_SECRET_ACCESS_KEY="$(cat /opt/sheshi/secrets/object_storage_secret_key)" \
restic -r "$(sed -n 's/^RESTIC_REPOSITORY=//p' /opt/sheshi/env/production.env | tail -n 1)" snapshots
```

Never copy unencrypted database dumps off the VM. If a dump must be handled
manually during an incident, remove it as soon as the restore is verified.
