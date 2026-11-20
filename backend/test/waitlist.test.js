import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-test-"));
  server = createApp({
    dataDir,
    adminToken: "test-token",
    publicDir: path.resolve(new URL("../../landing", import.meta.url).pathname),
    landingOrigin: "https://horslign.earth"
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("GET /api/health", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "horsligne-backend");
});

test("POST /api/waitlist valid -> 201 and persisted", async () => {
  const res = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ana Lima", email: "Ana@Example.com", destination: "Chapada Diamantina", lang: "pt" })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.id);

  const lines = fs.readFileSync(path.join(dataDir, "waitlist.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const saved = JSON.parse(lines[0]);
  assert.equal(saved.email, "ana@example.com"); // lowercased
  assert.equal(saved.name, "Ana Lima");
});

test("POST /api/waitlist same email (different case) -> 200 duplicate, no new row", async () => {
  const res = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ana L", email: "ANA@example.com" })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.duplicate, true);
  const lines = fs.readFileSync(path.join(dataDir, "waitlist.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
});

test("POST /api/waitlist missing name -> 400 validation", async () => {
  const res = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "bob@example.com" })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "validation");
  assert.ok(body.error.details.some((d) => d.field === "name"));
});

test("POST /api/waitlist bad email -> 400", async () => {
  const res = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "not-an-email" })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "validation");
});

test("POST /api/waitlist invalid JSON -> 400 bad_json", async () => {
  const res = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops"
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "bad_json");
});

test("POST /api/waitlist oversized body -> 413", async () => {
  const res = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x".repeat(100 * 1024), email: "a@b.co" })
  });
  assert.equal(res.status, 413);
});

test("unknown /api route -> 404 JSON not_found", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.deepEqual(body, { error: { code: "not_found", message: "Route not found" } });
});

test("CORS: origin echoed + preflight 204", async () => {
  const res = await fetch(`${base}/api/health`, { headers: { origin: "https://horslign.earth" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://horslign.earth");

  const pre = await fetch(`${base}/api/waitlist`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://horslign.earth");
  assert.ok(pre.headers.get("access-control-allow-methods").includes("POST"));
});

test("GET /api/waitlist/count requires admin token when set", async () => {
  const noAuth = await fetch(`${base}/api/waitlist/count`);
  assert.equal(noAuth.status, 401);

  const ok = await fetch(`${base}/api/waitlist/count`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.count, 1);
});

test("GET / serves the landing page when PUBLIC_DIR set", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Hors Ligne/);
  assert.match(res.headers.get("content-type"), /text\/html/);
});

test("path traversal on static is blocked", async () => {
  const res = await fetch(`${base}/../backend/src/server.js`);
  assert.equal(res.status, 404);
});
