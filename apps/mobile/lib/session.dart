import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

class Session {
  Session();

  static const _tokenKey = 'clouddeck.access';
  static const _refreshKey = 'clouddeck.refresh';

  final ApiClient api = ApiClient();
  String? token;
  String? refreshToken;

  bool get signedIn => token != null;

  Future<bool> restore() async {
    final prefs = await SharedPreferences.getInstance();
    token = prefs.getString(_tokenKey);
    refreshToken = prefs.getString(_refreshKey);
    api.token = token;
    return token != null;
  }

  Future<void> save(Map<String, dynamic> auth) async {
    token = auth['accessToken'] as String;
    refreshToken = auth['refreshToken'] as String?;
    api.token = token;
    final prefs = await SharedPreferences.getInstance();
    if (token != null) await prefs.setString(_tokenKey, token!);
    if (refreshToken != null) await prefs.setString(_refreshKey, refreshToken!);
  }

  Future<void> logout() async {
    token = null;
    refreshToken = null;
    api.token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_refreshKey);
  }
}
