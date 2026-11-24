// Generic JSONL collection with supersede-on-update semantics:
// every mutation appends a new full record; on load, the last record per key
// wins. Append-only on disk (audit trail preserved), map in memory.
// Postgres replaces this at scale; the interface stays the same.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createCollection(dataDir, filename, opts = {}) {
  const key = opts.key || "id";
  const backend = opts.backend || null;
  const name = filename.replace(/\.jsonl$/, "");

  // Postgres mode (DATABASE_URL set): memory map hydrated from PG on boot;
  // mutations are enqueued and flushed once per request by api.js.
  if (backend) {
    const rows = backend.register(name);
    return {
      file: null,
      backend: true,
      add(value) {
        const now = new Date().toISOString();
        const rec = { [key]: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
        backend.enqueue(name, rec);
        rows.set(rec[key], rec);
        return rec;
      },
      update(id, patch) {
        const cur = rows.get(id);
        if (!cur) return null;
        const rec = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        backend.enqueue(name, rec);
        rows.set(id, rec);
        return rec;
      },
      find(id) {
        return rows.get(id) || null;
      },
      findWhere(fn) {
        return [...rows.values()].filter(fn);
      },
      list() {
        return [...rows.values()];
      },
      count() {
        return rows.size;
      }
    };
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, filename);
  const rows = new Map();

  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec[key]) rows.set(rec[key], rec);
      } catch { /* skip corrupted line */ }
    }
  }

  function persist(rec) {
    fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
  }

  return {
    file,
    add(value) {
      const now = new Date().toISOString();
      const rec = { [key]: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
      persist(rec);
      rows.set(rec[key], rec);
      return rec;
    },
    update(id, patch) {
      const cur = rows.get(id);
      if (!cur) return null;
      const rec = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      persist(rec);
      rows.set(id, rec);
      return rec;
    },
    find(id) {
      return rows.get(id) || null;
    },
    findWhere(fn) {
      return [...rows.values()].filter(fn);
    },
    list() {
      return [...rows.values()];
    },
    count() {
      return rows.size;
    }
  };
}
