import "package:material_ui/material_ui.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../api/endpoints.dart" as api;
import "../../api/models.dart";
import "../../services/sync_queue.dart";
import "../../shared/widgets.dart";
import "../../state/auth_controller.dart";
import "run_detail_screen.dart";

/// Roster: paid bookings to check in + active runs. All reads/writes go through the
/// offline-first client so the checkpoint works with zero bars.
class RosterScreen extends StatefulWidget {
  const RosterScreen({super.key});
  @override
  State<RosterScreen> createState() => _RosterScreenState();
}

class _RosterScreenState extends State<RosterScreen> {
  late final OfflineFirstClient _offline;
  Future<dynamic>? _paid;
  Future<dynamic>? _runs;
  int _pendingOps = 0;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthController>();
    _offline = OfflineFirstClient(auth.api);
    _reload();
    _refreshPending();
  }

  void _reload() {
    _paid = api.paidBookings(_offline);
    _runs = api.activeRuns(_offline);
  }

  Future<void> _refreshPending() async {
    final n = await SyncQueue.instance.pendingCount();
    if (mounted) setState(() => _pendingOps = n);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text("Roster"),
        actions: [
          if (_pendingOps > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Chip(label: Text("$_pendingOps queued"), backgroundColor: kWarn.withValues(alpha: 0.12), side: BorderSide.none),
            ),
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: "Flush queued ops",
            onPressed: () async {
              await SyncQueue.instance.flush(context.read<AuthController>().api);
              _reload();
              _refreshPending();
            },
          ),
          IconButton(icon: const Icon(Icons.logout), onPressed: () => auth.signOut()),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(_reload);
          await _refreshPending();
        },
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            Text("Active runs", style: Theme.of(context).textTheme.titleLarge),
            FutureBuilder(
              future: _runs,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
                if (snap.hasError) return ErrorBox("${snap.error}");
                final runs = ((snap.data as Map<String, dynamic>)["runs"] as List).map((r) => Run.fromJson(r)).toList();
                if (runs.isEmpty) return const Text("No session in progress.");
                return Column(children: runs.map((r) => Card(
                      child: ListTile(
                        leading: StatusBadge(r.status),
                        title: Text("Run ${r.id.substring(0, 8)}"),
                        subtitle: Text("check-in ${r.checkedInAt ?? "—"}"),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => RunDetailScreen(runId: r.id, offline: _offline))).then((_) { _reload(); _refreshPending(); }),
                      ),
                    )).toList());
              },
            ),
            const SizedBox(height: 16),
            Text("Ready to check in (paid)", style: Theme.of(context).textTheme.titleLarge),
            FutureBuilder(
              future: _paid,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
                if (snap.hasError) return ErrorBox("${snap.error}");
                final list = ((snap.data as Map<String, dynamic>)["bookings"] as List);
                if (list.isEmpty) return const Text("Nothing waiting.");
                return Column(children: list.map((b) => Card(
                      child: ListTile(
                        title: Text("Booking ${b["id"].substring(0, 8)} · R\$ ${(b["priceCentsBRL"] / 100).toStringAsFixed(2)}"),
                        subtitle: Text("trip ${b["tripId"].substring(0, 8)}${b["gift"] == true ? " · gift" : ""}"),
                        trailing: FilledButton.tonal(onPressed: () => _checkIn(b["id"]), child: const Text("Check in")),
                      ),
                    )).toList());
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _checkIn(String bookingId) async {
    String custody = "accommodation_safe";
    final claim = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (context, setDlg) => AlertDialog(
            title: const Text("Check-in"),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<String>(
                initialValue: custody,
                items: const [
                  DropdownMenuItem(value: "accommodation_safe", child: Text("Accommodation safe")),
                  DropdownMenuItem(value: "sealed_pouch", child: Text("Sealed pouch (claim code)")),
                ],
                onChanged: (v) => custody = v ?? custody,
              ),
              if (custody == "sealed_pouch") TextField(controller: claim, decoration: const InputDecoration(labelText: "Claim code (HD-0000)")),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text("Check in")),
            ],
          )),
    );
    if (ok != true) return;
    try {
      await api.checkIn(_offline, bookingId, custody, custody == "sealed_pouch" ? claim.text.trim() : null);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Checked in — phone secured.")));
        _reload();
        _refreshPending();
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }
}
