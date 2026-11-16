import 'package:flutter/material.dart';

class ContentGraphView extends StatelessWidget {
  const ContentGraphView({super.key, required this.graph, this.height = 260});

  final Map<String, dynamic> graph;
  final double height;

  @override
  Widget build(BuildContext context) {
    final assets = (graph['assets'] as List<dynamic>?) ?? const [];
    final links = (graph['links'] as List<dynamic>?) ?? const [];
    if (assets.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('还没有资产，内容链会在上传与运行后出现。'),
      );
    }
    return SizedBox(
      height: height,
      child: CustomPaint(
        painter: _GraphPainter(
          assets: assets.cast<Map<String, dynamic>>(),
          links: links.cast<Map<String, dynamic>>(),
          color: Theme.of(context).colorScheme.primary,
          textColor: Theme.of(context).colorScheme.onSurface,
        ),
        child: const SizedBox.expand(),
      ),
    );
  }
}

class _GraphPainter extends CustomPainter {
  _GraphPainter({
    required this.assets,
    required this.links,
    required this.color,
    required this.textColor,
  });

  final List<Map<String, dynamic>> assets;
  final List<Map<String, dynamic>> links;
  final Color color;
  final Color textColor;

  @override
  void paint(Canvas canvas, Size size) {
    final nodeWidth = size.width * 0.42;
    final nodeHeight = 44.0;
    final gap = 26.0;
    final positions = <String, Offset>{};
    final columns = assets.length > 4 ? 2 : 1;
    final rows = (assets.length / columns).ceil();
    final verticalGap = rows > 1 ? (size.height - nodeHeight) / (rows - 1) : 0.0;

    for (var index = 0; index < assets.length; index += 1) {
      final column = columns == 1 ? 0 : index % 2;
      final row = columns == 1 ? index : index ~/ 2;
      final x = columns == 1
          ? (size.width - nodeWidth) / 2
          : column == 0
              ? 0.0
              : size.width - nodeWidth;
      final y = rows == 1 ? (size.height - nodeHeight) / 2 : row * verticalGap;
      final id = assets[index]['assetId'] as String? ?? '$index';
      positions[id] = Offset(x, y);
    }

    final line = Paint()
      ..color = color.withValues(alpha: 0.5)
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;
    for (final link in links) {
      final from = positions[link['fromAssetId'] as String? ?? ''];
      final to = positions[link['toAssetId'] as String? ?? ''];
      if (from == null || to == null) continue;
      final start = Offset(from.dx + nodeWidth, from.dy + nodeHeight / 2);
      final end = Offset(to.dx, to.dy + nodeHeight / 2);
      final path = Path()
        ..moveTo(start.dx, start.dy)
        ..cubicTo(start.dx + gap, start.dy, end.dx - gap, end.dy, end.dx, end.dy);
      canvas.drawPath(path, line);
    }

    final nodePaint = Paint()..color = color.withValues(alpha: 0.12);
    final border = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    for (final asset in assets) {
      final id = asset['assetId'] as String? ?? '';
      final position = positions[id];
      if (position == null) continue;
      final rect = Rect.fromLTWH(position.dx, position.dy, nodeWidth, nodeHeight);
      canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(10)), nodePaint);
      canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(10)), border);

      final text = TextPainter(
        text: TextSpan(
          text: '${asset['name'] ?? asset['type']}\n${asset['type']}',
          style: TextStyle(color: textColor, fontSize: 11),
        ),
        textDirection: TextDirection.ltr,
        maxLines: 2,
        ellipsis: '…',
      )..layout(maxWidth: nodeWidth - 12);
      text.paint(canvas, position + const Offset(6, 6));
    }
  }

  @override
  bool shouldRepaint(_GraphPainter oldDelegate) =>
      oldDelegate.assets != assets || oldDelegate.links != links;
}
