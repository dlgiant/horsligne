import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../shared/widgets.dart";
import "../../state/auth_controller.dart";

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;
  String? _error;
  bool _busy = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text("Hors Ligne", style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: kAccent)),
                    const SizedBox(height: 4),
                    Text(_register ? "Create your traveler account" : "Sign in", style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 16),
                    if (_register) TextField(controller: _name, decoration: const InputDecoration(labelText: "Name")),
                    const SizedBox(height: 10),
                    TextField(controller: _email, decoration: const InputDecoration(labelText: "Email"), keyboardType: TextInputType.emailAddress),
                    const SizedBox(height: 10),
                    TextField(controller: _password, decoration: const InputDecoration(labelText: "Password (min 10)"), obscureText: true),
                    if (_error != null) ...[const SizedBox(height: 10), ErrorBox(_error!)],
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: Text(_register ? "Register" : "Sign in"),
                    ),
                    TextButton(
                      onPressed: () => setState(() => _register = !_register),
                      child: Text(_register ? "Have an account? Sign in" : "New here? Register"),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      final auth = context.read<AuthController>();
      if (_register) {
        await auth.register(_name.text.trim(), _email.text.trim(), _password.text);
      } else {
        await auth.signIn(_email.text.trim(), _password.text);
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
