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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-portal-"));
  server = createApp({
    dataDir,
    adminToken: "test-admin",
    sessionSecret: "test-secret",
    otpDevReveal: true,
    publicDir: "none",
    portalBaseUrl: "https://portal.horslign.earth",
    loginMax: 1000 // don't trip the per-IP login limiter in the shared suite; 429 tested separately below
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeTrip(overrides = {}) {
  const res = await post("/api/trips", {
    travelerFirstName: "Ana",
    destination: "Chapada Diamantina",
    city: "Lençóis",
    startDate: "2026-12-01",
    endDate: "2026-12-06",
    homeTz: "Europe/Lisbon",
    ...overrides
  }, { authorization: ADMIN });
  assert.equal(res.status, 201);
  return (await res.json()).trip;
}

async function makeContact(tripId, overrides = {}) {
  const res = await post(`/api/trips/${tripId}/contacts`, {
    name: "Carlos (brother)",
    channel: "sms",
    identifier: "+351 912 345 678",
    ...overrides
  }, { authorization: ADMIN });
  assert.equal(res.status, 201);
  return res.json();
}

function linkTokenOf(portalUrl) {
  return portalUrl.split("/p/")[1];
}

test("trips require admin token", async () => {
  const res = await post("/api/trips", { travelerFirstName: "X", destination: "Y", startDate: "2026-12-01", endDate: "2026-12-02" });
  assert.equal(res.status, 401);
});

test("POST /api/trips validates dates", async () => {
  const res = await post("/api/trips", {
    travelerFirstName: "Ana", destination: "Chapada",
    startDate: "2026-12-10", endDate: "2026-12-01" // end before start
  }, { authorization: ADMIN });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "validation");
});

test("full portal flow: trip -> contact -> start -> verify -> me -> logout, with token rotation", async () => {
  const trip = await makeTrip();
  assert.equal(trip.status, "planned");

  const issued = await makeContact(trip.id);
  assert.match(issued.portalUrl, /^https:\/\/portal\.horslign\.earth\/p\/[A-Za-z0-9_-]{22}$/); // 128-bit token
  assert.equal(issued.password.length, 12);
  assert.equal(issued.contact.name, "Carlos (brother)");
  assert.ok(Date.parse(issued.expiresAt) > Date.parse("2026-12-07")); // trip end + 24h grace

  // stored record must not contain raw secrets
  const raw = fs.readFileSync(path.join(dataDir, "contacts.jsonl"), "utf8");
  assert.ok(!raw.includes(issued.password), "raw password must never be persisted");
  assert.ok(!raw.includes(linkTokenOf(issued.portalUrl)), "raw link token must never be persisted");
  assert.ok(raw.includes("passwordHash") && raw.includes("linkTokenHash"));

  // GET trip (admin): masked identifier, no secrets
  const tripRes = await get(`/api/trips/${trip.id}`, { authorization: ADMIN });
  const tripBody = await tripRes.json();
  assert.equal(tripBody.contacts[0].identifier, "***5678");
  assert.ok(!JSON.stringify(tripBody).includes("passwordHash"));

  const token = linkTokenOf(issued.portalUrl);

  // bad link
  let res = await post("/api/portal/start", { linkToken: "nope-nope", password: "wrong-password" });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "invalid_link");

  // wrong password
  res = await post("/api/portal/start", { linkToken: token, password: "wrong-password" });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "invalid_password");

  // correct start -> OTP (dev reveal)
  res = await post("/api/portal/start", { linkToken: token, password: issued.password });
  assert.equal(res.status, 200);
  const start = await res.json();
  assert.ok(start.otpId);
  assert.equal(start.channel, "sms");
  assert.match(start.devOtp, /^\d{6}$/);

  // wrong OTP then correct OTP
  res = await post("/api/portal/verify", { otpId: start.otpId, otp: "000000" === start.devOtp ? "111111" : "000000" });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "invalid_otp");

  res = await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp });
  assert.equal(res.status, 200);
  const login = await res.json();
  assert.ok(login.session);
  assert.equal(login.trip.travelerFirstName, "Ana");
  assert.equal(login.trip.destination, "Chapada Diamantina");
  assert.ok(!("identifier" in login.contact), "portal must never see phone/email");
  assert.notEqual(login.portalUrl, issued.portalUrl, "link token must rotate on login");

  // old link invalid after rotation
  res = await post("/api/portal/start", { linkToken: token, password: issued.password });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "invalid_link");

  // me with session
  res = await get("/api/portal/me", { authorization: `Bearer ${login.session}` });
  assert.equal(res.status, 200);
  const me = await res.json();
  assert.equal(me.trip.id, trip.id);
  assert.ok(me.sessionExpiresAt);

  // me without session
  res = await get("/api/portal/me");
  assert.equal(res.status, 401);

  // logout kills session
  res = await post("/api/portal/logout", undefined, { authorization: `Bearer ${login.session}` });
  assert.equal(res.status, 200);
  res = await get("/api/portal/me", { authorization: `Bearer ${login.session}` });
  assert.equal(res.status, 401);

  return { trip, issued, login };
});

