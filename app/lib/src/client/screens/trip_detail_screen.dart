import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../api/endpoints.dart" as api;
import "../../api/models.dart";
import "../../state/auth_controller.dart";
import "../../shared/widgets.dart";

/// Trip detail: portal contacts (issue = link+password shown once to share out-of-band,
/// revoke), bookings (incl. gift accept/decline), runs with check-out summaries (history).
class TripDetailScreen extends StatefulWidget {
  final String tripId;
  const TripDetailScreen({required this.tripId, super.key});
  @override
  State<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends State<TripDetailScreen> {
  Future<dynamic>? _detail; // GET /api/trips/:id → { ok, trip, contacts }
  Future<dynamic>? _me;     // GET /api/travelers/me → trips with bookings+runs

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    final auth = context.read<AuthController>();
    _detail = api.tripDetail(auth.api, widget.tripId);
    _me = api.me(auth.api);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text("Trip")),
        body: FutureBuilder(
          future: Future.wait([_detail!, _me!]),
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
            if (snap.hasError) return Center(child: ErrorBox("${snap.error}"));
            final detail = (snap.data as List)[0] as Map<String, dynamic>;
            final me = (snap.data as List)[1] as Map<String, dynamic>;
            final trip = Trip.fromJson(detail["trip"]);
            final contacts = (detail["contacts"] as List).map((c) => Contact.fromJson(c)).toList();
            final meTripJson = (me["trips"] as List).firstWhere((t) => t["id"] == widget.tripId, orElse: () => detail["trip"]);
            final meTrip = Trip.fromJson(meTripJson);
            return RefreshIndicator(
              onRefresh: () async => setState(_reload),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text("${trip.destination}${trip.city != null ? " — ${trip.city}" : ""}".trim(), style: Theme.of(context).textTheme.headlineSmall),
                  Text("${trip.startDate} → ${trip.endDate} · home tz ${trip.homeTz}", style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 16),
                  _contactsSection(contacts),
                  const SizedBox(height: 16),
                  _bookingsSection(meTrip),
                  const SizedBox(height: 16),
                  _runsSection(meTrip),
                ],
              ),
            );
          },
        ),
      );

  Widget _contactsSection(List<Contact> contacts) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text("Portal contacts", style: Theme.of(context).textTheme.titleMedium)),
              FilledButton.tonal(onPressed: _issueContact, child: const Text("Add")),
            ]),
            const SizedBox(height: 8),
            if (contacts.isEmpty) const Text("No contacts yet — add a loved one."),
            ...contacts.map((c) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(c.name),
                  subtitle: Text("${c.channel} · ${c.maskedIdentifier ?? ""}"),
                  trailing: c.revoked
                      ? const Text("revoked", style: TextStyle(color: kWarn))
                      : TextButton(onPressed: () => _revoke(c.id), child: const Text("Revoke")),
                )),
          ]),
        ),
      );

  Widget _bookingsSection(Trip trip) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text("Bookings", style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (trip.bookings.isEmpty) const Text("Nothing booked yet — see Explore."),
            ...trip.bookings.map((b) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text("${b.status}${b.gift ? " · gift" : ""}"),
                  subtitle: Text("R\$ ${(b.priceCentsBRL / 100).toStringAsFixed(2)}"),
                  trailing: b.gift && b.decision == "pending"
                      ? Row(mainAxisSize: MainAxisSize.min, children: [
                          TextButton(onPressed: () => _decide(b.id, true), child: const Text("Accept")),
                          TextButton(onPressed: () => _decide(b.id, false), child: const Text("Decline")),
                        ])
                      : null,
                )),
          ]),
        ),
      );

  Widget _runsSection(Trip trip) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text("Sessions & summaries", style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (trip.runs.isEmpty) const Text("No sessions yet."),
            ...trip.runs.map((r) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: StatusBadge(r.effectiveStatus),
                  title: Text(r.summary != null ? "Phone-free ${r.summary!.phoneFreeMinutes} min" : r.effectiveStatus),
                  subtitle: r.summary != null
                      ? Text("${r.summary!.messageCount} messages (${r.summary!.deliveredCount} delivered) · ${r.summary!.emergencyCount} verified emergency")
                      : Text(r.checkedInAt ?? ""),
                )),
          ]),
        ),
      );

  Future<void> _issueContact() async {
    final auth = context.read<AuthController>(); // capture before any await
    final name = TextEditingController();
    final identifier = TextEditingController();
    String channel = "sms";
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (context, setDlg) => AlertDialog(
            title: const Text("Add portal contact"),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: name, decoration: const InputDecoration(labelText: "Name (e.g. Carlos, brother)")),
              DropdownButtonFormField<String>(
                initialValue: channel,
                items: const [DropdownMenuItem(value: "sms", child: Text("SMS")), DropdownMenuItem(value: "email", child: Text("Email"))],
                onChanged: (v) => channel = v ?? "sms",
              ),
              TextField(controller: identifier, decoration: const InputDecoration(labelText: "Phone or email")),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text("Issue")),
            ],
          )),
    );
    if (ok != true) return;
    try {
      final res = await api.issueContact(auth.api, widget.tripId, name.text.trim(), channel, identifier.text.trim()) as Map<String, dynamic>;
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text("Share out-of-band"),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text("Send this link + password to your contact by your own channel — never through the portal itself:"),
            const SizedBox(height: 8),
            SelectableText(res["portalUrl"], style: const TextStyle(fontFamily: "monospace")),
            SelectableText(res["password"], style: const TextStyle(fontFamily: "monospace")),
            const SizedBox(height: 8),
            const Text("The link rotates on every login; you can revoke anytime. It stops working 24h after trip end."),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text("Done")),
            TextButton(
              onPressed: () => Clipboard.setData(ClipboardData(text: "${res["portalUrl"]}\n${res["password"]}")),
              child: const Text("Copy"),
            ),
          ],
        ),
      );
      setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }

  Future<void> _revoke(String contactId) async {
    try {
      await api.revokeContact(context.read<AuthController>().api, widget.tripId, contactId);
      setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }

  Future<void> _decide(String bookingId, bool accept) async {
    try {
      await api.decideGift(context.read<AuthController>().api, bookingId, accept);
      setState(_reload);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }
}
