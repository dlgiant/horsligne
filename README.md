# Hors Ligne

Phone-free days abroad. Your family stays in the loop. You stay safe — and your phone stays out of thieves' hands.

Hors Ligne is a digital-detox service: travelers book phone-free, facilitator-led activities, leave their phone in a safe place, and their loved ones follow a calm, secure status portal. A verified checkpoint relays urgent messages, and everyone gets a check-out summary.

## Docs
All working documents live in [`docs/`](docs/):

- `01-master-plan.md` — full product/ops plan, decisions locked
- `02-demo-script-30min.md` — 30-minute demo script
- `03-landing-page-copy.md` — landing page copy (EN/PT)
- `04-portal-security-spec.md` — portal access, audit log, LGPD/GDPR
- `05-checkpoint-emergency-protocol.md` — emergency channels, verification, escalation
- `06-waiver-guardian-consent.md` — waiver/consent outline (counsel review pending)
- `07-provider-onboarding-checklist.md` — provider vetting/insurance/terms
- `08-trust-pack-safeguarding.md` — trust pack + safeguarding policy
- `09-metrics-timeline.md` — metrics + 90-day timeline
- `10-architecture.md` — system architecture

## Layout
- `app/` — Flutter apps (traveler client + staff, offline-first)
- `portal/` — family web portal (React)
- `admin/` — internal admin console (React)
- `backend/` — API (bookings, checkpoint log, portal auth, payments)
- `infra/` — deployment, CI, secrets management

Status: planning complete, scaffold in progress.
