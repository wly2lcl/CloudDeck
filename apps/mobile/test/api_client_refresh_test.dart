import 'dart:convert';

import 'package:clouddeck_mobile/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('401 时自动刷新令牌并重试一次', () async {
    var projectCalls = 0;
    var tokenChanged = false;

    final client = MockClient((request) async {
      if (request.url.path == '/v1/projects') {
        projectCalls++;
        if (projectCalls == 1) {
          return http.Response(
            jsonEncode({
              'error': {'code': 'UNAUTHENTICATED', 'message': '令牌过期'},
            }),
            401,
            headers: {'content-type': 'application/json'},
          );
        }
        expect(request.headers['authorization'], 'Bearer new-access');
        return http.Response(
          jsonEncode({'data': <dynamic>[]}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }

      if (request.url.path == '/v1/auth/refresh') {
        expect(jsonDecode(request.body)['refreshToken'], 'refresh-1');
        return http.Response(
          jsonEncode({
            'data': {'accessToken': 'new-access', 'refreshToken': 'refresh-2'},
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }

      return http.Response('{}', 404);
    });

    final api = ApiClient(baseUrl: 'http://test', client: client)
      ..token = 'expired'
      ..refreshToken = 'refresh-1'
      ..onTokensChanged = (_, _) => tokenChanged = true;

    final projects = await api.projects();

    expect(projects, isEmpty);
    expect(projectCalls, 2);
    expect(tokenChanged, isTrue);
    expect(api.token, 'new-access');
    expect(api.refreshToken, 'refresh-2');
  });
}
