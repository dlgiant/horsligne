import "api_client.dart";

/// Every backend call the apps make (backend/src/api.js).
/// Client (traveler) endpoints use the traveler session; staff endpoints use the
/// staff token (ADMIN_TOKEN stand-in until staff auth lands — see backend README).

// ---- auth / traveler ----
Future<dynamic> register(Api api, String name, String email, String password) =>
    api.post("/api/travelers/register", {"name": name, "email": email, "password": password});

Future<dynamic> login(Api api, String email, String password) =>
    api.post("/api/travelers/login", {"email": email, "password": password});

Future<dynamic> me(ApiClient api) => api.get("/api/travelers/me");

Future<dynamic> createTrip(Api api, Map<String, dynamic> trip) =>
    api.post("/api/trips", trip);

Future<dynamic> tripDetail(Api api, String tripId) => api.get("/api/trips/$tripId");

Future<dynamic> issueContact(Api api, String tripId, String name, String channel, String identifier) =>
    api.post("/api/trips/$tripId/contacts", {"name": name, "channel": channel, "identifier": identifier});

Future<dynamic> revokeContact(Api api, String tripId, String contactId) =>
    api.post("/api/trips/$tripId/contacts/$contactId/revoke");

Future<dynamic> catalog(Api api, [String? destination]) =>
    api.get("/api/catalog${destination == null ? "" : "?destination=$destination"}");

Future<dynamic> offeringDetail(Api api, String offeringId) => api.get("/api/sessions/$offeringId");

Future<dynamic> book(Api api, String offeringId, String tripId, {bool gift = false}) =>
    api.post("/api/sessions/$offeringId/book", {"tripId": tripId, "gift": gift});

Future<dynamic> decideGift(Api api, String bookingId, bool accept) =>
    api.post("/api/bookings/$bookingId/decide", {"accept": accept});

// ---- staff (admin token stand-in) ----
Future<dynamic> adminOverview(Api api) => api.get("/api/admin/overview");
Future<dynamic> paidBookings(Api api) => api.get("/api/admin/bookings?status=paid");
Future<dynamic> activeRuns(Api api) => api.get("/api/admin/runs?status=in_progress");
Future<dynamic> runDetail(Api api, String runId) => api.get("/api/runs/$runId");
Future<dynamic> checkpointLog(Api api, String runId) => api.get("/api/runs/$runId/messages");

Future<dynamic> checkIn(Api api, String bookingId, String custody, String? claimCode) =>
    api.post("/api/bookings/$bookingId/check-in", {"custody": custody, if (claimCode != null) "claimCode": claimCode});

Future<dynamic> verifyMessage(Api api, String messageId, {required bool verified, String via = "callback", bool lifeThreatening = false}) =>
    api.post("/api/messages/$messageId/verify",
        {"verified": verified, "via": via, "lifeThreatening": lifeThreatening});

Future<dynamic> extendRun(Api api, String runId, int minutes) =>
    api.post("/api/runs/$runId/extend", {"minutes": minutes});

Future<dynamic> checkOut(Api api, String runId) => api.post("/api/runs/$runId/check-out");

Future<dynamic> logIncident(Api api, String runId, String note) =>
    api.post("/api/runs/$runId/incident", {"note": note});
