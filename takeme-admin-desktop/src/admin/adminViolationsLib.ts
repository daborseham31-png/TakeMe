// ---------------------------------------------------------------------------
// Admin-side helpers for the Driver No-Show Violations & Appeals feature
// (app/booking/driverNoShowLib.ts holds the driver-facing + shared
// read/write logic; this file only adds the admin list/detail conveniences —
// driver-name enrichment, the "all violations" subscription, and a thin
// re-export of the approve/reject actions so admin screens have one import
// source, mirroring adminReportsLib.ts's own shape).
// ---------------------------------------------------------------------------

import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";

import { db } from "../../firebase";
import {
  approveAppeal,
  canConfirmManualRefund,
  confirmManualRefund,
  DriverViolation,
  NO_SHOW_REASON_LABEL_KEY,
  rejectAppeal,
  subscribeAppealForViolation,
  ViolationAppeal,
} from "../booking/driverNoShowLib";

export {
  approveAppeal,
  canConfirmManualRefund,
  confirmManualRefund,
  rejectAppeal,
  subscribeAppealForViolation,
  NO_SHOW_REASON_LABEL_KEY,
};
export type { DriverViolation, ViolationAppeal };

const VIOLATIONS_COLLECTION = "driverViolations";

const toSeconds = (value: unknown): number => (value as { seconds?: number } | undefined)?.seconds || 0;

// Mirrors driverNoShowLib.ts's own (private) normalizeViolation exactly —
// duplicated here rather than exported from there, since that file already
// re-exports a lot from driverNoShowCore.ts and keeping its own internal
// normalizer private avoids yet another public surface to keep stable. If
// the driverViolations schema ever changes, update both.
const normalizeViolationDoc = (id: string, data: Record<string, any>): DriverViolation => ({
  id,
  driverId: data.driverId || "",
  tripId: data.tripId || "",
  bookingId: data.bookingId || null,
  schoolTripId: data.schoolTripId || null,
  category: data.category || "personal",
  violationType: "driver_no_show",
  scheduledAtSeconds: toSeconds(data.scheduledAt),
  gracePeriodEndedAtSeconds: toSeconds(data.gracePeriodEndedAt),
  routeFrom: data.routeFrom || "",
  routeTo: data.routeTo || "",
  passengerIds: Array.isArray(data.passengerIds) ? data.passengerIds : [],
  passengerCount: typeof data.passengerCount === "number" ? data.passengerCount : 0,
  paymentMethods: Array.isArray(data.paymentMethods) ? data.paymentMethods : [],
  paidAmount: typeof data.paidAmount === "number" ? data.paidAmount : 0,
  currency: data.currency || "ILS",
  refundStatus: data.refundStatus || "manual_refund_pending",
  description: data.description || "",
  active: data.active !== false,
  status: data.status || "open",
  appealId: data.appealId || null,
  createdAtSeconds: toSeconds(data.createdAt),
  updatedAtSeconds: toSeconds(data.updatedAt),
  resolvedAtSeconds: data.resolvedAt ? toSeconds(data.resolvedAt) : null,
  resolvedBy: data.resolvedBy || null,
  resolutionNote: data.resolutionNote || null,
  refundedAtSeconds: data.refundedAt ? toSeconds(data.refundedAt) : null,
  refundedBy: data.refundedBy || null,
  refundReference: data.refundReference || null,
});

export const subscribeAllViolations = (
  onUpdate: (rows: DriverViolation[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    query(collection(db, VIOLATIONS_COLLECTION), orderBy("createdAt", "desc")),
    (snap) => onUpdate(snap.docs.map((d) => normalizeViolationDoc(d.id, d.data()))),
    onError,
  );
};

// Previous violation history for the driver shown on a detail screen —
// section 6's "previous violation history when available". A one-shot read
// (the detail screen re-fetches on mount), not a live subscription — the
// primary violation itself is what needs to be live (see the detail
// screen's own onSnapshot).
export const getViolationHistoryForDriver = async (
  driverId: string,
  excludeViolationId: string,
): Promise<DriverViolation[]> => {
  const snap = await getDocs(query(collection(db, VIOLATIONS_COLLECTION), where("driverId", "==", driverId)));
  return snap.docs
    .filter((d) => d.id !== excludeViolationId)
    .map((d) => normalizeViolationDoc(d.id, d.data()))
    .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
};

// ---------------------------------------------------------------------------
// Driver display-info enrichment — the violation doc itself only carries
// driverId (per the approved schema), so the admin list/detail screens need
// a name/email/phone lookup. Cached per-session (a module-level Map, not
// React state) since driver names/contact info practically never change
// mid-session and this avoids a repeated getDoc for the same driver across
// every violation row.
// ---------------------------------------------------------------------------

export type DriverDisplayInfo = { name: string; email: string; phone: string };

const driverInfoCache = new Map<string, DriverDisplayInfo>();

export const useDriverDisplayInfo = (driverIds: string[]): Record<string, DriverDisplayInfo> => {
  const [, forceRerender] = useState(0);
  const fetchedRef = useRef(new Set<string>());
  const key = driverIds.filter(Boolean).join(",");

  useEffect(() => {
    const missing = driverIds.filter((id) => id && !fetchedRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => fetchedRef.current.add(id));

    Promise.all(
      missing.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "users", id));
          const data = snap.exists() ? snap.data() : null;
          driverInfoCache.set(id, {
            name: data?.name || id,
            email: data?.email || "",
            phone: data?.phone || "",
          });
        } catch {
          driverInfoCache.set(id, { name: id, email: "", phone: "" });
        }
      }),
    ).then(() => forceRerender((n) => n + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const result: Record<string, DriverDisplayInfo> = {};
  driverIds.forEach((id) => {
    if (id) result[id] = driverInfoCache.get(id) || { name: id, email: "", phone: "" };
  });
  return result;
};
