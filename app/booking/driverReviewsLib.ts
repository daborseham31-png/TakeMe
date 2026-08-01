// ---------------------------------------------------------------------------
// Driver reviews – shared across every category (School, Personal Ride,
// Work, Errands). A driver's reviews belong to their profile, not to any
// one booking type, so this is deliberately the single place every result
// card reads from.
// ---------------------------------------------------------------------------

import { collection, getDocs, query, where } from "firebase/firestore";

import { db } from "../../firebase";

// Different result-card shapes key the driver differently — resolve
// whichever field actually holds the driver's real Firebase UID.
// (employerId covers Work job listings specifically; ownerId covers
// Errand job listings.)
export const getDisplayedDriverId = (driver: any): string => {
  return String(
    driver?.driverId ||
      driver?.userId ||
      driver?.uid ||
      driver?.employerId ||
      driver?.ownerId ||
      driver?.id ||
      "",
  );
};

// Roadside Help offers specifically — deliberately NO fallback to
// offer.id/requestId/bookingId/routeId, since none of those are the
// driver's actual Firebase UID and using one by mistake would silently
// query reviews for the wrong "driver".
export const getOfferDriverId = (offer: any): string => {
  return String(
    offer?.driverId || offer?.userId || offer?.uid || offer?.ownerId || "",
  );
};

export type DriverReviewItem = {
  passengerName: string;
  rating: number;
  comment: string;
  createdAtSeconds: number;
};

const getCreatedAtSeconds = (createdAt: any): number => {
  if (!createdAt) return 0;
  if (typeof createdAt.seconds === "number") return createdAt.seconds;
  return 0;
};

// Every review for this driver, across every category — the driver's
// review list is global. The query only filters by driverId (no orderBy),
// so it never needs a composite Firestore index; sorting happens locally.
export const loadDriverReviews = async (
  driverId: string,
): Promise<DriverReviewItem[]> => {
  if (!driverId) return [];

  const snap = await getDocs(
    query(collection(db, "driverReviews"), where("driverId", "==", driverId)),
  );

  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data();

      return {
        passengerName:
          String(
            data.passengerName || data.reviewerName || data.userName || "",
          ).trim() || "Passenger",
        rating: Number(data.rating || data.stars || 0),
        // Left as "" when the passenger left no written comment — callers
        // decide how to display that (e.g. DriverReviewsSection skips
        // commentless reviews and falls back to a "no written reviews"
        // message instead of rendering a blank/placeholder line).
        comment: String(
          data.comment || data.reviewComment || data.text || "",
        ).trim(),
        createdAtSeconds: getCreatedAtSeconds(data.createdAt),
      };
    })
    .filter((review) => review.rating > 0)
    .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
};
