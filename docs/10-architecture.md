# Architecture — Hors Ligne

## Components
```
[Traveler]  client app (Flutter, iOS/Android)  ─┐
[Facilitator] staff app (Flutter, offline-first) ─┼─▶ [backend API] ─▶ [Postgres]
[Family]    portal (React web) ───────────────────┤        │  ├─ booking engine (capacity, waitlist, no-show fees)
[Admin]     admin console (React web) ────────────┘        ├─ checkpoint log + audit log (append-only)
                                                           ├─ portal auth (link + password + OTP)
                                                           ├─ payments (RevenueCat webhooks)
                                                           └─ CMS (activity catalog, headless)
```

## Key flows
1. **Booking:** client app → backend → RevenueCat payment (3DS) → confirmation. Prices in local + home currency. Traveler registers trip + portal contacts (link + password + OTP issued to each contact's own device).
2. **Check-in (on-site, offline-first):** staff app stores locally (encrypted), syncs when in coverage. Phone custody recorded: accommodation safe / sealed pouch + claim code.
3. **Checkpoint:** inbound messages → log (ts, channel, sender, callback, classification, verification) → urgent verified via callback/second channel → interrupt only if life-threatening, else relay at check-out. Unverified never interrupts. Channels per venue: satellite SOS / landline / written drop / emergency-contact chain / optional SMS relay. No channel = no session.
4. **Check-out summary:** staff screen + printed slip + queued SMS to traveler + mirrored in portal. Portal overdue rule: expected check-out + 30 min → "overdue" + venue emergency contact shown.
5. **Explore & book:** portal catalog of destination activities (risk-labeled, vetted providers, 15–20% commission); family books as gift (traveler accepts/declines) or proposes.

## Cross-cutting
- **Offline-first:** staff app local DB + sync queue; portal shows "last synced". Zero bars required on-site.
- **Privacy:** portal exposes venue + city only, never GPS; per-trip credentials expire at trip end + 24h; traveler can revoke; full audit log (12-month retention).
- **Safety/legal:** waiver + guardian consent at booking; background-checked facilitators; two-adult rule for minors; insurance (liability + indemnity + abuse cover); LGPD/GDPR; incident reports within 24h.
- **Analytics:** Amplitude/Mixpanel, internal only — never surfaced to users as feeds.

## Environments
- `dev` / `staging` / `prod`; secrets in vault; CI on PRs (to be added under `infra/`).
