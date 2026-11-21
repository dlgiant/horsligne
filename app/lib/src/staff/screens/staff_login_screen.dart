import "package:material_ui/material_ui.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../shared/widgets.dart";
import "../../state/auth_controller.dart";

/// Staff signs in with the admin token (bearer) — staff auth lands with the real
/// traveler/staff identity layer; token kept in flutter_secure_storage.
class StaffLoginScreen extends StatefulWidget {
  const StaffLoginScreen({super.key});
  @override
  State<StaffLoginScreen> createState() => _StaffLoginScreenState();
}

class _StaffLoginScreenState extends State<StaffLoginScreen> {
  final _token = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text("Hors Ligne Staff", style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: kAccent)),
                  const SizedBox(height: 4),
                  const Text("Checkpoint console — roster, check-in/out, messages."),
                  const SizedBox(height: 16),
                  TextField(controller: _token, decoration: const InputDecoration(labelText: "Staff token"), obscureText: true),
                  if (_error != null) ...[const SizedBox(height: 10), ErrorBox(_error!)],
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _busy ? null : _submit, child: const Text("Sign in")),
                ]),
              ),
            ),
          ),
        ),
      );

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<AuthController>().signInWithToken(_token.text.trim());
    } on ApiException catch (e) {
      setState(() => _error = "${e.status} ${e.code}: ${e.message}");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
