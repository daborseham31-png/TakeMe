// ---------------------------------------------------------------------------
// Desktop stub. The real app/driverLocationTask.ts (mobile) manages a live
// expo-location GPS subscription for an active driver trip — a concept that
// structurally doesn't exist in the admin desktop app (the admin never
// drives a trip). authLib.ts's signOutAndRedirectToLogin calls
// stopDriverLocationTracking() unconditionally as its first sign-out step;
// here it's just a no-op with the same signature, so authLib.ts's logic is
// otherwise unchanged. Not copying the real file avoids pulling in
// expo-location's native-module dependency chain for code that would never
// run on desktop anyway.
// ---------------------------------------------------------------------------

export const stopDriverLocationTracking = async (): Promise<void> => {};
