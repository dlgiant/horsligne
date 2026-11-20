# Checkpoint & Emergency Protocol

Governs how communications from outside reach phone-free participants, and how emergencies escalate. Core rule: **nothing on-site depends on cell reception.**

## 1. Emergency channels per venue (ranked, disclosed per session in portal)
1. **Satellite communicator** (e.g., Garmin inReach) held by the facilitator — works anywhere with sky view; SOS routes to emergency services. Minimum for remote venues.
2. **Venue / partner landline** — front desk or venue phone.
3. **Written message drop** — note left at desk with name, time, callback number, relation to participant.
4. **Pre-registered emergency contact chain** — outsiders contact the participant's designated contact, who reaches the venue via landline. The participant's own phone is never in the chain.
5. **Optional SMS/WhatsApp relay via venue phone** — only where coverage exists; always labeled optional.

Rule: a venue with no satellite and no confirmed landline does not host sessions.

## 2. Inbound message flow
1. Message arrives (portal → staff app sync, or landline/satellite/written note) → **checkpoint log entry**: entry_id, session_id, ts, channel, sender name, callback number, relation, classification (routine/urgent), content summary.
2. If **urgent**: verification via callback to the registered contact or a second channel. Mark `verified` or `unverified` with verifier + ts.
3. Facilitator decision: life-threatening verified → **interrupt** + escalation (§3). Otherwise → relay at check-out.
4. **Unverified messages never interrupt a session.** They are relayed at check-out labeled "unverified".

## 3. Escalation (verified life-threatening)
1. Facilitator interrupts the activity, ensures scene safety
2. Call local emergency services — BR: 190 police, 192 ambulance (SAMU); elsewhere: local equivalents listed in the session brief
3. Remote venue with no cell: satellite SOS
4. Notify organizer/guardian via portal (auto-status: "incident in progress")
5. First aid by trained facilitator; evacuation plan per venue
6. Incident report in admin console within 24h; insurer notified; log preserved

## 4. Overdue rule
Expected check-out + **30-min grace** → portal status flips to `overdue` and displays the venue emergency contact prominently. Overdue ≠ emergency; copy says so explicitly. Facilitator may extend expected check-out from staff app (logged).

## 5. Check-out summary (the "when leaving" moment)
Delivered three ways, identical content:
1. On the staff device screen at check-out
2. Printed slip handed to the participant
3. Queued SMS/email to the participant + mirrored in the portal

Contents: check-out ts, phone-free duration, messages (verified/unverified, sender, callback number, relayed status), any incidents, sessions attended, streak. Portal also shows the family-side delivery confirmation.

## 6. Offline behavior
All checkpoint entries stored locally on the staff device (encrypted at rest) and synced when in coverage. Portal displays "last synced <ts>" next to status so families never assume instant delivery. In no-reception areas the portal still works for the family (they have coverage at home); venue side uses channels 1–4 above.

## 7. Log schema
```
entry_id | session_id | ts | channel | sender | callback_number | relation |
classification | verification_status | verified_by | decision | relayed_at | actor
```
Immutable, timestamped, exportable — this log is the primary liability evidence.
