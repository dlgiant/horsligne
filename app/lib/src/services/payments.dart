import "package:flutter/foundation.dart";

import "../api/api_client.dart";
import "../api/endpoints.dart" as ep;
import "../api/models.dart";

enum PurchaseOutcome { paid, pending, failed }

/// Payments via RevenueCat (docs/01 §8: card + 3DS, prices local + home currency).
///
/// Prod: `purchases_flutter` (RevenueCat SDK) — the app passes the booking id as
/// the `hl_booking_id` subscriber attribute, so the RevenueCat webhook lands on
/// the right booking. The backend verifies the X-RevenueCat-Signature HMAC
/// (REVENUECAT_WEBHOOK_SECRET) and is idempotent by event id.
///
/// Dev (debug + local API): no SDK — the booking stays `pending_payment` and the
/// demo marks it paid through the webhook stub (backend/scripts/seed-demo.mjs).
class PaymentsService {
  PaymentsService._();
  static final PaymentsService instance = PaymentsService._();

  Future<PurchaseOutcome> purchase(ApiClient api, {required Offering offering, required String bookingId}) async {
    // TODO(infra): Purchases.configure(...) with the RevenueCat API key, then
    // purchase the package for [offering] after setting subscriber attribute
    // hl_booking_id = bookingId, so the webhook resolves this booking.
    if (kDebugMode) return PurchaseOutcome.pending; // dev: demo webhook pays it
    return PurchaseOutcome.failed; // prod SDK not wired yet in this skeleton
  }

  /// Cancel a booking whose payment failed (frees the spot, promotes waitlist).
  Future<void> cancelAfterFailure(Api api, String bookingId) => ep.cancelBooking(api, bookingId);
}
