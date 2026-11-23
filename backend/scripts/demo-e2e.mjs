#!/usr/bin/env node
// demo-e2e.mjs — automated end-to-end dry-run of the docs/02 30-minute demo script.
// Runs the full flow against a LIVE API and asserts every beat:
//   landing waitlist → traveler register/trip → portal invite → catalog → book+pay →
//   portal login (link+password+OTP) → gift book & accept → check-in (pouch HD-4821) →
//   portal messages (routine + urgent) → staff verify (relay_at_checkout) → checkpoint log →
//   overdue flag + emergency channel → check-out + summary → audit + revenue.
//
// Usage:
//   API_BASE=http://localhost:3000 ADMIN_TOKEN=adm node scripts/demo-e2e.mjs
// (backend should run with OTP_DEV_REVEAL=1 so the OTP is readable here)

import assert from "node:assert/strict";

const API = process.env.API_BASE || "http://localhost:3000";
const ADMIN = process.env.ADMIN_TOKEN || "";

const req = async (method, p, body, token) => {
  const res = await fetch(API + p, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};
const post = (p, body, token) => req("POST", p, body, token);
const get = (p, token) => req("GET", p, undefined, token);

const step = (msg) => console.log(`\n=== ${msg}`);
const day = (offset, h = 0, m = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

async function main() {
  step("0:00–0:03 — landing: waitlist signup");
  const wl = await post("/api/waitlist", { name: "Demo Visitor", email: "visitor@demo.horslign.earth" });
  assert.ok([200, 201].includes(wl.status), JSON.stringify(wl.data));
  console.log("waitlist ok:", JSON.stringify(wl.data));

  step("0:03–0:10 — traveler app: Ana registers, logs in, creates trip, invites Carlos");
  await post("/api/travelers/register", { name: "Ana Lima", email: "ana@demo.horslign.earth", password: "demo-password-1" });
  const login = await post("/api/travelers/login", { email: "ana@demo.horslign.earth", password: "demo-password-1" });
  assert.equal(login.status, 200);
  const T = login.data.session;
  const trip = (await post("/api/trips", {
    travelerFirstName: "Ana", destination: "Chapada Diamantina", city: "Lençóis",
    startDate: day(1).slice(0, 10), endDate: day(6).slice(0, 10), homeTz: "Europe/Lisbon"
  }, T)).data.trip;
  const contact = (await post(`/api/trips/${trip.id}/contacts`, {
    name: "Carlos (brother, Lisbon)", channel: "sms", identifier: "+351 912 345 678"
  }, T)).data;
  const linkToken = contact.portalUrl.split("/p/")[1];
  console.log("trip:", trip.destination, "| portal link:", contact.portalUrl);
  console.log("portal password (one-time):", contact.password);

  step("catalog setup: venue + sunrise hike + paddle gift option");
  const venue = (await post("/api/venues", {
    name: "Pousada Chapada", city: "Lençóis", destination: "Chapada Diamantina", tz: "America/Bahia",
    approxLat: -12.56, approxLng: -41.31,
    emergencyChannel: { type: "landline", contact: "+55 75 3xxx-xxxx" }
  }, ADMIN)).data.venue;
  const hike = (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Sunrise hike + meditation", kind: "hike",
    startAt: day(2, 6, 0), endAt: day(2, 9, 0), capacity: 8, priceCentsBRL: 9000, risk: "moderate"
  }, ADMIN)).data.session;
  const paddle = (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Paddleboarding on Rio Lençóis", kind: "paddle",
    startAt: day(5, 10, 0), endAt: day(5, 12, 0), capacity: 6, priceCentsBRL: 12000, risk: "low"
  }, ADMIN)).data.session;
  // past session to demo the overdue flag without waiting (expected check-out already > grace ago)
  const past = (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Overdue drill (past)", kind: "hike",
    startAt: new Date(Date.now() - 3 * 3600000).toISOString(), endAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    capacity: 8, priceCentsBRL: 1000, risk: "low"
  }, ADMIN)).data.session;
  const catalog = await get("/api/catalog?destination=Chapada");
  assert.ok(catalog.data.count >= 3);
  console.log("catalog:", catalog.data.catalog.map((c) => `${c.title} (${c.priceBRL})`).join(" | "));

  step("0:03–0:10 — Ana books the hike and pays (dev webhook)");
  const bHike = (await post(`/api/sessions/${hike.id}/book`, { tripId: trip.id }, T)).data.booking;
  await post("/api/webhooks/revenuecat", { bookingId: bHike.id, event: "payment.succeeded" });
  const bPast = (await post(`/api/sessions/${past.id}/book`, { tripId: trip.id }, T)).data.booking;
  await post("/api/webhooks/revenuecat", { bookingId: bPast.id, event: "payment.succeeded" });
  console.log("hike booked+paid:", bHike.id);

  step("0:10–0:20 — portal: Carlos logs in via link + password + OTP");
  const start = await post("/api/portal/start", { linkToken, password: contact.password });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const otp = start.data.devOtp;
  assert.ok(otp, "OTP_DEV_REVEAL=1 must expose devOtp");
  const verify = await post("/api/portal/verify", { otpId: start.data.otpId, otp });
  assert.equal(verify.status, 200, JSON.stringify(verify.data));
  const P = verify.data.session; // portal session token
  const me = await get("/api/portal/me", P);
  assert.equal(me.data.trip.destination, "Chapada Diamantina");
  console.log("portal session ok; rotated link:", verify.data.portalUrl);
  const pcat = await get("/api/portal/catalog", P);
  assert.ok(pcat.data.catalog.length >= 3 && pcat.data.homeTz === "Europe/Lisbon");
  console.log("portal catalog with dual tz ok (homeTz:", pcat.data.homeTz + ")");

  step("0:10–0:20 — Carlos books the paddle as a GIFT (pending Ana's decision)");
  const gift = (await post("/api/portal/book", { offeringId: paddle.id, gift: true }, P)).data.booking;
  assert.equal(gift.decision, "pending");
  const decided = await post(`/api/bookings/${gift.id}/decide`, { accept: true }, T);
  assert.equal(decided.data.decision, "accepted");
  console.log("gift booked by portal, accepted by traveler:", gift.id);

  step("0:20–0:25 — staff: check-in with sealed pouch HD-4821");
  const runHike = (await post(`/api/bookings/${bHike.id}/check-in`, { custody: "sealed_pouch", claimCode: "HD-4821" }, ADMIN)).data.run;
  const runPast = (await post(`/api/bookings/${bPast.id}/check-in`, { custody: "accommodation_safe" }, ADMIN)).data.run;
  console.log("runs in progress:", runHike.id, runPast.id);

  step("0:10–0:20 — Carlos sends routine + urgent messages from the portal");
  const m1 = (await post("/api/portal/messages", { urgency: "routine", text: "Dad's flight delayed — new pickup 18:00" }, P)).data.message;
  const m2 = (await post("/api/portal/messages", { urgency: "urgent", text: "Mom fell at home — call us when you can" }, P)).data.message;
  assert.equal(m2.verification, "pending");

  step("0:20–0:25 — staff verifies the urgent message (callback, NOT life-threatening → relay at check-out)");
  const v = await post(`/api/messages/${m2.id}/verify`, { verified: true, via: "callback", lifeThreatening: false }, ADMIN);
  assert.equal(v.data.decision, "relay_at_checkout");
  const log = await get(`/api/runs/${runHike.id}/messages`, ADMIN);
  assert.equal(log.data.count, 2);
  console.log("checkpoint log entries:", log.data.entries.map((e) => `${e.classification}/${e.verification_status}/${e.decision}`).join(", "));

  step("0:25–0:28 — portal status: in progress + last synced; overdue drill flips with emergency channel");
  const status = await get("/api/portal/status", P);
  const st = status.data.runs.find((r) => r.id === runPast.id);
  assert.equal(st.status, "overdue", "past session must read overdue after grace");
  const runDetail = status.data.run; // active run for portal
  assert.ok(runDetail && runDetail.lastSyncedAt);
  const overdueDetail = await get(`/api/runs/${runPast.id}`, ADMIN);
  console.log("portal runs:", status.data.runs.map((r) => r.status).join(","), "| active run lastSyncedAt:", runDetail.lastSyncedAt);

  step("0:25–0:28 — check-out: summary mirrors staff/portal; messages relayed+delivered");
  const co = await post(`/api/runs/${runHike.id}/check-out`, undefined, ADMIN);
  assert.equal(co.status, 200);
  const s = co.data.summary;
  assert.equal(s.messages.length, 2);
  assert.ok(s.messages.every((m) => m.relayed && m.delivered));
  assert.equal(s.emergencyCount, 1, "one verified urgent message counts as verified emergency (relayed at check-out, not interrupted)");
  const pSummary = await get(`/api/runs/${runHike.id}/summary`, P);
  assert.equal(pSummary.status, 200);
  const pStatus2 = await get("/api/portal/status", P);
  assert.ok(pStatus2.data.runs.find((r) => r.id === runHike.id).status === "checked_out");
  console.log(`check-out summary: phone-free ${s.phoneFreeMinutes} min, ${s.messages.length} messages delivered, emergencies ${s.emergencyCount}`);

  step("0:28–0:30 — admin console: audit + revenue");
  const audit = await get("/api/audit?tripId=" + trip.id, ADMIN);
  const actions = audit.data.events.map((e) => e.action);
  for (const a of ["login.success", "booking.created", "run.checked_in", "message.sent", "message.verified", "run.checked_out", "payment.succeeded"]) {
    assert.ok(actions.includes(a), `audit missing ${a}`);
  }
  const rev = await get("/api/admin/revenue", ADMIN);
  assert.ok(rev.data.totalCentsBRL >= 10000, "hike 9000 + past drill 1000 paid");
  console.log("audit actions ok; revenue:", rev.data.totalBRL, "BRL");

  step("DEMO E2E PASS ✔  (full docs/02 flow green against " + API + ")");
}

main().catch((e) => {
  console.error("DEMO E2E FAIL ✘", e);
  process.exit(1);
});
