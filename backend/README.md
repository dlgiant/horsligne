# backend/ — Hors Ligne API

Zero-dependency Node (>=20) HTTP server. MVP surface is the **waitlist API** that
the landing page posts to; the full roadmap (booking engine, portal auth,
checkpoint/audit log, payments) is in `docs/10-architecture.md` and
`backend/` grows route-by-route from here.

## Quickstart

```bash
cd backend
npm start          # = node src/server.js  → http://localhost:3000
npm test           # node --test (12 tests, no deps)
```

By default the server also serves `../landing` statically, so one process
co-hosts landing + API in dev: open http://localhost:3000/ for the page and
http://localhost:3000/api/... for the API. Disable with `PUBLIC_DIR=none`.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | `{ok, service, ts}` |
| POST | `/api/waitlist` | — | Add waitlist entry. Body `{name, email, destination?, lang?, source?, ts?}` → `201 {ok,id}`; same email (case-insensitive) → `200 {ok,duplicate:true}`; invalid → `400 {error:{code:"validation"|"bad_json", details?}}`; body >64kb → `413` |
| GET | `/api/waitlist/count` | `Bearer $ADMIN_TOKEN` (if set) | `{ok, count}` |
| any | `/api/*` unknown | — | `404 {"error":{"code":"not_found","message":"Route not found"}}` |
| OPTIONS | any | — | CORS preflight → 204 |

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `DATA_DIR` | `backend/data` | JSONL store location (gitignored) |
| `ADMIN_TOKEN` | unset (open) | if set, required as Bearer token for `/api/waitlist/count` |
| `LANDING_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin`; set to the landing origin in prod |
| `PUBLIC_DIR` | `../landing` | static dir; `none` to disable |

## Wiring the landing page to this API

In `landing/index.html`, before `app.js`:

```html
<script>window.HL_WAITLIST_ENDPOINT = "/api/waitlist";</script>            <!-- co-hosted -->
<!-- or -->                                                                    
<script>window.HL_WAITLIST_ENDPOINT = "https://api.horslign.earth/api/waitlist";</script>
```

## Data & privacy (LGPD/GDPR)

- Storage now: append-only `data/waitlist.jsonl` (one JSON row per signup, UUID id). Postgres replaces it at scale — `src/store.js` is the only module that touches storage.
- Data collected: name, email, destination (optional), lang, source, timestamps. Minimal by design; no phone/GPS ever. Deletion/access requests → delete the row from the JSONL (script TODO) or query Postgres later.
- Rate limiting, TLS and secrets-vault integration land under `infra/` at deploy time.

## Layout

```
backend/
├── src/server.js     HTTP server: router, CORS, JSON body limit, static hosting
├── src/store.js      append-only JSONL store + email dedupe index (swap for Postgres later)
├── src/validate.js   waitlist payload validation/sanitizing
├── test/             node:test suite (spins the app on an ephemeral port, temp DATA_DIR)
└── data/             runtime store (gitignored, .gitkeep only)
```

## Next routes (weeks 3–6 build)

1. `POST /api/trips` + portal-contact issuance (link + password + OTP) — `docs/04`
2. Booking engine: `POST /api/sessions/:id/book`, capacity/waitlist/no-show — `docs/01` §7
3. Checkpoint log (append-only, timestamped) + check-out summary — `docs/05`
4. RevenueCat webhooks — `docs/01` §8
