import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

class Session {
  Session({ApiClient? client}) : api = client ?? ApiClient() {
    api.onTokensChanged = _persist;
  }

  static const _tokenKey = 'clouddeck.access';
  static const _refreshKey = 'clouddeck.refresh';

  final ApiClient api;

  String? get token => api.token;
  String? get refreshToken => api.refreshToken;

  bool get signedIn => api.token != null;

  Future<void> _persist(String accessToken, String refreshToken) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, accessToken);
    await prefs.setString(_refreshKey, refreshToken);
  }

  Future<bool> restore() async {
    final prefs = await SharedPreferences.getInstance();
    api.token = prefs.getString(_tokenKey);
    api.refreshToken = prefs.getString(_refreshKey);
    return api.token != null;
  }

  Future<void> save(Map<String, dynamic> auth) async {
    api.token = auth['accessToken'] as String;
    api.refreshToken = auth['refreshToken'] as String?;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, api.token!);
    if (api.refreshToken != null) {
      await prefs.setString(_refreshKey, api.refreshToken!);
    }
  }

  Future<void> logout() async {
    api.token = null;
    api.refreshToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_refreshKey);
  }
}
