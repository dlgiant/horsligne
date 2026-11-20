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
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const get = (p, headers = {}) => fetch(base + p, { headers });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-traveler-"));
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

async function registerAndLogin(email = "ana@example.com") {
  let res = await post("/api/travelers/register", { name: "Ana Lima", email, password: "sup3r-secret-pw" });
  assert.equal(res.status, 201);
  res = await post("/api/travelers/login", { email, password: "sup3r-secret-pw" });
  assert.equal(res.status, 200);
  const body = await res.json();
  return { session: body.session, traveler: body.traveler };
}

const T = (s) => ({ authorization: `Bearer ${s}` });

test("register: validation + duplicate email", async () => {
  let res = await post("/api/travelers/register", { name: "X", email: "bad", password: "short" });
  assert.equal(res.status, 400);
  res = await post("/api/travelers/register", { name: "Ana", email: "ana@example.com", password: "sup3r-secret-pw" });
  assert.equal(res.status, 201);
  res = await post("/api/travelers/register", { name: "Ana2", email: "ANA@example.com", password: "another-pw-123" });
  assert.equal(res.status, 409);
  // raw password never persisted
  const raw = fs.readFileSync(path.join(dataDir, "travelers.jsonl"), "utf8");
  assert.ok(!raw.includes("sup3r-secret-pw"));
  assert.ok(raw.includes("passwordHash"));
});

test("login: wrong password 401, correct 200 with session; logout kills it", async () => {
  let res = await post("/api/travelers/login", { email: "ana@example.com", password: "wrong-password" });
  assert.equal(res.status, 401);
  const { session } = await registerAndLogin("bia@example.com");
  res = await get("/api/travelers/me", T(session));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).traveler.email, "bia@example.com");
  res = await post("/api/travelers/logout", undefined, T(session));
  assert.equal(res.status, 200);
  res = await get("/api/travelers/me", T(session));
  assert.equal(res.status, 401);
});

test("traveler creates own trip; cannot touch another traveler's trip; admin still can", async () => {
  const ana = await registerAndLogin("ana2@example.com");
  const bob = await registerAndLogin("bob@example.com");

  // no auth at all -> 401
  let res = await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", startDate: "2026-12-01", endDate: "2026-12-06" });
  assert.equal(res.status, 401);

  res = await post("/api/trips", {
    travelerFirstName: "Ana", destination: "Chapada Diamantina", city: "Lençóis",
    startDate: "2026-12-01", endDate: "2026-12-06", homeTz: "Europe/Lisbon"
  }, T(ana.session));
  assert.equal(res.status, 201);
  const trip = (await res.json()).trip;

  // bob cannot read/manage ana's trip
  res = await get(`/api/trips/${trip.id}`, T(bob.session));
  assert.equal(res.status, 403);
  res = await post(`/api/trips/${trip.id}/contacts`, { name: "Eve", channel: "email", identifier: "eve@example.com" }, T(bob.session));
  assert.equal(res.status, 403);

  // ana can issue + revoke contacts
  res = await post(`/api/trips/${trip.id}/contacts`, { name: "Carlos", channel: "sms", identifier: "+351 912 345 678" }, T(ana.session));
  assert.equal(res.status, 201);
  const issued = await res.json();
  assert.match(issued.portalUrl, /\/p\/[A-Za-z0-9_-]{22}$/);

  // portal still logs in with those credentials (regression)
  const token = issued.portalUrl.split("/p/")[1];
  let sres = await post("/api/portal/start", { linkToken: token, password: issued.password });
  const st = await sres.json();
  sres = await post("/api/portal/verify", { otpId: st.otpId, otp: st.devOtp });
  assert.equal(sres.status, 200);
  const portalSession = (await sres.json()).session;

  // ana revokes -> portal session dies
  const cid = issued.contact.id;
  res = await post(`/api/trips/${trip.id}/contacts/${cid}/revoke`, undefined, T(ana.session));
  assert.equal(res.status, 200);
  res = await get("/api/portal/me", T(portalSession));
  assert.equal(res.status, 401);

  // admin override still works
  res = await get(`/api/trips/${trip.id}`, { authorization: ADMIN });
  assert.equal(res.status, 200);
});

