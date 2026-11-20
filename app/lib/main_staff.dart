// Staff (facilitator) app entrypoint — offline-first.
// Run: flutter run --target lib/main_staff.dart --dart-define=API_BASE=http://localhost:3000
//
// All on-site writes go through the offline sync queue (src/services/sync_queue.dart)
// and flush when back in coverage. Zero bars required on-site (docs/05 §6).

import "package:flutter/material.dart";
import "src/staff/staff_app.dart";

void main() => runApp(const StaffApp());
