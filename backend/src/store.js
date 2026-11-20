// Append-only JSONL store for waitlist entries, with an in-memory email
// index for idempotent signup (same email -> duplicate, not a new row).
// Postgres replaces this at scale (docs/10-architecture.md); the interface
// stays the same: add(), has(), count(), list().

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "waitlist.jsonl");
  const emails = new Set();

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
      const entry = { id: crypto.randomUUID(), ...value, createdAt: new Date().toISOString() };
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
