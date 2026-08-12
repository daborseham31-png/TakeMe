// ---------------------------------------------------------------------------
// Global OS push-notification tap routing.
//
// This is the ONE place expo-notifications' native tap events are wired up
// (see https://docs.expo.dev/versions/v54.0.0/sdk/notifications/ —
// addNotificationResponseReceivedListener / getLastNotificationResponseAsync
// / clearLastNotificationResponseAsync). Registered once at the app root
// (see app/_layout.tsx), it covers every state a tap can happen in:
//   - foregrounded / backgrounded: addNotificationResponseReceivedListener
//     fires immediately, live, for the whole time this hook is mounted.
//   - opened from terminated: the response that launched the app isn't
//     delivered through that listener — it has to be read once via
//     getLastNotificationResponseAsync() on mount instead.
//
// The actual "which screen does this open" decision is NEVER duplicated
// here — both this file and the in-app Notifications list
// (app/notifications.tsx) call the exact same resolveNotificationRoute()
// (notificationRoutingCore.ts), so the two paths can never drift apart.
// ---------------------------------------------------------------------------

import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { normalizeRoutableNotification, resolveNotificationRoute } from "./notificationRoutingCore";

export const useGlobalNotificationRouting = (): void => {
  // Every notification.request.identifier this hook has already routed for,
  // for the lifetime of this mount. Expo's own docs note
  // getLastNotificationResponseAsync() keeps returning the SAME response
  // until explicitly cleared, and the response that launched a terminated
  // app can also be re-delivered through the live listener shortly after —
  // this set is what stops either of those from navigating twice for one
  // real tap.
  const handledIdentifiers = useRef<Set<string>>(new Set());

  useEffect(() => {
    // expo-notifications has no web support (Expo's own docs list
    // Android/iOS only) — none of the calls below are safe to make on Web,
    // so this hook is a deliberate no-op there rather than risking a throw
    // from root-level setup (see app/_layout.tsx, where this is mounted
    // unconditionally on every platform).
    if (Platform.OS === "web") return;

    const handleResponse = (
      response: Notifications.NotificationResponse | null | undefined,
    ) => {
      if (!response) return;

      // Only a real tap on the notification body/default action should
      // navigate — a custom action button (if any are ever added) would
      // report its own identifier here instead and must not fall through
      // to this same navigation.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        return;
      }

      const identifier = response.notification?.request?.identifier;
      if (identifier) {
        if (handledIdentifiers.current.has(identifier)) return;
        handledIdentifiers.current.add(identifier);
      }

      const raw = response.notification?.request?.content?.data;
      const routable = normalizeRoutableNotification(raw);
      const route = resolveNotificationRoute(routable);

      // Malformed/empty payload (see resolveNotificationRoute's own
      // comment) — safely ignore rather than opening some default screen.
      if (!route) return;

      router.push(route as any);
    };

    // App opened from a terminated state by tapping a push notification —
    // delivered here once, not through the live listener below.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        handleResponse(response);
        // Prevents the same terminated-launch response from being handed
        // back again on a later call (e.g. a second mount of this hook
        // during the same app process) once it's already been routed.
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {});

    // App already running (foreground or backgrounded) — fires live for
    // every tap for as long as this hook stays mounted.
    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleResponse,
    );

    return () => {
      subscription.remove();
    };
  }, []);
};
