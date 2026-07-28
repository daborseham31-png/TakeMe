// ---------------------------------------------------------------------------
// Driver "Republish Trip" — a compact confirmation MODAL (mirrors the
// passenger's existing "Book Again" modal in app/(tabs)/bookings.tsx: a
// read-only summary card + New Date/New Time/New Price/New Seats + a single
// Publish button), never a full-page navigation to the original creation
// screen. This file holds only the plain, in-memory prefill shape and the
// small pure helpers (location/school resolution) both bookings.tsx and
// useMySchoolRows.tsx's modals use — never a raw Firestore document, never a
// URL param, never a temporary doc written just for navigation, never React
// context or a global draft store.
//
// sourceTripId is carried along for local reference only — it is never
// written to the new document and never reused as its id. Publishing goes
// through a small, self-contained write in each modal's own submit handler,
// reusing the SAME validators the full creation screens use
// (validateAccountInfo/validateDateAndTimeNotPassed/fetchDriverEligibility/
// getDriverSuspensionBlockedReason/resolveLocationCoordinates) and writing
// the exact same Firestore document shape — so a republished trip always
// gets a brand-new document id and starts with zero passengers, exactly
// like any other newly created trip.
// ---------------------------------------------------------------------------

import { getIsraelLocationById, IsraelLocation } from "../../booking/israelLocations";
import { resolveIsraelLocationId } from "../../booking/locationSearch";
import { SCHOOLS, SchoolLocation } from "../../booking/schools";

// The four real driver-publishable categories in this app today (see
// CATEGORY_META in bookingsLib.ts) — deliberately excludes "roadside" (no
// driver-publishing flow exists for it) and never adds "Item Delivery".
export type DriverTripCategory = "personal" | "school" | "workErrands" | "errands";

// Everything the Republish modal needs to show its read-only summary and
// seed its editable New Price/New Seats fields — built ONCE, synchronously,
// at the moment "Republish Trip" is pressed (see openRepublishDriverTrip/
// openRepublishRideDriverTrip in bookings.tsx, openRepublishSchoolTrip in
// useMySchoolRows.tsx). Never persisted anywhere; lives only in that
// screen's own local state until the modal is closed or published.
export type RepublishTripPrefill = {
  // Local reference only — never becomes the new trip's id, never written
  // to the new document.
  sourceTripId?: string;
  sourceCategory: DriverTripCategory;

  // Personal / legacy weekly-school (driverRoutes) route fields.
  from?: string;
  to?: string;
  fromPlace?: IsraelLocation | null;
  toPlace?: IsraelLocation | null;
  schoolName?: string;
  destinationDetails?: string;

  // One-time school trips only (schoolTrips collection).
  schoolId?: string;
  schoolPlace?: SchoolLocation | null;
  direction?: "to_school" | "from_school";

  // Work / Errand job-listing fields.
  title?: string;
  location?: string;
  locationPlace?: IsraelLocation | null;
  canTakeKids?: boolean;
  allowsPets?: boolean;

  // Suggested, fully editable in the modal — never auto-submitted as-is.
  suggestedPrice?: number;
  suggestedSeats?: number;
};

// Best-effort text -> curated-dataset resolution, reusing the SAME
// canonical/multilingual matcher the My Bookings location filter uses (see
// app/booking/locationSearch.ts) — so a republished trip's from/to/location
// can be silently pre-resolved instead of forcing the driver to retype and
// re-pick it from an autocomplete the modal doesn't even show. Returns null
// when the stored text isn't a recognized locality; the publish handler
// falls back to a live geocode of the raw text in that case (see
// resolveLocationCoordinates), exactly like a normal fresh trip would.
export function resolveIsraelLocationForText(
  text: string | undefined | null,
): IsraelLocation | null {
  if (!text) return null;
  const id = resolveIsraelLocationId(text);
  return id ? getIsraelLocationById(id) : null;
}

// Same idea for the school picker — resolves a stored schoolId back to the
// full SchoolLocation object.
export function resolveSchoolById(schoolId: string | undefined | null): SchoolLocation | null {
  if (!schoolId) return null;
  return SCHOOLS.find((school) => school.id === schoolId) || null;
}
