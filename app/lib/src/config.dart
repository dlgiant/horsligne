/// Deploy-time config via --dart-define, e.g.
///   flutter run --dart-define=API_BASE=https://api.horslign.earth
library;

class ApiConfig {
  static const apiBase = String.fromEnvironment(
    "API_BASE",
    defaultValue: "http://localhost:3000",
  );
}
