import "package:flutter_test/flutter_test.dart";

import "package:horsligne/src/api/models.dart";
import "package:horsligne/src/shared/widgets.dart";

/// Pure unit tests for the parts of the app that must never regress:
/// model parsing against the real backend JSON shapes and the docs/05 §4
/// overdue rule. (Widget tests for the full apps need plugin mocks for
/// flutter_secure_storage / sqflite — see services/ for the seams.)
void main() {
  test("Offering parses backend catalog shape incl. venue + BRL price", () {
    final o = Offering.fromJson({
      "id": "o1",
      "title": "Hike",
      "kind": "hike",
      "startAt": "2026-12-02T14:00:00.000Z",
      "endAt": "2026-12-02T17:00:00.000Z",
      "capacity": 5,
      "spotsLeft": 3,
      "priceCentsBRL": 9000,
      "risk": "low",
      "status": "open",
      "venue": {"id": "v1", "name": "Pousada", "city": "Lençóis", "destination": "Chapada", "tz": "America/Bahia", "emergencyChannel": {"type": "landline", "contact": "+55 75 3000-0000"}},
    });
    expect(o.venueCity, "Lençóis");
    expect(o.venueTz, "America/Bahia");
    expect(o.priceBRL, "R\$ 90.00");
    expect(o.spotsLeft, 3);
  });

  test("Run.isOverdue implements docs/05 §4 (expected check-out + 30min grace)", () {
    final future = DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String();
    final past = DateTime.now().toUtc().subtract(const Duration(hours: 2)).toIso8601String();
    final almostOverdue = DateTime.now().toUtc().subtract(const Duration(minutes: 31)).toIso8601String();
    expect(Run(id: "r1", status: "in_progress", expectedCheckOut: future).isOverdue, isFalse);
    expect(Run(id: "r2", status: "in_progress", expectedCheckOut: past).isOverdue, isTrue);
    // 31 min past expected → overdue (grace is 30)
    expect(Run(id: "r3", status: "in_progress", expectedCheckOut: almostOverdue).isOverdue, isTrue);
    // extension pushes the deadline
    final ext = DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String();
    expect(Run(id: "r4", status: "in_progress", expectedCheckOut: past, extendedCheckOut: ext).isOverdue, isFalse);
    // checked-out runs are never overdue
    expect(Run(id: "r5", status: "checked_out", expectedCheckOut: past).isOverdue, isFalse);
  });

  test("CheckpointEntry parses docs/05 §7 checkpoint log schema", () {
    final m = CheckpointEntry.fromJson({
      "entry_id": "m1",
      "session_id": "run1",
      "ts": "2026-12-02T15:00:00.000Z",
      "channel": "portal",
      "sender": "Carlos",
      "callback_number": null,
      "relation": null,
      "classification": "urgent",
      "verification_status": "pending",
      "verified_by": null,
      "decision": null,
      "relayed_at": null,
      "actor": "portal",
    });
    expect(m.entryId, "m1");
    expect(m.classification, "urgent");
    expect(m.verificationStatus, "pending");
  });

  test("RunSummary counts delivered/emergency from check-out summary", () {
    final s = RunSummary.fromJson({
      "runId": "r1",
      "checkedOutAt": "2026-12-02T17:00:00.000Z",
      "phoneFreeMinutes": 180,
      "messages": [
        {"sender": "Ana", "classification": "routine", "verification": "not_required", "relayed": true, "delivered": true},
        {"sender": "Carlos", "classification": "urgent", "verification": "verified", "relayed": true, "delivered": true},
      ],
      "emergencyCount": 1,
      "incidents": [],
    });
    expect(s.phoneFreeMinutes, 180);
    expect(s.messageCount, 2);
    expect(s.deliveredCount, 2);
    expect(s.emergencyCount, 1);
  });

  test("fmtDual renders venue time + home time label", () {
    final s = fmtDual("2026-12-02T14:00:00.000Z", "America/Bahia", "Europe/Lisbon");
    expect(s, contains("Bahia"));
    expect(s, contains("your time"));
  });
}
