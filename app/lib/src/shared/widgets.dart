import "package:material_ui/material_ui.dart";
import "package:intl/intl.dart";

/// Shared design tokens + widgets for client and staff apps.
/// Calm, warm, "outdoors at dusk" palette — same family as landing/portal/admin.

const kAccent = Color(0xFF1F4D3F); // deep pine
const kAccentSoft = Color(0xFF3E6B58);
const kPaper = Color(0xFFF6F3EC); // warm sand
const kInk = Color(0xFF1E2B26);
const kWarn = Color(0xFFB3402E);
const kGold = Color(0xFFE8A33D);

ThemeData appTheme() => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: kAccent,
        surface: kPaper,
        primary: kAccent,
        secondary: kGold,
        error: kWarn,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: kPaper,
      textTheme: const TextTheme().apply(bodyColor: kInk, displayColor: kInk).copyWith(
            headlineSmall: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: -0.5),
            titleLarge: const TextStyle(fontWeight: FontWeight.w700),
            titleMedium: const TextStyle(fontWeight: FontWeight.w600),
          ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        surfaceTintColor: Colors.transparent,
        shadowColor: kInk.withValues(alpha: 0.18),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: kPaper,
        foregroundColor: kInk,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: TextStyle(color: kInk, fontSize: 20, fontWeight: FontWeight.w700),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        ),
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        side: BorderSide.none,
        labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        indicatorColor: kAccent.withValues(alpha: 0.12),
        labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      ),
    );

ThemeData appDarkTheme() => appTheme().copyWith(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: const Color(0xFF141D19),
      colorScheme: ColorScheme.fromSeed(
        seedColor: kAccent,
        brightness: Brightness.dark,
        surface: const Color(0xFF141D19),
        primary: const Color(0xFF7FB8A4),
        secondary: kGold,
        error: kWarn,
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
    final inProgress = status == "in_progress";
    final color = overdue ? kWarn : inProgress ? kGold : kAccent;
    return Chip(
      label: Text(status.toUpperCase(), style: TextStyle(color: color, fontSize: 11)),
      backgroundColor: color.withValues(alpha: 0.12),
      side: BorderSide.none,
    );
  }
}

/// Risk label with color semantics (master plan §4: risk-labeled catalog).
class RiskBadge extends StatelessWidget {
  final String risk;
  const RiskBadge(this.risk, {super.key});
  @override
  Widget build(BuildContext context) {
    final c = switch (risk) {
      "high" => kWarn,
      "medium" => kGold,
      _ => kAccentSoft,
    };
    return Chip(
      avatar: Icon(Icons.shield_outlined, size: 14, color: c),
      label: Text("$risk risk", style: TextStyle(color: c, fontSize: 11)),
      backgroundColor: c.withValues(alpha: 0.1),
      side: BorderSide.none,
    );
  }
}

/// Small stat chip used in summaries (phone-free minutes, messages, emergencies).
class StatChip extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  const StatChip(this.icon, this.value, this.label, {super.key});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: kAccent.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(12)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 16, color: kAccent),
          const SizedBox(width: 6),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(color: kInk.withValues(alpha: 0.65), fontSize: 12)),
        ]),
      );
}

class SectionTitle extends StatelessWidget {
  final String text;
  const SectionTitle(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
      );
}

/// Gradient hero card for a trip/destination header.
class DestinationHero extends StatelessWidget {
  final String title;
  final String subtitle;
  final List<Widget> chips;
  const DestinationHero({required this.title, required this.subtitle, required this.chips, super.key});
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF1F4D3F), Color(0xFF3E6B58)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [BoxShadow(color: kAccent.withValues(alpha: 0.25), blurRadius: 18, offset: const Offset(0, 8))],
        ),
        padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white)),
          const SizedBox(height: 4),
          Text(subtitle, style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
          const SizedBox(height: 14),
          Wrap(spacing: 8, runSpacing: 8, children: chips),
        ]),
      );
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
