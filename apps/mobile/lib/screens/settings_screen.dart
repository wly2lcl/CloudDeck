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
          FilledButton.tonal(onPressed: logout, child: const Text('退出登录')),
        ],
      ),
    );
  }
}