test("traveler books own trip; cannot book someone else's trip; gift decide by owner", async () => {
  const ana = await registerAndLogin("ana3@example.com");
  const bob = await registerAndLogin("bob3@example.com");

  const tripA = (await (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", startDate: "2026-12-01", endDate: "2026-12-06" }, T(ana.session))).json()).trip;
  const tripB = (await (await post("/api/trips", { travelerFirstName: "Bob", destination: "Chapada", startDate: "2026-12-01", endDate: "2026-12-06" }, T(bob.session))).json()).trip;

  const venue = (await (await post("/api/venues", { name: "V", city: "L", destination: "Chapada", emergencyChannel: { type: "landline", contact: "+55 75 3000-0000" } }, { authorization: ADMIN })).json()).venue;
  const off = (await (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Hike", kind: "hike",
    startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    capacity: 5, priceCentsBRL: 9000, risk: "low"
  }, { authorization: ADMIN })).json()).session;

  // ana books own trip
  let res = await post(`/api/sessions/${off.id}/book`, { tripId: tripA.id }, T(ana.session));
  assert.equal(res.status, 201);
  const b = (await res.json()).booking;
  assert.equal(b.bookedBy.type, "traveler");
  assert.equal(b.bookedBy.id, ana.traveler.id);

  // ana cannot book bob's trip
  res = await post(`/api/sessions/${off.id}/book`, { tripId: tripB.id }, T(ana.session));
  assert.equal(res.status, 403);

  // gift from a portal contact of ana's trip, decided by ana
  const issued = await (await post(`/api/trips/${tripA.id}/contacts`, { name: "Carlos", channel: "email", identifier: "carlos@example.com" }, T(ana.session))).json();
  const token = issued.portalUrl.split("/p/")[1];
  let sres = await post("/api/portal/start", { linkToken: token, password: issued.password });
  const st = await sres.json();
  sres = await post("/api/portal/verify", { otpId: st.otpId, otp: st.devOtp });
  const portalSession = (await sres.json()).session;
  res = await post("/api/portal/book", { offeringId: off.id, gift: true }, T(portalSession));
  const gift = (await res.json()).booking;
  assert.equal(gift.gift, true);

  // bob cannot decide ana's gift
  res = await post(`/api/bookings/${gift.id}/decide`, { accept: true }, T(bob.session));
  assert.equal(res.status, 403);
  // ana accepts
  res = await post(`/api/bookings/${gift.id}/decide`, { accept: true }, T(ana.session));
  assert.equal((await res.json()).decision, "accepted");
});

test("traveler overview: trips + bookings + runs with summaries", async () => {
  const ana = await registerAndLogin("ana4@example.com");
  const trip = (await (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", startDate: "2026-12-01", endDate: "2026-12-06" }, T(ana.session))).json()).trip;
  const venue = (await (await post("/api/venues", { name: "V", city: "L", destination: "Chapada", emergencyChannel: { type: "satellite", contact: "inReach 1" } }, { authorization: ADMIN })).json()).venue;
  const off = (await (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Hike", kind: "hike",
    startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    capacity: 5, priceCentsBRL: 9000, risk: "low"
  }, { authorization: ADMIN })).json()).session;
  const bk = (await (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id }, T(ana.session))).json()).booking;
  await post("/api/webhooks/revenuecat", { bookingId: bk.id, event: "payment.succeeded" }, { authorization: ADMIN });
  const run = (await (await post(`/api/bookings/${bk.id}/check-in`, { custody: "accommodation_safe" }, { authorization: ADMIN })).json()).run;
  await post(`/api/runs/${run.id}/check-out`, undefined, { authorization: ADMIN });

  const res = await get("/api/travelers/me", T(ana.session));
  const me = await res.json();
  assert.equal(me.trips.length, 1);
  assert.equal(me.trips[0].bookings.length, 1);
  assert.equal(me.trips[0].runs[0].status, "checked_out");
  assert.ok(me.trips[0].runs[0].summary, "check-out summary visible to traveler (history)");
  assert.equal(me.trips[0].runs[0].summary.phoneFreeMinutes >= 0, true);
});
