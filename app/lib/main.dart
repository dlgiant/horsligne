// Traveler client app entrypoint.
// Run: flutter run --target lib/main.dart --dart-define=API_BASE=http://localhost:3000
// Design rule (master plan §5): no feeds, no engagement loops — use it, then put it away.

import "package:material_ui/material_ui.dart";
import "src/client/client_app.dart";

void main() => runApp(const ClientApp());
