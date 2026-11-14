import 'package:clouddeck_mobile/screens/login_screen.dart';
import 'package:clouddeck_mobile/session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('登录页渲染邮箱与密码输入', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LoginScreen(session: Session(), onSignedIn: () {}),
      ),
    );

    expect(find.text('CloudDeck'), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(2));
    expect(find.text('登录'), findsWidgets);
  });
}
