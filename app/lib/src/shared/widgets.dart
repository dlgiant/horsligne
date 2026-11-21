import "package:material_ui/material_ui.dart";
import "package:intl/intl.dart";

/// Shared widgets for client + staff apps (same calm palette as landing/portal/admin).

const kAccent = Color(0xFF2E5E4E);
const kPaper = Color(0xFFF7F4EE);
const kInk = Color(0xFF21302B);
const kWarn = Color(0xFFA33B2E);

ThemeData appTheme() => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: kAccent, surface: kPaper),
      scaffoldBackgroundColor: kPaper,
      textTheme: const TextTheme().apply(bodyColor: kInk, displayColor: kInk),
      cardTheme: CardThemeData(color: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        filled: true,
        fillColor: Colors.white,
      ),
    );

class ErrorBox extends StatelessWidget {
  final String message;
  const ErrorBox(this.message, {super.key});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: kWarn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
        child: Text(message, style: TextStyle(color: kWarn)),
      );
}

class StatusBadge extends StatelessWidget {
  final String status;
  const StatusBadge(this.status, {super.key});
  @override
  Widget build(BuildContext context) {
    final overdue = status == "overdue";
    final color = overdue ? kWarn : kAccent;
    return Chip(
      label: Text(status.toUpperCase(), style: TextStyle(color: color, fontSize: 11)),
      backgroundColor: color.withValues(alpha: 0.1),
      side: BorderSide.none,
    );
  }
}

/// Dual-timezone line: venue tz + traveler home tz (docs/01 §4).
String fmtDual(String iso, String tzVenue, String tzHome) {
  final d = DateTime.tryParse(iso);
  if (d == null) return "—";
  String at(String tz) {
    try {
      return DateFormat("EEE HH:mm", "en").format(d.toUtc().add(_offsetFor(tz, d)));
    } catch (_) {
      return DateFormat("EEE HH:mm").format(d.toLocal());
    }
  }

  return "${at(tzVenue)} (${_shortTz(tzVenue)}) · ${at(tzHome)} (your time)";
}

String _shortTz(String tz) => tz.contains("/") ? tz.split("/").last.replaceAll("_", " ") : tz;

// Minimal tz offset lookup for common launch tzs (full impl: timezone package).
Duration _offsetFor(String tz, DateTime atUtc) {
  const map = {
    "America/Bahia": Duration(hours: -3),
    "America/Sao_Paulo": Duration(hours: -3),
    "Europe/Lisbon": Duration(hours: 0), // WET in winter
    "UTC": Duration.zero,
  };
  return map[tz] ?? Duration.zero;
}
