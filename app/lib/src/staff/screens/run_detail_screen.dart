import "package:flutter/material.dart";

import "../../api/api_client.dart";
import "../../api/endpoints.dart" as api;
import "../../api/models.dart";
import "../../services/sync_queue.dart";
import "../../shared/widgets.dart";

/// Run detail: live status (incl. overdue + venue emergency channel only when overdue,
/// docs/05 §4), checkpoint log, urgent-message verification, extend, incident, check-out.
class RunDetailScreen extends StatefulWidget {
  final String runId;
  final OfflineFirstClient offline;
  const RunDetailScreen({required this.runId, required this.offline, super.key});
  @override
  State<RunDetailScreen> createState() => _RunDetailScreenState();
}

class _RunDetailScreenState extends State<RunDetailScreen> {
  Future<dynamic>? _run;
  Future<dynamic>? _log;
  int _pendingOps = 0;

  @override
  void initState() {
    super.initState();
    _reload();
    SyncQueue.instance.pending().then((ops) => mounted ? setState(() => _pendingOps = ops.length) : null);
  }

  void _reload() {
    _run = api.runDetail(widget.offline, widget.runId);
    _log = api.checkpointLog(widget.offline, widget.runId);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text("Run"),
          actions: [
            if (_pendingOps > 0)
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Chip(label: Text("$_pendingOps queued"), backgroundColor: kWarn.withValues(alpha: 0.12), side: BorderSide.none),
              ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: () async => setState(_reload),
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              FutureBuilder(
                future: _run,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
                  if (snap.hasError) return ErrorBox("${snap.error}");
                  final run = Run.fromJson((snap.data as Map<String, dynamic>)["run"]);
                  final overdue = run.isOverdue;
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text("Run ${run.id.substring(0, 8)}", style: Theme.of(context).textTheme.titleMedium)),
                          StatusBadge(run.effectiveStatus),
                        ]),
                        Text("check-in ${run.checkedInAt ?? "—"} · expected out ${run.extendedCheckOut ?? run.expectedCheckOut ?? "—"}"),
                        if (run.incidentInProgress) ...[
                          const SizedBox(height: 8),
                          const ErrorBox("Incident in progress — portal shows the same status."),
                        ],
                        if (overdue) ...[
                          const SizedBox(height: 8),
                          FutureBuilder(
                            future: run.offeringId == null ? null : api.offeringDetail(widget.offline, run.offeringId!),
                            builder: (context, osnap) {
                              final venue = osnap.data is Map ? (osnap.data as Map)["session"]["venue"] : null;
                              final ch = venue is Map && venue["emergencyChannel"] is Map ? venue["emergencyChannel"]["contact"] : null;
                              return ErrorBox("Overdue >30min. Emergency channel: ${ch ?? "…"}");
                            },
                          ),
                        ],
                        const SizedBox(height: 12),
                        Wrap(spacing: 8, children: [
                          FilledButton.tonal(onPressed: () => _extend(30), child: const Text("Extend +30m")),
                          FilledButton.tonal(onPressed: _incident, child: const Text("Log incident")),
                          FilledButton(onPressed: run.status == "checked_out" ? null : _checkOut, child: const Text("Check out")),
                        ]),
                      ]),
                    ),
                  );
                },
              ),
              const SizedBox(height: 12),
              Text("Checkpoint log (docs/05 §7)", style: Theme.of(context).textTheme.titleLarge),
              FutureBuilder(
                future: _log,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
                  if (snap.hasError) return ErrorBox("${snap.error}");
                  final entries = ((snap.data as Map<String, dynamic>)["entries"] as List).map((e) => CheckpointEntry.fromJson(e)).toList();
                  if (entries.isEmpty) return const Text("No messages yet.");
                  return Column(children: entries.map((m) => Card(
                        child: ListTile(
                          title: Text("${m.classification.toUpperCase()} · ${m.verificationStatus}${m.decision != null ? " · ${m.decision}" : ""}"),
                          subtitle: Text("${m.sender} · ${m.channel} · ${m.ts}"),
                          trailing: m.classification == "urgent" && m.verificationStatus == "pending"
                              ? FilledButton.tonal(onPressed: () => _verify(m.entryId), child: const Text("Verify"))
                              : null,
                        ),
                      )).toList());
                },
              ),
            ],
          ),
        ),
      );

  Future<void> _verify(String messageId) async {
    String via = "callback";
    bool life = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (context, setDlg) => AlertDialog(
            title: const Text("Verify urgent message (docs/05 §2.2)"),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<String>(
                initialValue: via,
                items: const [DropdownMenuItem(value: "callback", child: Text("Callback number")), DropdownMenuItem(value: "second_channel", child: Text("Second channel"))],
                onChanged: (v) => via = v ?? via,
              ),
              CheckboxListTile(value: life, onChanged: (v) => setDlg(() => life = v ?? false), title: const Text("Life-threatening? (interrupt only if verified + yes)")),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text("Record")),
            ],
          )),
    );
    if (ok != true) return;
    try {
      await api.verifyMessage(widget.offline, messageId, verified: true, via: via, lifeThreatening: life);
      if (mounted) setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }

  Future<void> _extend(int minutes) async {
    try {
      await api.extendRun(widget.offline, widget.runId, minutes);
      if (mounted) setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }

  Future<void> _incident() async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text("Log incident"),
        content: TextField(controller: note, decoration: const InputDecoration(labelText: "What happened?")),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text("Log")),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await api.logIncident(widget.offline, widget.runId, note.text.trim());
      if (mounted) setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }

  Future<void> _checkOut() async {
    try {
      final res = await api.checkOut(widget.offline, widget.runId) as Map<String, dynamic>;
      if (!mounted) return;
      final s = RunSummary.fromJson(res["summary"]);
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text("Check-out summary"),
          content: Text("Phone-free: ${s.phoneFreeMinutes} min\nMessages: ${s.messageCount} (${s.deliveredCount} delivered, ${s.emergencyCount} verified emergency)"),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text("Close"))],
        ),
      );
      setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }
}
