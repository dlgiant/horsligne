// Crypto + rate-limiting helpers. Zero deps (node:crypto).
// Spec: docs/04-portal-security-spec.md

import crypto from "node:crypto";

export function sha256hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** 128-bit random token for invite links (spec §1). */
export function genToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("base64url");
}

// No ambiguous chars (0/O, 1/l/I) in human-transcribed passwords.
const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Per-contact password, min 10 chars per spec — we generate 12. */
export function genPassword(len = 12) {
  let out = "";
  for (let i = 0; i < len; i++) out += PW_ALPHABET[crypto.randomInt(0, PW_ALPHABET.length)];
  return out;
}

export function genOtp6() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** scrypt password hash (spec says bcrypt; scrypt is the node:crypto-native equivalent). */
export function hashSecret(value) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(value, salt, 32, { N: 16384, r: 8, p: 1 });
  return ["scrypt", "16384", "8", "1", salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifySecret(value, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const hash = crypto.scryptSync(value, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

/** OTP stored hashed with a per-OTP salt. */
export function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

/** HMAC-signed session token: s1.<base64url(payload)>.<sig> (stands in for JWT; same guarantees). */
export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `s1.${body}.${sig}`;
}

export function verifySession(token, secret) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3 || parts[0] !== "s1") return null;
    const [, body, sig] = parts;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Simple fixed-window rate limiter (in-memory; per-process). */
export class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }
  /** Returns { allowed, retryAfterMs }. */
  check(key) {
    const now = Date.now();
    let rec = this.hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, rec);
    }
    rec.count += 1;
    if (rec.count > this.max) return { allowed: false, retryAfterMs: rec.resetAt - now };
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** Mask identifiers for logs/responses: emails and phone numbers. */
export function maskIdentifier(identifier) {
  if (identifier.includes("@")) {
    const [user, domain] = identifier.split("@");
    return `${user.slice(0, 1)}***@${domain}`;
  }
  const digits = identifier.replace(/[^0-9]/g, "");
  return `***${digits.slice(-4)}`;
}
