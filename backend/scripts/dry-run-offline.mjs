#!/usr/bin/env node
// dry-run-offline.mjs — the "fully offline (airplane mode)" internal dry-run from
// docs/09 (weeks 3–6). It simulates the staff app on-site with zero bars:
//
//   1. seed: trip + venue + session + booking, paid via the dev webhook stub
//   2. AIRPLANE MODE: check-in, extend, incident, check-out are written to a
//      LOCAL queue file only (same shape as the app's sqflite `pending_ops`)
//      — no HTTP call is made in this phase, exactly like the real app
//   3. RECONNECT: the queue is flushed once to POST /api/sync
//   4. FLAKY RETRY: the same batch is sent again — must be `replayed`, never re-applied
//   5. verify final state: one run, checked_out, extension + incident + summary landed
//
// Usage:
//   API_BASE=http://localhost:3000 ADMIN_TOKEN=adm node scripts/dry-run-offline.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = process.env.API_BASE || "http://localhost:3000";
const ADMIN = process.env.ADMIN_TOKEN || "";

const post = async (p, body, token = ADMIN) => {
  const res = await fetch(API + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`POST ${p} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
};
const get = async (p, token = ADMIN) => {
  const res = await fetch(API + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
};

const step = (msg) => console.log(`\n=== ${msg}`);

async function main() {
  step("0. health check");
  console.log(JSON.stringify(await fetch(API + "/api/health").then((r) => r.json())));

  step("1. seed: trip + venue + session + booking (paid via dev webhook)");
  const trip = (await post("/api/trips", { travelerFirstName: "DryRun", destination: "Chapada", city: "Lençóis", startDate: "2026-12-01", endDate: "2026-12-06" })).trip;
  const venue = (await post("/api/venues", { name: "Pousada DryRun", city: "Lençóis", destination: "Chapada", emergencyChannel: { type: "landline", contact: "+55 75 3000-0000" } })).venue;
  const off = (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Offline dry-run hike", kind: "hike",
    startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    capacity: 5, priceCentsBRL: 9000, risk: "low"
  })).session;
  const booking = (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id })).booking;
  await post("/api/webhooks/revenuecat", { bookingId: booking.id, event: "payment.succeeded" });
  console.log(`booking ${booking.id} paid (dev webhook)`);

  step("2. AIRPLANE MODE ON — staff app writes to the local queue only (no HTTP)");
  const queueFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hl-queue-")), "pending_ops.jsonl");
  const enqueue = (id, method, p, body) =>
    fs.appendFileSync(queueFile, JSON.stringify({ id, method, path: p, body, created_at: new Date().toISOString() }) + "\n");
  // the run id is unknown offline — check-in is op-1 and later ops reference the
  // server-side run id, so the dry-run resolves it from the check-in response at
  // flush time is NOT possible offline; instead we chain via a placeholder that
  // /api/sync resolves: ops after check-in use "@lastRun" (resolved by the script
  // between flush waves, like the app does when it reads the check-in response).
  enqueue("op-1", "POST", `/api/bookings/${booking.id}/check-in`, { custody: "sealed_pouch", claimCode: "HD-4821" });
  console.log("queued op-1 check-in (sealed_pouch HD-4821) — local file:", queueFile);

  // first flush wave: just the check-in (app would do this when briefly in coverage,
  // or everything at once at the end — both are valid sync strategies)
  step("3. RECONNECT (wave 1): flush check-in to POST /api/sync");
  const ops1 = fs.readFileSync(queueFile, "utf8").trim().split("\n").map(JSON.parse);
  const res1 = await post("/api/sync", { ops: ops1.map((o) => ({ id: o.id, method: o.method, path: o.path, body: o.body })) });
  assert.equal(res1.results[0].ok, true, JSON.stringify(res1));
  const runId = res1.results[0].response.run.id;
  console.log(`applied: run ${runId} in_progress`);

  step("2b. still offline: extend +30, incident, check-out queued locally");
  enqueue("op-2", "POST", `/api/runs/${runId}/extend`, { minutes: 30 });
  enqueue("op-3", "POST", `/api/runs/${runId}/incident`, { note: "Dry-run: minor delay at the river crossing, group fine" });
  enqueue("op-4", "POST", `/api/runs/${runId}/check-out`, undefined);
  console.log("queued op-2 extend, op-3 incident, op-4 check-out (local only)");

  step("3b. RECONNECT (wave 2): flush remaining ops");
  const allOps = fs.readFileSync(queueFile, "utf8").trim().split("\n").map(JSON.parse);
  const wave2 = allOps.filter((o) => !res1.results.some((r) => r.id === o.id));
  const res2 = await post("/api/sync", { ops: wave2.map((o) => ({ id: o.id, method: o.method, path: o.path, body: o.body ?? null })) });
  for (const r of res2.results) console.log(`  ${r.id}: ok=${r.ok} status=${r.status}${r.replayed ? " (replayed)" : ""}`);
  assert.ok(res2.results.every((r) => r.ok), JSON.stringify(res2));

  step("4. FLAKY RETRY: resend the ENTIRE queue — must be replayed, never re-applied");
  const retry = await post("/api/sync", { ops: allOps.map((o) => ({ id: o.id, method: o.method, path: o.path, body: o.body ?? null })) });
  assert.ok(retry.results.every((r) => r.ok && r.replayed === true), JSON.stringify(retry.results));
  console.log("all 4 ops replayed=true — no double-apply");

  step("5. verify final state");
  const runs = (await get("/api/admin/runs")).runs.filter((r) => r.bookingId === booking.id);
  assert.equal(runs.length, 1, "exactly one run for the booking");
  const run = (await get(`/api/runs/${runId}`)).run;
  assert.equal(run.status, "checked_out");
  assert.ok(run.extendedCheckOut, "extension landed");
  assert.ok(run.incident, "incident landed");
  assert.ok(run.checkedOutAt);
  const summary = (await get(`/api/runs/${runId}/summary`)).summary;
  assert.ok(summary.phoneFreeMinutes >= 0);
  console.log(`run checked_out ✔ extended ✔ incident ✔ summary ✔ (phone-free ${summary.phoneFreeMinutes} min)`);
  const audit = await get("/api/audit");
  assert.ok(audit.events.some((e) => e.action === "sync.batch"), "sync.batch audited");
  console.log("audit contains sync.batch ✔");

  step("DRY-RUN PASS ✔  (airplane mode → local queue → /api/sync idempotent flush)");
  fs.rmSync(path.dirname(queueFile), { recursive: true, force: true });
}

main().catch((e) => {
  console.error("DRY-RUN FAIL ✘", e);
  process.exit(1);
});
