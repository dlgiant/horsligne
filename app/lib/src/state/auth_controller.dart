import "package:flutter/foundation.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";

import "../api/api_client.dart";
import "../api/endpoints.dart" as ep;
import "../config.dart";

/// Session auth for both apps. Token lives in flutter_secure_storage only.
///
/// Client app: email+password login (POST /api/travelers/login).
/// Staff app: staff token entered manually (ADMIN_TOKEN stand-in until staff
/// auth lands on the backend — see backend/README.md "Auth model").
class AuthController extends ChangeNotifier {
  AuthController({ApiClient? client, FlutterSecureStorage? storage})
      : _api = client ?? ApiClient(ApiConfig.apiBase),
        _storage = storage ?? const FlutterSecureStorage();

  final ApiClient _api;
  final FlutterSecureStorage _storage;
  static const _tokenKey = "hl_session_token";

  String? _token;
  String? get token => _token;
  bool get isSignedIn => _token != null;
  ApiClient get api => _api;

  Future<void> restore() async {
    _token = await _storage.read(key: _tokenKey);
    if (_token != null) _api.token = _token;
    notifyListeners();
  }

  Future<void> signIn(String email, String password) async {
    final res = await ep.login(_api, email, password) as Map<String, dynamic>;
    await _save(res["session"] as String);
  }

  Future<void> register(String name, String email, String password) async {
    await ep.register(_api, name, email, password);
    await signIn(email, password);
  }

  /// Staff sign-in with a raw token (validated against the admin overview).
  Future<void> signInWithToken(String token) async {
    _api.token = token;
    await ep.adminOverview(_api); // throws ApiException(401) if invalid
    await _save(token);
  }

  Future<void> signOut() async {
    _token = null;
    _api.token = null;
    await _storage.delete(key: _tokenKey);
    notifyListeners();
  }

  Future<void> _save(String token) async {
    _token = token;
    _api.token = token;
    await _storage.write(key: _tokenKey, value: token);
    notifyListeners();
  }
}
