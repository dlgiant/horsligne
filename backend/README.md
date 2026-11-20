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
| POST | `/api/trips` | admin | Create trip `{travelerFirstName, destination, city?, startDate, endDate, homeTz?}` → `201 {trip}` |
| GET | `/api/trips/:id` | admin | Trip + contacts (identifiers masked, no secrets) |
| POST | `/api/trips/:id/contacts` | admin | Issue portal credentials `{name, channel: sms\|email, identifier}` → `201 {contact, portalUrl, password (shown once), expiresAt}` |
| POST | `/api/trips/:id/contacts/:cid/revoke` | admin | Revoke contact; kills all its sessions immediately |
| GET | `/api/audit?tripId=` | admin | Append-only audit events (spec §4 schema) |
| POST | `/api/portal/start` | public | `{linkToken, password}` → sends OTP → `200 {otpId, channel, expiresAt}` (`devOtp` only with `OTP_DEV_REVEAL=1`); `401 invalid_link/invalid_password`, `403 revoked`, `410 expired`, `429 rate_limited` |
| POST | `/api/portal/resend-otp` | public | `{otpId}` → new OTP (3/10min per contact) |
| POST | `/api/portal/verify` | public | `{otpId, otp}` → `200 {session, expiresAt, portalUrl (rotated), contact, trip}`; `401 invalid_otp` (5 tries), `423 otp_locked` (+traveler notified), `410 otp_expired` |
| GET | `/api/portal/me` | `Bearer session` | `{contact, trip, sessionExpiresAt}` — data-minimized (spec §3: never phone/GPS/payment); session slides to +24h |
| POST | `/api/portal/logout` | `Bearer session` | Revokes session |
| POST | `/api/venues` | admin | Create venue — `emergencyChannel` **required** (no channel = no sessions, master plan §5) |
| POST | `/api/venues/:id/sessions` | admin | Create bookable session `{title, kind, startAt, endAt, capacity, priceCentsBRL, risk: low\|moderate\|semi-risky}` |
| GET | `/api/catalog?destination=` | public | "Explore & book" source: open sessions with risk label, price, spotsLeft, venue name+city+tz+emergency channel — never GPS |
| GET | `/api/sessions/:id` | public | Session + venue + spotsLeft + status |
| POST | `/api/sessions/:id/book` | admin (traveler stand-in) or `Bearer session` | `{tripId, gift?}` → booking `pending_payment` (or `waitlisted` when full) + price in BRL cents |
| GET | `/api/portal/catalog` | `Bearer session` | Catalog + trip (`homeTz` for dual-timezone display) |
| POST | `/api/portal/book` | `Bearer session` | Family books as gift/propose: `{offeringId, gift?}` → traveler later accepts/declines |
| GET | `/api/portal/bookings` | `Bearer session` | All bookings for the contact's trip |
| GET | `/api/trips/:id/bookings` | admin | Bookings for a trip |
| POST | `/api/webhooks/revenuecat` | — (dev stub; signature check lands with `infra/`) | `{bookingId, event: payment.succeeded\|payment.failed}` — paid / cancel+promote waitlist |
| POST | `/api/bookings/:id/cancel` | admin or owning session | Cancel; frees spot → promotes earliest waitlisted (`waitlist.promoted`) |
| POST | `/api/bookings/:id/decide` | admin (traveler stand-in) | `{accept: bool}` on pending gift bookings → `booking.accepted` / `declined` |
| POST | `/api/bookings/:id/no-show` | admin (staff) | Paid → `no_show` + `noShowFee` flag (fee charged via RevenueCat later) |
| any | `/api/*` unknown | — | `404 {"error":{"code":"not_found","message":"Route not found"}}` |
| OPTIONS | any | — | CORS preflight → 204 |

## Booking engine notes

