/// Data models mirroring the backend JSON (backend/src/api.js).
/// Data minimization (docs/04 §3): the app never receives GPS/phone/payment data.

library;

class Traveler {
  final String id;
  final String name;
  final String email;
  Traveler({required this.id, required this.name, required this.email});
  factory Traveler.fromJson(Map<String, dynamic> j) =>
      Traveler(id: j["id"], name: j["name"], email: j["email"]);
}

class Trip {
  final String id;
  final String travelerFirstName;
  final String destination;
  final String? city;
  final String startDate;
  final String endDate;
  final String homeTz;
  final String status;
  final List<Booking> bookings;
  final List<Run> runs;
  Trip({
    required this.id,
    required this.travelerFirstName,
    required this.destination,
    this.city,
    required this.startDate,
    required this.endDate,
    required this.homeTz,
    required this.status,
    this.bookings = const [],
    this.runs = const [],
  });
  factory Trip.fromJson(Map<String, dynamic> j) => Trip(
        id: j["id"],
        travelerFirstName: j["travelerFirstName"],
        destination: j["destination"],
        city: j["city"],
        startDate: j["startDate"],
        endDate: j["endDate"],
        homeTz: j["homeTz"] ?? "UTC",
        status: j["status"] ?? "planned",
        bookings: (j["bookings"] as List? ?? []).map((b) => Booking.fromJson(b)).toList(),
        runs: (j["runs"] as List? ?? []).map((r) => Run.fromJson(r)).toList(),
      );
}

class Contact {
  final String id;
  final String name;
  final String channel;
  final String? maskedIdentifier;
  final bool revoked;
  Contact({required this.id, required this.name, required this.channel, this.maskedIdentifier, this.revoked = false});
  factory Contact.fromJson(Map<String, dynamic> j) => Contact(
        id: j["id"],
        name: j["name"],
        channel: j["channel"],
        maskedIdentifier: j["identifier"],
        revoked: j["revoked"] ?? false,
      );
}

class Offering {
  final String id;
  final String title;
  final String kind;
  final String startAt;
  final String endAt;
  final int spotsLeft;
  final int priceCentsBRL;
  final String risk;
  final String status;
  final String venueName;
  final String venueCity;
  final String venueTz;
  final double? approxLat; // city-level only (fuzzed map area, docs/04 §3)
  final double? approxLng;
  Offering({
    required this.id,
    required this.title,
    required this.kind,
    required this.startAt,
    required this.endAt,
    required this.spotsLeft,
    required this.priceCentsBRL,
    required this.risk,
    required this.status,
    required this.venueName,
    required this.venueCity,
    required this.venueTz,
    this.approxLat,
    this.approxLng,
  });
  factory Offering.fromJson(Map<String, dynamic> j) => Offering(
        id: j["id"],
        title: j["title"],
        kind: j["kind"],
        startAt: j["startAt"],
        endAt: j["endAt"],
        spotsLeft: j["spotsLeft"] ?? 0,
        priceCentsBRL: j["priceCentsBRL"] ?? 0,
        risk: j["risk"] ?? "low",
        status: j["status"] ?? "open",
        venueName: j["venue"]?["name"] ?? "",
        venueCity: j["venue"]?["city"] ?? "",
        venueTz: j["venue"]?["tz"] ?? "UTC",
        approxLat: (j["venue"]?["approxLat"] as num?)?.toDouble(),
        approxLng: (j["venue"]?["approxLng"] as num?)?.toDouble(),
      );
  String get priceBRL => "R\$ ${(priceCentsBRL / 100).toStringAsFixed(2)}";
}

class Booking {
  final String id;
  final String offeringId;
  final String status;
  final bool gift;
  final String? decision;
  final int priceCentsBRL;
  final String createdAt;
  Booking({
    required this.id,
    required this.offeringId,
    required this.status,
    required this.gift,
    this.decision,
    required this.priceCentsBRL,
    required this.createdAt,
  });
  factory Booking.fromJson(Map<String, dynamic> j) => Booking(
        id: j["id"],
        offeringId: j["offeringId"],
        status: j["status"],
        gift: j["gift"] ?? false,
        decision: j["decision"],
        priceCentsBRL: j["priceCentsBRL"] ?? 0,
        createdAt: j["createdAt"] ?? "",
      );
}

