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
/// MVP: ops replay to their individual endpoints. The server-side bulk
/// reconcile endpoint (POST /api/sync) is the documented next backend step.
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

  /// Replay queued ops in order. Returns how many were flushed.
  Future<int> flush(ApiClient api) async {
    if (!await isOnline()) return 0;
    var flushed = 0;
    for (final op in await pending()) {
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
        break; // stop at first server rejection; keep the rest queued
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
