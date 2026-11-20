# Satellite communicator checklist (remote venues) — docs/05 channel 1

One device per remote venue (e.g. Garmin inReach Mini 2 class). A venue with **no
emergency channel has no session** (docs/05).

## Provisioning
- [ ] Device purchased + activated on the satellite plan (test message sent before first session)
- [ ] Device registered in the venue record (`POST /api/venues` → `emergencyChannel: {type: "satellite", contact: "<device id / SOS number>"}`)
- [ ] SOS / emergency contact chain configured: venue → Hors Ligne ops → local emergency services (number per venue, verified by call once per quarter)
- [ ] Staff facilitator trained on: SOS button, check-in message template, battery check
- [ ] Device stored in the venue's sealed, labeled pouch with the printed emergency card

## Per-session (staff app run)
- [ ] Battery ≥ 80% at check-in; spare power bank in the pouch
- [ ] Test "all good" satellite message sent at session start (logged in checkpoint)
- [ ] At check-out: device returned, charged, pouch resealed

## Hygiene
- [ ] Firmware updated quarterly
- [ ] Device never leaves the venue except for repair (chain of custody noted in ops log)
- [ ] Lost/stolen device → deactivate on the satellite portal same day + rotate venue emergency channel
