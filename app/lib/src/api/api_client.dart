import "dart:convert";

import "package:http/http.dart" as http;

/// Error shape matches the backend: {"error":{"code":…,"message":…}}.
class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  ApiException(this.status, this.code, this.message);
  @override
  String toString() => "ApiException($status $code): $message";
}

/// Common surface for direct and offline-first clients (see services/sync_queue.dart).
abstract class Api {
  Future<dynamic> get(String path);
  Future<dynamic> post(String path, [Object? body]);
}

/// Thin Bearer-token JSON client for the Hors Ligne backend (backend/).
class ApiClient implements Api {
  ApiClient(this.base, {this.token});

  final String base;
  String? token;

  Map<String, String> get _headers => {
        "content-type": "application/json",
        if (token != null) "authorization": "Bearer $token",
      };

  Future<dynamic> _handle(http.Response res) async {
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(res.body);
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 400) {
      final err = body is Map && body["error"] is Map ? body["error"] as Map : {};
      throw ApiException(
        res.statusCode,
        (err["code"] ?? "error").toString(),
        (err["message"] ?? res.reasonPhrase ?? "Request failed").toString(),
      );
    }
    return body;
  }

  @override
  Future<dynamic> get(String path) =>
      http.get(Uri.parse("$base$path"), headers: _headers).then(_handle);

  @override
  Future<dynamic> post(String path, [Object? body]) => http
      .post(Uri.parse("$base$path"), headers: _headers, body: body == null ? null : jsonEncode(body))
      .then(_handle);
}
