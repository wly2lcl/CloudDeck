import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

class AudioScreen extends StatefulWidget {
  const AudioScreen({super.key, required this.url, required this.name});

  final String url;
  final String name;

  @override
  State<AudioScreen> createState() => _AudioScreenState();
}

class _AudioScreenState extends State<AudioScreen> {
  final AudioPlayer player = AudioPlayer();
  String? error;

  @override
  void initState() {
    super.initState();
    player.setUrl(widget.url).then((_) => player.play()).catchError((Object caught) {
      if (mounted) setState(() => error = '无法播放：$caught');
    });
  }

  @override
  void dispose() {
    player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.graphic_eq, size: 96),
            const SizedBox(height: 24),
            if (error != null)
              Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            StreamBuilder<PlayerState>(
              stream: player.playerStateStream,
              builder: (context, snapshot) {
                final playing = snapshot.data?.playing ?? false;
                return IconButton.filledTonal(
                  iconSize: 48,
                  onPressed: () => playing ? player.pause() : player.play(),
                  icon: Icon(playing ? Icons.pause : Icons.play_arrow),
                );
              },
            ),
            const SizedBox(height: 16),
            StreamBuilder<Duration?>(
              stream: player.durationStream,
              builder: (context, snapshot) {
                final duration = snapshot.data ?? Duration.zero;
                return Text('时长 ${duration.inMinutes}:${(duration.inSeconds % 60).toString().padLeft(2, '0')}');
              },
            ),
          ],
        ),
      ),
    );
  }
}
