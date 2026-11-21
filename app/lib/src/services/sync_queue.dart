import "dart:convert";

import "package:connectivity_plus/connectivity_plus.dart";
import "package:flutter/foundation.dart" show kIsWeb;
import "package:path/path.dart";
import "package:sqflite/sqflite.dart";

import "../api/api_client.dart";

/// Staff app offline-first queue (docs/05 §6, docs/10): every on-site write is
/// stored locally first (sqflite, encrypted at rest on the device OS) and
/// flushed to the backend when coverage returns. Zero bars required on-site.
///
/// Flush goes through the bulk reconcile endpoint POST /api/sync, which is
/// idempotent by client op id (backend synced_ops.jsonl) — a re-sent batch never
/// double-applies. Falls back to per-op replay if the backend is older (404).
class SyncQueue {
  SyncQueue._();
  static final SyncQueue instance = SyncQueue._();

  Database? _db;

  Future<Database> _open() async {
    if (_db != null) return _db!;
    if (kIsWeb) throw UnsupportedError("sqflite is not supported on Flutter web");
    final dir = await getDatabasesPath();
    _db = await openDatabase(join(dir, "hl_staff_offline.db"), version: 1, onCreate: (db, _) {
      return db.execute("""
        CREATE TABLE pending_ops (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          body TEXT,
          created_at TEXT NOT NULL
        )
      """);
    });
    return _db!;
  }

  Future<int> enqueue(String method, String path, [Object? body]) async {
    final db = await _open();
    return db.insert("pending_ops", {
      "method": method,
      "path": path,
      "body": body == null ? null : jsonEncode(body),
      "created_at": DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, dynamic>>> pending() async {
    final db = await _open();
    return db.query("pending_ops", orderBy: "id ASC");
  }

  /// Never throws (web has no local DB) — used for the "N queued" chip.
  Future<int> pendingCount() async {
    try {
      return (await pending()).length;
    } on UnsupportedError {
      return 0;
    }
  }

  Future<void> markDone(int id) async {
    final db = await _open();
    await db.delete("pending_ops", where: "id = ?", whereArgs: [id]);
  }

  Future<bool> isOnline() async {
    final r = await Connectivity().checkConnectivity();
    return r.any((c) => c != ConnectivityResult.none);
  }

  /// Replay queued ops in order via POST /api/sync (idempotent by op id server-side).
  /// Returns how many were flushed. Falls back to per-op replay on backends without /api/sync.
  Future<int> flush(ApiClient api) async {
    if (!await isOnline()) return 0;
    final ops = await pending();
    if (ops.isEmpty) return 0;
    try {
      final res = await api.post("/api/sync", {
        "ops": ops.map((o) => {
          "id": "op-${o["id"]}",
          "method": o["method"],
          "path": o["path"],
          "body": o["body"] == null ? null : jsonDecode(o["body"] as String),
        }).toList(),
      }) as Map<String, dynamic>;
      var flushed = 0;
      for (final r in (res["results"] as List)) {
        if (r["ok"] != true) break; // stop at first rejection; keep the rest queued, in order
        final rowId = int.parse((r["id"] as String).replaceFirst("op-", ""));
        await markDone(rowId);
        flushed++;
      }
      return flushed;
    } on ApiException catch (e) {
      if (e.status == 404) return _flushPerOp(api, ops); // older backend without /api/sync
      return 0;
    }
  }

  /// Legacy per-op replay (pre-/api/sync backends).
  Future<int> _flushPerOp(ApiClient api, List<Map<String, dynamic>> ops) async {
    var flushed = 0;
    for (final op in ops) {
      try {
        final body = op["body"] == null ? null : jsonDecode(op["body"] as String);
        if (op["method"] == "POST") {
          await api.post(op["path"] as String, body);
        } else {
          await api.get(op["path"] as String);
        }
        await markDone(op["id"] as int);
        flushed++;
      } on ApiException {
        break;
      }
    }
    return flushed;
  }
}

/// ApiClient wrapper for the staff app: online → direct call; offline (or
/// network failure) → enqueue and return a synthetic "queued" response so the
/// UI can show "saved locally, will sync".
class OfflineFirstClient implements Api {
  OfflineFirstClient(this.api, {SyncQueue? queue}) : _queue = queue ?? SyncQueue.instance;
  final ApiClient api;
  final SyncQueue _queue;

  /// Reads pass through (no offline cache in the MVP; roster/run screens show an
  /// error box when offline and the user can retry — writes are what must queue).
  @override
  Future<dynamic> get(String path) => api.get(path);

  @override
  Future<dynamic> post(String path, [Object? body]) async {
    if (await _queue.isOnline()) {
      try {
        return await api.post(path, body);
      } on ApiException {
        rethrow;
      } catch (_) {
        // network-level failure → fall through to queue
      }
    }
    try {
      await _queue.enqueue("POST", path, body);
      return {"ok": true, "queued": true};
    } on UnsupportedError {
      // no local queue (web): try the server directly as a last resort
      return api.post(path, body);
    }
  }

  Future<int> flush() => _queue.flush(api);
  Future<List<Map<String, dynamic>>> pendingOps() => _queue.pending();
}