class Run {
  final String id;
  final String? offeringId;
  final String status;
  final String? checkedInAt;
  final String? checkedOutAt;
  final String? expectedCheckOut;
  final String? extendedCheckOut;
  final bool? overdue; // set by /api/admin/runs; otherwise computed via [isOverdue]
  final bool incidentInProgress;
  final String? emergencyChannel; // portal view only; staff resolves via the offering's venue
  final RunSummary? summary;
  Run({
    required this.id,
    this.offeringId,
    required this.status,
    this.checkedInAt,
    this.checkedOutAt,
    this.expectedCheckOut,
    this.extendedCheckOut,
    this.overdue,
    this.incidentInProgress = false,
    this.emergencyChannel,
    this.summary,
  });
  factory Run.fromJson(Map<String, dynamic> j) => Run(
        id: j["id"],
        offeringId: j["offeringId"],
        status: j["status"],
        checkedInAt: j["checkedInAt"],
        checkedOutAt: j["checkedOutAt"],
        expectedCheckOut: j["expectedCheckOut"],
        extendedCheckOut: j["extendedCheckOut"],
        overdue: j["overdue"],
        incidentInProgress: j["incidentInProgress"] ?? (j["incident"] != null),
        emergencyChannel: j["emergencyChannel"],
        summary: j["summary"] == null ? null : RunSummary.fromJson(j["summary"]),
      );

  /// docs/05 §4: overdue = expected (or extended) check-out + 30-min grace.
  bool get isOverdue {
    if (overdue != null) return overdue!;
    if (status != "in_progress") return false;
    final base = extendedCheckOut ?? expectedCheckOut;
    if (base == null) return false;
    final dt = DateTime.tryParse(base);
    if (dt == null) return false;
    return DateTime.now().toUtc().isAfter(dt.toUtc().add(const Duration(minutes: 30)));
  }

  String get effectiveStatus => isOverdue ? "overdue" : status;
}

class RunSummary {
  final String? checkedOutAt;
  final int phoneFreeMinutes;
  final int emergencyCount;
  final int messageCount;
  final int deliveredCount;
  RunSummary({
    this.checkedOutAt,
    required this.phoneFreeMinutes,
    required this.emergencyCount,
    required this.messageCount,
    required this.deliveredCount,
  });
  factory RunSummary.fromJson(Map<String, dynamic> j) => RunSummary(
        checkedOutAt: j["checkedOutAt"],
        phoneFreeMinutes: j["phoneFreeMinutes"] ?? 0,
        emergencyCount: j["emergencyCount"] ?? 0,
        messageCount: (j["messages"] as List? ?? []).length,
        deliveredCount: (j["messages"] as List? ?? []).where((m) => m["delivered"] == true).length,
      );
}

/// Checkpoint log entry (docs/05 §7 schema) — staff app only.
class CheckpointEntry {
  final String entryId;
  final String ts;
  final String channel;
  final String sender;
  final String classification;
  final String verificationStatus;
  final String? decision;
  final String? relayedAt;
  CheckpointEntry({
    required this.entryId,
    required this.ts,
    required this.channel,
    required this.sender,
    required this.classification,
    required this.verificationStatus,
    this.decision,
    this.relayedAt,
  });
  factory CheckpointEntry.fromJson(Map<String, dynamic> j) => CheckpointEntry(
        entryId: j["entry_id"],
        ts: j["ts"] ?? "",
        channel: j["channel"] ?? "",
        sender: j["sender"] ?? "",
        classification: j["classification"] ?? "routine",
        verificationStatus: j["verification_status"] ?? "pending",
        decision: j["decision"],
        relayedAt: j["relayed_at"],
      );
}
