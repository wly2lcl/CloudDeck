import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.session, required this.onLogout});

  final Session session;
  final VoidCallback onLogout;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, dynamic>? me;
  Map<String, dynamic>? quota;
  final deviceController = TextEditingController();
  String platform = 'android';
  String? deviceMessage;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final results = await Future.wait([
        widget.session.api.me(),
        widget.session.api.quota(),
      ]);
      if (mounted) {
        setState(() {
          me = results[0];
          quota = results[1];
        });
      }
    } on ApiException catch (caught) {
      if (mounted) setState(() => error = caught.message);
    }
  }

  Future<void> registerDevice() async {
    final token = deviceController.text.trim();
    if (token.length < 16) {
      setState(() => deviceMessage = '令牌长度不足');
      return;
    }
    try {
      await widget.session.api.registerDevice(token, platform);
      if (mounted) setState(() => deviceMessage = '推送令牌已注册');
    } on ApiException catch (caught) {
      if (mounted) setState(() => deviceMessage = caught.message);
    }
  }

  @override
  void dispose() {
    deviceController.dispose();
    super.dispose();
  }

  Future<void> logout() async {
    await widget.session.logout();
    if (mounted) Navigator.of(context).pop();
    widget.onLogout();
  }

  @override
  Widget build(BuildContext context) {
    final user = me?['user'] as Map<String, dynamic>?;
    final tenants = (me?['tenants'] as List<dynamic>?) ?? const [];
    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (error != null) Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          Card(
            child: ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text((user?['email'] as String?) ?? '当前用户'),
              subtitle: Text((user?['displayName'] as String?) ?? ''),
            ),
          ),
          const SizedBox(height: 16),
          Text('租户', style: Theme.of(context).textTheme.titleMedium),
          ...tenants.map(
            (tenant) => ListTile(
              title: Text((tenant as Map<String, dynamic>)['name'] as String),
              subtitle: Text('${tenant['role']} · ${tenant['tier']}'),
            ),
          ),
          const SizedBox(height: 16),
          Text('本月配额', style: Theme.of(context).textTheme.titleMedium),
          if (quota != null)
            Card(
              child: ListTile(
                title: Text('已用 ${quota!['costUsd']} / ${quota!['maxCostUsd']} USD'),
                subtitle: Text(
                  '任务 ${quota!['jobCount']}/${quota!['maxJobs']} · 并发 ${quota!['running']}/${quota!['maxConcurrency']}',
                ),
              ),
            ),
          const SizedBox(height: 24),
          Text('推送注册', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: deviceController,
            decoration: const InputDecoration(
              labelText: 'FCM / APNs 设备令牌',
              helperText: '令牌由 Firebase/APNs SDK 获取后粘贴注册',
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              DropdownButton<String>(
                value: platform,
                items: const [
                  DropdownMenuItem(value: 'android', child: Text('Android')),
                  DropdownMenuItem(value: 'ios', child: Text('iOS')),
                ],
                onChanged: (value) => setState(() => platform = value ?? platform),
              ),
              const SizedBox(width: 12),
              FilledButton(onPressed: registerDevice, child: const Text('注册推送')),
            ],
          ),
          if (deviceMessage != null) Text(deviceMessage!),
          const SizedBox(height: 24),
          FilledButton.tonal(onPressed: logout, child: const Text('退出登录')),
        ],
      ),
    );
  }
}
