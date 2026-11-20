# PhoneFree Abroad — Master Plan (v2, D2C traveler-first)

## 1. Concept
A digital-detox service for people who want phone-free time — travelers abroad above all — while loved ones stay informed through a secure web portal. The traveler books and prepays sessions in an app, leaves the phone in a safe place, and does facilitator-led activities (meditation, hikes, surf lessons, paddleboarding, workshops). A checkpoint relays verified emergency communications, and at check-out everyone gets a summary. The app is deliberately anti-addictive: no feeds, nothing to do once checked in.

**Pitch line:** "Phone-free days abroad. Family stays in the loop. You stay safe — and your phone stays out of thieves' hands."

## 2. Audience priority
1. **Individual travelers abroad (primary, D2C)** — solo/duo travelers in semi-risky or remote destinations; phone theft and family anxiety are the two pains
2. **Organizers (Phase 2)** — camps, schools, outdoor clubs running group detox sessions
3. **Small-town community sessions (Phase 2/3)** — locals at libraries, cafes, parks
4. Hotels: opportunistic only, never a dependency

## 3. Core flow
1. Traveler registers trip in client app (where there's coverage), adds loved ones as portal contacts → each gets unique link + password + OTP (SMS, email fallback) to their own device
2. Books + prepays session (card via RevenueCat, 3DS; prices in local + home currency)
3. Leaves phone at accommodation safe / home → facilitator checks them in on staff device; fallback: sealed pouch + claim code at venue
4. Activity runs phone-free; staff app fully offline, syncs when back in coverage
5. Checkpoint logs inbound messages (portal → staff app, or satellite/landline/written note in no-reception areas); urgent = verified via callback/second channel before any interruption
6. Check-out: summary on screen + printed slip + queued SMS — "no emergency communications" or "1 verified message: who, when, callback number" — mirrored in portal

## 4. Portal (family side)
- Status: scheduled → checked in → in progress → checked out; dual timezone (local + home); always "last synced" time
- Expected check-out + overdue flag: after 30-min grace, status flips to "overdue" and portal shows the venue emergency contact (landline/satellite) to call directly
- Messaging: routine / urgent with verification status; delivery confirmed at check-out
- **Explore & book tab:** destination activity catalog (paddleboarding, surf lessons, trail tours…). Family can book as a gift (their card; traveler sees it in their app with accept/decline) or propose (traveler books/pays). Risk label on every activity (low/moderate/semi-risky); semi-risky requires full safeguards. Booked activities run through the same check-in/checkpoint/check-out loop
- Privacy: venue + city only, never GPS; per-trip credentials expire at trip end (traveler can revoke anytime); full audit log; PT/EN at launch
- Trust pack public: waiver, background checks, insurance certificates, LGPD compliance, two-adult rule for minors

## 5. Design principles
- **Zero bars required** — everything on-site offline-first; satellite communicator (inReach, SOS-capable) is minimum emergency channel for remote venues; no channel = no sessions there
- **Use it, then put it away** — client app is booking + history only
- **Safety by design** — one designated emergency channel per session; documented escalation (BR: 190 police / 192 medical); timestamped logs as liability evidence
- **Minimum data** — LGPD/GDPR; minors' data at highest protection tier

## 6. Roles
Client (traveler) · Facilitator (runs sessions, holds emergency channel, logs checkpoint) · Activity provider (vetted local guide/instructor; ~15–20% commission) · Portal contact (loved one: view status, message, book/gift) · Platform admin (venues, catalog, providers, logs, revenue, incidents)

## 7. Feature roadmap
**MVP (demo week 7):**
- Client app (Flutter): trip registration, loved-one contacts, booking + prepay, 3 purposeful notifications only, history/streak, check-out summaries
- Portal: link+password+OTP login, status + dual timezone, overdue flag + venue emergency contact, routine/urgent messaging, Explore & book (gift/propose), check-out summary, audit log
- Staff app (Flutter, offline-first): check-in, phone custody, checkpoint log, verification, check-out slip (screen + print + queued SMS)
- Admin console: venues, schedule, capacity/waitlist, provider onboarding/vetting/insurance, checkpoint + audit logs, incident reports, revenue
- Trust pack + satellite communicator per remote venue

**Phase 2:** smart lockers (app-issued codes/NFC) · organizer B2B · memberships/travel packs · group bookings · SMS relay where coverage exists · ES language · new towns

**Phase 3:** multi-destination rollout · B2B (schools, camps, corporate) · insurer/tourism-board partnerships · wellbeing outcome studies · optional staffed "phone hotel" at venues

## 8. Tech stack
- Client + staff apps: Flutter (iOS + Android, one codebase); staff app offline-first (local DB + sync queue)
- Portal + admin: web (React)
- Backend: Node/Go or Firebase; booking engine (capacity, waitlist, no-show fees); roles; headless CMS for activity catalog
- Payments: RevenueCat (3DS); gift bookings on family's card; cash-at-door for local sessions
- Analytics: Amplitude/Mixpanel (internal only)
- Hardware: satellite communicator per remote venue

## 9. Monetization
- Per-session ticket (launch ~R$90-equiv; first session 50% off in launch town) + travel pack/membership
- Activity commission 15–20% on Explore & book bookings
- No-show fees; venue revenue share where applicable
- Phase 3: B2B per-participant pricing, insurer bundles, municipal grants

## 10. Metrics
- Waitlist → paid conversion ≥ 10%; CAC payback ≤ 2 sessions
- Show-up rate; on-time check-out rate; zero safety incidents
- Portal: ≥70% of families active; message delivery rate; audit-log completeness
- Activity bookings per trip; commission revenue
- Repeat booking within 30 days; rating ≥ 4.5/5; wellbeing questionnaire deltas

## 11. Risks
| Risk | Mitigation |
|---|---|
| Phone theft while traveling | Phone stays at accommodation; pouch fallback; portal never exposes location |
| Emergency in no-signal venue | Satellite SOS / landline mandatory per venue; disclosed per session |
| Scam/false emergency messages | Callback/second-channel verification; unverified = relay at check-out only; timestamped log |
| Portal credential leakage | OTP, expiring session-scoped links, rate limiting, audit log, "never share your link" UX |
| False overdue panic | 30-min grace, clear copy, venue number surfaced immediately |
| Solo-traveler privacy | City/venue only, expiring revocable credentials |
| Safeguarding failure with minors | Background checks, two-adult rule, guardian consent, abuse insurance, incident workflow |
| D2C trust without partner | Public trust pack, insurance certs, early-bird pricing, reviews, support line |
| OTP failure (roaming) | Email OTP fallback |
| Anti-detox irony | No feeds; progress only at check-out; offline by design |

## 12. 90-day plan
- **Weeks 1–2:** brand + landing page (PT/EN) + waitlist; pricing; trust pack drafted; recruit + vet facilitators for launch town; satellite communicator for remote venues
- **Weeks 3–6:** build client app, staff app, portal, admin console; two dry-runs, one fully offline
- **Week 7:** record 3-min walkthrough + 30-min live demo → launch landing page; convert waitlist to first paid bookings
- **Weeks 8–11:** first real sessions; wellbeing data, reviews, portal audit data; iterate
- **Week 12:** metrics review → next town; decide on organizer B2B channel

## 13. Locked decisions
- Flutter one codebase; separate staff app + web portal + admin console
- D2C traveler-abroad first; organizers Phase 2; hotels never a dependency
- Portal: per-trip link + password + OTP (SMS/email), session-scoped, expiring; city/venue only, no GPS; PT/EN; 30-min overdue grace
- Phone custody: accommodation/home default, sealed pouch fallback, lockers Phase 2
- Offline-first everything; satellite = minimum emergency channel for remote venues
- Pricing: per-session + travel pack; 15–20% activity commission; cash option for locals
- Week-7 demo = public D2C launch; success = ≥10% waitlist→paid, zero incidents
