// Hors Ligne API — zero-dependency Node server (node:http).
// MVP surface: waitlist. Roadmap (docs/10-architecture.md): booking engine,
// portal auth (link+password+OTP), checkpoint/audit log, RevenueCat webhooks.
//
// Env:
//   PORT            default 3000
//   DATA_DIR        default <backend>/data
//   ADMIN_TOKEN     if set, required as Bearer token for /api/waitlist/count
//   LANDING_ORIGIN  CORS origin for the landing page, default "*"
//   PUBLIC_DIR      static dir to serve (default ../landing, i.e. co-host the
//                   landing page in dev); set to "none" to disable

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "./store.js";
import { validateWaitlist } from "./validate.js";

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

function sendJson(res, status, obj, cors) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...cors
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c) => {
      if (tooLarge) return; // keep draining so the 413 response can be sent
      size += c.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) reject(Object.assign(new Error("payload too large"), { code: "too_large" }));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

async function readJson(req, res, cors) {
  try {
    const raw = await readBody(req);
    if (!raw) return { empty: true };
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "too_large") {
      sendJson(res, 413, { error: { code: "too_large", message: "Payload too large (max 64kb)" } }, cors);
    } else {
      sendJson(res, 400, { error: { code: "bad_json", message: "Body must be valid JSON" } }, cors);
    }
    return null;
  }
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "600"
  };
}

function serveStatic(req, res, publicDir, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(path.normalize(publicDir))) return false; // path traversal guard
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-cache"
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data");
  const adminToken = opts.adminToken ?? process.env.ADMIN_TOKEN ?? null;
  const cors = corsHeaders(opts.landingOrigin ?? process.env.LANDING_ORIGIN ?? "*");
  const publicDir =
    opts.publicDir !== undefined ? opts.publicDir
    : process.env.PUBLIC_DIR !== undefined ? process.env.PUBLIC_DIR
    : path.join(__dirname, "..", "..", "landing");
  const store = createStore(dataDir);
  const staticDir = publicDir && publicDir !== "none" ? path.resolve(publicDir) : null;

  return http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // ---- API routes ----
    if (p === "/api/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, service: "horsligne-backend", ts: new Date().toISOString() }, cors);
      return;
    }

    if (p === "/api/waitlist" && req.method === "POST") {
      const body = await readJson(req, res, cors);
      if (body === null) return; // response already sent
      const result = validateWaitlist(body.empty ? {} : body);
      if (!result.ok) {
        sendJson(res, 400, { error: { code: "validation", message: "Invalid waitlist payload", details: result.errors } }, cors);
        return;
      }
      if (store.has(result.value.email)) {
        sendJson(res, 200, { ok: true, duplicate: true, message: "Email already on the list" }, cors);
        return;
      }
      const entry = store.add(result.value);
      sendJson(res, 201, { ok: true, id: entry.id }, cors);
      return;
    }

    if (p === "/api/waitlist/count" && req.method === "GET") {
      if (adminToken) {
        const auth = req.headers.authorization || "";
        if (auth !== `Bearer ${adminToken}`) {
          sendJson(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
          return;
        }
      }
      sendJson(res, 200, { ok: true, count: store.count() }, cors);
      return;
    }

    if (p.startsWith("/api/")) {
      sendJson(res, 404, { error: { code: "not_found", message: "Route not found" } }, cors);
      return;
    }

    // ---- Static (landing page co-hosted in dev) ----
    if (req.method === "GET" && staticDir && serveStatic(req, res, staticDir, p)) return;

    sendJson(res, 404, { error: { code: "not_found", message: "Route not found" } }, cors);
  });
}

// Start listening only when run directly (tests import createApp instead).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`horsligne-backend listening on http://localhost:${port}`);
    console.log(`  POST /api/waitlist   (CORS: ${process.env.LANDING_ORIGIN || "*"})`);
    console.log(`  GET  /api/health`);
  });
}
