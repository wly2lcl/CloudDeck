import 'package:flutter/material.dart';

import 'screens/login_screen.dart';
import 'screens/projects_screen.dart';
import 'session.dart';

void main() {
  runApp(const CloudDeckApp());
}

class CloudDeckApp extends StatefulWidget {
  const CloudDeckApp({super.key});

  @override
  State<CloudDeckApp> createState() => _CloudDeckAppState();
}

class _CloudDeckAppState extends State<CloudDeckApp> {
  final Session session = Session();
  bool loading = true;

  @override
  void initState() {
    super.initState();
    session.restore().whenComplete(() {
      if (mounted) setState(() => loading = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CloudDeck',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF5EEAD4),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF0B0F14),
      ),
      home: loading
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : session.signedIn
              ? ProjectsScreen(
                  session: session,
                  onLogout: () => setState(() {}),
                )
              : LoginScreen(
                  session: session,
                  onSignedIn: () => setState(() {}),
                ),
    );
  }
}
