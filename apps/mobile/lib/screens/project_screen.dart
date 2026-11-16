import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../session.dart';
import 'audio_screen.dart';
import 'job_screen.dart';

class ProjectScreen extends StatefulWidget {
  const ProjectScreen({super.key, required this.session, required this.project});

  final Session session;
  final Project project;

  @override
  State<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends State<ProjectScreen> {
  List<Asset> assets = const [];
  List<Capability> capabilities = const [];
  List<Comment> comments = const [];
  final commentController = TextEditingController();
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
      final results = await Future.wait([
        widget.session.api.assets(widget.project.id),
        widget.session.api.capabilities(),
        widget.session.api.comments(widget.project.id),
      ]);
      if (mounted) {
        setState(() {
          assets = results[0] as List<Asset>;
          capabilities = results[1] as List<Capability>;
          comments = results[2] as List<Comment>;
        });
      }
    } on ApiException catch (caught) {
      if (mounted) setState(() => error = caught.message);
    } catch (caught) {
      if (mounted) setState(() => error = '加载失败：$caught');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  bool _isText(Asset asset) =>
      asset.mime.startsWith('text/') ||
      asset.mime.contains('json') ||
      asset.mime.contains('markdown');

  Future<void> preview(Asset asset) async {
    try {
      if (asset.mime.startsWith('audio/')) {
        final url = await widget.session.api.assetUrl(asset.assetId, asset.latestVersion);
        if (!mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => AudioScreen(url: url, name: asset.name)),
        );
        return;
      }
      if (_isText(asset)) {
        final text = await widget.session.api.assetText(asset.assetId, asset.latestVersion);
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(asset.name),
            content: SizedBox(
              width: double.maxFinite,
              height: 400,
              child: SingleChildScrollView(child: SelectableText(text)),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('关闭')),
            ],
          ),
        );
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('该类型暂不支持预览')),
        );
      }
    } on ApiException catch (caught) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
      }
    }
  }

  Future<void> addComment() async {
    final body = commentController.text.trim();
    if (body.isEmpty) return;
    try {
      final comment = await widget.session.api.addComment(widget.project.id, body);
      if (!mounted) return;
      setState(() {
        comments = [...comments, comment];
        commentController.clear();
      });
    } on ApiException catch (caught) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
      }
    }
  }

  Future<void> run(Capability capability) async {
    final compatible = assets.where((asset) => capability.inputTypes.contains(asset.type)).toList();
    if (compatible.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('没有匹配的输入资产（需要 ${capability.inputTypes.join(' / ')}）')),
      );
      return;
    }

    var mode = 'continue';
    var instruction = '续写下一段，保持原有叙事视角与节奏。';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(capability.name),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('输入：${compatible.first.name}'),
              if (capability.id == 'novel.edit') ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: mode,
                  decoration: const InputDecoration(labelText: '模式'),
                  items: const [
                    DropdownMenuItem(value: 'continue', child: Text('续写')),
                    DropdownMenuItem(value: 'rewrite', child: Text('改写')),
                    DropdownMenuItem(value: 'check', child: Text('一致性检查')),
                  ],
                  onChanged: (value) => setDialogState(() => mode = value ?? mode),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  initialValue: instruction,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: '写作指令'),
                  onChanged: (value) => instruction = value,
                ),
              ],
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('提交')),
          ],
        ),
      ),
    );
    if (confirmed != true) return;

    try {
      final job = await widget.session.api.createJob(
        widget.project.id,
        capabilityId: capability.id,
        assetId: compatible.first.assetId,
        version: compatible.first.latestVersion,
        params: capability.id == 'novel.edit'
            ? {'mode': mode, 'instruction': instruction}
            : const {},
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => JobScreen(session: widget.session, jobId: job.jobId),
        ),
      );
      await load();
    } on ApiException catch (caught) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
      }
    }
  }

  @override
  void dispose() {
    commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.project.name),
        actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh))],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ),
                Text('资产', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                if (assets.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('还没有资产，请在 Web 端上传稿件。'),
                  ),
                ...assets.map(
                  (asset) => Card(
                    child: ListTile(
                      leading: Icon(
                        asset.mime.startsWith('audio/') ? Icons.graphic_eq : Icons.description_outlined,
                      ),
                      title: Text(asset.name),
                      subtitle: Text('${asset.type} · v${asset.latestVersion}'),
                      onTap: () => preview(asset),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Text('能力', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ...capabilities.map(
                  (capability) => Card(
                    child: ListTile(
                      title: Text(capability.name),
                      subtitle: Text('${capability.description}\n预估 ${capability.estimate} USD'),
                      isThreeLine: true,
                      trailing: FilledButton(
                        onPressed: () => run(capability),
                        child: const Text('运行'),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Text('评论', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                if (comments.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text('还没有评论。'),
                  ),
                ...comments.map(
                  (comment) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(comment.body),
                    subtitle: Text(comment.createdAt.toLocal().toString()),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: commentController,
                        decoration: const InputDecoration(hintText: '写一条评论…'),
                        onSubmitted: (_) => addComment(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(onPressed: addComment, child: const Text('发送')),
                  ],
                ),
              ],
            ),
    );
  }
}
