import "package:material_ui/material_ui.dart";
import "package:provider/provider.dart";

import "../shared/widgets.dart";
import "../state/auth_controller.dart";
import "screens/auth_screen.dart";
import "screens/home_screen.dart";

/// Traveler client app. Booking + history only — no feeds (master plan §5).
class ClientApp extends StatelessWidget {
  const ClientApp({super.key});

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(
        create: (_) => AuthController()..restore(),
        child: MaterialApp(
          title: "Hors Ligne",
          theme: appTheme(),
          home: Consumer<AuthController>(
            builder: (context, auth, _) => auth.isSignedIn ? const HomeScreen() : const AuthScreen(),
          ),
        ),
      );
}
