import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../session.dart';
import '../i18n.dart';
import 'project_screen.dart';
import 'settings_screen.dart';

class ProjectsScreen extends StatefulWidget {
  const ProjectsScreen({super.key, required this.session, required this.onLogout});

  final Session session;
  final VoidCallback onLogout;

  @override
  State<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends State<ProjectsScreen> {
  List<Project> projects = const [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = await widget.session.api.projects();
      if (mounted) setState(() => projects = data);
    } on ApiException catch (caught) {
      if (mounted) setState(() => error = caught.message);
    } catch (caught) {
      if (mounted) setState(() => error = '加载失败：$caught');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> createProject() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(tr('新建项目')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(labelText: tr('项目名称')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('取消'))),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: Text(tr('创建')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty) return;

    try {
      final project = await widget.session.api.createProject(name);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ProjectScreen(session: widget.session, project: project),
        ),
      );
      await load();
    } on ApiException catch (caught) {
      if (mounted) setState(() => error = caught.message);
    }
  }

  Future<void> logout() async {
    await widget.session.logout();
    widget.onLogout();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('CloudDeck'),
        actions: [
          IconButton(onPressed: load, icon: const Icon(Icons.refresh)),
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => SettingsScreen(session: widget.session, onLogout: widget.onLogout),
              ),
            ),
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: createProject,
        icon: const Icon(Icons.add),
        label: Text(tr('新建项目')),
      ),
      body: RefreshIndicator(
        onRefresh: load,
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  if (projects.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 80),
                      child: Center(child: Text(tr('还没有项目，先创建一个。'))),
                    ),
                  ...projects.map(
                    (project) => Card(
                      child: ListTile(
                        title: Text(project.name),
                        subtitle: Text(
                          project.description?.isNotEmpty == true
                              ? project.description!
                              : '创建于 ${project.createdAt.toLocal()}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => ProjectScreen(session: widget.session, project: project),
                            ),
                          );
                          await load();
                        },
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
