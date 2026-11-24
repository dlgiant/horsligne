// Postgres adapter integration test. Skipped unless TEST_PG_URL is set, e.g.:
//   TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5441/postgres npm test
// Uses its own schema (test_<rand>) so it never touches real data.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

const PG_URL = process.env.TEST_PG_URL || "";
const SCHEMA = `test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

let server, base, dataDir, pg;
const ADMIN = "Bearer adm";
const post = (p, body, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", authorization: ADMIN, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (p, headers = {}) => fetch(base + p, { headers: { authorization: ADMIN, ...headers } });

before(async () => {
  if (!PG_URL) return;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-pgtest-"));
  process.env.DATABASE_URL = PG_URL;
  server = createApp({ dataDir, adminToken: "adm", sessionSecret: "s", publicDir: "none", pgSchema: SCHEMA, otpDevReveal: true, loginMax: 1000, messageMax: 1000 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const { default: pgmod } = await import("pg");
  pg = new pgmod.Client({ connectionString: PG_URL });
  await pg.connect();
  await pg.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`).catch(() => {}); // backend may create it concurrently
  await pg.query(`SET search_path TO "${SCHEMA}"`);
});

after(async () => {
  if (!PG_URL) return;
  server.close();
  await pg.end();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATABASE_URL;
});

test("postgres mode: full flow lands in PG and survives a restart (new app instance)", { skip: !PG_URL }, async () => {
  await post("/api/waitlist", { name: "Waiter", email: "wait@example.com" }, {});
  const trip = (await (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", city: "L", startDate: "2026-12-01", endDate: "2026-12-06" })).json()).trip;
  const contact = (await (await post(`/api/trips/${trip.id}/contacts`, { name: "Carlos", channel: "sms", identifier: "+351 912 345 678" })).json());
  assert.ok(contact.portalUrl && contact.password);

  // portal login end-to-end (OTP dev reveal)
  const start = await (await post("/api/portal/start", { linkToken: contact.portalUrl.split("/p/")[1], password: contact.password }, {})).json();
  const verify = await (await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp }, {})).json();
  assert.ok(verify.session);

  // rows really in PG (flush runs after each response — drain it explicitly here)
  await server.api.pgBackend.flush();
  const res = await pg.query(`SELECT collection, count(*)::int AS n FROM kv GROUP BY collection ORDER BY collection`);
  const counts = Object.fromEntries(res.rows.map((r) => [r.collection, r.n]));
  assert.ok(counts.waitlist >= 1 && counts.trips >= 1 && counts.contacts >= 1 && counts.sessions >= 1 && counts.audit >= 1, JSON.stringify(counts));
  console.log("PG collections:", JSON.stringify(counts));

  // "restart": new app instance, same schema → data visible without any JSONL
  const dataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "hl-pgtest2-"));
  const server2 = createApp({ dataDir: dataDir2, adminToken: "adm", sessionSecret: "s", publicDir: "none", pgSchema: SCHEMA, otpDevReveal: true, loginMax: 1000, messageMax: 1000 });
  await new Promise((r) => server2.listen(0, "127.0.0.1", r));
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  const trips2 = await (await fetch(base2 + "/api/admin/trips", { headers: { authorization: ADMIN } })).json();
  assert.equal(trips2.trips.length, 1, "trip visible after restart from PG");
  assert.equal(trips2.trips[0].destination, "Chapada");
  const wl2 = await (await fetch(base2 + "/api/admin/waitlist", { headers: { authorization: ADMIN } })).json();
  assert.equal(wl2.entries[0].email, "wait@example.com");
  server2.close();
  fs.rmSync(dataDir2, { recursive: true, force: true });
  console.log("restart durability ok");
});
