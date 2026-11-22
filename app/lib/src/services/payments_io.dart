import "package:flutter/foundation.dart";
import "package:flutter/services.dart" show PlatformException;
import "package:purchases_flutter/purchases_flutter.dart";

import "../api/api_client.dart";
import "../api/endpoints.dart" as ep;
import "../api/models.dart" as model;
import "../config.dart";
import "payments_stub.dart" show PurchaseOutcome;

/// Real RevenueCat purchase flow (mobile/desktop), docs/01 §8.
///
/// Setup:
/// - RevenueCat public SDK key via `--dart-define=REVENUECAT_PUBLIC_KEY=...`
///   (same RC project for Android Play Billing and iOS StoreKit 2).
/// - RevenueCat products use the **offering id** as their product identifier,
///   so `offering.id` maps 1:1 to a store product.
/// - The booking id is attached as the `hl_booking_id` subscriber attribute,
///   which the backend reads from the webhook (`subscriber_attributes`) and
///   resolves to the booking; the webhook signature is verified with
///   REVENUECAT_WEBHOOK_SECRET (see backend).
///
/// If no key is configured (local dev), behaves like the stub: `pending`.
class PaymentsService {
  PaymentsService._();
  static final PaymentsService instance = PaymentsService._();

  bool _configured = false;

  Future<void> _ensureConfigured() async {
    if (_configured) return;
    final key = ApiConfig.revenueCatPublicKey;
    if (key.isEmpty) return; // dev: no key → stub behavior
    await Purchases.setLogLevel(kDebugMode ? LogLevel.debug : LogLevel.warn);
    await Purchases.configure(PurchasesConfiguration(key));
    _configured = true;
  }

  Future<PurchaseOutcome> purchase(ApiClient api, {required model.Offering offering, required String bookingId}) async {
    await _ensureConfigured();
    if (!_configured) return PurchaseOutcome.pending; // dev demo: webhook pays
    try {
      // attach booking id so the webhook resolves this booking
      await Purchases.setAttributes({"hl_booking_id": bookingId});

      // find the package whose store product id == offering.id
      final offerings = await Purchases.getOfferings();
      Package? pkg;
      for (final o in offerings.all.values) {
        for (final p in o.availablePackages) {
          if (p.storeProduct.identifier == offering.id) {
            pkg = p;
            break;
          }
        }
        if (pkg != null) break;
      }
      if (pkg != null) {
        await Purchases.purchase(PurchaseParams.package(pkg));
      } else {
        final products = await Purchases.getProducts([offering.id]);
        if (products.isEmpty) return PurchaseOutcome.failed;
        await Purchases.purchase(PurchaseParams.storeProduct(products.first));
      }
      return PurchaseOutcome.paid; // server-side confirmation arrives via webhook
    } on PlatformException catch (e) {
      final code = PurchasesErrorHelper.getErrorCode(e);
      if (code == PurchasesErrorCode.productAlreadyPurchasedError) return PurchaseOutcome.paid;
      return PurchaseOutcome.failed; // includes purchaseCancelledError → release the booking
    } catch (_) {
      return PurchaseOutcome.failed;
    }
  }

  /// Cancel a booking whose payment failed (frees the spot, promotes waitlist).
  Future<void> cancelAfterFailure(Api api, String bookingId) => ep.cancelBooking(api, bookingId);
}
