// ---------------------------------------------------------------------------
// Regression tests for app/notificationRoutingCore.ts — the single shared
// "which screen does this notification open" decision used by BOTH the
// in-app Notifications list (app/notifications.tsx) and the global native
// push-tap handler (app/useGlobalNotificationRouting.ts).
//
// This is what fixes "tapping a native push banner did nothing sensible":
// before this file existed, app/notifications.tsx had its own private
// branch chain and there was no OS push-tap listener at all. Now both call
// sites share exactly this logic, so they cannot drift apart.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  getBookingTabFromNotification,
  normalizeRoutableNotification,
  resolveNotificationRoute,
  RoutableNotification,
} from "../app/notificationRoutingCore";

describe("resolveNotificationRoute", () => {
  it("returns null for a completely empty/malformed payload (nothing to identify)", () => {
    expect(resolveNotificationRoute({})).toBeNull();
    expect(resolveNotificationRoute({ title: "Something" })).toBeNull();
  });

  it("routes roadside_help_requested to the driver's Help Requests screen with requestId", () => {
    const route = resolveNotificationRoute({
      type: "roadside_help_requested",
      requestId: "req-1",
      targetPage: "driver/help-requests",
    });
    expect(route).toEqual({
      pathname: "/driver/help-requests",
      params: { requestId: "req-1" },
    });
  });

  it("falls back to the default driver/help-requests path when targetPage is absent", () => {
    const route = resolveNotificationRoute({
      type: "roadside_help_requested",
      requestId: "req-2",
    });
    expect(route?.pathname).toBe("/driver/help-requests");
    expect(route?.params.requestId).toBe("req-2");
  });

  it("ignores roadside_help_requested when requestId is missing (malformed) and falls through to the generic route", () => {
    const route = resolveNotificationRoute({
      type: "roadside_help_requested",
      targetPage: "driver/help-requests",
    });
    // No requestId — must NOT open the detail screen with nothing to load.
    expect(route?.pathname).not.toBe("/driver/help-requests");
    expect(route?.pathname).toBe("/(tabs)/bookings");
  });

  it("routes roadside_offer_received to the waiting screen with highlightOfferId", () => {
    const route = resolveNotificationRoute({
      type: "roadside_offer_received",
      requestId: "req-3",
      offerId: "offer-9",
    });
    expect(route).toEqual({
      pathname: "/booking/roadside-help/waiting",
      params: { requestId: "req-3", highlightOfferId: "offer-9" },
    });
  });

  it("routes school_trip_match to trip-confirm with child identity fields", () => {
    const route = resolveNotificationRoute({
      type: "school_trip_match",
      bookingId: "trip-1",
      requestId: "rr-1",
      childEntryId: "entry-1",
      childName: "Sami",
      childId: "child-1",
    });
    expect(route).toEqual({
      pathname: "/booking/school/trip-confirm",
      params: {
        tripId: "trip-1",
        rideRequestId: "rr-1",
        childEntryId: "entry-1",
        childName: "Sami",
        childId: "child-1",
      },
    });
  });

  it("routes trip_started to live-tracking with source=schoolTrips", () => {
    const route = resolveNotificationRoute({
      type: "trip_started",
      bookingId: "trip-2",
    });
    expect(route).toEqual({
      pathname: "/booking/live-tracking",
      params: { id: "trip-2", source: "schoolTrips" },
    });
  });

  it("routes school_trip_replacement to the replacement-offer screen", () => {
    const route = resolveNotificationRoute({
      type: "school_trip_replacement",
      replacementOfferId: "offer-5",
      originalBookingId: "trip-3",
    });
    expect(route).toEqual({
      pathname: "/booking/school/replacement-offer",
      params: { offerId: "offer-5", originalBookingId: "trip-3" },
    });
  });

  it("routes roadside_payment_required to the roadside payment screen", () => {
    const route = resolveNotificationRoute({
      type: "roadside_payment_required",
      requestId: "req-4",
      offerId: "offer-4",
      bookingId: "booking-4",
      amount: 120,
    });
    expect(route).toEqual({
      pathname: "/booking/roadside-help/payment",
      params: {
        requestId: "req-4",
        offerId: "offer-4",
        bookingId: "booking-4",
        amount: "120",
        category: "roadside",
      },
    });
  });

  it("ignores roadside_payment_required when bookingId is missing", () => {
    const route = resolveNotificationRoute({
      type: "roadside_payment_required",
      requestId: "req-5",
    });
    expect(route?.pathname).toBe("/(tabs)/bookings");
  });

  it("routes noshow_appeal_submitted straight to the admin targetPage", () => {
    const route = resolveNotificationRoute({
      type: "noshow_appeal_submitted",
      targetPage: "admin/violations/v-1",
    });
    expect(route).toEqual({
      pathname: "/admin/violations/v-1",
      params: {},
    });
  });

  it("routes an errand payment-needed notification to the payment screen", () => {
    const route = resolveNotificationRoute({
      type: "request_accepted",
      kind: "errand",
      applicationId: "app-1",
    });
    expect(route).toEqual({
      pathname: "/booking/payment",
      params: { kind: "errand", id: "app-1" },
    });
  });

  it("falls back to My Bookings with the correct tab for an unrecognized type carrying an id", () => {
    const route = resolveNotificationRoute({
      type: "personal_ride_booking",
      bookingId: "b-1",
    });
    expect(route?.pathname).toBe("/(tabs)/bookings");
    expect(route?.params.tab).toBe("driver");
    expect(route?.params.bookingId).toBe("b-1");
  });

  it("honors an explicit targetTab over the type-based default", () => {
    const route = resolveNotificationRoute({
      type: "personal_ride_booking",
      bookingId: "b-2",
      targetTab: "passenger",
    });
    expect(route?.params.tab).toBe("passenger");
  });
});