- Capacity counts `pending_payment` + `paid` bookings; when full, new bookings go to `waitlisted` (FIFO) and the offering flips to `full`. Cancel/payment-failed frees the spot and promotes the earliest waitlisted entry.
- Prices are integer cents BRL (`priceCentsBRL`; R$ 90 = `9000`). Launch-town 50% first-session discount is a pricing-layer TODO (master plan §9).
- Gift bookings (`bookedBy.type = "contact"`) start with `decision: "pending"`; the traveler accepts/declines (`booking.accepted`/`declined` audit actions, spec §4).
- Audit actions added: `venue.created, session.created, catalog.viewed, booking.created, booking.cancelled, booking.accepted, booking.declined, booking.no_show, waitlist.joined, waitlist.promoted, payment.succeeded, payment.failed`.

## Portal security (implements `docs/04-portal-security-spec.md`)

- **Credentials:** per-trip, per-contact invite link (single 128-bit token in the URL path, stored **hashed** only) + per-contact password (12 chars, scrypt-hashed — spec says bcrypt, scrypt is the node:crypto equivalent) + OTP (6 digits, 10-min expiry, 5 attempts → lockout + traveler notification queued in `data/notifications.jsonl`).
- **Login:** link → password → OTP → HMAC-signed session (`s1.…`, 24h sliding). **Link token rotates on every successful login** (old link dies immediately).
- **Expiry/revocation:** credentials expire at trip end + 24h; traveler revoke kills sessions instantly.
- **Rate limits (spec §5):** login 5/15min per token + per IP; OTP resend 3/10min per contact.
- **Audit log:** append-only `data/audit.jsonl`, spec §4 schema (`id, createdAt, actorType, actorId, action, objectType, objectId, ip, userAgent, detail`) — actions: `trip.created, credential.issued, credential.rotated, credential.revoked, otp.sent, otp.locked, login.success, login.fail, login.logout, status.viewed`.
- **Data minimization (spec §3):** portal responses never include phone, GPS, payment data, or raw secrets.
- **Documented deviation from spec §1:** credentials are usable from issuance (not only from trip start) until trip end + 24h, because families log in pre-trip to book gifts (master plan §4).
- **Dev/demo:** `OTP_DEV_REVEAL=1` returns the OTP in the API response; real SMS/email delivery plugs in under `infra/` via the `notifications` queue. `PORTAL_BASE_URL` builds invite links. Management routes use `ADMIN_TOKEN` as a stand-in for traveler/staff auth until the client app lands.


## Env vars

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `DATA_DIR` | `backend/data` | JSONL store location (gitignored) |
| `ADMIN_TOKEN` | unset (open) | if set, required as Bearer token for `/api/waitlist/count` |
| `LANDING_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin`; set to the landing origin in prod |
| `PUBLIC_DIR` | `../landing` | static dir; `none` to disable |
| `PORTAL_BASE_URL` | `http://localhost:8080` | base for invite links (`{PORTAL_BASE_URL}/p/{token}`) |
| `SESSION_SECRET` | dev default + warning | HMAC secret for portal sessions — **set in prod** |
| `OTP_DEV_REVEAL` | unset | `1` = include OTP in API responses (dev/demo only) |

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
├── src/server.js       HTTP server: CORS, JSON body limit, static hosting, /api delegation
├── src/api.js          all routes: waitlist, trips, portal auth, audit
├── src/collections.js  generic JSONL collection (supersede-on-update; audit stays append-only)
├── src/store.js        waitlist store + email dedupe
├── src/security.js     scrypt, HMAC sessions, OTP, token/password gen, rate limiter, masking
├── src/validate.js     payload validation/sanitizing
├── test/               node:test suites (ephemeral port, temp DATA_DIR) — 21 tests
└── data/               runtime stores: waitlist/trips/contacts/sessions/audit/notifications .jsonl (gitignored)
```

## Next routes (weeks 3–6 build)

1. Checkpoint log (append-only, timestamped) + check-out summary — `docs/05`
2. Traveler auth for the client app (replaces the ADMIN_TOKEN stand-in on management routes)
3. RevenueCat webhook signature verification + real payment flow — `docs/01` §8
4. Staff offline sync endpoint (queue reconciliation) — `docs/10`
