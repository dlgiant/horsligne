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
- `landing/` — public landing page + waitlist (static, PT/EN) — built
- `portal/` — family web portal (static SPA, PT/EN: link+password+OTP login, status/dual-tz/overdue, messages, Explore & book, check-out summary) — built
- `app/` — Flutter apps (traveler client + staff, offline-first)
- `admin/` — internal admin console (static SPA, PT/EN: dashboard, venues, sessions, trips+contacts, runs+checkpoint, bookings, audit, waitlist) — built
- `backend/` — API (bookings, checkpoint log, portal auth, payments)
- `infra/` — deployment, CI, secrets management

Status: planning complete; `landing/`, `portal/`, `admin/` (all static, PT/EN) and `backend/` (waitlist, traveler auth, portal auth per `docs/04`, booking engine, checkpoint per `docs/05`, admin list/overview endpoints) all built — 46 tests green (39 backend + 5 portal + 2 admin), JSONL storage with Postgres as documented swap point. Demo seeding: `backend/scripts/seed-demo.mjs`. Next per the 90-day plan (weeks 3–6): staff offline sync endpoint, client/staff Flutter apps, deploy under `infra/`.
