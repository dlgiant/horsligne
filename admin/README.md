# admin/ — internal admin console (static SPA, PT/EN)

Restricted internal tool. Auth = the `ADMIN_TOKEN` (sent as `Bearer`), validated
against `GET /api/admin/overview`; stored in `sessionStorage` for the tab only.
Zero build step, CSP meta, no trackers. API base via `config.js` (`window.HL_API_BASE`).

Per `docs/04` §2, admin sees audit logs read-only and **no message content by
default** (the checkpoint log view shows metadata; content stays in the staff app).

## Run in dev

```bash
# terminal 1 — API
cd backend && PORT=3000 ADMIN_TOKEN=devtoken npm start
# terminal 2 — console
cd admin && python3 -m http.server 8125
# open http://localhost:8125 → token "devtoken"
# seed demo data first: cd backend && ADMIN_TOKEN=devtoken node scripts/seed-demo.mjs
```

## Views (hash routes)

| Route | What |
|---|---|
| `#/` | Dashboard: waitlist/trips/venues/sessions/active runs/incidents/revenue stats + recent bookings & runs |
| `#/venues` | Venue list + create (emergency channel **required**) |
| `#/sessions` | Offerings list (spots, price, risk, status) + create session per venue |
| `#/trips` / `#/trips/:id` | Trip list; detail: issue portal contact (prints invite link + one-time password), revoke, bookings, runs |
| `#/runs` / `#/runs/:id` | Run list (overdue highlighted); detail: custody, extend +30 min, check-out (returns summary), log incident, checkpoint log with verify/unverify actions |
| `#/bookings` | All bookings with cancel / no-show / gift accept-decline |
| `#/audit` | Audit log, optional `?tripId=` filter |
| `#/waitlist` | Waitlist entries (admin-only PII) |

## API additions in this change (all `Bearer $ADMIN_TOKEN`)

`GET /api/admin/overview` · `/api/admin/venues` · `/api/admin/trips` ·
`/api/admin/runs?status=` · `/api/admin/bookings?status=` · `/api/admin/waitlist` ·
`/api/admin/revenue` (paid revenue per offering + total, no-show excluded)

## Files

- `index.html` / `styles.css` / `config.js` — shell, styles (portal palette + tables), API config
- `lib.js` — pure helpers (apiFetch, token store, money/ts formatting, status labels) — imported by `app.js` and tests
- `app.js` — hash router + views
- `test/lib.test.js` — `node --test` from `admin/`: helpers + full contract test booting the real backend (token gating + management flow)
