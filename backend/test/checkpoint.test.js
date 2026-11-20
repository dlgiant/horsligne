import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

let server;
let base;
let dataDir;
const ADMIN = "Bearer test-admin";

const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ADMIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const get = (p, headers = {}) => fetch(base + p, { headers: { authorization: ADMIN, ...headers } });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-checkpoint-"));
  server = createApp({
    dataDir,
    adminToken: "test-admin",
    sessionSecret: "test-secret",
    otpDevReveal: true,
    publicDir: "none",
    portalBaseUrl: "https://portal.horslign.earth",
    loginMax: 1000,
    messageMax: 1000
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const FUTURE = {
  start: new Date(Date.now() + 60 * 60000).toISOString(),
  end: new Date(Date.now() + 4 * 60 * 60000).toISOString()
};

async function setupRun({ startAt, endAt } = {}) {
  const trip = (await (await post("/api/trips", {
    travelerFirstName: "Ana", destination: "Chapada Diamantina", city: "Lençóis",
    startDate: "2026-12-01", endDate: "2026-12-06", homeTz: "Europe/Lisbon"
  })).json()).trip;
  const venue = (await (await post("/api/venues", {
    name: "Pousada Chapada", city: "Lençóis", destination: "Chapada Diamantina",
    emergencyChannel: { type: "landline", contact: "+55 75 3xxx-xxxx" }
  })).json()).venue;
  const offering = (await (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Sunrise hike", kind: "hike",
    startAt: startAt || FUTURE.start, endAt: endAt || FUTURE.end,
    capacity: 5, priceCentsBRL: 9000, risk: "moderate"
  })).json()).session;
  const booking = (await (await post(`/api/sessions/${offering.id}/book`, { tripId: trip.id })).json()).booking;
  await post("/api/webhooks/revenuecat", { bookingId: booking.id, event: "payment.succeeded" }, {});
  // portal contact + session
  const issued = await (await post(`/api/trips/${trip.id}/contacts`, { name: "Carlos", channel: "sms", identifier: "+351 912 345 678" })).json();
  const token = issued.portalUrl.split("/p/")[1];
  const start = await (await post("/api/portal/start", { linkToken: token, password: issued.password }, {})).json();
  const login = await (await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp }, {})).json();
  return { trip, venue, offering, booking, session: login.session };
}

test("full checkpoint loop: check-in → messages → verify → check-out → summary mirrored", async () => {
  const { trip, offering, booking, session } = await setupRun();

  // pouch custody requires claim code
  let res = await post(`/api/bookings/${booking.id}/check-in`, { custody: "sealed_pouch" });
  assert.equal(res.status, 400);
  res = await post(`/api/bookings/${booking.id}/check-in`, { custody: "sealed_pouch", claimCode: "HD-4821" });
  assert.equal(res.status, 201);
  const runId = (await res.json()).run.id;

  // check-in only for paid bookings / once
  res = await post(`/api/bookings/${booking.id}/check-in`, { custody: "accommodation_safe" });
  assert.equal(res.status, 409);

  // portal status: in progress, not overdue, no emergency contact yet, has lastSynced
  res = await get("/api/portal/status", { authorization: `Bearer ${session}` });
  let status = (await res.json()).run;
  assert.equal(status.status, "in_progress");
  assert.equal(status.overdue, false);
  assert.equal(status.emergencyChannel, null);
  assert.ok(status.lastSyncedAt);
  assert.equal(status.venue.name, "Pousada Chapada");
  assert.ok(!JSON.stringify(status).includes("identifier"), "no phone of traveler/contact leaked");

  // family sends routine + urgent
  res = await post("/api/portal/messages", { text: "Dad's flight delayed — pickup 18:00", urgency: "routine" }, { authorization: `Bearer ${session}` });
  assert.equal(res.status, 201);
  const routine = (await res.json()).message;
  assert.equal(routine.verification, "not_required");

  res = await post("/api/portal/messages", { text: "Mom fell at home — call us", urgency: "urgent" }, { authorization: `Bearer ${session}` });
  const urgent = (await res.json()).message;
  assert.equal(urgent.verification, "pending");

  // staff checkpoint log view (docs/05 §7 schema)
  res = await get(`/api/runs/${runId}/messages`);
  const entries = (await res.json()).entries;
  assert.equal(entries.length, 2);
  assert.ok(entries[0].entry_id && entries[0].session_id && entries[0].classification);

  // verify urgent via callback, NOT life-threatening → relay at check-out
  res = await post(`/api/messages/${urgent.id}/verify`, { verified: true, via: "callback", lifeThreatening: false });
  assert.equal((await res.json()).decision, "relay_at_checkout");

  // unverified urgent never interrupts
  res = await post("/api/portal/messages", { text: "Sketchy message", urgency: "urgent" }, { authorization: `Bearer ${session}` });
  const urgent2 = (await res.json()).message;
  res = await post(`/api/messages/${urgent2.id}/verify`, { verified: false, via: "second_channel" });
  const v2 = await res.json();
  assert.equal(v2.verification, "unverified");
  assert.equal(v2.decision, "relay_at_checkout", "unverified must never interrupt (docs/05 §2.4)");

  // life-threatening + verified → interrupt + incident status
  res = await post("/api/portal/messages", { text: "Life threatening", urgency: "urgent" }, { authorization: `Bearer ${session}` });
  const urgent3 = (await res.json()).message;
  res = await post(`/api/messages/${urgent3.id}/verify`, { verified: true, via: "callback", lifeThreatening: true });
  assert.equal((await res.json()).decision, "interrupt");
  res = await get("/api/portal/status", { authorization: `Bearer ${session}` });
  assert.equal((await res.json()).run.incidentInProgress, true);

  // check-out → summary with messages delivered
  res = await post(`/api/runs/${runId}/check-out`, undefined);
  assert.equal(res.status, 200);
  const summary = (await res.json()).summary;
  assert.equal(summary.phoneFreeMinutes >= 0, true);
  assert.equal(summary.messages.length, 4); // routine + 3 urgent sent above
  assert.ok(summary.messages.every((m) => m.relayed && m.delivered), "all messages relayed+delivered at check-out");
  assert.equal(summary.emergencyCount, 2); // 2 verified urgent (1 relay, 1 interrupt)

  // portal sees checked_out + summary + own message delivery status
  res = await get("/api/portal/status", { authorization: `Bearer ${session}` });
  assert.equal((await res.json()).run.status, "checked_out");
  res = await get(`/api/runs/${runId}/summary`, { authorization: `Bearer ${session}` });
  assert.equal(res.status, 200);
  res = await get("/api/portal/messages", { authorization: `Bearer ${session}` });
  const mine = (await res.json()).messages;
  assert.ok(mine.every((m) => m.deliveredAt), "portal shows delivery confirmation (docs/05 §5)");

  // audit trail
  res = await get(`/api/audit?tripId=${trip.id}`);
  const actions = (await res.json()).events.map((e) => e.action);
  for (const a of ["run.checked_in", "message.sent", "message.verified", "run.checked_out", "message.delivered"]) {
    assert.ok(actions.includes(a), `audit should contain ${a}`);
  }
});

