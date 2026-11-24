// Postgres backend for the JSONL collections — used ONLY when DATABASE_URL is set.
// Design (docs/10): Postgres is the durable store; the process keeps the same
// in-memory maps as the JSONL mode (the API layer is synchronous), so every
// mutation is enqueued and flushed to Postgres once per HTTP request (handle()
// awaits flush). On boot, all rows are loaded back into memory (hydration).
//
// Layout: one table `kv(collection text, id text, data jsonb, created_at, updated_at)`
// with PK (collection, id); each former .jsonl file maps to a `collection` value.
// Schema defaults to `hl_<hash8(dataDir)>` (stable per deployment, isolated per
// test tmpdir) and can be overridden with PG_SCHEMA.
//
// `pg` is an OPTIONAL dependency (dynamic import): without DATABASE_URL the
// backend stays zero-dependency JSONL and never loads this module.

import crypto from "node:crypto";

export function schemaForDataDir(dataDir) {
  return `hl_${crypto.createHash("sha256").update(String(dataDir)).digest("hex").slice(0, 8)}`;
}

// All live clients, so tests/teardown can close them (an open pg client keeps
// the event loop alive and would hang `node --test`).
const allClients = new Set();
export async function closeAllPg() {
  await Promise.allSettled([...allClients].map((c) => c.end()));
  allClients.clear();
}

export function createPgBackend(url, { schema } = {}) {
  const collections = new Map(); // name → Map(id → rec)
  const hydrateCallbacks = new Map();
  const queue = []; // { collection, rec }
  let flushing = Promise.resolve(); // serializes flushes (requests respond before flushing)
  let client = null;
  let enabled = true;
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));

  async function init() {
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: url });
    allClients.add(client);
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } catch (e) {
      if (!/duplicate key/.test(e.message)) throw e; // IF NOT EXISTS can race; existing schema is fine
    }
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE IF NOT EXISTS kv (
      collection text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (collection, id)
    )`);
    const res = await client.query(`SELECT collection, data FROM kv`);
    for (const row of res.rows) {
      const rec = row.data;
      if (!rec || !rec.id) continue;
      if (!collections.has(row.collection)) collections.set(row.collection, new Map());
      collections.get(row.collection).set(rec.id, rec);
    }
    for (const cb of hydrateCallbacks.values()) cb();
    readyResolve();
  }

  init().catch((e) => {
    console.error(`[pg] init failed (${e.message}) — continuing with empty memory; JSONL fallback not active because DATABASE_URL is set`);
    readyResolve(); // unblock requests; flush() will no-op while disabled
    enabled = false;
  });

  // Flushes are serialized on a promise chain: handle() responds before
  // flushing, so the next request's flush can start while one is running.
  function doFlush() {
    if (!enabled || !client || queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    return (async () => {
      try {
        await client.query("BEGIN");
        for (const { collection, rec } of batch) {
          await client.query(
            `INSERT INTO kv (collection, id, data, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
            [collection, rec.id, JSON.stringify(rec), rec.createdAt || new Date().toISOString(), rec.updatedAt || rec.createdAt || new Date().toISOString()]
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        queue.unshift(...batch); // retry on next flush
        console.error(`[pg] flush failed (${e.message}) — ${batch.length} writes requeued`);
      }
    })();
  }

  return {
    ready,
    schema,
    /** Returns the live Map for a collection; rows hydrate on ready. */
    register(name, onHydrate) {
      if (!collections.has(name)) collections.set(name, new Map());
      if (onHydrate) hydrateCallbacks.set(name, onHydrate);
      return collections.get(name);
    },
    enqueue(collection, rec) {
      if (!enabled) return;
      queue.push({ collection, rec });
    },
    /** Upsert all queued rows, serialized (handle() responds before flushing,
     *  so the next request's flush can start while one is running). */
    flush() {
      flushing = flushing.then(doFlush, doFlush);
      return flushing;
    },
    async close() {
      if (client) {
        allClients.delete(client);
        await client.end().catch(() => {});
      }
    }
  };
}
