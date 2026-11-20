# app/ — Flutter apps

Two apps, one codebase:

- **Client app (traveler):** trip registration, portal-contact invites, booking + prepay (RevenueCat), 3 purposeful notifications only, history/streak, check-out summaries.
- **Staff app (facilitator):** offline-first (local encrypted DB + sync queue), check-in, phone custody, checkpoint log, verification, check-out slip (screen + print + queued SMS).

Design rule: no feeds, no engagement loops — use it, then put it away.
