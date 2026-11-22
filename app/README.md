# app/ — Flutter apps

Two apps, one codebase, two entrypoints:

- **Client app (traveler)** — `lib/main.dart`: register/login, trips, portal-contact invites
  (link+password shown once, share out-of-band, revoke), Explore & book with prepay,
  gift accept/decline, check-out summaries (history/streak).
- **Staff app (facilitator)** — `lib/main_staff.dart`: offline-first roster → check-in
  (phone custody: accommodation safe / sealed pouch + claim code) → checkpoint log →
  urgent-message verification → extend/incident → check-out summary.

Design rule (master plan §5/§7): no feeds, no engagement loops. The client app may only
send 3 notification types — booking confirmed, session starting soon, session ended
(`lib/src/services/notifications.dart`).

## Visuals & maps

- Refreshed theme (`lib/src/shared/widgets.dart`): warm sand + deep pine palette, 18px
  rounded cards, soft shadows, gradient `DestinationHero` headers, `RiskBadge`, `StatChip`.
- Catalog cards show a **map preview** (`lib/src/shared/map_preview.dart`, flutter_map +
  OSM tiles). PRIVACY (docs/04 §3): the map draws only a **fuzzed ~4 km area circle** at
  the city centroid (`venue.approxLat/approxLng`, city-level only) — never a pin at the
  venue's exact location, and no `MarkerLayer` at all.
- Trips home uses hero cards; trip detail renders sessions as a **timeline** with check-out
  summaries as stat chips (phone-free minutes, messages, verified emergencies).

## Run

```bash
# backend first: cd ../backend && PORT=3000 ADMIN_TOKEN=adm OTP_DEV_REVEAL=1 npm start

# traveler client
flutter run --target lib/main.dart --dart-define=API_BASE=http://localhost:3000

# staff console
flutter run --target lib/main_staff.dart --dart-define=API_BASE=http://localhost:3000
```

`API_BASE` is the only deploy-time config (`lib/src/config.dart`). Staff signs in with the
admin token (stand-in until staff auth lands on the backend).

## Structure

```
lib/
  main.dart                 client entrypoint
  main_staff.dart           staff entrypoint
  src/
    config.dart             API_BASE via --dart-define
    api/                    ApiClient (Bearer JSON), models, endpoints (mirror backend/src/api.js)
    state/auth_controller.dart   session token in flutter_secure_storage only
    services/notifications.dart  the 3 allowed notifications
    services/sync_queue.dart     staff offline-first queue (sqflite) + OfflineFirstClient
    shared/widgets.dart          theme, ErrorBox, StatusBadge, dual-tz formatting
    client/                  ClientApp + screens (auth, home/trips, catalog, trip detail)
    staff/                   StaffApp + screens (login, roster, run detail)
```

## Offline-first (staff)

Every on-site **write** goes through `OfflineFirstClient`: online → direct POST;
offline/network failure → appended to the local `pending_ops` table (sqflite, encrypted
at rest by the OS) and flushed in order when coverage returns (docs/05 §6). The roster
shows a "N queued" chip and a manual flush button. Reads pass through and show an error
box offline. Flush uses the backend's bulk reconcile endpoint `POST /api/sync`
(idempotent by client op id via `synced_ops.jsonl`, whitelisted staff write routes only),
with a per-op fallback for older backends.

## Payments

Booking prepay goes through RevenueCat (3DS) via `purchases_flutter`:

```bash
flutter run -d <device> --target lib/main.dart \
  --dart-define=API_BASE=http://10.0.2.2:3000 \
  --dart-define=REVENUECAT_PUBLIC_KEY=goog_xxx   # or appl_xxx — same RC project
```

- `lib/src/services/payments.dart` is a conditional export: `payments_io.dart` (real
  SDK flow) on mobile/desktop, `payments_stub.dart`/`payments_web.dart` on web.
- Product convention: the RevenueCat **product id = offering id** (create products in
  the RC dashboard with those ids).
- The booking id is set as the `hl_booking_id` subscriber attribute, so the webhook
  resolves the booking. The backend verifies `X-RevenueCat-Signature` (HMAC-SHA256,
  `REVENUECAT_WEBHOOK_SECRET`, 5-min tolerance) and is idempotent by event id
  (`processed_events.jsonl`); unsigned payloads are accepted only in dev (audited).
- No key configured (local dev) → booking stays `pending_payment` and the demo pays it
  via the webhook (`backend/scripts/seed-demo.mjs`). User cancel / payment failure →
  the app cancels the booking via the API (spot released, waitlist promoted).

## Tests

```bash
flutter analyze   # 0 errors
flutter test      # model/overdue-rule unit tests (test/widget_test.dart)
```
