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
box offline. The server-side bulk reconcile endpoint (`POST /api/sync`) is the
documented next backend step.

## Payments

Booking prepay is stubbed: the client fires the booking-confirmed notification and the
dev backend marks the booking paid via the RevenueCat webhook stub
(`POST /api/webhooks/revenuecat`). RevenueCat + 3DS integration lands with infra/.

## Tests

```bash
flutter analyze   # 0 errors
flutter test      # model/overdue-rule unit tests (test/widget_test.dart)
```