describe("getBookingTabFromNotification", () => {
  it("defaults unrecognized types to passenger", () => {
    expect(getBookingTabFromNotification({ type: "some_unknown_type" })).toBe("passenger");
  });

  it("maps known driver-facing types to driver", () => {
    expect(getBookingTabFromNotification({ type: "new_booking_request" })).toBe("driver");
  });

  it("maps known passenger-facing types to passenger", () => {
    expect(getBookingTabFromNotification({ type: "ride_arrived" })).toBe("passenger");
  });
});

describe("normalizeRoutableNotification", () => {
  it("returns an empty object for null/undefined/non-object input (malformed push data)", () => {
    expect(normalizeRoutableNotification(null)).toEqual({});
    expect(normalizeRoutableNotification(undefined)).toEqual({});
    expect(normalizeRoutableNotification("garbage")).toEqual({});
    expect(normalizeRoutableNotification(42)).toEqual({});
  });

  it("extracts only well-typed fields, discarding anything with the wrong type", () => {
    const result = normalizeRoutableNotification({
      type: "roadside_help_requested",
      requestId: "req-1",
      amount: "not-a-number",
      kind: "not-work-or-errand",
      targetTab: "not-a-tab",
    });
    expect(result.type).toBe("roadside_help_requested");
    expect(result.requestId).toBe("req-1");
    expect(result.amount).toBeNull();
    expect(result.kind).toBeNull();
    expect(result.targetTab).toBeNull();
  });

  it("round-trips through resolveNotificationRoute exactly like a well-typed Firestore doc would", () => {
    const raw: unknown = {
      type: "roadside_help_requested",
      requestId: "req-77",
      targetPage: "driver/help-requests",
    };
    const normalized: RoutableNotification = normalizeRoutableNotification(raw);
    const route = resolveNotificationRoute(normalized);
    expect(route).toEqual({
      pathname: "/driver/help-requests",
      params: { requestId: "req-77" },
    });
  });
});
