/// Payments via RevenueCat (docs/01 §8: card + 3DS, prices local + home currency).
///
/// Platform split (conditional export):
/// - mobile/desktop (`dart.library.io`) → `payments_io.dart`: real
///   `purchases_flutter` SDK flow (see there);
/// - web / anything else → `payments_stub.dart`: no store SDK on web, booking
///   stays `pending_payment` and the demo pays it via the webhook.
library;

export "payments_stub.dart"
    if (dart.library.io) "payments_io.dart"
    if (dart.library.js_interop) "payments_web.dart";
