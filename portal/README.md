# portal/ — family web portal (static SPA, PT/EN)

For loved ones at home. Open the per-trip invite link → password → one-time code
(link + password + OTP per `docs/04-portal-security-spec.md`). Zero build step:
plain HTML/CSS/JS modules, same calm design as `landing/`, CSP meta tag, no
trackers. API base is set in `config.js` (`window.HL_API_BASE`).

## Run in dev

```bash
# terminal 1 — API (serves on :3000)
cd backend && PORT=3000 ADMIN_TOKEN=devtoken OTP_DEV_REVEAL=1 PORTAL_BASE_URL='http://localhost:8124/#' npm start
# terminal 2 — portal statically on :8124
cd portal && python3 -m http.server 8124
# terminal 3 — seed the fictional demo data (docs/02) and print invite link + password
cd backend && ADMIN_TOKEN=devtoken API_BASE=http://localhost:3000 PORTAL_BASE_URL='http://localhost:8124/#' node scripts/seed-demo.mjs
```

Open the printed invite link (`http://localhost:8124/#/p/<token>`). With
`OTP_DEV_REVEAL=1` the API returns the OTP in the response and the login form
prefills it (demo only — real SMS/email delivery plugs in under `infra/`).

## What it shows

- **Status card**: session status (scheduled / in progress / checked out /
  **overdue** after expected check-out + 30 min, with the venue emergency
  contact), dual timezone (venue + traveler's home), "last synced" — venue +
  city only, never GPS (`docs/04` §3)
- **Incident banner** when a verified life-threatening message interrupts
- **Messages**: send routine/urgent (20/h limit); urgent shows verification
  state; delivery confirmation appears at check-out (`docs/05` §2/§5)
- **Explore & book**: destination catalog with risk labels, price, spots left,
  venue emergency channel; book as gift or propose (`POST /api/portal/book`)
- **Bookings** for the trip + **check-out summary** after the session
- Auto-refreshes status every 30s; PT/EN toggle (persisted); logout revokes the
  session server-side

## Files

- `index.html` — shell + CSP
- `config.js` — `window.HL_API_BASE` (edit at deploy; default `http://localhost:3000`)
- `lib.js` — pure helpers (API client, invite-token parsing, dual-tz formatting,
  PT/EN labels, session store) — imported by `app.js` **and** by tests
- `app.js` — hash router (`#/p/<token>` login, `#/` dashboard) + views
- `test/lib.test.js` — run from `portal/`: `node --test` (helpers + full API
  contract test that boots the real backend on an ephemeral port)

## Notes

- Invite links are `PORTAL_BASE_URL + "/p/" + token`; with hash routing the dev
  base is `http://localhost:8124/#`. In prod, either keep hash routing or make
  the host rewrite `/p/*` to `index.html`.
- Session is kept in `sessionStorage` and sent as `Bearer` (spec §1 wants an
  httpOnly+Secure+SameSite=Strict cookie in prod — the API already issues opaque
  HMAC tokens, so the deployed portal host can switch to cookie mode without
  backend changes).
- Link tokens rotate on every login (old link dies) — the UI tells the user to
  ask the traveler for the newest link when that happens.
