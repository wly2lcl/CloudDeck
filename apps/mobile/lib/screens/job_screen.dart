import 'dart:async';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../session.dart';
import 'audio_screen.dart';

class JobScreen extends StatefulWidget {
  const JobScreen({super.key, required this.session, required this.jobId});

  final Session session;
  final String jobId;

  @override
  State<JobScreen> createState() => _JobScreenState();
}

class _JobScreenState extends State<JobScreen> {
  Job? job;
  List<JobLog> logs = const [];
  Timer? timer;
  String? error;

  @override
  void initState() {
    super.initState();
    refresh();
    timer = Timer.periodic(const Duration(seconds: 1), (_) => refresh());
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      final results = await Future.wait([
        widget.session.api.job(widget.jobId),
        widget.session.api.logs(widget.jobId),
      ]);
      if (!mounted) return;
      setState(() {
        job = results[0] as Job;
        logs = results[1] as List<JobLog>;
      });
      if (job?.terminal == true) timer?.cancel();
    } on ApiException catch (caught) {
      if (mounted) setState(() => error = caught.message);
    } catch (caught) {
      if (mounted) setState(() => error = '刷新失败：$caught');
    }
  }

  double get progress {
    if (job?.status == 'succeeded') return 1;
    for (final log in logs.reversed) {
      if (log.type == 'progress') {
        final value = (log.payload['percent'] as num?)?.toDouble() ?? 0;
        return (value / 100).clamp(0, 1);
      }
    }
    return 0;
  }

  Future<void> cancel() async {
    try {
      await widget.session.api.cancel(widget.jobId);
      await refresh();
    } on ApiException catch (caught) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
    }
  }

  Future<void> resume() async {
    try {
      await widget.session.api.resume(widget.jobId);
      timer?.cancel();
      timer = Timer.periodic(const Duration(seconds: 1), (_) => refresh());
      await refresh();
    } on ApiException catch (caught) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
    }
  }

  Future<void> retry() async {
    try {
      final next = await widget.session.api.retry(widget.jobId);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => JobScreen(session: widget.session, jobId: next.jobId),
        ),
      );
    } on ApiException catch (caught) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
    }
  }

  Future<void> openOutput(JobOutput output) async {
    try {
      if (output.type == 'audio_track' || output.name.endsWith('.mp3')) {
        final url = await widget.session.api.assetUrl(output.assetId, output.version);
        if (!mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => AudioScreen(url: url, name: output.name)),
        );
        return;
      }
      final text = await widget.session.api.assetText(output.assetId, output.version);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(output.name),
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
    } on ApiException catch (caught) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caught.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = job;
    return Scaffold(
      appBar: AppBar(
        title: Text(current?.capabilityId ?? '任务'),
        actions: [
          if (current != null && !current.terminal)
            TextButton(onPressed: cancel, child: const Text('取消')),
          if (current != null &&
              current.resumable &&
              (current.status == 'failed' || current.status == 'cancelled'))
            TextButton(onPressed: resume, child: const Text('续作')),
          if (current != null && (current.status == 'failed' || current.status == 'cancelled'))
            TextButton(onPressed: retry, child: const Text('重试')),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (error != null)
            Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (current != null) ...[
            Row(
              children: [
                Expanded(child: LinearProgressIndicator(value: progress)),
                const SizedBox(width: 12),
                Text('${(progress * 100).round()}%'),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${current.status} · 预估 ${current.estimatedCostUsd} USD · 实际 ${current.actualCostUsd} USD',
            ),
            if (current.errorCode != null)
              Text(
                '${current.errorCode}: ${current.errorMessage}',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (current.outputs.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('产物', style: Theme.of(context).textTheme.titleMedium),
              ...current.outputs.map(
                (output) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.article_outlined),
                    title: Text(output.name),
                    subtitle: Text('${output.type} · v${output.version}'),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: () => openOutput(output),
                  ),
                ),
              ),
            ],
          ],
          const SizedBox(height: 16),
          Text('事件', style: Theme.of(context).textTheme.titleMedium),
          ...logs.reversed.take(100).map(
                (log) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 64,
                        child: Text(
                          log.type,
                          style: TextStyle(color: Theme.of(context).colorScheme.primary),
                        ),
                      ),
                      Expanded(child: Text(log.summary)),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }
}
