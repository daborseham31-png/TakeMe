// ---------------------------------------------------------------------------
// Shared notification -> route decision logic.
//
// ONE place decides "where does tapping this notification go" for the WHOLE
// app — the in-app Notifications list (app/notifications.tsx) and the
// native OS push-tap handler (app/useGlobalNotificationRouting.ts) both call
// resolveNotificationRoute() below instead of each keeping their own copy of
// this branch chain, so the two paths can never drift apart (this is the
// exact bug this file fixes: a native push tap used to have no routing logic
// at all and always fell back to the OS's default screen).
//
// Deliberately dependency-free (no react-native/firebase/expo-router/expo-
// notifications imports) — same reasoning as every other *Core.ts file in
// this project (see weeklyBookingCore.ts's own header): this is what lets it
// be unit-tested under vitest's plain-Node config, and it also means it
// genuinely has no side effects — it only ever returns a route descriptor,
// never calls router.push itself. Both call sites own that last step.
// ---------------------------------------------------------------------------

export type BookingTab = "passenger" | "driver";

export type RoutableNotification = {
  type?: string | null;
  title?: string | null;

  applicationId?: string | null;
  bookingId?: string | null;

  kind?: "work" | "errand" | null;
  category?: string | null;

  // Canonical field for routing. openBookingTab/roleTarget are kept for
  // backwards compatibility with older notification documents.
  targetTab?: BookingTab | null;
  roleTarget?: BookingTab | null;
  openBookingTab?: BookingTab | null;

  // Roadside Help only.
  requestId?: string | null;
  offerId?: string | null;
  targetPage?: string | null;
  amount?: number | null;
  driverId?: string | null;
  passengerId?: string | null;

  // School rides only.
  childEntryId?: string | null;
  childName?: string | null;
  childId?: string | null;

  // "school_trip_replacement" only.
  originalBookingId?: string | null;
  replacementOfferId?: string | null;
};

