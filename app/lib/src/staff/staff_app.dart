import "package:material_ui/material_ui.dart";
import "package:provider/provider.dart";

import "../shared/widgets.dart";
import "../state/auth_controller.dart";
import "screens/staff_login_screen.dart";
import "screens/roster_screen.dart";

/// Staff app: roster → check-in → checkpoint log → check-out summary.
/// Offline-first: ops queue locally and flush on reconnect (sync_queue.dart).
class StaffApp extends StatelessWidget {
  const StaffApp({super.key});

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(
        create: (_) => AuthController()..restore(),
        child: MaterialApp(
          title: "Hors Ligne Staff",
          theme: appTheme(),
          home: Consumer<AuthController>(
            builder: (context, auth, _) => auth.isSignedIn ? const RosterScreen() : const StaffLoginScreen(),
          ),
        ),
      );
}
