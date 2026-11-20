# Secrets — generation, storage, rotation

**Rule: secrets never enter the repo.** Root `.gitignore` blocks `.env*`;
`backend/.gitignore` blocks `data/*.jsonl`. On servers they live in
`/etc/horsligne/env` (systemd `EnvironmentFile=`, mode `600`, owned by root).

## Generate (run anywhere, zero deps)

```bash
# 256-bit hex secrets — use for all three below
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| Var | Purpose | Where it lives |
|---|---|---|
| `SESSION_SECRET` | HMAC key for portal + traveler session tokens (`s1.…`) | env file; rotation kills all sessions (acceptable: users re-login) |
| `REVENUECAT_WEBHOOK_SECRET` | RevenueCat webhook signing secret | env file **and** RevenueCat dashboard → Project settings → Webhooks |
| `ADMIN_TOKEN` | Bearer token for admin/staff routes + admin console login | env file; staff app users enter it manually; rotate = re-share with staff |

`OTP_DEV_REVEAL` must be `0` (or unset) in prod — it puts OTPs in API responses.

## Rotation procedure

1. Generate a new value with the one-liner above.
2. `sudoedit /etc/horsligne/env`, `sudo systemctl restart horsligne-backend`.
3. For `REVENUECAT_WEBHOOK_SECRET` also update the RevenueCat dashboard (events
   signed with the old secret start failing with 401 — check `webhook.rejected`
   in the audit log).
4. For `ADMIN_TOKEN`, redistribute to staff out-of-band.
5. Record the rotation (who/when) in the audit log via a manual note to the ops channel.

## Vault

When the team grows: move `/etc/horsligne/env` to a vault (e.g. Doppler, 1Password
Connect, or sops + git). The backend reads plain env vars only — no code change needed.
