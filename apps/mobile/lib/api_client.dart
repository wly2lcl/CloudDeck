import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  ApiException(this.code, this.message, this.status);

  final String code;
  final String message;
  final int status;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({
    this.baseUrl = const String.fromEnvironment(
      'API_BASE',
      defaultValue: 'http://localhost:4310',
    ),
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;
  String? token;
  String? refreshToken;
  void Function(String accessToken, String refreshToken)? onTokensChanged;

  Future<bool> _refresh() async {
    final current = refreshToken;
    if (current == null) return false;

    final response = await _client.post(
      Uri.parse('$baseUrl/v1/auth/refresh'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'refreshToken': current}),
    );
    if (response.statusCode >= 400) {
      token = null;
      refreshToken = null;
      return false;
    }

    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    final data = payload['data'] as Map<String, dynamic>?;
    final access = data?['accessToken'] as String?;
    final next = data?['refreshToken'] as String?;
    if (access == null || next == null) {
      token = null;
      refreshToken = null;
      return false;
    }
    token = access;
    refreshToken = next;
    onTokensChanged?.call(access, next);
    return true;
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool auth = true,
    bool allowRefresh = true,
  }) async {
    final headers = <String, String>{'content-type': 'application/json'};
    if (auth && token != null) {
      headers['authorization'] = 'Bearer $token';
    }

    final uri = Uri.parse('$baseUrl$path');
    late http.Response response;
    switch (method) {
      case 'POST':
        response = await _client.post(uri, headers: headers, body: jsonEncode(body ?? {}));
      case 'DELETE':
        response = await _client.delete(uri, headers: headers);
      default:
        response = await _client.get(uri, headers: headers);
    }

    if (response.statusCode == 401 && auth && allowRefresh && refreshToken != null) {
      if (await _refresh()) {
        return _request(method, path, body: body, auth: auth, allowRefresh: false);
      }
    }

    dynamic payload;
    try {
      payload = jsonDecode(response.body);
    } catch (_) {
      payload = <String, dynamic>{};
    }

    if (response.statusCode >= 400) {
      final error = payload is Map<String, dynamic> ? payload['error'] : null;
      throw ApiException(
        (error?['code'] as String?) ?? 'INTERNAL',
        (error?['message'] as String?) ?? '请求失败（${response.statusCode}）',
        response.statusCode,
      );
    }

    if (payload is Map<String, dynamic>) return payload['data'];
    return payload;
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final data = await _request(
      'POST',
      '/v1/auth/login',
      body: {'email': email, 'password': password},
      auth: false,
    );
    return data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> register(String email, String password, String name) async {
    final data = await _request(
      'POST',
      '/v1/auth/register',
      body: {'email': email, 'password': password, 'displayName': name},
      auth: false,
    );
    return data as Map<String, dynamic>;
  }

  Future<List<Project>> projects() async {
    final data = await _request('GET', '/v1/projects') as List<dynamic>;
    return data.map((item) => Project.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Project> createProject(String name) async {
    final data = await _request('POST', '/v1/projects', body: {'name': name});
    return Project.fromJson(data as Map<String, dynamic>);
  }

  Future<List<Asset>> assets(String projectId) async {
    final data = await _request('GET', '/v1/projects/$projectId/assets') as List<dynamic>;
    return data.map((item) => Asset.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<Capability>> capabilities() async {
    final data = await _request('GET', '/v1/capabilities') as List<dynamic>;
    return data.map((item) => Capability.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Job> createJob(
    String projectId, {
    required String capabilityId,
    required String assetId,
    required int version,
    Map<String, dynamic> params = const {},
  }) async {
    final data = await _request(
      'POST',
      '/v1/projects/$projectId/jobs',
      body: {
        'capabilityId': capabilityId,
        'inputs': [
          {'assetId': assetId, 'version': version},
        ],
        'params': params,
      },
    );
    return Job.fromJson(data as Map<String, dynamic>);
  }

  Future<Job> job(String jobId) async {
    final data = await _request('GET', '/v1/jobs/$jobId');
    return Job.fromJson(data as Map<String, dynamic>);
  }

  Future<List<JobLog>> logs(String jobId) async {
    final data = await _request('GET', '/v1/jobs/$jobId/logs') as List<dynamic>;
    return data.map((item) => JobLog.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Job> cancel(String jobId) async {
    final data = await _request('POST', '/v1/jobs/$jobId/cancel');
    return Job.fromJson(data as Map<String, dynamic>);
  }

  Future<Job> retry(String jobId) async {
    final data = await _request('POST', '/v1/jobs/$jobId/retry');
    return Job.fromJson(data as Map<String, dynamic>);
  }

  Future<Job> resume(String jobId) async {
    final data = await _request('POST', '/v1/jobs/$jobId/resume');
    return Job.fromJson(data as Map<String, dynamic>);
  }

  Future<List<Comment>> comments(String projectId) async {
    final data = await _request('GET', '/v1/projects/$projectId/comments') as List<dynamic>;
    return data.map((item) => Comment.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Comment> addComment(String projectId, String body) async {
    final data = await _request(
      'POST',
      '/v1/projects/$projectId/comments',
      body: {'body': body},
    );
    return Comment.fromJson(data as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> registerDevice(String token, String platform) async {
    final data = await _request(
      'POST',
      '/v1/devices',
      body: {'token': token, 'platform': platform},
    );
    return data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> me() async {
    final data = await _request('GET', '/v1/me');
    return data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> quota() async {
    final data = await _request('GET', '/v1/billing/quota');
    return data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> graph(String projectId) async {
    final data = await _request('GET', '/v1/projects/$projectId/graph');
    return data as Map<String, dynamic>;
  }

  Future<String> assetUrl(String assetId, int version) async {
    final data = await _request('GET', '/v1/assets/$assetId/versions/$version/url');
    return (data as Map<String, dynamic>)['url'] as String;
  }

  Future<String> assetText(String assetId, int version) async {
    final data = await _request('GET', '/v1/assets/$assetId/versions/$version/content');
    return (data as Map<String, dynamic>)['text'] as String;
  }
}
