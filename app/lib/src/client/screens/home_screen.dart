import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../api/endpoints.dart" as api;
import "../../api/models.dart";
import "../../state/auth_controller.dart";
import "../../shared/widgets.dart";
import "catalog_screen.dart";
import "trip_detail_screen.dart";

/// Client home: trips (with bookings/runs/summaries), catalog, and the 3-notification
/// rule in action. Booking happens here on wifi; sessions themselves need zero bars.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  Future<dynamic>? _me;

  @override
  void initState() {
    super.initState();
    _me = api.me(context.read<AuthController>().api);
  }

  void _reload() => setState(() => _me = api.me(context.read<AuthController>().api));

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text("Hors Ligne"),
        actions: [
          IconButton(icon: const Icon(Icons.logout), onPressed: () => auth.signOut()),
        ],
      ),
      body: IndexedStack(
        index: _tab,
        children: [
          _tripsTab(_me),
          const CatalogScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.luggage), label: "Trips"),
          NavigationDestination(icon: Icon(Icons.explore), label: "Explore"),
        ],
      ),
    );
  }

  Widget _tripsTab(Future<dynamic>? future) => FutureBuilder(
        future: future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) {
            final e = snap.error;
            return Center(child: ErrorBox(e is ApiException ? "${e.status} ${e.code}: ${e.message}" : "$e"));
          }
          final data = snap.data as Map<String, dynamic>;
          final trips = (data["trips"] as List).map((t) => Trip.fromJson(t)).toList();
          if (trips.isEmpty) {
            return Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text("No trips yet."),
                const SizedBox(height: 12),
                FilledButton(onPressed: () => _createTrip(context), child: const Text("Register a trip")),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView.builder(
              itemCount: trips.length,
              itemBuilder: (context, i) {
                final t = trips[i];
                final pastRuns = t.runs.where((r) => r.status == "checked_out" && r.summary != null).length;
                return Card(
                  child: ListTile(
                    title: Text("${t.destination}${t.city != null ? " — ${t.city}" : ""}"),
                    subtitle: Text("${t.startDate} → ${t.endDate} · ${t.bookings.length} bookings · $pastRuns summaries"),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context)
                        .push(MaterialPageRoute(builder: (_) => TripDetailScreen(tripId: t.id)))
                        .then((_) => _reload()),
                  ),
                );
              },
            ),
          );
        },
      );

  Future<void> _createTrip(BuildContext context) async {
    final auth = context.read<AuthController>(); // capture before any await
    final dest = TextEditingController();
    final city = TextEditingController();
    final start = TextEditingController(text: DateTime.now().toIso8601String().substring(0, 10));
    final end = TextEditingController(text: DateTime.now().add(const Duration(days: 5)).toIso8601String().substring(0, 10));
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text("Register trip"),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: dest, decoration: const InputDecoration(labelText: "Destination")),
          TextField(controller: city, decoration: const InputDecoration(labelText: "City")),
          TextField(controller: start, decoration: const InputDecoration(labelText: "Start (YYYY-MM-DD)")),
          TextField(controller: end, decoration: const InputDecoration(labelText: "End (YYYY-MM-DD)")),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text("Save")),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final meRes = await api.me(auth.api) as Map<String, dynamic>;
      final name = (meRes["traveler"]["name"] as String).split(" ").first;
      await api.createTrip(auth.api, {
        "travelerFirstName": name,
        "destination": dest.text.trim(),
        "city": city.text.trim(),
        "startDate": start.text.trim(),
        "endDate": end.text.trim(),
        "homeTz": "UTC",
      });
      _reload();
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }
}
