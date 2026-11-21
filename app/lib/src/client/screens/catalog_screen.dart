import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../api/endpoints.dart" as api;
import "../../api/models.dart";
import "../../services/notifications.dart";
import "../../services/payments.dart";
import "../../shared/widgets.dart";
import "../../state/auth_controller.dart";

/// Explore & book: destination catalog with risk labels (master plan §4).
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});
  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  Future<dynamic>? _catalog;

  @override
  void initState() {
    super.initState();
    _catalog = api.catalog(context.read<AuthController>().api);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder(
        future: _catalog,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: ErrorBox("${snap.error}"));
          final items = ((snap.data as Map<String, dynamic>)["catalog"] as List).map((c) => Offering.fromJson(c)).toList();
          if (items.isEmpty) return const Center(child: Text("Nothing here yet — check back when sessions open."));
          return RefreshIndicator(
            onRefresh: () async => setState(() => _catalog = api.catalog(context.read<AuthController>().api)),
            child: ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final o = items[i];
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(o.title, style: Theme.of(context).textTheme.titleMedium)),
                        Chip(label: Text(o.risk, style: const TextStyle(fontSize: 11)), backgroundColor: kAccent.withValues(alpha: 0.1), side: BorderSide.none),
                      ]),
                      const SizedBox(height: 4),
                      Text("${o.venueName}, ${o.venueCity} · ${fmtDual(o.startAt, o.venueTz, "UTC")}", style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 4),
                      Text("${o.priceBRL} · ${o.spotsLeft} spots left ${o.status == "full" ? "(full)" : ""}"),
                      const SizedBox(height: 10),
                      FilledButton.icon(
                        onPressed: o.status == "full" ? null : () => _book(context, o),
                        icon: const Icon(Icons.card_giftcard),
                        label: const Text("Book & prepay"),
                      ),
                    ]),
                  ),
                );
              },
            ),
          );
        },
      );

  Future<void> _book(BuildContext context, Offering o) async {
    final auth = context.read<AuthController>();
    try {
      final meRes = await api.me(auth.api) as Map<String, dynamic>;
      final trips = meRes["trips"] as List;
      if (trips.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Register a trip first (Trips tab).")));
        return;
      }
      final tripId = trips.first["id"];
      final res = await api.book(auth.api, o.id, tripId) as Map<String, dynamic>;
      if (res["waitlisted"] == true) {
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Added to waitlist.")));
        return;
      }
      // Payment via RevenueCat (3DS) — see services/payments.dart; in dev the
      // booking stays pending_payment and the demo pays it via the webhook stub.
      final booking = res["booking"] as Map<String, dynamic>;
      final outcome = await PaymentsService.instance.purchase(auth.api, offering: o, bookingId: booking["id"]);
      if (!context.mounted) return;
      if (outcome == PurchaseOutcome.failed) {
        await PaymentsService.instance.cancelAfterFailure(auth.api, booking["id"]);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox("Payment failed — booking cancelled, spot released.")));
        return;
      }
      if (outcome == PurchaseOutcome.paid) {
        await NotificationService.instance.bookingConfirmed(o.title); // one of the only 3 notifications
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
        outcome == PurchaseOutcome.paid
            ? "Booked: ${o.title} — ${o.priceBRL}"
            : "Booked: ${o.title} — ${o.priceBRL} (payment pending; dev demo pays via webhook)",
      )));
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }
}