export type ResolvedNotificationRoute = {
  pathname: string;
  params: Record<string, string>;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : value != null ? String(value) : "";

// Defensive coercion for data that did NOT come from a well-typed Firestore
// read — a native push notification's `data` payload is arbitrary JSON from
// an external delivery pipeline, so every field is re-validated here rather
// than trusted. The in-app Notifications screen's Firestore-backed rows are
// already well-typed, but are still passed through this same function so
// both callers apply IDENTICAL normalization — never two slightly different
// interpretations of the same field.
export const normalizeRoutableNotification = (raw: unknown): RoutableNotification => {
  if (!raw || typeof raw !== "object") return {};
  const data = raw as Record<string, unknown>;

  const tab = (value: unknown): BookingTab | null =>
    value === "driver" || value === "passenger" ? value : null;

  return {
    type: typeof data.type === "string" ? data.type : null,
    title: typeof data.title === "string" ? data.title : null,
    applicationId: typeof data.applicationId === "string" ? data.applicationId : null,
    bookingId: typeof data.bookingId === "string" ? data.bookingId : null,
    kind: data.kind === "work" || data.kind === "errand" ? data.kind : null,
    category: typeof data.category === "string" ? data.category : null,
    targetTab: tab(data.targetTab),
    roleTarget: tab(data.roleTarget),
    openBookingTab: tab(data.openBookingTab),
    requestId: typeof data.requestId === "string" ? data.requestId : null,
    offerId: typeof data.offerId === "string" ? data.offerId : null,
    targetPage: typeof data.targetPage === "string" ? data.targetPage : null,
    amount: typeof data.amount === "number" ? data.amount : null,
    driverId: typeof data.driverId === "string" ? data.driverId : null,
    passengerId: typeof data.passengerId === "string" ? data.passengerId : null,
    childEntryId: typeof data.childEntryId === "string" ? data.childEntryId : null,
    childName: typeof data.childName === "string" ? data.childName : null,
    childId: typeof data.childId === "string" ? data.childId : null,
    originalBookingId: typeof data.originalBookingId === "string" ? data.originalBookingId : null,
    replacementOfferId: typeof data.replacementOfferId === "string" ? data.replacementOfferId : null,
  };
};

const DRIVER_NOTIFICATION_TYPES = new Set([
  "request_received",
  "new_booking_request",
  "payment_confirmed",
  "personal_ride_booking",
  "school_ride_booking",
  "ride_completed",
  "roadside_offer_accepted",
  "roadside_payment_received",
]);

const PASSENGER_NOTIFICATION_TYPES = new Set([
  "request_accepted",
  "request_rejected",
  "on_the_way",
  "arrived",
  "completed",
  "cancelled",
  "ride_on_the_way",
  "ride_arrived",
  "ride_trip_completed",
  "roadside_driver_on_way",
  "roadside_rating_required",
]);

export const getBookingTabFromNotification = (n: RoutableNotification): BookingTab => {
  if (n.targetTab === "driver" || n.targetTab === "passenger") return n.targetTab;
  if (n.roleTarget === "driver" || n.roleTarget === "passenger") return n.roleTarget;
  if (n.openBookingTab === "driver" || n.openBookingTab === "passenger") return n.openBookingTab;

  if (DRIVER_NOTIFICATION_TYPES.has(n.type || "")) return "driver";
  if (PASSENGER_NOTIFICATION_TYPES.has(n.type || "")) return "passenger";

  return "passenger";
};

export const notificationNeedsPayment = (n: RoutableNotification): boolean =>
  n.type === "request_accepted" && n.kind === "errand";

// The single route decision for every notification type in the app. Returns
// null only when there is truly nothing to identify a destination with (an
// empty/garbage payload — e.g. a malformed push with no recognizable type or
// id at all) — callers must treat null as "do nothing", never as "fall back
// to some default screen". Every specific-type branch below additionally
// requires ITS OWN essential id to be non-empty before taking that branch;
// a well-formed Firestore-backed notification (the in-app screen's case)
// always has it, but a malformed external push might not — when it's
// missing, that branch is skipped and the chain falls through to the next
// check, ending at the generic My Bookings route (which needs no specific
// id) rather than opening a detail screen with nothing to show.
export const resolveNotificationRoute = (
  n: RoutableNotification,
): ResolvedNotificationRoute | null => {
  const hasAnyIdentifyingField =
    !!n.type || !!n.bookingId || !!n.applicationId || !!n.requestId || !!n.offerId;
  if (!hasAnyIdentifyingField) return null;

  if (notificationNeedsPayment(n) && n.applicationId && n.kind) {
    return {
      pathname: "/booking/payment",
      params: { kind: n.kind, id: n.applicationId },
    };
  }

  // A nearby driver was notified of a new Roadside Help request — open the
  // driver's existing Help Requests screen directly, never My Bookings. See
  // createRoadsideRequest (roadsideLib.ts), which sets targetPage to exactly
  // "driver/help-requests".
  if (n.type === "roadside_help_requested" && n.requestId) {
    return {
      pathname: `/${n.targetPage || "driver/help-requests"}`,
      params: { requestId: n.requestId },
    };
  }

  // A driver just offered help — open Finding Help with this exact offer
  // highlighted. Never Home, never another category.
  if (n.type === "roadside_offer_received" && n.requestId) {
    return {
      pathname: "/booking/roadside-help/waiting",
      params: {
        requestId: n.requestId,
        highlightOfferId: n.offerId || "",
      },
    };
  }

  // A waiting parent's requested return ride was matched — open the trip
  // details/confirm screen directly. Never books automatically; the parent
  // still has to confirm on that screen.
  if (n.type === "school_trip_match" && (n.bookingId || n.applicationId)) {
    return {
      pathname: "/booking/school/trip-confirm",
      params: {
        tripId: n.bookingId || n.applicationId || "",
        rideRequestId: n.requestId || "",
        childEntryId: n.childEntryId || "",
        childName: n.childName || "",
        childId: n.childId || "",
      },
    };
  }

  // The driver verified the passenger's code and the trip has started — open
  // Live Tracking directly (bookingId holds the TRIP id here).
  if (n.type === "trip_started" && (n.bookingId || n.applicationId)) {
    return {
      pathname: "/booking/live-tracking",
      params: {
        id: n.bookingId || n.applicationId || "",
        source: "schoolTrips",
      },
    };
  }

  // A driver cancelled a trip the parent had booked — open the replacement-
  // offer review screen directly. Never books anything automatically.
  if (n.type === "school_trip_replacement" && (n.replacementOfferId || n.applicationId)) {
    return {
      pathname: "/booking/school/replacement-offer",
      params: {
        offerId: n.replacementOfferId || n.applicationId || "",
        originalBookingId: n.originalBookingId || "",
      },
    };
  }

  // The driver finished the help — open the Roadside Help payment page
  // directly. Never My Bookings first.
  if (n.type === "roadside_payment_required" && n.bookingId) {
    return {
      pathname: "/booking/roadside-help/payment",
      params: {
        requestId: n.requestId || "",
        offerId: n.offerId || "",
        bookingId: n.bookingId,
        amount: n.amount != null ? String(n.amount) : "",
        category: "roadside",
      },
    };
  }

  // Admin: a driver submitted a no-show appeal — open the admin detail
  // screen directly (see driverNoShowLib.ts's notifyAllAdminsOfNewAppeal,
  // which sets targetPage to exactly "admin/violations/{violationId}").
  if (n.type === "noshow_appeal_submitted" && n.targetPage) {
    return { pathname: `/${n.targetPage}`, params: {} };
  }

  const tab = getBookingTabFromNotification(n);

  return {
    pathname: "/(tabs)/bookings",
    params: {
      tab,
      bookingId: n.bookingId || "",
      applicationId: n.applicationId || "",
      requestId: n.requestId || "",
      offerId: n.offerId || "",
      category: n.category || "",
      type: n.type || "",
      kind: n.kind || "",
    },
  };
};
