# infra/ — deployment, CI, secrets

Target architecture (docs/10): **one small VPS**, nginx terminates TLS and serves the
static sites; the zero-dependency Node backend runs under systemd and stores JSONL in
`backend/data/` (Postgres swap point documented in `backend/src/store.js`).

```
horslign.earth        → landing/   (static, PT/EN)
portal.horslign.earth → portal/    (static SPA)
admin.horslign.earth  → admin/     (static SPA)
api.horslign.earth    → /api/* proxied to 127.0.0.1:3000 (backend, systemd)
```

## Environments

| Env | Host | Branch deployed | Secrets |
|---|---|---|---|
| dev | localhost | whatever you run | `.env` (gitignored) |
| staging | staging.horslign.earth | `main` after PR merge | `/etc/horsligne/env.staging` |
| prod | horslign.earth | tagged release | `/etc/horsligne/env` (mode 600) |

## Files

- `nginx-horsligne.conf` — TLS + static + `/api/` proxy (certbot for certificates)
- `horsligne-backend.service` — systemd unit, hardened, `EnvironmentFile=/etc/horsligne/env`
- `.env.example` — every env var the backend reads, with comments
- `secrets.md` — generation, storage, rotation (never commit secrets; root `.gitignore` blocks `.env*`)
- `deploy.sh` — rsync the repo to the VPS + restart + healthcheck: `./infra/deploy.sh deploy@host prod`
- `backup.sh` — timestamped backups of the append-only JSONL store (audit included), 30-day retention
- `healthcheck.sh` — `/api/health` + prod secret-presence check (run on the server or via cron)
- `satellite-checklist.md` — satellite communicator provisioning for remote venues (docs/05 channel 1)
- `../.github/workflows/ci.yml` — CI on every PR: backend + portal + admin tests, Flutter analyze + test

## First-time server setup (prod)

```bash
# on the VPS, once:
sudo apt update && sudo apt install -y nginx nodejs certbot python3-certbot-nginx rsync
sudo mkdir -p /srv/horsligne /etc/horsligne /var/backups/horsligne
sudo cp infra/horsligne-backend.service /etc/systemd/system/
sudo cp infra/nginx-horsligne.conf /etc/nginx/sites-available/horsligne
sudo ln -s /etc/nginx/sites-available/horsligne /etc/nginx/sites-enabled/
sudoedit /etc/horsligne/env        # fill from infra/.env.example + infra/secrets.md, chmod 600
sudo certbot --nginx -d horslign.earth -d www.horslign.earth -d portal.horslign.earth -d admin.horslign.earth -d api.horslign.earth
sudo systemctl enable --now horsligne-backend nginx

# deploy from your machine:
./infra/deploy.sh deploy@horslign.earth prod

# backups + healthcheck via cron:
#   17 3 * * * /srv/horsligne/infra/backup.sh
#   */5 * * * * /srv/horsligne/infra/healthcheck.sh
```

## RevenueCat webhook (prod)

Point the RevenueCat dashboard webhook at `https://api.horslign.earth/api/webhooks/revenuecat`
and set the same secret in `/etc/horsligne/env` as `REVENUECAT_WEBHOOK_SECRET`.
Unsigned payloads are rejected with 401 when the secret is set (see `infra/secrets.md`).
