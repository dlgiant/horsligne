/// Deploy-time config via --dart-define, e.g.
///   flutter run --dart-define=API_BASE=https://api.horslign.earth
library;

class ApiConfig {
  static const apiBase = String.fromEnvironment(
    "API_BASE",
    defaultValue: "http://localhost:3000",
  );

  /// RevenueCat public SDK key (mobile builds). Empty in dev → payments stay
  /// pending and the demo webhook pays. Never the secret key.
  static const revenueCatPublicKey = String.fromEnvironment(
    "REVENUECAT_PUBLIC_KEY",
    defaultValue: "",
  );
}
