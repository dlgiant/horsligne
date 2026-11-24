#!/usr/bin/env node
// migrate-jsonl-to-pg.mjs — one-shot migration of the JSONL store (data/*.jsonl)
// into Postgres when moving to DATABASE_URL. Idempotent (upsert by collection+id).
//
//   DATA_DIR=backend/data DATABASE_URL=postgres://… PG_SCHEMA=hl_xxx node scripts/migrate-jsonl-to-pg.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { schemaForDataDir } from "../src/pgbackend.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PG_SCHEMA || schemaForDataDir(DATA_DIR);

if (!URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await client.query(`SET search_path TO "${SCHEMA}"`);
  await client.query(`CREATE TABLE IF NOT EXISTS kv (
    collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection, id))`);

  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".jsonl"));
  let total = 0;
  for (const f of files) {
    const collection = f.replace(/\.jsonl$/, "");
    const lines = fs.readFileSync(path.join(DATA_DIR, f), "utf8").split("\n").filter((l) => l.trim());
    let n = 0;
    for (const line of lines) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!rec.id) continue;
      await client.query(
        `INSERT INTO kv (collection, id, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [collection, rec.id, JSON.stringify(rec), rec.createdAt || new Date().toISOString(), rec.updatedAt || rec.createdAt || new Date().toISOString()]
      );
      n++;
    }
    total += n;
    console.log(`${collection}: ${n} rows`);
  }
  console.log(`migrated ${total} rows → schema ${SCHEMA} (kv)`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
