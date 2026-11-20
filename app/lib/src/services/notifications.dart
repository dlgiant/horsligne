import "package:flutter_local_notifications/flutter_local_notifications.dart";

/// The ONLY notifications the client app may send (master plan §7 MVP):
/// booking confirmation, session starting soon, session ended.
/// No feeds, no badges-as-engagement, nothing else. Anti-addictive by design.
enum AppNotificationType { bookingConfirmed, sessionStartingSoon, sessionEnded }

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    try {
      const settings = DarwinInitializationSettings();
      const android = AndroidInitializationSettings("@mipmap/ic_launcher");
      await _plugin.initialize(InitializationSettings(android: android, iOS: settings));
      _initialized = true;
    } catch (_) {
      _initialized = false; // web/desktop without the plugin: notifications become a no-op
    }
  }

  /// Best-effort: on platforms without local-notification support (e.g. Flutter web)
  /// this silently no-ops — the booking itself already succeeded.
  Future<void> show(AppNotificationType type, {required String title, required String body}) async {
    try {
      if (!_initialized) await init();
      if (!_initialized) return;
      const details = NotificationDetails(
        android: AndroidNotificationDetails("horsligne", "Hors Ligne", importance: Importance.high),
        iOS: DarwinNotificationDetails(),
      );
      await _plugin.show(type.index, title, body, details);
    } catch (_) {
      // never let a notification failure break the flow
    }
  }

  Future<void> bookingConfirmed(String offeringTitle) => show(
        AppNotificationType.bookingConfirmed,
        title: "Booked: $offeringTitle",
        body: "See you there. Your phone stays safe — check-in at the venue.",
      );

  Future<void> sessionStartingSoon(String offeringTitle) => show(
        AppNotificationType.sessionStartingSoon,
        title: "$offeringTitle starts in 30 min",
        body: "Leave your phone at check-in.",
      );

  Future<void> sessionEnded() => show(
        AppNotificationType.sessionEnded,
        title: "Session ended",
        body: "Collect your phone — your check-out summary is ready.",
      );
}
