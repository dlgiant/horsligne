import "package:material_ui/material_ui.dart";
import "package:flutter_map/flutter_map.dart";
import "package:latlong2/latlong.dart"; // latlong2 ≥0.10 split the barrel; LatLng lives here

import "widgets.dart";

/// Map preview for the catalog. PRIVACY (docs/04 §3): shows only a fuzzed
/// CITY-LEVEL area circle (~4 km radius) around the city centroid — never a
/// pin at the venue's exact location. No MarkerLayer on purpose.
class MapPreview extends StatelessWidget {
  final double? approxLat;
  final double? approxLng;
  final String city;
  final double height;
  const MapPreview({required this.approxLat, required this.approxLng, required this.city, this.height = 130, super.key});

  @override
  Widget build(BuildContext context) {
    if (approxLat == null || approxLng == null) {
      return _placeholder();
    }
    final center = LatLng(approxLat!, approxLng!);
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
      child: SizedBox(
        height: height,
        child: Stack(children: [
          FlutterMap(
            options: MapOptions(
              initialCenter: center,
              initialZoom: 11.5,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.none), // static preview
            ),
            children: [
              TileLayer(
                urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                userAgentPackageName: "earth.horslign.earth",
              ),
              // fuzzed area circle — the only location visual we ever show
              CircleLayer(circles: [
                CircleMarker(
                  point: center,
                  radius: 4000, // meters
                  useRadiusInMeter: true,
                  color: kAccent.withValues(alpha: 0.15),
                  borderColor: kAccent.withValues(alpha: 0.6),
                  borderStrokeWidth: 2,
                ),
              ]),
            ],
          ),
          Positioned(
            left: 10,
            bottom: 10,
            child: Chip(
              avatar: const Icon(Icons.location_city, size: 14, color: kAccent),
              label: Text("$city area (approx.)", style: const TextStyle(fontSize: 11)),
              backgroundColor: Colors.white.withValues(alpha: 0.92),
              side: BorderSide.none,
            ),
          ),
        ]),
      ),
    );
  }

  Widget _placeholder() => Container(
        height: height,
        decoration: BoxDecoration(
          color: kAccent.withValues(alpha: 0.08),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
        ),
        child: Center(
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.map_outlined, color: kAccent.withValues(alpha: 0.7)),
            const SizedBox(width: 8),
            Text("$city — map area hidden until city coords are set", style: TextStyle(color: kInk.withValues(alpha: 0.6), fontSize: 12)),
          ]),
        ),
      );
}
