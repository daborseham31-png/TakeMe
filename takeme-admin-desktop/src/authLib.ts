// ---------------------------------------------------------------------------
// The ONE sign-out path for the whole app. Every "Log out" button (Profile,
// Admin menu, Admin settings) calls this instead of signOut()+router.replace()
// directly — see each call site's own history of doing that inline, which
// raced Firestore listeners still attached to authenticated screens against
// signOut() flipping auth.currentUser to null before those listeners had a
// chance to unsubscribe, surfacing as an uncaught "Missing or insufficient
// permissions" while the Login screen was opening.
//
// Every authenticated screen's own onSnapshot listeners already tear
// themselves down reactively via their own onAuthStateChanged subscription
// (see (tabs)/_layout.tsx, home.tsx, bookings.tsx, notifications.tsx,
// messages.tsx, admin/_layout.tsx, ...) — that part doesn't need repeating
// here. What this DOES own, explicitly and in order, is the non-listener
// resource (foreground GPS tracking) and the actual navigation, so the app
// is never left rendering an authenticated screen with a null auth.currentUser:
//   1. Stop foreground location tracking (driverLocationTask.ts) — not a
//      React listener, never torn down by an auth-state effect.
//   2. Sign out of Firebase Auth.
//   3. Only then navigate to the Login screen.
// ---------------------------------------------------------------------------

import { router } from "./router/expoRouterShim";
import { signOut } from "firebase/auth";

import { auth } from "../firebase";
import { stopDriverLocationTracking } from "./driverLocationTask";

export const signOutAndRedirectToLogin = async (): Promise<void> => {
  await stopDriverLocationTracking();
  await signOut(auth);
  router.replace("/");
};
