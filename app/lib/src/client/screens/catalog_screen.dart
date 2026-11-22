import "package:material_ui/material_ui.dart";
import "package:provider/provider.dart";

import "../../api/api_client.dart";
import "../../api/endpoints.dart" as api;
import "../../api/models.dart";
import "../../services/notifications.dart";
import "../../services/payments.dart";
import "../../shared/map_preview.dart";
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
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              separatorBuilder: (a, b) => const SizedBox(height: 12),
              itemBuilder: (context, i) {
                final o = items[i];
                return Card(
                  clipBehavior: Clip.antiAlias,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    MapPreview(approxLat: o.approxLat, approxLng: o.approxLng, city: o.venueCity),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(o.title, style: Theme.of(context).textTheme.titleLarge)),
                          RiskBadge(o.risk),
                        ]),
                        const SizedBox(height: 6),
                        Row(children: [
                          const Icon(Icons.place_outlined, size: 15, color: kAccentSoft),
                          const SizedBox(width: 4),
                          Expanded(child: Text("${o.venueName} · ${o.venueCity}", style: Theme.of(context).textTheme.bodySmall)),
                        ]),
                        const SizedBox(height: 4),
                        Row(children: [
                          const Icon(Icons.schedule, size: 15, color: kAccentSoft),
                          const SizedBox(width: 4),
                          Expanded(child: Text(fmtDual(o.startAt, o.venueTz, "UTC"), style: Theme.of(context).textTheme.bodySmall)),
                        ]),
                        const SizedBox(height: 12),
                        Row(children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(color: kGold.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
                            child: Text(o.priceBRL, style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF8A5A00))),
                          ),
                          const SizedBox(width: 8),
                          Text(o.status == "full" ? "full" : "${o.spotsLeft} spots left", style: TextStyle(color: kInk.withValues(alpha: 0.65), fontSize: 12)),
                          const Spacer(),
                          FilledButton.icon(
                            onPressed: o.status == "full" ? null : () => _book(context, o),
                            icon: const Icon(Icons.card_giftcard, size: 18),
                            label: const Text("Book & prepay"),
                          ),
                        ]),
                      ]),
                    ),
                  ]),
                );
              },
            ),
          );
        },
      );

  Future<void> _book(BuildContext context, Offering o) async {
    final auth = context.read<AuthController>();
    final messenger = ScaffoldMessenger.of(context); // capture before any await
    try {
      final meRes = await api.me(auth.api) as Map<String, dynamic>;
      final trips = meRes["trips"] as List;
      if (trips.isEmpty) {
        messenger.showSnackBar(const SnackBar(content: Text("Register a trip first (Trips tab).")));
        return;
      }
      final tripId = trips.first["id"];
      final res = await api.book(auth.api, o.id, tripId) as Map<String, dynamic>;
      if (res["waitlisted"] == true) {
        messenger.showSnackBar(const SnackBar(content: Text("Added to waitlist.")));
        return;
      }
      // Payment via RevenueCat (3DS) — see services/payments.dart; in dev the
      // booking stays pending_payment and the demo pays it via the webhook stub.
      final booking = res["booking"] as Map<String, dynamic>;
      final outcome = await PaymentsService.instance.purchase(auth.api, offering: o, bookingId: booking["id"]);
      if (outcome == PurchaseOutcome.failed) {
        await PaymentsService.instance.cancelAfterFailure(auth.api, booking["id"]);
        if (!context.mounted) return;
        messenger.showSnackBar(SnackBar(content: ErrorBox("Payment failed — booking cancelled, spot released.")));
        return;
      }
      if (outcome == PurchaseOutcome.paid) {
        await NotificationService.instance.bookingConfirmed(o.title); // one of the only 3 notifications
      }
      if (!context.mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(
        outcome == PurchaseOutcome.paid
            ? "Booked: ${o.title} — ${o.priceBRL}"
            : "Booked: ${o.title} — ${o.priceBRL} (payment pending; dev demo pays via webhook)",
      )));
    } on ApiException catch (e) {
      if (context.mounted) messenger.showSnackBar(SnackBar(content: ErrorBox(e.message)));
    }
  }
}
