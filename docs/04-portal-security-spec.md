# Portal Security Spec — Family Portal

Scope: the web portal used by loved ones (portal contacts) to view traveler status, send messages, and book/gift activities. The traveler's phone is not part of the trust boundary — portal contacts have their own devices.

## 1. Access model
- **Per-trip, per-contact credentials.** Each portal contact gets: unique invite link (single 128-bit random token in URL path, never in query string/log), a per-contact password, and OTP delivery to their registered mobile (SMS) and email.
- **Login flow:** link → token lookup → password (bcrypt-hashed, min 10 chars) → OTP (6 digits, 10-min expiry, 5 attempts then lockout + notify traveler via app) → session (JWT, 24h sliding, httpOnly + Secure + SameSite=Strict cookie).
- **Expiry:** credentials valid from trip start until trip end + 24h grace, then automatically revoked. Traveler can revoke any contact at any time (immediate session invalidation).
- **Rotation:** link token rotates on each successful login; old token invalidated.

## 2. Roles and permissions
| Role | Can |
|---|---|
| Portal contact | View own traveler's session status/schedule (dual tz), send routine/urgent messages, browse destination catalog, book as gift / propose activity, view own message delivery status, view check-out summary, view own audit entries |
| Traveler | Everything above + accept/decline bookings, revoke contacts, view full audit log for own trip |
| Facilitator | Read messages for own sessions, mark verification, log checkpoint entries (via staff app) |
| Admin | Read-only audit log access, incident reports, no message content access by default |

## 3. Data minimization (hard rule)
The portal must NEVER expose: GPS coordinates, precise location, traveler's phone number, payment data, or other travelers' data. Exposed: traveler first name, session status, venue name + city, schedule with dual timezone, expected check-out, venue emergency channel, own messages, check-out summary.

## 4. Audit log (immutable, append-only)
Schema per event:
```
event_id (uuid) | ts (UTC) | actor_type | actor_id | action | object_type | object_id | ip | user_agent | detail (no message content)
```
Actions: `login.success`, `login.fail`, `otp.sent`, `otp.verified`, `otp.locked`, `message.sent`, `message.delivered`, `booking.created`, `booking.accepted`, `booking.declined`, `credential.revoked`, `status.viewed`, `summary.viewed`.
Retention: 12 months. Exportable for authorities/insurer on request.

## 5. Rate limiting
- Login attempts: 5 per 15 min per IP + per account
- OTP resend: 3 per 10 min per contact
- Messages: 20 per hour per contact
- API: 60 req/min per session

## 6. Transport & app security
TLS 1.3, HSTS, CSP (no inline scripts), standard SQLi/XSS/CSRF protections, secrets in env/vault, dependency scanning in CI, annual pen test before scaling.

## 7. LGPD / GDPR compliance
- **Legal basis:** consent (given at booking by traveler and contact) + legitimate interest for safety logging
- **Data subject rights:** access, correction, deletion, portability, objection — via privacy@ contact; respond ≤ 15 days (LGPD) / 30 days (GDPR)
- **Retention:** trip data until trip end + 24h; audit logs 12 months; message content deleted at trip end + 30 days unless an incident is open
- **Minors:** highest tier — guardian consent required, portal access restricted to named guardians only, shorter retention
- **DPAs** with SMS/email providers, hosting, payment processor
- **Breach notification:** authority + affected users within 72h (GDPR) / reasonable time (LGPD, ANPD)
- **DPO/privacy contact** published on landing page and portal footer
