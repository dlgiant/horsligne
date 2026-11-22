import "../api/api_client.dart";
import "../api/endpoints.dart" as ep;
import "../api/models.dart";

enum PurchaseOutcome { paid, pending, failed }

/// Fallback (web / no RevenueCat key configured): the booking stays
/// `pending_payment` and the dev demo marks it paid through the webhook
/// (`backend/scripts/seed-demo.mjs`). The backend verifies the
/// X-RevenueCat-Signature HMAC (REVENUECAT_WEBHOOK_SECRET) and is idempotent
/// by event id.
class PaymentsService {
  PaymentsService._();
  static final PaymentsService instance = PaymentsService._();

  Future<PurchaseOutcome> purchase(ApiClient api, {required Offering offering, required String bookingId}) async {
    return PurchaseOutcome.pending; // no store on this platform / dev mode
  }

  /// Cancel a booking whose payment failed (frees the spot, promotes waitlist).
  Future<void> cancelAfterFailure(Api api, String bookingId) => ep.cancelBooking(api, bookingId);
}