test("overdue rule: expected check-out + 30 min → overdue + venue emergency contact shown", async () => {
  // offering that ended 31 min ago → already past grace at check-in
  const past = {
    start: new Date(Date.now() - 90 * 60000).toISOString(),
    end: new Date(Date.now() - 31 * 60000).toISOString()
  };
  const { booking, session } = await setupRun({ startAt: past.start, endAt: past.end });
  let res = await post(`/api/bookings/${booking.id}/check-in`, { custody: "accommodation_safe" });
  const runId = (await res.json()).run.id;

  res = await get("/api/portal/status", { authorization: `Bearer ${session}` });
  const run = (await res.json()).run;
  assert.equal(run.status, "overdue");
  assert.equal(run.overdue, true);
  assert.deepEqual(run.emergencyChannel, { type: "landline", contact: "+55 75 3xxx-xxxx" }, "venue contact surfaced when overdue (docs/05 §4)");

  // facilitator extends by 60 min → overdue clears
  res = await post(`/api/runs/${runId}/extend`, { minutes: 60 });
  assert.equal(res.status, 200);
  res = await get("/api/portal/status", { authorization: `Bearer ${session}` });
  assert.equal((await res.json()).run.status, "in_progress");
});

test("messages require an active run; verify only on urgent", async () => {
  const { trip, session } = await setupRun();
  let res = await post("/api/portal/messages", { text: "hello?", urgency: "routine" }, { authorization: `Bearer ${session}` });
  assert.equal(res.status, 409); // no check-in yet → no active run

  const booking = (await (await get(`/api/trips/${trip.id}/bookings`)).json()).bookings[0];
  await post(`/api/bookings/${booking.id}/check-in`, { custody: "accommodation_safe" });
  res = await post("/api/portal/messages", { text: "ok now", urgency: "routine" }, { authorization: `Bearer ${session}` });
  const msg = (await res.json()).message;
  res = await post(`/api/messages/${msg.id}/verify`, { verified: true, via: "callback" });
  assert.equal(res.status, 409, "routine messages don't need verification");
});

test("message rate limit per contact (spec §5: 20/h; tested with low cap)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-msglimit-"));
  const srv = createApp({
    dataDir: dir, adminToken: "a", sessionSecret: "s", publicDir: "none",
    otpDevReveal: true, loginMax: 1000, messageMax: 3
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const post2 = (p, body, h = {}) => fetch(b + p, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer a", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const trip = (await (await post2("/api/trips", { travelerFirstName: "A", destination: "D", city: "C", startDate: "2026-12-01", endDate: "2026-12-06" })).json()).trip;
    const venue = (await (await post2("/api/venues", { name: "V", city: "C", destination: "D", emergencyChannel: { type: "satellite", contact: "inReach 1234" } })).json()).venue;
    const off = (await (await post2(`/api/venues/${venue.id}/sessions`, { title: "T", kind: "hike", startAt: FUTURE.start, endAt: FUTURE.end, capacity: 5, priceCentsBRL: 9000, risk: "low" })).json()).session;
    const bk = (await (await post2(`/api/sessions/${off.id}/book`, { tripId: trip.id })).json()).booking;
    await post2("/api/webhooks/revenuecat", { bookingId: bk.id, event: "payment.succeeded" }, {});
    await post2(`/api/bookings/${bk.id}/check-in`, { custody: "accommodation_safe" });
    const issued = await (await post2(`/api/trips/${trip.id}/contacts`, { name: "C", channel: "email", identifier: "c@example.com" })).json();
    const token = issued.portalUrl.split("/p/")[1];
    const st = await (await post2("/api/portal/start", { linkToken: token, password: issued.password }, {})).json();
    const lg = await (await post2("/api/portal/verify", { otpId: st.otpId, otp: st.devOtp }, {})).json();

    let last;
    for (let i = 0; i < 4; i++) {
      last = await fetch(`${b}/api/portal/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${lg.session}` },
        body: JSON.stringify({ text: `msg ${i}`, urgency: "routine" })
      });
    }
    assert.equal(last.status, 429);
    assert.equal((await last.json()).error.code, "rate_limited");
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
