# backend/ — API

Node/Go (or Firebase at MVP). Responsibilities: booking engine (capacity, waitlist, no-show fees), trip + portal-contact management (link/password/OTP issuance, expiry, revocation), checkpoint log + audit log (append-only, timestamped), check-out summary generation, payment webhooks (RevenueCat), CMS integration for the activity catalog, notification dispatch (booking / session-start / session-ended only).

All on-site writes must be queueable offline on the staff app and reconciled on sync.
