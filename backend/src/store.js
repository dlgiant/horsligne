// Append-only JSONL store for waitlist entries, with an in-memory email
// index for idempotent signup (same email -> duplicate, not a new row).
// Postgres replaces this at scale (docs/10-architecture.md); the interface
// stays the same: add(), has(), count(), list().

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createStore(dataDir, opts = {}) {
  const backend = opts.backend || null;
  const emails = new Set();

  // Postgres mode (DATABASE_URL set): same collection, hydrated from PG.
  if (backend) {
    const rows = backend.register("waitlist", () => {
      emails.clear();
      for (const rec of rows.values()) if (rec.email) emails.add(rec.email.toLowerCase());
    });
    return {
      file: null,
      backend: true,
      has(email) {
        return emails.has(email.toLowerCase());
      },
      add(value) {
        const now = new Date().toISOString();
        const entry = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
        backend.enqueue("waitlist", entry);
        rows.set(entry.id, entry);
        emails.add(entry.email.toLowerCase());
        return entry;
      },
      count() {
        return emails.size;
      },
      list() {
        return [...rows.values()];
      }
    };
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "waitlist.jsonl");

  // Load existing entries (survives restarts).
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.email) emails.add(entry.email);
      } catch { /* skip corrupted line, keep going */ }
    }
  }

  return {
    file,
    has(email) {
      return emails.has(email.toLowerCase());
    },
    add(value) {
      const now = new Date().toISOString();
      const entry = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
      fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
      emails.add(entry.email);
      return entry;
    },
    count() {
      return emails.size;
    },
    list() {
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, "utf8").split("\n")
        .filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }
  };
}
