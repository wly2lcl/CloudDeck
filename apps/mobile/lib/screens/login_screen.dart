import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import '../i18n.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, required this.onSignedIn});

  final Session session;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  final nameController = TextEditingController();
  bool register = false;
  bool busy = false;
  String? error;

  @override
  void dispose() {
    emailController.dispose();
    passwordController.dispose();
    nameController.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final auth = register
          ? await widget.session.api.register(
              emailController.text.trim(),
              passwordController.text,
              nameController.text.trim(),
            )
          : await widget.session.api.login(
              emailController.text.trim(),
              passwordController.text,
            );
      await widget.session.save(auth);
      if (mounted) widget.onSignedIn();
    } on ApiException catch (caught) {
      if (mounted) setState(() => error = caught.message);
    } catch (caught) {
      if (mounted) setState(() => error = '无法连接控制面：$caught');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('CloudDeck', style: Theme.of(context).textTheme.headlineMedium),
                      const SizedBox(height: 6),
                      Text(
                        register ? tr('创建你的内容工作空间') : tr('登录你的内容工作台'),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 24),
                      TextField(
                        controller: emailController,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        decoration: InputDecoration(labelText: tr('邮箱')),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: passwordController,
                        obscureText: true,
                        decoration: InputDecoration(labelText: tr('密码')),
                      ),
                      if (register) ...[
                        const SizedBox(height: 12),
                        TextField(
                          controller: nameController,
                          decoration: InputDecoration(labelText: tr('昵称（可选）')),
                        ),
                      ],
                      if (error != null) ...[
                        const SizedBox(height: 12),
                        Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      ],
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: busy ? null : submit,
                        child: Text(busy ? tr('请稍候…') : (register ? tr('注册并登录') : tr('登录'))),
                      ),
                      TextButton(
                        onPressed: busy
                            ? null
                            : () => setState(() {
                                  register = !register;
                                  error = null;
                                }),
                        child: Text(register ? tr('已有账号？去登录') : tr('没有账号？创建一个')),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
