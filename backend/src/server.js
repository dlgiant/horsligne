// Hors Ligne API — zero-dependency Node server (node:http).
// Routes live in src/api.js (waitlist, trips, portal auth, audit).
// Roadmap: docs/10-architecture.md — booking engine, checkpoint log,
// RevenueCat webhooks, CMS next.
//
// Env:
//   PORT             default 3000
//   DATA_DIR         default <backend>/data
//   ADMIN_TOKEN      if set, required as Bearer token for management routes
//   LANDING_ORIGIN   CORS origin for the landing page, default "*"
//   PUBLIC_DIR       static dir to serve (default ../landing); "none" disables
//   PORTAL_BASE_URL  base URL used to build invite links, default http://localhost:8080
//   SESSION_SECRET   HMAC secret for portal sessions (set in prod!)
//   OTP_DEV_REVEAL   "1" to include the OTP in API responses (dev/demo only)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApi } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon"
};

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "600"
  };
}

function sendJson(res, status, obj, cors) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...cors
  });
  res.end(body);
}

/** Reads + parses the body. Returns { ok, value }; on failure sends the error and returns { ok: false }. */
async function readJson(req, res, cors) {
  try {
    const raw = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on("data", (c) => {
        if (tooLarge) return; // keep draining so the error response can be sent
        size += c.length;
        if (size > MAX_BODY) { tooLarge = true; return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (tooLarge) reject(Object.assign(new Error("payload too large"), { code: "too_large" }));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
    if (!raw) return { ok: true, value: null };
    req.rawBody = raw; // needed for webhook signature verification (HMAC over the exact bytes)
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    if (e.code === "too_large") {
      sendJson(res, 413, { error: { code: "too_large", message: "Payload too large (max 64kb)" } }, cors);
    } else {
      sendJson(res, 400, { error: { code: "bad_json", message: "Body must be valid JSON" } }, cors);
    }
    return { ok: false };
  }
}

function serveStatic(res, publicDir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return false; }
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(path.normalize(publicDir + path.sep))) return false; // path traversal guard
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-cache"
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function createApp(opts = {}) {
  const cors = corsHeaders(opts.landingOrigin ?? process.env.LANDING_ORIGIN ?? "*");
  const publicDir =
    opts.publicDir !== undefined ? opts.publicDir
    : process.env.PUBLIC_DIR !== undefined ? process.env.PUBLIC_DIR
    : path.join(__dirname, "..", "..", "landing");
  const staticDir = publicDir && publicDir !== "none" ? path.resolve(publicDir) : null;

  const api = createApi({
    dataDir: opts.dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data"),
    adminToken: opts.adminToken !== undefined ? opts.adminToken : (process.env.ADMIN_TOKEN ?? null),
    portalBaseUrl: opts.portalBaseUrl || process.env.PORTAL_BASE_URL || "http://localhost:8080",
    sessionSecret: opts.sessionSecret || process.env.SESSION_SECRET || "dev-secret-change-me",
    otpDevReveal: opts.otpDevReveal !== undefined ? opts.otpDevReveal : process.env.OTP_DEV_REVEAL === "1",
    revenuecatWebhookSecret: opts.revenuecatWebhookSecret !== undefined ? opts.revenuecatWebhookSecret : (process.env.REVENUECAT_WEBHOOK_SECRET ?? null),
    loginMax: opts.loginMax,
    otpResendMax: opts.otpResendMax,
    messageMax: opts.messageMax
  });

  return http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (p.startsWith("/api/")) {
      let body = null;
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const parsed = await readJson(req, res, cors);
        if (!parsed.ok) return; // error response already sent
        body = parsed.value;
      }
      await api.handle(req, res, p, body, cors);
      return;
    }

    if (req.method === "GET" && staticDir && serveStatic(res, staticDir, p)) return;

    sendJson(res, 404, { error: { code: "not_found", message: "Route not found" } }, cors);
  });
}

// Start listening only when run directly (tests import createApp instead).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  if (!process.env.SESSION_SECRET) {
    console.warn("WARNING: SESSION_SECRET not set — using dev default. Set it in prod.");
  }
  if (!process.env.REVENUECAT_WEBHOOK_SECRET) {
    console.warn("WARNING: REVENUECAT_WEBHOOK_SECRET not set — /api/webhooks/revenuecat accepts unsigned payloads (dev only).");
  }
  createApp().listen(port, () => {
    console.log(`horsligne-backend listening on http://localhost:${port}`);
    console.log(`  POST /api/waitlist  POST /api/trips  POST /api/trips/:id/contacts`);
    console.log(`  POST /api/portal/start|verify|resend-otp  GET /api/portal/me  POST /api/portal/logout`);
    console.log(`  GET  /api/health  GET /api/audit?tripId=`);
  });
}