test("OTP lockout after 5 wrong attempts locks and notifies traveler", async () => {
  const trip = await makeTrip();
  const issued = await makeContact(trip.id);
  const token = linkTokenOf(issued.portalUrl);
  let res = await post("/api/portal/start", { linkToken: token, password: issued.password });
  const start = await res.json();

  const wrong = start.devOtp === "000000" ? "000001" : "000000";
  for (let i = 0; i < 4; i++) {
    res = await post("/api/portal/verify", { otpId: start.otpId, otp: wrong });
    assert.equal(res.status, 401);
  }
  res = await post("/api/portal/verify", { otpId: start.otpId, otp: wrong });
  assert.equal(res.status, 423);
  assert.equal((await res.json()).error.code, "otp_locked");

  // pending OTP cleared -> next verify 404
  res = await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp });
  assert.equal(res.status, 404);

  const notifs = fs.readFileSync(path.join(dataDir, "notifications.jsonl"), "utf8");
  assert.ok(notifs.includes("traveler.notify"), "traveler must be notified on lockout");
});

test("expired credential (trip end + 24h passed) is rejected", async () => {
  const trip = await makeTrip({ startDate: "2020-01-01", endDate: "2020-01-05" });
  const issued = await makeContact(trip.id);
  const res = await post("/api/portal/start", { linkToken: linkTokenOf(issued.portalUrl), password: issued.password });
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error.code, "expired");
});

test("revoked contact is rejected and sessions die immediately", async () => {
  const trip = await makeTrip();
  const issued = await makeContact(trip.id);
  const token = linkTokenOf(issued.portalUrl);

  let res = await post("/api/portal/start", { linkToken: token, password: issued.password });
  const start = await res.json();
  res = await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp });
  const login = await res.json();
  const newToken = linkTokenOf(login.portalUrl);

  res = await post(`/api/trips/${trip.id}/contacts/${issued.contact.id}/revoke`, undefined, { authorization: ADMIN });
  assert.equal(res.status, 200);

  res = await get("/api/portal/me", { authorization: `Bearer ${login.session}` });
  assert.equal(res.status, 401, "session must be invalidated on revoke");

  res = await post("/api/portal/start", { linkToken: newToken, password: issued.password });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "revoked");
});

test("audit log is append-only with the spec schema and is filterable by trip", async () => {
  const trip = await makeTrip();
  const issued = await makeContact(trip.id);
  const token = linkTokenOf(issued.portalUrl);
  let res = await post("/api/portal/start", { linkToken: token, password: issued.password });
  const start = await res.json();
  await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp });
  await post(`/api/trips/${trip.id}/contacts/${issued.contact.id}/revoke`, undefined, { authorization: ADMIN });

  res = await get(`/api/audit?tripId=${trip.id}`, { authorization: ADMIN });
  assert.equal(res.status, 200);
  const { events } = await res.json();
  const actions = events.map((e) => e.action);
  for (const a of ["trip.created", "credential.issued", "otp.sent", "login.success", "credential.rotated", "credential.revoked"]) {
    assert.ok(actions.includes(a), `audit should contain ${a}`);
  }
  for (const e of events) {
    assert.ok(e.id && e.createdAt && e.actorType && e.action && e.objectType && e.objectId !== undefined);
    assert.ok("ip" in e && "userAgent" in e);
  }
  // audit requires admin
  res = await get("/api/audit");
  assert.equal(res.status, 401);
});

test("login rate limit: 6th attempt in window -> 429 (dedicated app, default limit 5)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-ratelimit-"));
  const srv = createApp({
    dataDir: dir, adminToken: "a", sessionSecret: "s",
    publicDir: "none", otpDevReveal: true
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const tripRes = await fetch(`${b}/api/trips`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer a" },
      body: JSON.stringify({ travelerFirstName: "A", destination: "D", startDate: "2026-12-01", endDate: "2026-12-05" })
    });
    const trip = (await tripRes.json()).trip;
    const cRes = await fetch(`${b}/api/trips/${trip.id}/contacts`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer a" },
      body: JSON.stringify({ name: "C", channel: "email", identifier: "c@example.com" })
    });
    const issued = await cRes.json();
    const token = issued.portalUrl.split("/p/")[1];

    let last;
    for (let i = 0; i < 6; i++) {
      last = await fetch(`${b}/api/portal/start`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkToken: token, password: issued.password })
      });
    }
    assert.equal(last.status, 429);
    assert.equal((await last.json()).error.code, "rate_limited");
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("contact validation: email channel needs email, sms needs phone", async () => {
  const trip = await makeTrip();
  let res = await post(`/api/trips/${trip.id}/contacts`, { name: "C", channel: "email", identifier: "not-an-email" }, { authorization: ADMIN });
  assert.equal(res.status, 400);
  res = await post(`/api/trips/${trip.id}/contacts`, { name: "C", channel: "sms", identifier: "abc" }, { authorization: ADMIN });
  assert.equal(res.status, 400);
  res = await post(`/api/trips/${trip.id}/contacts`, { name: "C", channel: "pigeon" }, { authorization: ADMIN });
  assert.equal(res.status, 400);
});
