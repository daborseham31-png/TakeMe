import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "../../components/PlatformDateTimePicker";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Alert } from "../AppAlert";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../firebase";
import KeyboardAvoidingWrapper from "../components/KeyboardAvoidingWrapper";
import useMySchoolRows, {
  SchoolDriverRow,
  SchoolPassengerRow,
} from "../booking/school/useMySchoolRows";
import {
  BookingBucket,
  BookingItem,
  cancelGeneralBooking,
  canStartTrip,
  dismissRatingNotifications,
  DRIVER_CANCEL_LOCK_HOURS,
  DriverCollection,
  DriverTripItem,
  explodeDriverRouteTrip,
  getBookingDateYMD,
  getCategoryMeta,
  getDriverTripBucket,
  getDriverTripStatus,
  getGeneralBookingCancelBlockedReason,
  getPassengerTripBucket,
  getPassengerTripStatus,
  getStartTripBlockedReason,
  getTimeBasedCancelBlockedReason,
  getTripTimestamp,
  isCompletedItem,
  markCompleted,
  normalizeBooking,
  normalizeDriverTrip,
  RATING_NOTIFICATION_TYPES,
  sortMyBookings,
  translateCancellationError,
} from "../booking/bookingsLib";
import { computeApproxDistanceKm } from "../booking/pickupLocationCore";
import {
  CANCELLATION_WARNING_MESSAGE_KEY,
  CancellationStandingResult,
  CancellationWarningPreview,
  DRIVER_CANCELLED_TRIP_STATUS,
  DriverCancellationViolation,
  evaluateDriverCancellationStanding,
  getDriverCancellationWarningPreview,
  getDriverSuspensionBlockedReason,
  readExistingCancellationViolation,
  subscribeDriverCancellationViolations,
  writeCancellationViolationIfNew,
} from "../booking/driverViolationsLib";
import {
  canSubmitAppeal,
  DriverViolation,
  subscribeActiveViolationCount,
  subscribeDriverViolations,
  ViolationSource,
} from "../booking/driverNoShowLib";
import ViolationAppealModal from "../booking/ViolationAppealModal";
import {
  arriveRide,
  cancelRideBooking,
  finishRide,
  getRideCancelBlockedReason,
  hideRideBookingForDriver,
  hideRideBookingForPassenger,
  normalizeRideBooking,
  RIDE_CATEGORY,
  RIDE_STATUS_LABEL,
  RideBooking,
  RideStatus,
  startRide,
  startRideInProgress,
  submitRideRating,
} from "../booking/rideBookingLib";
import {
  acceptRequest,
  arriveJob,
  beginJobTrip,
  cancelApplication,
  cancelBlockedReason,
  enrichApplicationWithCustomerAge,
  finishJob,
  isAwaitingPayment,
  normalizeApplication,
  NormalizedApplication,
  notify,
  rejectRequest,
  startJob,
  startState,
  STATUS_LABEL,
  submitApplicationRating,
} from "../booking/work-errand/workErrandLib";
import RoadsideAcceptedCard from "../booking/roadside-help/RoadsideAcceptedCard";
import {
  cancelRoadsideRequestByPassenger,
  confirmCompletion,
  normalizeRoadsideRequest,
  RoadsideRequestRecord,
  submitRoadsideRating,
  syncCancelledRoadsideRequest,
} from "../booking/roadside-help/roadsideLib";
import { openBitPayment } from "../booking/bitPayment";
import { createReport } from "../admin/adminReportsLib";
import DateInput, { TimeInput } from "../driver/create/DateInput";
import RepublishTripModal from "../driver/create/RepublishTripModal";
import {
  formatDateToYMD,
  normalize,
  parseDateInput,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "../driver/create/driverHelpers";
import { fetchDriverEligibility, getDriverEligibilityAlertCopy } from "../driver/driverEligibility";
import {
  DriverTripCategory,
  RepublishTripPrefill,
  resolveIsraelLocationForText,
} from "../driver/create/republishLib";
import { recordUsedFormValues, useSavedFormValues } from "../driver/create/savedFormValuesLib";
import {
  getLocalizedLocationName,
  normalizeLocationText,
  resolveIsraelLocationId,
  resolveLocationCoordinates,
  searchIsraelLocationsMultilingual,
} from "../booking/locationSearch";
import { IsraelLocation } from "../booking/israelLocations";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { formatLocalizedDateFromYMD, translateCategoryLabel, translateProblemType, translateStatus, translateStoredDayName } from "../i18n/formatters";
import { DirectionalCard, DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { accentBorderStart, ltrContentStyle, marginEnd } from "../i18n/rtl";

type Tab = "passenger" | "driver";

const getParamString = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const getLast3Digits = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

const paymentMethodLabel = (method: string | null | undefined, t: TFunction) =>
  method === "cash" ? t("common.cash") : method === "bit" ? "BIT" : t("common.card");

const formatPhoneForDisplay = (phone?: string | null) => {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("00972")) {
    return "0" + digits.slice(5);
  }

  if (digits.startsWith("9720")) {
    return "0" + digits.slice(4);
  }

  if (digits.startsWith("972")) {
    return "0" + digits.slice(3);
  }

  return digits;
};

const formatPhoneForCall = (phone?: string | null) => {
  const displayPhone = formatPhoneForDisplay(phone);

  if (!displayPhone) return "";

  if (displayPhone.startsWith("0")) {
    return "+972" + displayPhone.slice(1);
  }

  return displayPhone;
};

const enrichRideWithRouteDetails = async (ride: RideBooking) => {
  if (!ride.routeId) return ride;

  const alreadyHasCarDetails =
    !!ride.driverCar && !!ride.driverCarColor && !!ride.driverCarPlateLast3;

  if (alreadyHasCarDetails && !!ride.driverPhone) return ride;

  try {
    const routeSnap = await getDoc(doc(db, "driverRoutes", ride.routeId));

    if (!routeSnap.exists()) return ride;

    const route = routeSnap.data();

    return {
      ...ride,
      driverPhone: ride.driverPhone || route.phone || "",
      driverCar: ride.driverCar || route.car || "",
      driverCarColor: ride.driverCarColor || route.carColor || "",
      driverCarPlateLast3:
        ride.driverCarPlateLast3 ||
        getLast3Digits(route.driverCarPlateLast3 || route.carPlate || ""),
    };
  } catch {
    return ride;
  }
};

// One combined chronological list mixes every category and every source
// (personal_ride live-tracking "rides", general "bookings", driver-owned
// "trip" listings, and Work/Errand "applications") — each variant is tagged
// with its own real object (via `_kind`) plus its ORIGINAL fields, so the
// shared sortMyBookings() helper can read `.date`/`.time`/`.status`/
// `.tripStatus` straight off it with no per-category special-casing.
type TaggedRide = RideBooking & { _kind: "ride" };
// activeBookingCount is real evidence of booking (see tagTrip below), never
// derived from available/remaining seats. waitingForBooking is the ONE
// shared "zero active bookings, not yet completed" flag read by both the
// card (Mark as Completed / "Waiting for booking" label) and
// getBookingBucket (Unbooked Trips), so the two can never disagree.
type TaggedTrip = DriverTripItem & {
  _kind: "trip";
  activeBookingCount: number;
  waitingForBooking: boolean;
};
type TaggedBooking = BookingItem & { _kind: "booking" };
// NormalizedApplication has no `.time` field (it uses `.startTime`) — alias
// it here so the generic date/time sort helpers work unchanged.
type TaggedApplication = NormalizedApplication & {
  _kind: "application";
  time: string;
};

// School (new-style) rows come pre-tagged from useMySchoolRows — see its
// SchoolPassengerRow/SchoolDriverRow types.
type CombinedRow =
  | TaggedRide
  | TaggedTrip
  | TaggedBooking
  | TaggedApplication
  | SchoolPassengerRow
  | SchoolDriverRow;

const tagRide = (r: RideBooking): TaggedRide => ({ ...r, _kind: "ride" });
// Real active-booking evidence — driverRoutes/errandJobs "trip" rows only
// ever reach here with zero bookings by construction (booked ones are
// filtered out of driverTrips upstream, see the comment there); workJobs
// keeps its own real acceptedWorkersCount counter even while still open for
// more workers. A trip already manually marked "completed" is never
// "waiting for booking" regardless of activeBookingCount.
const tagTrip = (t: DriverTripItem): TaggedTrip => {
  const activeBookingCount = t.collectionName === "workJobs" ? (t.acceptedWorkersCount ?? 0) : 0;

  return {
    ...t,
    _kind: "trip",
    activeBookingCount,
    waitingForBooking: t.status === "ongoing" && activeBookingCount === 0,
  };
};
const tagBooking = (b: BookingItem): TaggedBooking => ({
  ...b,
  _kind: "booking",
});
const tagApplication = (a: NormalizedApplication): TaggedApplication => ({
  ...a,
  _kind: "application",
  time: a.startTime,
});

// ---------------------------------------------------------------------------
// My Bookings filter bar — one place every row kind's category/driver-name/
// location values are resolved from, instead of re-deriving them inside each
// render function. "Personal" folds together "personal" (legacy BookingItem
// category) and "personal_ride" (RIDE_CATEGORY) — same user-facing category,
// two different underlying booking mechanisms. Roadside bookings have no
// dedicated filter option (per spec) — they simply never match a specific
// category filter, but remain visible under "All Categories".
// ---------------------------------------------------------------------------

type CategoryFilterValue = "all" | "school" | "personal" | "workErrands" | "errands";

const CATEGORY_FILTER_OPTIONS: CategoryFilterValue[] = [
  "all",
  "school",
  "personal",
  "workErrands",
  "errands",
];

// The real category string CATEGORY_META/translateCategoryLabel expect for
// each filter option (distinct from the filter's own "personal" value, which
// must match either "personal" or "personal_ride" on the row itself).
const CATEGORY_FILTER_META_KEY: Record<Exclude<CategoryFilterValue, "all">, string> = {
  school: "school",
  personal: "personal",
  workErrands: "workErrands",
  errands: "errands",
};

const getRowCategoryFilterValue = (row: CombinedRow): CategoryFilterValue | "" => {
  switch (row._kind) {
    case "ride":
      return "personal";
    case "booking":
      if (row.category === "school") return "school";
      if (row.category === "personal" || row.category === "personal_ride") return "personal";
      return "";
    case "trip":
      if (row.category === "school") return "school";
      if (row.category === "personal" || row.category === "personal_ride") return "personal";
      if (row.category === "workErrands") return "workErrands";
      if (row.category === "errands") return "errands";
      return "";
    case "application":
      return row.category === "workErrands" ? "workErrands" : "errands";
    case "schoolBooking":
    case "schoolWaiting":
    case "schoolTrip":
      return "school";
    default:
      return "";
  }
};

// The "other side"'s name — always the assigned/accepted DRIVER, regardless
// of which tab (passenger/driver) is currently active, resolved from
// whichever real field each source actually stores it in (never invented).
// TaggedTrip (a driver's own not-yet-booked driverRoutes/workJobs/errandJobs
// listing) has no driver-name field at all — there is no "other side" yet —
// so it never matches a non-empty driver-name search, which is correct.
const getRowDriverName = (row: CombinedRow): string => {
  switch (row._kind) {
    case "ride":
      return row.driverName || "";
    case "booking":
      return row.driverName || "";
    case "application":
      return row.providerName || "";
    case "schoolBooking":
    case "schoolWaiting":
    case "schoolTrip":
      return row.driverName || "";
    default:
      return "";
  }
};

// Every origin/destination-ish label a row carries, combined into one flat
// list — used both to build the location filter's suggestion pool (from
// already-loaded bookings, never a Firestore/external query) and to test a
// selected location against "either side" of the trip.
const getRowLocationLabels = (row: CombinedRow): string[] => {
  switch (row._kind) {
    case "ride":
      return [row.from, row.to, row.schoolName, row.destinationDetails].filter(Boolean) as string[];
    case "booking":
      return [row.from, row.to, row.address].filter(Boolean) as string[];
    case "trip":
      return [row.from, row.to, row.location].filter(Boolean) as string[];
    case "application":
      return [row.city, row.neighborhood].filter(Boolean) as string[];
    case "schoolBooking":
    case "schoolWaiting":
      return [row.fromLabel, row.toLabel].filter(Boolean) as string[];
    case "schoolTrip":
      return [row.fromArea, row.fromAddress, row.toArea, row.toAddress, row.schoolName].filter(
        Boolean,
      ) as string[];
    default:
      return [];
  }
};

// The location filter's selected value — stores the resolved canonical
// dataset id (see israelLocations.ts/locationSearch.ts) alongside the label
// actually shown in the chip, per the requirement that filtering must never
// depend only on the currently displayed/translated label. `canonicalId` is
// null when the picked suggestion isn't in the curated dataset (falls back
// to plain substring text matching — see locationRowMatches below).
type SelectedLocationFilter = { canonicalId: string | null; label: string };

// Whether ANY of a row's own location labels relate to the selected filter
// location. Canonical match first (resolves each label to a dataset id and
// compares ids — this is what makes "Nazareth" typed by one person match
// "الناصرة" stored on someone else's booking), then a raw substring
// fallback (also the ONLY path for a location the curated dataset doesn't
// know about at all).
const locationRowMatches = (filter: SelectedLocationFilter, row: CombinedRow): boolean => {
  const labels = getRowLocationLabels(row);
  if (labels.length === 0) return false;

  if (filter.canonicalId) {
    const matchesCanonical = labels.some(
      (label) => resolveIsraelLocationId(label) === filter.canonicalId,
    );
    if (matchesCanonical) return true;
  }

  const normalizedFilterLabel = normalizeLocationText(filter.label);
  return labels.some((label) => normalizeLocationText(label).includes(normalizedFilterLabel));
};

// ---------------------------------------------------------------------------
// Driver tab ONLY: a "trip" row (the driver's own driverRoutes/workJobs/
// errandJobs listing) is the only kind that can ever be "waiting for
// booking" — ride/booking/application rows only ever exist because someone
// actually booked or applied for something (there is no "unclaimed" version
// of any of these three), so tagTrip's waitingForBooking is never computed
// for them.
//
// IMPORTANT: `status` on a normalized DriverTripItem is NEVER usable as
// booking evidence — normalizeDriverTrip (bookingsLib.ts) collapses every
// non-completed driverRoutes/workJobs/errandJobs document to status
// "ongoing" regardless of whether anyone booked/accepted it (a freshly
// created, never-booked route has the exact same "ongoing" status as one
// with a passenger). Real evidence only ever comes from a matching document
// elsewhere — driverRoutes: a `bookings` doc whose routeId matches
// (bookedRouteIds); workJobs: an accepted-or-further workApplications doc
// whose sourceId matches (bookedWorkJobIds); errandJobs: an
// accepted-or-further errandApplications doc whose sourceId matches
// (bookedErrandJobIds). All three: once booked, the original listing is
// dropped from `driverTrips` entirely in favor of the application/booking
// row, so the same real-world assignment is never rendered as two cards —
// and never reaches tagTrip as a "trip" row at all once booked.
// By the time a "trip" row reaches tagTrip it is therefore guaranteed to
// have no real booking evidence (activeBookingCount is always 0, except
// workJobs' own acceptedWorkersCount mirror, which is also guaranteed 0 by
// the same filtering).
// ---------------------------------------------------------------------------

export default function BookingsScreen() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();
  const { height: windowHeight } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();

  // Real, live keyboard height — NOT a guess — so the location modal's sheet
  // can be shrunk AND lifted to sit directly above the keyboard instead of
  // staying pinned to the physical screen bottom, where the keyboard (an OS
  // overlay the Modal itself knows nothing about) would otherwise just
  // cover its lower portion — title and search field included.
  //
  // iOS only: Android already resizes the whole window itself for the
  // keyboard (app.json's android.softwareKeyboardLayoutMode: "resize" — see
  // the same convention/reasoning in components/KeyboardAvoidingWrapper.tsx),
  // so useWindowDimensions()'s windowHeight there already excludes the
  // keyboard. Also applying this iOS-only keyboardHeight offset on Android
  // would subtract the keyboard's height a second time and shrink/lift the
  // sheet far more than necessary.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const showSub = Keyboard.addListener("keyboardWillShow", (e) => {
      setKeyboardHeight(e.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const params = useLocalSearchParams<{
    tab?: string | string[];
    bookingId?: string | string[];
    applicationId?: string | string[];
    requestId?: string | string[];
    type?: string | string[];
    kind?: string | string[];
  }>();

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [tab, setTab] = useState<Tab>("passenger");
  // Shared by both Passenger and Driver — one Upcoming/In Progress/Completed
  // tab row above the single merged list (see getBookingBucket). "violations"
  // is a driver-only addition (see driverNoShowLib.ts) that reads from its
  // own driverViolations subscription below, NOT from the combined
  // booking/trip rows — deliberately widened locally rather than adding
  // "violations" to bookingsLib.ts's exported BookingBucket type, since
  // getDriverTripBucket/getPassengerTripBucket must never return it (a
  // no-show trip is bucketed to "completed" there — see that file).
  type DriverBucketTab = BookingBucket | "violations";
  const [bucketTab, setBucketTab] = useState<DriverBucketTab>("upcoming");
  // Driver no-show violations (see driverNoShowLib.ts) — a completely
  // separate WRITE system from the driver-cancellation violations below
  // (different collection, different creator: the Worker's cron vs. the
  // driver's own client at cancel time), but both are shown together in the
  // same Violations tab (see driverCancellationViolations/mergedViolations
  // below) — a driver doesn't care which internal system produced a
  // violation, only that it's theirs. Both are live subscriptions, not
  // one-shot fetches, so the Violations tab count/list and the active-count
  // badge stay correct the instant an admin approves/rejects an appeal or
  // excuses a cancellation.
  const [driverViolations, setDriverViolations] = useState<DriverViolation[]>([]);
  const [activeViolationCount, setActiveViolationCount] = useState(0);
  // Driver-cancellation violations (see driverViolationCore.ts's
  // writeCancellationViolationIfNew) — written by the driver's own client at
  // cancel time (cancelDriverTrip/cancelGeneralBooking/cancelRideBooking/
  // cancelApplication), stored under users/{uid}/cancellationViolations
  // rather than the top-level driverViolations collection the no-show system
  // uses, since firestore.rules deliberately denies EVERY client-side
  // `create` on driverViolations (only the trusted Worker may write there —
  // see driverNoShowLib.ts's header). Merged into the same on-screen list
  // below rather than duplicated into driverViolations itself.
  const [driverCancellationViolations, setDriverCancellationViolations] = useState<
    DriverCancellationViolation[]
  >([]);
  // A minimal shape (never the whole violation object) since the modal only
  // ever needs these three fields regardless of which violation system the
  // appeal is for — see submitViolationAppeal's violationSource param.
  const [appealModalViolation, setAppealModalViolation] = useState<{
    id: string;
    tripId: string;
    violationSource: ViolationSource;
  } | null>(null);
  // The search bar now searches ONLY by driver name (see getRowDriverName) —
  // kept as `search`/`setSearch` since it's the same existing field/state,
  // just narrowed in scope; the variable name is unchanged to minimize the
  // diff against the rest of the file.
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // New filter-bar state (category/date/location) — Clear Filters resets
  // exactly these four, plus `search` above. Never touches Firestore.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterValue>("all");
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<SelectedLocationFilter | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  // The single "Filters" entry sheet beside the search field — Category/
  // Date/Location keep their own existing modals/state above unchanged;
  // this just controls the new summary sheet that links out to them.
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);

  // Ticks once a minute purely to force a Waiting-for-booking trip whose
  // departure time has just passed out of that section and into Expired —
  // No bookings automatically, without waiting on some unrelated Firestore
  // update or user interaction to trigger a re-render — same pattern as
  // home.tsx's expiryTick. Never re-fetches anything.
  const [unbookedExpiryTick, setUnbookedExpiryTick] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setUnbookedExpiryTick(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Deep-link from a notification ("open the driver tab, find this pending
  // request, scroll to it and flash it briefly").
  const [pendingScrollAppId, setPendingScrollAppId] = useState<string | null>(
    null,
  );
  const [highlightAppId, setHighlightAppId] = useState<string | null>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const appCardRefs = useRef<Record<string, View | null>>({});

  // Horizontal status-tab bar — independent from the vertical page scroll
  // above (a nested horizontal ScrollView inside a vertical one already
  // gets its own gesture in React Native, no extra wiring needed).
  const bucketScrollRef = useRef<ScrollView>(null);
  const bucketScrollOffsetRef = useRef(0);
  const bucketScrollViewportWidthRef = useRef(0);
  const bucketButtonLayoutsRef = useRef<Record<string, { x: number; width: number }>>({});

  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [driverRoadside, setDriverRoadside] = useState<BookingItem[]>([]);
  // Same roadsideRequests/{requestId} source of truth as the driver's Help
  // Requests screen — both subscribe independently, so any change either
  // screen makes shows up on the other in real time (see roadsideLib.ts).
  const [driverRoadsideRequests, setDriverRoadsideRequests] = useState<
    RoadsideRequestRecord[]
  >([]);

  const [passengerRides, setPassengerRides] = useState<RideBooking[]>([]);
  const [driverRides, setDriverRides] = useState<RideBooking[]>([]);

  const [ratingBooking, setRatingBooking] = useState<RideBooking | null>(null);
  const [schoolRatingBooking, setSchoolRatingBooking] =
    useState<BookingItem | null>(null);
  const [appRatingBooking, setAppRatingBooking] =
    useState<NormalizedApplication | null>(null);
  const [roadsideRatingBooking, setRoadsideRatingBooking] =
    useState<BookingItem | null>(null);
  const [ratedSchoolBookingIds, setRatedSchoolBookingIds] = useState<string[]>(
    [],
  );

  // "Report a Problem" (customer-only, roadside completion_pending stage) —
  // reuses the exact same adminReports collection/flow as the profile
  // screen's own "Report a Problem" entry point (see adminReportsLib.ts).
  const [reportBooking, setReportBooking] = useState<BookingItem | null>(null);
  const [reportDescription, setReportDescription] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  // Set only from a tapped rating notification (see the params effect below)
  // — the ONLY way the rating modal opens on its own now. Cleared the moment
  // this component (or useMySchoolRows, for new-style school trips) has had
  // its one shot at finding + opening the matching booking, so it never
  // fires again on a later re-render.
  const [pendingRatingBookingId, setPendingRatingBookingId] = useState<
    string | null
  >(null);

  const [ratingStars, setRatingStars] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);

  const [routes, setRoutes] = useState<DriverTripItem[]>([]);
  const [workJobs, setWorkJobs] = useState<DriverTripItem[]>([]);
  const [errandJobs, setErrandJobs] = useState<DriverTripItem[]>([]);

  const [myWorkApps, setMyWorkApps] = useState<NormalizedApplication[]>([]);
  const [myErrandApps, setMyErrandApps] = useState<NormalizedApplication[]>([]);
  const [asProviderWork, setAsProviderWork] = useState<NormalizedApplication[]>(
    [],
  );
  const [asProviderErrand, setAsProviderErrand] = useState<
    NormalizedApplication[]
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const [rebook, setRebook] = useState<{
    category: string;
    from: string;
    to: string;
    date: string;
    time: string;
    seats: number | null;
  } | null>(null);
  const [rebookDate, setRebookDate] = useState("");
  const [rebookTime, setRebookTime] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Driver "Republish Trip" — a compact confirmation MODAL (mirrors the
  // rebook state/modal directly above), never a full-page navigation. Only
  // the fields below are ever changed by the driver; everything else about
  // the new trip comes straight from `republish` (built once, synchronously,
  // when the button is pressed — see openRepublishDriverTrip/
  // openRepublishRideDriverTrip). Closing/cancelling the modal or a
  // successful publish both simply reset `republish` to null — there is no
  // other temporary state to clean up.
  const [republish, setRepublish] = useState<RepublishTripPrefill | null>(null);
  const [republishDate, setRepublishDate] = useState("");
  const [republishTime, setRepublishTime] = useState("");
  const [republishPrice, setRepublishPrice] = useState("");
  const [republishSeats, setRepublishSeats] = useState("");
  const [showRepublishDatePicker, setShowRepublishDatePicker] = useState(false);
  const [showRepublishTimePicker, setShowRepublishTimePicker] = useState(false);
  const [republishSubmitting, setRepublishSubmitting] = useState(false);
  const { driverName, phone, driverAge, languages } = useDriverAccount();
  const savedVehicleValues = useSavedFormValues();

  const school = useMySchoolRows({
    tab,
    uid,
    pendingRatingBookingId,
    onConsumePendingRating: () => setPendingRatingBookingId(null),
  });

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
  }, []);

  // Driver no-show violations — live subscriptions (see driverNoShowLib.ts),
  // independent of the big combined-rows effect further below since
  // driverViolations is its own top-level collection with its own doc shape,
  // not a re-bucketed booking/trip row. Read-only: the Cloudflare Worker's
  // cron is the ONLY writer that may ever create a violation (see
  // driverNoShowLib.ts's header) — this screen only ever subscribes/reads,
  // it never attempts to write one.
  useEffect(() => {
    if (!uid) {
      setDriverViolations([]);
      setActiveViolationCount(0);
      setDriverCancellationViolations([]);
      return;
    }

    const unsubscribeList = subscribeDriverViolations(
      uid,
      setDriverViolations,
      (error) => console.warn("subscribeDriverViolations failed", error),
    );
    const unsubscribeCount = subscribeActiveViolationCount(
      uid,
      setActiveViolationCount,
      (error) => console.warn("subscribeActiveViolationCount failed", error),
    );
    // Driver-cancellation violations — see driverCancellationViolations'
    // own declaration above for why this is a SEPARATE collection/
    // subscription from the two above, merged only on-screen.
    const unsubscribeCancellationViolations = subscribeDriverCancellationViolations(
      uid,
      setDriverCancellationViolations,
      (error) => console.warn("subscribeDriverCancellationViolations failed", error),
    );

    return () => {
      unsubscribeList();
      unsubscribeCount();
      unsubscribeCancellationViolations();
    };
  }, [uid]);

  useEffect(() => {
    const requestedTab = getParamString(params.tab);

    if (requestedTab === "driver") {
      setTab("driver");
    }

    if (requestedTab === "passenger") {
      setTab("passenger");
    }

    // Driver no-show violation notifications (see driverNoShowLib.ts) — jump
    // straight to the Violations tab, not just the Driver role tab, so
    // tapping any of these four notification types lands the driver
    // directly on the relevant card instead of Upcoming.
    const noShowNotificationTypes = new Set([
      "driver_noshow_violation_created",
      "noshow_appeal_approved",
      "noshow_appeal_rejected",
    ]);
    if (noShowNotificationTypes.has(getParamString(params.type) || "")) {
      setTab("driver");
      setBucketTab("violations");
    }

    // Roadside notifications route with requestId/offerId (see spec item 8),
    // not always a bookingId — fall back to requestId so the accepted /
    // completed Roadside card can still be found and highlighted.
    const targetId =
      getParamString(params.bookingId) ||
      getParamString(params.applicationId) ||
      getParamString(params.requestId);

    if (targetId) {
      setPendingScrollAppId(targetId);
    }

    // A rating notification always carries a real bookingId (never
    // applicationId/requestId alone — see rideBookingLib.finishRide,
    // ride-navigation's updateTripStatus/updateSchoolTripStatus,
    // workErrandLib.finishJob, roadsideLib.finishRoadsideHelp,
    // bookingsLib.markCompleted) — only trigger the targeted open-modal
    // effect below for that exact case, never for on_the_way/arrived/etc.
    // notifications that also happen to carry a bookingId.
    const notificationType = getParamString(params.type);
    const ratingBookingId = getParamString(params.bookingId);

    if (ratingBookingId && notificationType && RATING_NOTIFICATION_TYPES.has(notificationType)) {
      setPendingRatingBookingId(ratingBookingId);
    }
  }, [params.tab, params.bookingId, params.applicationId, params.requestId, params.type]);

  useEffect(() => {
    if (!uid) return;

    setLoading(true);

const subscribe = (
  collectionName: "driverRoutes" | "workJobs" | "errandJobs",
  field: string,
  setter: (items: DriverTripItem[]) => void,
) =>
  onSnapshot(
    query(collection(db, collectionName), where(field, "==", uid)),
    (snap) => {
      const visibleDocs = snap.docs.filter((d) => d.data().deletedForDriver !== true);

      setter(
        collectionName === "driverRoutes"
          ? visibleDocs.flatMap((d) => explodeDriverRouteTrip(d.id, d.data()))
          : visibleDocs.map((d) => normalizeDriverTrip(d.id, d.data(), collectionName)),
      );
      setLoading(false);
    },
    () => setLoading(false),
  );

    const unsubBookings = onSnapshot(
      query(collection(db, "bookings"), where("passengerId", "==", uid)),
      async (snap) => {
        const passengerRideItems = snap.docs
          .filter(
            (d) =>
              d.data().category === RIDE_CATEGORY &&
              d.data().deletedForPassenger !== true,
          )
          .map((d) => normalizeRideBooking(d.id, d.data()));

        const passengerRideItemsWithDetails = await Promise.all(
          passengerRideItems.map(enrichRideWithRouteDetails),
        );

        setPassengerRides(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category === RIDE_CATEGORY &&
                data.deletedForPassenger !== true &&
                data.passengerId === uid
              );
            })
            .map((d) => normalizeRideBooking(d.id, d.data())),
        );

        setBookings(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category !== RIDE_CATEGORY &&
                data.deletedForPassenger !== true &&
                data.passengerId === uid
              );
            })
            .map((d) => normalizeBooking(d.id, d.data())),
        );

        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubDriverRoadside = onSnapshot(
      query(collection(db, "bookings"), where("driverId", "==", uid)),
      async (snap) => {
        setDriverRoadside(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category !== RIDE_CATEGORY &&
                data.deletedForDriver !== true &&
                data.driverId === uid &&
                data.passengerId !== uid
              );
            })
            .map((d) => normalizeBooking(d.id, d.data())),
        );

        const driverRideItems = snap.docs
          .filter(
            (d) =>
              d.data().category === RIDE_CATEGORY &&
              d.data().deletedForDriver !== true,
          )
          .map((d) => normalizeRideBooking(d.id, d.data()));

        const driverRideItemsWithDetails = await Promise.all(
          driverRideItems.map(enrichRideWithRouteDetails),
        );

        setDriverRides(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category === RIDE_CATEGORY &&
                data.deletedForDriver !== true &&
                data.driverId === uid &&
                data.passengerId !== uid
              );
            })
            .map((d) => normalizeRideBooking(d.id, d.data())),
        );

        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubDriverRoadsideRequests = onSnapshot(
      query(
        collection(db, "roadsideRequests"),
        where("selectedDriverId", "==", uid),
      ),
      (snap) => {
        setDriverRoadsideRequests(
          snap.docs.map((d) => normalizeRoadsideRequest(d.id, d.data())),
        );
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "bookings.driverRoadsideRequests",
          collection: "roadsideRequests",
          userId: uid,
          code: error.code,
          message: error.message,
        });
        setDriverRoadsideRequests([]);
      },
    );

    const unsubRoutes = subscribe("driverRoutes", "driverId", setRoutes);
    const unsubWork = subscribe("workJobs", "employerId", setWorkJobs);
    const unsubErrands = subscribe("errandJobs", "ownerId", setErrandJobs);

    const subscribeApps = (
      collectionName: "workApplications" | "errandApplications",
      field: string,
      kind: "work" | "errand",
      viewer: Tab,
      setter: (items: NormalizedApplication[]) => void,
    ) =>
      onSnapshot(
        query(collection(db, collectionName), where(field, "==", uid)),
        async (snap) => {
          const deleteField =
            viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver";

          const items = snap.docs
            .filter((d) => d.data()[deleteField] !== true)
            .map((d) => normalizeApplication(d.id, d.data(), kind));

          // Only the driver's pending-request card needs the passenger's
          // age, so only bother fetching it for driver-viewed lists (and
          // only for the ones missing it — see enrichApplicationWithCustomerAge).
          setter(
            viewer === "driver"
              ? await Promise.all(items.map(enrichApplicationWithCustomerAge))
              : items,
          );

          setLoading(false);
        },
        () => setLoading(false),
      );

    const unsubMyWork = subscribeApps(
      "workApplications",
      "applicantId",
      "work",
      "passenger",
      setMyWorkApps,
    );

    const unsubMyErrand = subscribeApps(
      "errandApplications",
      "passengerId",
      "errand",
      "passenger",
      setMyErrandApps,
    );

    const unsubProvWork = subscribeApps(
      "workApplications",
      "employerId",
      "work",
      "driver",
      setAsProviderWork,
    );

    const unsubProvErrand = subscribeApps(
      "errandApplications",
      "driverId",
      "errand",
      "driver",
      setAsProviderErrand,
    );

    return () => {
      unsubBookings();
      unsubDriverRoadside();
      unsubDriverRoadsideRequests();
      unsubRoutes();
      unsubWork();
      unsubErrands();
      unsubMyWork();
      unsubMyErrand();
      unsubProvWork();
      unsubProvErrand();
    };
  }, [uid]);

  // Passenger's own live location sharing is now started/stopped from
  // app/(tabs)/_layout.tsx, NOT here — this screen unmounts on every tab
  // switch (Home/Messages/Profile), which used to kill sharing the moment
  // the passenger left this tab even though the driver was still on the
  // way. The tab layout stays mounted for as long as the passenger is
  // signed in and inside (tabs), so that's the one place this can safely
  // depend on "app is in the foreground" instead of "this screen happens
  // to be open". See _layout.tsx's own comment for the exact start/stop
  // rules (unchanged from before: booked/driver-on-the-way window only).

  const passengerApps = useMemo(
    () =>
      [...myWorkApps, ...myErrandApps].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [myWorkApps, myErrandApps],
  );

  const driverApps = useMemo(
    () =>
      [...asProviderWork, ...asProviderErrand].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [asProviderWork, asProviderErrand],
  );

  const scrollToAppCard = (id: string) => {
    const cardNode = appCardRefs.current[id];
    const scrollNode = mainScrollRef.current;

    if (!cardNode || !scrollNode) return;

    // measure() gives page-absolute coordinates for both the card and the
    // ScrollView, so the target offset can be computed in plain JS without
    // relying on a fragile native-handle relationship between the two.
    // (ScrollView's TS type doesn't declare `measure`, though the
    // underlying native component always supports it — hence the `any`.)
    const scrollNodeAny = scrollNode as any;

    cardNode.measure((
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      pageX: number,
      pageY: number,
    ) => {
      scrollNodeAny.measure((
        _sx: number,
        _sy: number,
        _sw: number,
        _sh: number,
        _spx: number,
        scrollPageY: number,
      ) => {
        const targetY =
          scrollOffsetRef.current + (pageY - scrollPageY) - 16;

        scrollNode.scrollTo({ y: Math.max(targetY, 0), animated: true });
      });
    });
  };

// Only a CANCELLED booking is ignored here — a cancelled booking is not a
// real active passenger booking, so the original route listing must reappear
// (and, once it has zero active bookings left, land in Unbooked Trips — see
// getBookingBucket). A completed booking still counts: the trip already
// happened, so the listing stays represented by that completed booking card
// rather than reappearing as a separate "unbooked" row for the same trip.
const bookedRouteIds = useMemo(() => {
  const ids = new Set<string>();

  driverRoadside.forEach((b) => {
    if (b.routeId && b.status !== "cancelled") {
      ids.add(b.routeId);
    }
  });

  driverRides.forEach((r) => {
    if (r.routeId && r.status !== "cancelled") {
      ids.add(r.routeId);
    }
  });

  return ids;
}, [driverRoadside, driverRides]);

  // Errand has no multi-worker capacity concept (unlike Work) — once a
  // request is accepted (or further along: payment-pending, on the way,
  // arrived, completed...), the job is effectively taken by exactly one
  // customer. The accepted application already renders its own card, so the
  // original errandJobs listing must be dropped here to avoid a duplicate
  // "still waiting" card for a job that's actually in progress. A cancelled
  // (or still-pending/rejected) application is not a real active booking —
  // the listing must reappear so it can correctly land in Unbooked Trips
  // once it has zero active bookings (see getBookingBucket).
  const bookedErrandJobIds = useMemo(() => {
    const ids = new Set<string>();

    asProviderErrand.forEach((a) => {
      if (
        a.sourceId &&
        a.status !== "pending" &&
        a.status !== "rejected" &&
        a.status !== "cancelled"
      ) {
        ids.add(a.sourceId);
      }
    });

    return ids;
  }, [asProviderErrand]);

  // Once ANY worker has accepted a job (or is further along — on the way,
  // in progress, completed...), that worker's own accepted-assignment
  // application card already shows the detailed Start/Finish flow for it —
  // the published workJobs listing card becomes a duplicate of the exact
  // same real-world assignment and must not render alongside it. Matched by
  // application.sourceId === job.id (the real relationship the application
  // was created from — see acceptRequest in workErrandLib.ts), never by
  // title/location/date. A cancelled (or still-pending/rejected)
  // application is not a real active booking — the listing must reappear so
  // it can correctly land in Unbooked Trips once it has zero active
  // bookings (see getDriverTripStatus/tagTrip's activeBookingCount).
  const bookedWorkJobIds = useMemo(() => {
    const ids = new Set<string>();

    asProviderWork.forEach((a) => {
      if (
        a.sourceId &&
        a.status !== "pending" &&
        a.status !== "rejected" &&
        a.status !== "cancelled"
      ) {
        ids.add(a.sourceId);
      }
    });

    return ids;
  }, [asProviderWork]);

  // Driver-owned listings not yet booked by anyone (school/personal routes,
  // work jobs, errand jobs). Once a route/errand/work job IS booked, its
  // original listing card is hidden here in favor of the actual
  // booking/application card, so the same real-world assignment is never
  // shown as two separate cards.
  const driverTrips = useMemo(
    () =>
      [...routes, ...workJobs, ...errandJobs].filter((t) => {
        if (t.collectionName === "driverRoutes" && bookedRouteIds.has(t.id)) {
          return false;
        }

        if (t.collectionName === "errandJobs" && bookedErrandJobIds.has(t.id)) {
          return false;
        }

        if (t.collectionName === "workJobs" && bookedWorkJobIds.has(t.id)) {
          return false;
        }

        return true;
      }),
    [routes, workJobs, errandJobs, bookedRouteIds, bookedErrandJobIds, bookedWorkJobIds],
  );

  // ONE combined, chronologically sorted list per tab — School, Personal,
  // Work, Errand, Roadside, and driver-listing cards are all mixed together
  // by real trip date/time only (see sortMyBookings in bookingsLib.ts).
  // Never sort each category separately and concatenate the results.
  const combinedPassengerRows = useMemo<CombinedRow[]>(
    () =>
      sortMyBookings([
        ...passengerRides.map(tagRide),
        ...bookings.map(tagBooking),
        ...passengerApps.map(tagApplication),
        ...school.passengerRows,
      ]),
    [passengerRides, bookings, passengerApps, school.passengerRows],
  );

  const combinedDriverRows = useMemo<CombinedRow[]>(
    () =>
      sortMyBookings([
        ...driverRides.map(tagRide),
        ...driverTrips.map(tagTrip),
        ...driverRoadside.map(tagBooking),
        ...driverApps.map(tagApplication),
        ...school.driverRows,
      ]),
    [driverRides, driverTrips, driverRoadside, driverApps, school.driverRows],
  );

  // requestId -> live roadsideRequests record, so a roadside booking row can
  // render the SAME synchronized RoadsideAcceptedCard used on Help Requests
  // instead of its own status snapshot.
  const driverRoadsideRequestsById = useMemo(() => {
    const map = new Map<string, RoadsideRequestRecord>();
    driverRoadsideRequests.forEach((r) => map.set(r.id, r));
    return map;
  }, [driverRoadsideRequests]);

  // Driver-name search (see getRowDriverName) — normalizeLocationText handles
  // case-insensitivity, trimming, and the Arabic/Hebrew diacritic/final-
  // letter folding a plain .toLowerCase() would miss.
  const driverNameQuery = normalizeLocationText(search.trim());
  const hasActiveFilters =
    !!search.trim() || categoryFilter !== "all" || !!dateFilter || !!locationFilter;

  // All four filters combine with AND logic — a row must pass every active
  // one. Order doesn't affect the result (all are simple boolean checks),
  // only that they all run before the Upcoming/In Progress/Completed bucket
  // split below, so tab counts and bucket contents both reflect the same
  // filtered set.
  const matchesFilters = (row: CombinedRow): boolean => {
    if (driverNameQuery && !normalizeLocationText(getRowDriverName(row)).includes(driverNameQuery)) {
      return false;
    }

    if (categoryFilter !== "all" && getRowCategoryFilterValue(row) !== categoryFilter) {
      return false;
    }

    if (dateFilter && getBookingDateYMD(row) !== dateFilter) {
      return false;
    }

    if (locationFilter && !locationRowMatches(locationFilter, row)) {
      return false;
    }

    return true;
  };

  const filteredPassengerRows = useMemo(
    () => combinedPassengerRows.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [combinedPassengerRows, driverNameQuery, categoryFilter, dateFilter, locationFilter],
  );

  const filteredDriverRows = useMemo(
    () => combinedDriverRows.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [combinedDriverRows, driverNameQuery, categoryFilter, dateFilter, locationFilter],
  );

  // Location filter suggestions — sourced from the full, comprehensive
  // Israel locality dataset (israelLocations.ts), NEVER from the user's own
  // loaded bookings and NEVER a Firestore/external places query. This lets a
  // user filter by a locality that doesn't currently appear in any of their
  // bookings. Booking RESULTS still only ever come from combinedPassengerRows/
  // combinedDriverRows above — picking a suggestion here never creates a
  // booking or reads another user's data. Multilingual: searches english/
  // arabic/hebrew/russian/aliases/id together (see
  // searchIsraelLocationsMultilingual), so "Nazareth"/"الناصرة"/"נצרת"/
  // "Назарет" all surface the same entry regardless of typed script.
  // Capped and memoized — never re-searches on anything but the query/
  // language actually changing, never renders the whole ~130-entry dataset.
  const locationSuggestions = useMemo(
    () => searchIsraelLocationsMultilingual(locationQuery, language, 12),
    [locationQuery, language],
  );

  const handleClearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setDateFilter(null);
    setLocationFilter(null);
  };

  // One shared Upcoming/In Progress/Completed(/Unbooked Trips) split, used
  // by both Passenger and Driver tabs — never a per-category split. Already
  // sorted by sortMyBookings (nearest-date-first / completed-last, most-
  // recent-completed-first across every category), so filtering here just
  // buckets the list without a second sort call, preserving date order
  // exactly.
  //
  // Passenger and Driver deliberately use TWO SEPARATE classifiers, never
  // one shared function — "In Progress" means something different for each
  // role (see bookingsLib.ts's comment above getPassengerTripStatus).
  // Passenger: getPassengerTripStatus/getPassengerTripBucket — driver on the
  // way/arrived/actually in progress all read as one continuous In Progress
  // phase, and there is no Unbooked Trips bucket at all. Driver: the
  // stricter getDriverTripStatus/getDriverTripBucket, unchanged.
  const rowsForTab = tab === "passenger" ? filteredPassengerRows : filteredDriverRows;
  const getBucket = tab === "driver" ? getDriverTripBucket : getPassengerTripBucket;
  const getEffectiveStatus = tab === "driver" ? getDriverTripStatus : getPassengerTripStatus;

  const upcomingRows = useMemo(
    () => rowsForTab.filter((row) => getBucket(row) === "upcoming"),
    [rowsForTab, getBucket],
  );

  const inProgressRows = useMemo(
    () => rowsForTab.filter((row) => getBucket(row) === "inProgress"),
    [rowsForTab, getBucket],
  );

  const completedRows = useMemo(
    () => rowsForTab.filter((row) => getBucket(row) === "completed"),
    [rowsForTab, getBucket],
  );

  // Split of the Completed bucket, for BOTH roles — a cancelled trip is
  // bucketed as "completed" (see getDriverTripBucket/getPassengerTripBucket)
  // but is never the same thing as a successful completion, so it renders in
  // its own clearly separated section (see the Completed tab JSX below) and
  // is excluded from the Completed tab's own count, without adding a new
  // main tab for either role.
  const trulyCompletedRows = useMemo(
    () => completedRows.filter((row) => getEffectiveStatus(row) !== "cancelled"),
    [completedRows, getEffectiveStatus],
  );
  const cancelledHistoryRows = useMemo(
    () => completedRows.filter((row) => getEffectiveStatus(row) === "cancelled"),
    [completedRows, getEffectiveStatus],
  );

  // Driver-only — a published trip listing (driverRoutes/workJobs/errandJobs
  // "trip" row, or a School "schoolTrip" row) whose own departure date/time
  // has passed with zero real active bookings against it (see
  // getDriverTripBucket in bookingsLib.ts). Always empty on the passenger
  // tab, since no passenger row kind can ever classify this way.
  const unbookedTripsRows = useMemo(
    () => rowsForTab.filter((row) => getBucket(row) === "unbookedTrips"),
    [rowsForTab, getBucket],
  );

  // The Violations tab shows BOTH violation systems together (no-show,
  // driverViolations — see driverNoShowLib.ts; driver-cancellation,
  // users/{uid}/cancellationViolations — see driverViolationCore.ts),
  // merged into one chronological list and one combined active-count badge,
  // since a driver doesn't care which internal system a violation came
  // from. Sorted newest-first, matching each system's own subscription
  // order individually.
  const mergedViolationRows = useMemo(
    () =>
      [...driverViolations, ...driverCancellationViolations].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [driverViolations, driverCancellationViolations],
  );
  const activeCancellationViolationCount = useMemo(
    () => driverCancellationViolations.filter((v) => v.active).length,
    [driverCancellationViolations],
  );
  const mergedActiveViolationCount = activeViolationCount + activeCancellationViolationCount;

  // Clear All's exact scope: the current role tab's FULL bucket, deliberately
  // computed from combinedPassengerRows/combinedDriverRows (never
  // filteredPassengerRows/filteredDriverRows) so an active search query can
  // never shrink what gets confirmed/cleared — see this screen's Clear All
  // requirements. Reuses the exact same getBucket classifier every other
  // section above already uses, so this can never disagree with what's
  // actually shown once the search box is cleared.
  const combinedRowsForTab = tab === "passenger" ? combinedPassengerRows : combinedDriverRows;

  const clearAllScopeRows = useMemo(
    () => combinedRowsForTab.filter((row) => getBucket(row) === bucketTab),
    [combinedRowsForTab, getBucket, bucketTab],
  );

  // Two clearly separated sections within Unbooked Trips — never one mixed
  // list. getDriverTripStatus is the exact same function that already
  // decided this row belongs in "unbookedTrips" (see getDriverTripBucket),
  // so which of the two sections it falls into can never disagree with why
  // it's in this tab at all. Each section gets its OWN sort direction (see
  // getTripTimestamp — the one shared date+time parser used everywhere else
  // in My Bookings, so every category's differing date/time field names are
  // already handled consistently).
  const waitingForBookingRows = useMemo(
    () =>
      [...unbookedTripsRows]
        .filter((row) => getDriverTripStatus(row) === "waitingForBooking")
        .sort((a, b) => getTripTimestamp(a) - getTripTimestamp(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unbookedTripsRows, unbookedExpiryTick],
  );
  const expiredNoBookingsRows = useMemo(
    () =>
      [...unbookedTripsRows]
        .filter((row) => getDriverTripStatus(row) === "expiredNoBookings")
        .sort((a, b) => getTripTimestamp(b) - getTripTimestamp(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unbookedTripsRows, unbookedExpiryTick],
  );

  // "Unbooked Trips" is driver-only — if it was selected and the user
  // switches to the Passenger tab (which never has this bucket), fall back
  // to Upcoming rather than showing an always-empty selected tab.
  useEffect(() => {
    if (tab === "passenger" && bucketTab === "unbookedTrips") {
      setBucketTab("upcoming");
    }
  }, [tab, bucketTab]);

  // Keep the active status tab visible when it changes — only scrolls the
  // horizontal tab bar the minimum amount needed to bring it fully into
  // view (never forces it to the center), and only once this tab's own
  // layout has actually been measured.
  useEffect(() => {
    const layout = bucketButtonLayoutsRef.current[bucketTab];
    const viewportWidth = bucketScrollViewportWidthRef.current;
    if (!layout || !viewportWidth) return;

    const EDGE_PADDING = 12;
    const currentOffset = bucketScrollOffsetRef.current;
    const buttonStart = layout.x;
    const buttonEnd = layout.x + layout.width;

    let nextOffset: number | null = null;
    if (buttonStart < currentOffset + EDGE_PADDING) {
      nextOffset = Math.max(buttonStart - EDGE_PADDING, 0);
    } else if (buttonEnd > currentOffset + viewportWidth - EDGE_PADDING) {
      nextOffset = buttonEnd - viewportWidth + EDGE_PADDING;
    }

    if (nextOffset !== null) {
      bucketScrollRef.current?.scrollTo({ x: nextOffset, animated: true });
    }
  }, [bucketTab, tab]);

  // Notification deep link: once the target combined list (whichever tab the
  // notification targeted) contains the target id, scroll to it and flash
  // it briefly. Roadside notifications may only carry a requestId (see spec
  // item 8) rather than the booking's own id, so booking rows also match on
  // their `requestId` — the row's real `.id` is always what gets highlighted
  // (that's what appCardRefs is keyed by).
  useEffect(() => {
    if (!pendingScrollAppId) return;

    const candidates =
      tab === "driver" ? combinedDriverRows : combinedPassengerRows;

    const match = candidates.find(
      (row) =>
        row.id === pendingScrollAppId ||
        (row._kind === "booking" && row.requestId === pendingScrollAppId),
    );
    if (!match) return;

    const id = match.id;
    setPendingScrollAppId(null);
    setHighlightAppId(id);

    // Give the just-switched tab/list a moment to finish laying out before
    // measuring card positions.
    const scrollTimer = setTimeout(() => scrollToAppCard(id), 350);
    const clearTimer = setTimeout(() => {
      setHighlightAppId((prev) => (prev === id ? null : prev));
    }, 2600);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [pendingScrollAppId, tab, combinedDriverRows, combinedPassengerRows]);

  // `resolveErrorMessage`, when given, takes over turning a caught error into
  // the Alert's message — used by the cancellation call sites below so a
  // CancellationError's stable code (never a raw Firestore/SDK error) is
  // translated via translateCancellationError, instead of falling through to
  // this function's own default `error?.message` (which is only safe for the
  // OTHER operations here — accept/reject/start/finish/pay/... — that still
  // throw a plain, already-translated Error).
  const runApp = async (
    id: string,
    fn: () => Promise<void>,
    resolveErrorMessage?: (error: unknown) => string,
  ) => {
    try {
      setBusyId(id);
      await fn();
    } catch (error: any) {
      Alert.alert(
        t("common.error"),
        resolveErrorMessage
          ? resolveErrorMessage(error)
          : error?.message || t("booking.somethingWentWrong"),
      );
    } finally {
      setBusyId(null);
    }
  };

  // Shown after a successful driver cancellation, once
  // evaluateDriverCancellationStanding has actually run (see each cancel
  // call site below) — never blocks/replaces the cancellation's own success
  // path. 1st-through-5th violations are already fully explained by the
  // PRE-cancellation warning modal the driver just confirmed through (see
  // confirmDriverCancellation below); the only thing left to report here is
  // the one state change that happens strictly AFTER confirmation — the
  // account becoming suspended on the 6th violation.
  const showDriverCancellationStandingAlert = (result: CancellationStandingResult | null) => {
    if (!result || result.warning !== "suspended") return;
    Alert.alert(t("driver.accountSuspendedTitle"), t("driver.cancellationSuspensionBlockedMessage"));
  };

  // Item 1/2/3/4/9 — before actually executing a driver's cancellation of a
  // trip, show a modal explaining the up-to-5-per-30-days policy and exactly
  // how many cancellations will remain, with "Continue and Cancel" (proceeds)
  // and "Do Not Cancel" (does nothing) as the only two actions. The warning
  // count is read FRESH from Firestore right here, every time — never from
  // local/cached state — and only ever shown when this specific trip/booking
  // has a real passenger on it (hasRealBooking); a zero-booking trip instead
  // falls straight through to the exact same plain confirm every cancellation
  // already used before this feature existed, with no violation warning at
  // all. Setting/clearing busyId around the fetch also blocks a double-tap on
  // the triggering button from firing this twice.
  const confirmDriverCancellation = async (
    id: string,
    hasRealBooking: boolean,
    title: string,
    baseMessage: string,
    confirmLabel: string,
    onConfirm: () => Promise<void>,
    resolveErrorMessage?: (error: unknown) => string,
    cancelLabel: string = t("common.cancel"),
  ) => {
    if (!hasRealBooking || !uid) {
      Alert.alert(title, baseMessage, [
        { text: cancelLabel, style: "cancel" },
        {
          text: confirmLabel,
          style: "destructive",
          onPress: () => runApp(id, onConfirm, resolveErrorMessage),
        },
      ]);
      return;
    }

    setBusyId(id);
    let preview: CancellationWarningPreview | null = null;
    try {
      preview = await getDriverCancellationWarningPreview(uid);
    } catch (error) {
      console.log("confirmDriverCancellation: getDriverCancellationWarningPreview failed", { id, error });
    }
    setBusyId(null);

    const warningLine = preview ? t(CANCELLATION_WARNING_MESSAGE_KEY[preview.level]) : "";

    Alert.alert(title, warningLine ? `${baseMessage}\n\n${warningLine}` : baseMessage, [
      { text: t("driver.cancellationDoNotCancel"), style: "cancel" },
      {
        text: t("driver.cancellationContinueAndCancel"),
        style: "destructive",
        onPress: () => runApp(id, onConfirm, resolveErrorMessage),
      },
    ]);
  };

  const callPhone = (phone?: string | null) => {
    const callNumber = formatPhoneForCall(phone);

    if (!callNumber) {
      Alert.alert(t("booking.noPhoneTitle"), t("booking.noPhoneSavedMessage"));
      return;
    }

    Linking.openURL(`tel:${callNumber}`).catch(() =>
      Alert.alert(t("common.error"), t("booking.couldNotOpenPhoneApp")),
    );
  };


  const openLiveTracking = (bookingId: string) => {
    router.push({
      pathname: "/booking/live-tracking",
      params: { id: bookingId },
    } as any);
  };

  const openSchoolRideNavigation = (bookingId: string) => {
    router.push({
      pathname: "/driver/ride-navigation",
      params: { id: bookingId },
    } as any);
  };

  // Live Tracking is a School Ride–only feature. Personal Ride never shows
  // it, for either the passenger or the driver, regardless of trip status.
  const canShowLiveTracking = (item: any) => {
    return (
      item?.category === "school" &&
      item?.trackingEnabled === true &&
      item?.tripStatus === "arrived_pickup"
    );
  };

  const getBookingTripLabel = (b: BookingItem) => {
    const tripStatus = (b as any).tripStatus;

    // Driver no-show (see driverNoShowLib.ts) — checked before the generic
    // "cancelled" branch since a no-show trip never gets b.status written to
    // "cancelled" (only tripStatus is set), and needs its own clear reason
    // text rather than reading as a plain passenger/driver cancellation.
    if (tripStatus === "driver_no_show") {
      return t("driverNoShow.passengerCancelledReason");
    }

    if (b.status === "cancelled") {
      return t("bookings.status.cancelled");
    }

    if (b.status === "completed" || tripStatus === "completed") {
      return t("common.completed");
    }

    if (tripStatus === "driver_on_way") {
      return t("rides.status.on_the_way");
    }

    if (tripStatus === "arrived_pickup") {
      return t("rides.status.arrived");
    }

    if (tripStatus === "in_progress") {
      return t("booking.statusTripInProgress");
    }

    return t("booking.statusOngoing");
  };

  const renderBookingTripStatus = (b: BookingItem) => {
    const tripStatus = (b as any).tripStatus;
    // Driver no-show reads visually as "cancelled" (red pill) — see
    // getBookingTripLabel above for the matching text override.
    const cancelled = b.status === "cancelled" || tripStatus === "driver_no_show";
    const completed = !cancelled && (b.status === "completed" || tripStatus === "completed");

    return (
      <View
        style={[
          styles.statusPill,
          cancelled ? styles.statusDead : completed ? styles.statusDone : styles.statusOngoing,
        ]}
      >
        <Ionicons
          name={cancelled ? "close-circle" : completed ? "checkmark-circle" : "time"}
          size={13}
          color={cancelled ? "#B91C1C" : completed ? "#166534" : "#B86115"}
        />
        <Text
          style={[
            styles.statusText,
            cancelled
              ? styles.statusTextDead
              : completed
                ? styles.statusTextDone
                : styles.statusTextOngoing,
          ]}
        >
          {getBookingTripLabel(b)}
        </Text>
      </View>
    );
  };

  // Deleting a card only ever hides it from the current user's own list — it
  // never cancels/changes the booking itself (status/tripStatus/paymentStatus
  // are untouched). Active/upcoming items get an extra-explicit warning so
  // that's never mistaken for a cancellation.
  const removeConfirmMessage = (item: any, label: string) =>
    isCompletedItem(item)
      ? t("booking.removeConfirmCompleted", { label })
      : t("booking.removeActiveMessage");

  const confirmHideRideBooking = (ride: RideBooking, viewer: Tab) => {
    Alert.alert(t("booking.removeBookingTitle"), removeConfirmMessage(ride, t("booking.labelWord")), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.removeButton"),
        style: "destructive",
        onPress: () =>
          runApp(ride.id, () => {
            if (viewer === "passenger") {
              setPassengerRides((prev) => prev.filter((r) => r.id !== ride.id));
            } else {
              setDriverRides((prev) => prev.filter((r) => r.id !== ride.id));
            }

            return viewer === "passenger"
              ? hideRideBookingForPassenger(ride.id)
              : hideRideBookingForDriver(ride.id, ride.routeId);
          }),
      },
    ]);
  };

const hideGeneralBooking = async (bookingId: string, viewer: Tab) => {
  const localBooking = driverRoadside.find((b) => b.id === bookingId);

  if (viewer === "passenger") {
    setBookings((prev) => prev.filter((b) => b.id !== bookingId));
  } else {
    setDriverRoadside((prev) => prev.filter((b) => b.id !== bookingId));

    if (localBooking?.routeId) {
      setRoutes((prev) => prev.filter((r) => r.id !== localBooking.routeId));
    }
  }

  const bookingRef = doc(db, "bookings", bookingId);
  const bookingSnap = await getDoc(bookingRef);

  const routeId =
    localBooking?.routeId ||
    (bookingSnap.exists() ? String(bookingSnap.data().routeId || "") : "");

  await updateDoc(bookingRef, {
    [viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver"]: true,
    updatedAt: serverTimestamp(),
  });

  // مهم: إذا السائق حذف كرت حجز مدرسة، نخفي كمان كرت driverRoutes الأصلي
  // عشان ما يرجع يظهر مكانه.
  if (viewer === "driver" && routeId) {
    await updateDoc(doc(db, "driverRoutes", routeId), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    });
  }
};

  const confirmHideGeneralBooking = (
    booking: BookingItem,
    viewer: Tab,
    label = t("booking.labelWord"),
  ) => {
    Alert.alert(t("booking.removeBookingTitle"), removeConfirmMessage(booking, label), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.removeButton"),
        style: "destructive",
        onPress: () =>
          runApp(booking.id, () => hideGeneralBooking(booking.id, viewer)),
      },
    ]);
  };

  const hideApplicationFromList = async (
    app: NormalizedApplication,
    viewer: Tab,
  ) => {
    const collectionName =
      app.kind === "work" ? "workApplications" : "errandApplications";

    if (viewer === "passenger") {
      if (app.kind === "work") {
        setMyWorkApps((prev) => prev.filter((a) => a.id !== app.id));
      } else {
        setMyErrandApps((prev) => prev.filter((a) => a.id !== app.id));
      }
    } else if (app.kind === "work") {
      setAsProviderWork((prev) => prev.filter((a) => a.id !== app.id));
    } else {
      setAsProviderErrand((prev) => prev.filter((a) => a.id !== app.id));
    }

    await updateDoc(doc(db, collectionName, app.id), {
      [viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver"]:
        true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmHideApplication = (app: NormalizedApplication, viewer: Tab) => {
    Alert.alert(t("booking.removeBookingTitle"), removeConfirmMessage(app, t("booking.labelWord")), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.removeButton"),
        style: "destructive",
        onPress: () =>
          runApp(app.id, () => hideApplicationFromList(app, viewer)),
      },
    ]);
  };

  const goToPayment = (a: NormalizedApplication) =>
    router.push({
      pathname: "/booking/payment",
      params: { kind: a.kind, id: a.id },
    } as any);

  // Work only — the provider pays the worker right after accepting their
  // application (see handleAppAccept); also reused as the fallback re-entry
  // point from the Completed card if that payment never went through.
  const goToWorkPayment = (a: NormalizedApplication) =>
    router.push({
      pathname: "/booking/work-errand/work/payment",
      params: {
        bookingId: a.id,
        amount: String(a.price ?? a.hourlyPay ?? 0),
        payerId: a.providerId,
        payerName: a.providerName,
        payeeId: a.customerId,
        payeeName: a.customerName,
        payeePhone: a.customerPhone,
        category: "work",
      },
    } as any);

  const openNavigation = (a: NormalizedApplication) =>
    router.push({
      pathname: "/driver/job-navigation",
      params: { kind: a.kind, id: a.id },
    } as any);

  const handleAppStart = (a: NormalizedApplication) => {
    if (startState(a.date) === "future") {
      Alert.alert(
        t("booking.notYetTitle"),
        a.kind === "work"
          ? t("booking.startAvailableOnJobDate")
          : t("booking.startAvailableOnErrandDate"),
      );
      return;
    }

    runApp(a.id, async () => {
      const blocked = await getDriverSuspensionBlockedReason(a.providerId);
      if (blocked) {
        Alert.alert(t("driver.accountSuspendedTitle"), blocked);
        return;
      }

      // Work Helper only — pressing Start is the one real "this assignment
      // has actually started" action, so it persists tripStatus
      // "in_progress" directly (same beginJobTrip write the old, separate
      // "Start Trip" post-arrival button already used — see
      // handleAppStartTrip below) rather than only the "on the way"
      // sub-step. Errand is deliberately untouched — still startJob, same
      // on_the_way → arrived → Finish flow as before.
      if (a.kind === "work") {
        await beginJobTrip(a.kind, a.id, a);
      } else {
        await startJob(a.kind, a.id, a);
      }
      openNavigation(a);
    });
  };

  const handleAppArrive = (a: NormalizedApplication) =>
    runApp(a.id, () => arriveJob(a.kind, a.id, a));

  // The real "Start Trip" step, distinct from handleAppStart (which only
  // means "began driving toward the customer"). Moves the card from
  // Upcoming to In Progress — see getDriverTripStatus in bookingsLib.ts.
  const handleAppStartTrip = (a: NormalizedApplication) =>
    runApp(a.id, () => beginJobTrip(a.kind, a.id, a));

  const handleAppFinish = (a: NormalizedApplication) =>
    Alert.alert(
      a.kind === "work" ? "Finish Work" : "Finish Errand",
      "Mark this as completed?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, finish",
          onPress: () => runApp(a.id, () => finishJob(a.kind, a.id, a)),
        },
      ],
    );

  const handleAppCancel = (
    a: NormalizedApplication,
    by: "passenger" | "driver",
  ) => {
    const blocked = cancelBlockedReason(a, by);

    if (blocked) {
      Alert.alert(t("booking.cannotCancelTitle"), blocked);
      return;
    }

    // Same driver/passenger wording split every other category's cancel
    // confirm already uses (see handleCancelRideBooking/
    // handleCancelGeneralBooking above) — the driver's version says
    // cancelling may affect the other side, the passenger's says only their
    // own booking is affected.
    const title = by === "driver" ? t("schoolTrip.cancelTripButton") : t("booking.cancelBookingTitle");
    const message = by === "driver" ? t("schoolTrip.cancelTripConfirm") : t("booking.cancelBookingConfirm");

    confirmDriverCancellation(
      a.id,
      by === "driver",
      title,
      message,
      t("common.yesCancel"),
      async () => {
        const result = await cancelApplication(a.kind, a.id, a, by);

        // The violation doc itself was already written atomically inside
        // cancelApplication's own transaction — this only counts/warns/
        // suspends, best-effort (see driverViolationsLib.ts's own header).
        if (result?.violationCreated) {
          try {
            const standing = await evaluateDriverCancellationStanding(result.driverId);
            showDriverCancellationStandingAlert(standing);
          } catch (error) {
            console.log("handleAppCancel: evaluateDriverCancellationStanding failed (violation already recorded, non-fatal)", {
              id: a.id,
              driverId: result.driverId,
              error,
            });
          }
        }
      },
      translateCancellationError,
      t("common.no"),
    );
  };

  const handleAppAccept = (a: NormalizedApplication) =>
    runApp(a.id, async () => {
      const blocked = await getDriverSuspensionBlockedReason(a.providerId);
      if (blocked) {
        Alert.alert(t("driver.accountSuspendedTitle"), blocked);
        return;
      }
      await acceptRequest(a.kind, a.id, a);

      // Work Helper: the provider pays the worker right after accepting, not
      // after the job is finished — Accept itself never waits on this (the
      // request is already accepted above), it's just the very next screen.
      // See handleAppFinish's own comment: the payment step has moved here,
      // so Finish Work no longer auto-opens it. Errand is untouched — its
      // customer-side upfront payment (payment_pending_passenger) already
      // happens on its own, unrelated screen.
      if (a.kind === "work") {
        goToWorkPayment(a);
      }
    });

  const handleAppReject = (a: NormalizedApplication) =>
    Alert.alert(t("booking.rejectRequestTitle"), t("booking.rejectRequestConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("roadsideHelp.rejectButton"),
        style: "destructive",
        onPress: () => runApp(a.id, () => rejectRequest(a.kind, a.id, a)),
      },
    ]);

  const confirmComplete = (
    collectionName: string,
    id: string,
    label: string,
  ) => {
    Alert.alert(t("booking.markAsCompletedTitle"), t("booking.markAsCompletedConfirm", { label }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.yesComplete"),
        onPress: () =>
          markCompleted(collectionName, id).catch((e) =>
            Alert.alert(t("common.error"), e?.message || t("booking.couldNotUpdate")),
          ),
      },
    ]);
  };

  // A driver-owned listing (driverRoutes/workJobs/errandJobs) belongs only to
  // that driver — deleting it only ever hides it from their own list, the
  // same deletedForDriver convention as every other card.
  const deleteTrip = async (trip: DriverTripItem) => {
    if (trip.collectionName === "driverRoutes") {
      setRoutes((prev) => prev.filter((r) => r.id !== trip.id));
    } else if (trip.collectionName === "workJobs") {
      setWorkJobs((prev) => prev.filter((r) => r.id !== trip.id));
    } else {
      setErrandJobs((prev) => prev.filter((r) => r.id !== trip.id));
    }

    await updateDoc(doc(db, trip.collectionName, trip.id), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmDeleteTrip = (trip: DriverTripItem) => {
    Alert.alert(t("booking.removeListingTitle"), removeConfirmMessage(trip, t("booking.listingWord")), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.removeButton"),
        style: "destructive",
        onPress: () => runApp(trip.id, () => deleteTrip(trip)),
      },
    ]);
  };

  // "Republish Trip" (driver only) — opens the compact confirmation modal
  // below (New Date/New Time/New Price/New Seats over a read-only summary),
  // never a full-page navigation to the original creation screen. `republish`
  // is built once, synchronously, right here — never a raw Firestore
  // document, never written anywhere, never reused as the new trip's id
  // (see republishLib.ts's header comment). Opening always resets date/time
  // to blank (the driver must pick a fresh, valid future value — see
  // submitRepublish) and seeds price/seats only as an editable suggestion.
  const openRepublishModal = (prefill: RepublishTripPrefill) => {
    if (republishSubmitting) return;

    setRepublish(prefill);
    setRepublishDate("");
    setRepublishTime("");
    setRepublishPrice(
      typeof prefill.suggestedPrice === "number" ? String(prefill.suggestedPrice) : "",
    );
    setRepublishSeats(
      typeof prefill.suggestedSeats === "number" ? String(prefill.suggestedSeats) : "1",
    );
  };

  const closeRepublishModal = () => {
    setRepublish(null);
    setRepublishDate("");
    setRepublishTime("");
    setRepublishPrice("");
    setRepublishSeats("");
    setShowRepublishDatePicker(false);
    setShowRepublishTimePicker(false);
  };

  // Driver's own not-yet-booked (or workJobs-with-workers) listing —
  // driverRoutes/workJobs/errandJobs, category is always one of the four
  // real driver-publishable values (never "roadside", never invented).
  const openRepublishDriverTrip = (trip: TaggedTrip) => {
    const category = trip.category as DriverTripCategory;

    if (
      category !== "personal" &&
      category !== "school" &&
      category !== "workErrands" &&
      category !== "errands"
    ) {
      Alert.alert(t("common.error"), t("booking.republishUnavailable"));
      return;
    }

    openRepublishModal({
      sourceTripId: trip.id,
      sourceCategory: category,
      from: trip.from || undefined,
      to: trip.to || undefined,
      fromPlace: resolveIsraelLocationForText(trip.from),
      toPlace: resolveIsraelLocationForText(trip.to),
      location: trip.location || undefined,
      locationPlace: resolveIsraelLocationForText(trip.location),
      title: trip.title || undefined,
      suggestedPrice: typeof trip.price === "number" ? trip.price : undefined,
      suggestedSeats:
        typeof (category === "workErrands" ? trip.totalSeats : trip.seats) === "number"
          ? (category === "workErrands" ? trip.totalSeats : trip.seats) ?? undefined
          : undefined,
    });
  };

  // A completed, real personal_ride booking (driver view) — the route/
  // price/seats the driver actually offered, never the passenger's own
  // identity/rating/payment info (RideBooking carries none of that into
  // RepublishTripPrefill above).
  const openRepublishRideDriverTrip = (ride: RideBooking) => {
    openRepublishModal({
      sourceTripId: ride.id,
      sourceCategory: "personal",
      from: ride.from || undefined,
      to: ride.to || undefined,
      fromPlace: resolveIsraelLocationForText(ride.from),
      toPlace: resolveIsraelLocationForText(ride.to),
      destinationDetails: ride.destinationDetails || undefined,
      suggestedPrice: typeof ride.price === "number" ? ride.price : undefined,
      suggestedSeats: typeof ride.seats === "number" ? ride.seats : undefined,
    });
  };

  // Publishes the modal's current New Date/New Time/New Price/New Seats as a
  // COMPLETELY NEW trip — reuses the exact same validators the full
  // creation screens use, and writes the exact same Firestore document
  // shape those screens do (see RideForm.tsx/work.tsx/errand.tsx), so the
  // new document is indistinguishable from one created the normal way: a
  // brand-new id, zero passengers/bookings, the same default status fields.
  // Vehicle info comes from the driver's own most-recently-used values
  // (useSavedFormValues — the same source every creation screen already
  // prefills from), never from the old completed trip's document.
  const submitRepublish = async () => {
    if (!republish || republishSubmitting) return;

    const user = auth.currentUser;
    if (!user) {
      Alert.alert(t("auth.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);
    if (!accountInfo) return;

    const dateTimeValidation = validateDateAndTimeNotPassed(republishDate, republishTime, {
      dateLabelKey: "driverCreate.travelDate",
      timeLabelKey: "driverCreate.departureTime",
    });
    if (!dateTimeValidation) return;

    const cleanPrice = Number(republishPrice);
    if (!republishPrice || Number.isNaN(cleanPrice) || cleanPrice <= 0) {
      Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
      return;
    }

    const cleanSeats = Number(republishSeats);
    if (!republishSeats || Number.isNaN(cleanSeats) || cleanSeats < 1) {
      Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
      return;
    }

    setRepublishSubmitting(true);

    try {
      const eligibility = await fetchDriverEligibility(user.uid);
      if (!eligibility.eligible) {
        const copy = getDriverEligibilityAlertCopy(eligibility.status, t);
        Alert.alert(copy.title, copy.message);
        return;
      }

      const suspensionBlocked = await getDriverSuspensionBlockedReason(user.uid);
      if (suspensionBlocked) {
        Alert.alert(t("driver.accountSuspendedTitle"), suspensionBlocked);
        return;
      }

      const car = savedVehicleValues.carModels[0] || "";
      const carColor = savedVehicleValues.carColors[0] || "";
      const carPlate = savedVehicleValues.plateNumbers[0] || "";
      const { cleanDate, cleanTime, day } = dateTimeValidation;
      const category = republish.sourceCategory;

      if (category === "personal" || category === "school") {
        const fromCoords = await resolveLocationCoordinates(
          republish.fromPlace || null,
          republish.from || "",
        );
        const toCoords = await resolveLocationCoordinates(
          republish.toPlace || null,
          republish.to || "",
        );
        const routeCoords: Record<string, number> = {};
        if (fromCoords) {
          routeCoords.fromLat = fromCoords.latitude;
          routeCoords.fromLng = fromCoords.longitude;
        }
        if (toCoords) {
          routeCoords.toLat = toCoords.latitude;
          routeCoords.toLng = toCoords.longitude;
        }

        await addDoc(collection(db, "driverRoutes"), {
          driverId: user.uid,
          driverName,
          phone: accountInfo.cleanPhone,
          driverAge: accountInfo.cleanDriverAge,
          languages,
          category,
          car,
          carColor,
          carPlate,
          allowsPets: false,
          from: republish.from || "",
          to: republish.to || "",
          schoolName: category === "school" ? republish.schoolName || "" : null,
          destinationDetails:
            category === "personal" ? republish.destinationDetails || null : null,
          fromNormalized: normalize(republish.from || ""),
          toNormalized: normalize(republish.to || ""),
          fromLocationId: republish.fromPlace?.id || null,
          toLocationId: republish.toPlace?.id || null,
          fromLocationNames: republish.fromPlace
            ? {
                english: republish.fromPlace.english,
                arabic: republish.fromPlace.arabic,
                hebrew: republish.fromPlace.hebrew,
              }
            : null,
          toLocationNames: republish.toPlace
            ? {
                english: republish.toPlace.english,
                arabic: republish.toPlace.arabic,
                hebrew: republish.toPlace.hebrew,
              }
            : null,
          ...routeCoords,
          tripDate: cleanDate,
          startDate: cleanDate,
          day,
          isRecurring: false,
          bookingType: "quick",
          repeatDays: [day],
          availableDays: [day],
          weeklyTrips: [],
          time: cleanTime,
          price: cleanPrice,
          seats: cleanSeats,
          rating: 4.8,
          reviews: 0,
          eta: 10,
          active: true,
          createdAt: serverTimestamp(),
        });

        recordUsedFormValues({ price: String(cleanPrice) });
      } else if (category === "workErrands") {
        const locationCoords = await resolveLocationCoordinates(
          republish.locationPlace || null,
          republish.location || "",
        );

        await addDoc(collection(db, "workJobs"), {
          employerId: user.uid,
          employerName: driverName,
          phone: accountInfo.cleanPhone,
          driverAge: accountInfo.cleanDriverAge,
          languages,
          jobTitle: republish.title || "",
          jobTitleNormalized: normalize(republish.title || ""),
          description: "",
          location: republish.location || "",
          locationNormalized: normalize(republish.location || ""),
          locationId: republish.locationPlace?.id || null,
          locationNames: republish.locationPlace
            ? {
                english: republish.locationPlace.english,
                arabic: republish.locationPlace.arabic,
                hebrew: republish.locationPlace.hebrew,
              }
            : null,
          locationLat: locationCoords?.latitude ?? null,
          locationLng: locationCoords?.longitude ?? null,
          date: cleanDate,
          day,
          startTime: cleanTime,
          endTime: cleanTime,
          hourlyPay: cleanPrice,
          workersNeeded: cleanSeats,
          seats: cleanSeats,
          totalSeats: cleanSeats,
          remainingSeats: cleanSeats,
          acceptedWorkersCount: 0,
          status: "available",
          available: true,
          isFull: false,
          rating: 4.8,
          reviews: 0,
          active: true,
          category: "workErrands",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const locationCoords = await resolveLocationCoordinates(
          republish.locationPlace || null,
          republish.location || "",
        );

        await addDoc(collection(db, "errandJobs"), {
          ownerId: user.uid,
          ownerName: driverName,
          phone: accountInfo.cleanPhone,
          driverAge: accountInfo.cleanDriverAge,
          languages,
          canTakeKids: !!republish.canTakeKids,
          allowsPets: !!republish.allowsPets,
          errandTitle: republish.title || "",
          errandTitleNormalized: normalize(republish.title || ""),
          description: "",
          location: republish.location || "",
          locationNormalized: normalize(republish.location || ""),
          locationId: republish.locationPlace?.id || null,
          locationNames: republish.locationPlace
            ? {
                english: republish.locationPlace.english,
                arabic: republish.locationPlace.arabic,
                hebrew: republish.locationPlace.hebrew,
              }
            : null,
          locationLat: locationCoords?.latitude ?? null,
          locationLng: locationCoords?.longitude ?? null,
          date: cleanDate,
          day,
          startTime: cleanTime,
          endTime: cleanTime,
          price: cleanPrice,
          seats: cleanSeats,
          rating: 4.8,
          reviews: 0,
          active: true,
          category: "errands",
          createdAt: serverTimestamp(),
        });

        recordUsedFormValues({ price: String(cleanPrice) });
      }

      Alert.alert(t("common.success"), t("driver.tripCreated"));
      closeRepublishModal();
    } catch (error: any) {
      console.log("REPUBLISH TRIP ERROR:", error);
      Alert.alert(t("common.error"), error?.message || t("booking.republishUnavailable"));
    } finally {
      setRepublishSubmitting(false);
    }
  };

  // Terminal statuses for bookings/applications — anything else counts as a
  // real, still-active booking for cancellation purposes.
  const TERMINAL_BOOKING_STATUSES = new Set(["cancelled", "completed"]);
  const TERMINAL_APPLICATION_STATUSES = new Set(["cancelled", "rejected", "completed"]);

  // "Cancel Trip" on a driver's own NOT-YET-completed listing (driverRoutes/
  // workJobs/errandJobs — Personal Ride, School Ride, and every other
  // driver-created trip card) — cancels the WHOLE published listing
  // permanently (never becomes bookable again — see
  // DRIVER_CANCELLED_TRIP_STATUS/isCancelledTripStatus), gated by the SAME
  // 5-hour driver cancellation window every other category already uses
  // (DRIVER_CANCEL_LOCK_HOURS — never the 2-hour passenger window).
  //
  // Real, live booking/application documents are queried FRESH right before
  // the transaction (Firestore transactions can only get-by-reference, never
  // run a query — same accepted pattern documented in schoolTripsLib.ts's
  // cancelSchoolTrip) — NEVER trusted from trip.activeBookingCount, which
  // mirrors a cached counter (acceptedWorkersCount) for workJobs and is
  // always 0 by construction for driverRoutes/errandJobs at this specific UI
  // entry point (booked trips render as a booking/application row instead —
  // see tagTrip's own comment), but is re-verified here regardless rather
  // than assumed. Every affected booking/application is cancelled and its
  // owner notified, and exactly one violation is created only when at least
  // one real active booking/application existed — all in the SAME
  // transaction as the listing's own cancellation, never a separate,
  // skippable step, exactly like cancelGeneralBooking does for an
  // already-booked trip.
  const cancelDriverTrip = async (
    trip: TaggedTrip,
  ): Promise<CancellationStandingResult | null> => {
    if (!uid) return null;

    const tripRef = doc(db, trip.collectionName, trip.id);

    type AffectedRecord = { ref: ReturnType<typeof doc>; ownerId: string; isApplication: boolean };
    let affected: AffectedRecord[] = [];
    let linkedDocs: { id: string; status: string }[] = [];

    // A failed query must NEVER be silently treated as "zero bookings" —
    // that would skip a real violation for a trip that genuinely had a
    // passenger on it. Logged with full context, then re-thrown as-is (never
    // swallowed) so runApp's own catch surfaces the REAL error to the driver
    // instead of a generic message, and the cancellation itself never
    // proceeds on an unverified booking count.
    try {
      if (trip.collectionName === "driverRoutes") {
        const snap = await getDocs(query(collection(db, "bookings"), where("routeId", "==", trip.id)));
        linkedDocs = snap.docs.map((d) => ({ id: d.id, status: String(d.data().status) }));
        affected = snap.docs
          .filter((d) => !TERMINAL_BOOKING_STATUSES.has(String(d.data().status)))
          .map((d) => ({ ref: d.ref, ownerId: d.data().passengerId || "", isApplication: false }));
      } else if (trip.collectionName === "workJobs") {
        const snap = await getDocs(
          query(
            collection(db, "workApplications"),
            where("jobId", "==", trip.id),
            where("employerId", "==", uid),
          ),
        );
        linkedDocs = snap.docs.map((d) => ({ id: d.id, status: String(d.data().status) }));
        affected = snap.docs
          .filter((d) => !TERMINAL_APPLICATION_STATUSES.has(String(d.data().status)))
          .map((d) => ({ ref: d.ref, ownerId: d.data().applicantId || "", isApplication: true }));
      } else {
        const snap = await getDocs(
          query(
            collection(db, "errandApplications"),
            where("errandId", "==", trip.id),
            where("driverId", "==", uid),
          ),
        );
        linkedDocs = snap.docs.map((d) => ({ id: d.id, status: String(d.data().status) }));
        affected = snap.docs
          .filter((d) => !TERMINAL_APPLICATION_STATUSES.has(String(d.data().status)))
          .map((d) => ({ ref: d.ref, ownerId: d.data().passengerId || "", isApplication: true }));
      }
    } catch (error) {
      console.error("cancelDriverTrip: failed to query linked bookings/applications — aborting cancellation (never treated as zero bookings)", {
        tripId: trip.id,
        collection: trip.collectionName,
        error,
      });
      throw error;
    }

    const passengerBookingCount = affected.length;

    console.log("cancelDriverTrip: linked bookings/applications found", {
      tripId: trip.id,
      collection: trip.collectionName,
      linkedDocs,
      activeBookingCount: passengerBookingCount,
    });

    let violationCreated = false;

    await runTransaction(db, async (transaction) => {
      // PHASE 1 — the only read.
      const violationSnap =
        passengerBookingCount > 0
          ? await readExistingCancellationViolation(transaction, uid, trip.collectionName, trip.id)
          : null;

      // PHASE 2 — every write.
      transaction.update(tripRef, {
        status: DRIVER_CANCELLED_TRIP_STATUS,
        updatedAt: serverTimestamp(),
      });

      affected.forEach(({ ref, isApplication }) => {
        transaction.update(ref, isApplication
          ? { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: "driver", updatedAt: serverTimestamp() }
          : { status: "cancelled", cancelledBy: "driver", updatedAt: serverTimestamp() });
      });

      if (violationSnap) {
        violationCreated = writeCancellationViolationIfNew(transaction, violationSnap, {
          driverId: uid,
          sourceCollection: trip.collectionName,
          sourceId: trip.id,
          sourceCategory: trip.category || "",
          scheduledDeparture: new Date(`${trip.date}T${trip.time || "00:00"}:00`),
          passengerBookingCount,
        });
      }
    });

    // Best-effort — the cancellation itself already succeeded, so a notify()
    // failure must never be reported back to the caller as a failed
    // cancellation (same pattern as every other cancel function in this
    // codebase — see cancelGeneralBooking in bookingsLib.ts).
    await Promise.all(
      affected.map(({ ownerId }) =>
        ownerId
          ? notify({
              receiverId: ownerId,
              type: "cancelled",
              title: t("schoolTrip.bookingCancelledNotificationTitle"),
              message: `The driver cancelled "${trip.title || `${trip.from || ""} → ${trip.to || ""}`.trim() || trip.category}"`,
              applicationId: trip.id,
              category: trip.category,
              status: "cancelled",
              targetTab: "passenger",
            }).catch((error) => {
              console.log("cancelDriverTrip: notify failed (trip already cancelled, non-fatal)", {
                tripId: trip.id,
                ownerId,
                error,
              });
            })
          : Promise.resolve(),
      ),
    );

    // Keep the driver's own routes/workJobs/errandJobs state in sync — the
    // trip is no longer removed from the list (it now belongs in the
    // Cancelled Trips section — see getDriverTripBucket/renderTripCard),
    // just re-tagged so it re-buckets immediately without waiting for the
    // next snapshot.
    const patchStatus = (items: DriverTripItem[]) =>
      items.map((r) => (r.id === trip.id ? { ...r, status: "cancelled" as const } : r));
    if (trip.collectionName === "driverRoutes") {
      setRoutes(patchStatus);
    } else if (trip.collectionName === "workJobs") {
      setWorkJobs(patchStatus);
    } else {
      setErrandJobs(patchStatus);
    }

    if (!violationCreated) return null;

    try {
      return await evaluateDriverCancellationStanding(uid);
    } catch (error) {
      console.log("cancelDriverTrip: evaluateDriverCancellationStanding failed (violation already recorded, non-fatal)", {
        tripId: trip.id,
        collection: trip.collectionName,
        category: trip.category,
        error,
      });
      return null;
    }
  };

  const confirmCancelDriverTrip = (trip: TaggedTrip) => {
    // Re-validated fresh at press time, not just trusted from whatever the
    // disabled prop showed at last render — same defense-in-depth every
    // other cancel confirm in this file already applies.
    const blocked = getTimeBasedCancelBlockedReason(trip, DRIVER_CANCEL_LOCK_HOURS);
    if (blocked) {
      Alert.alert(t("booking.cannotCancelTitle"), blocked);
      return;
    }

    confirmDriverCancellation(
      trip.id,
      trip.activeBookingCount > 0,
      t("schoolTrip.cancelTripButton"),
      t("schoolTrip.cancelTripConfirm"),
      t("schoolTrip.cancelTripButton"),
      async () => {
        const result = await cancelDriverTrip(trip);
        showDriverCancellationStandingAlert(result);
      },
    );
  };

  // "Clear All" is a PURE per-user My Bookings view-hide action — never a
  // cancellation. It only ever acts on the exact role tab + status tab the
  // user currently has open (see clearAllScopeRows above), and only ever
  // writes the exact same per-user deletedForPassenger/deletedForDriver flag
  // every individual trash button already uses (hideGeneralBooking,
  // confirmHideRideBooking's hideRideBookingForPassenger/ForDriver,
  // hideApplicationFromList, confirmDeleteTrip's deleteTrip): no status/
  // tripStatus write, no two-hour/five-hour cancel-lock check, no call to
  // cancelRideBooking/cancelGeneralBooking/cancelApplication/
  // cancelSchoolBooking/cancelSchoolTrip/cancelRideRequest anywhere in this
  // function. The individual per-card "Cancel booking"/"Cancel trip" buttons
  // remain the ONLY thing that ever actually cancels a booking — this
  // function never calls them, in any bucket. School rows (_kind
  // "schoolBooking"/"schoolTrip"/"schoolWaiting") are owned by
  // useMySchoolRows — its own clearAllSchoolRows hides each one the exact
  // same way, one real document at a time, never a groupId.
  const runClearAllBookings = async (
    rows: CombinedRow[],
    viewer: Tab,
    bucket: BookingBucket,
  ) => {
    setClearingAll(true);

    const field = viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver";
    const nonSchoolRows = rows.filter(
      (r) =>
        r._kind !== "schoolBooking" && r._kind !== "schoolTrip" && r._kind !== "schoolWaiting",
    );

    try {
      const clearedRideIds = new Set<string>();
      const clearedBookingIds = new Set<string>();
      const clearedWorkAppIds = new Set<string>();
      const clearedErrandAppIds = new Set<string>();
      const clearedTripIdsByCollection: Record<DriverCollection, Set<string>> = {
        driverRoutes: new Set(),
        workJobs: new Set(),
        errandJobs: new Set(),
      };

      // One "op" per card to hide, each carrying its own `mark()` callback —
      // only called once its OWN chunk's batch.commit() actually succeeds,
      // so a card whose write was denied is never optimistically removed.
      // `cosmetic: true` marks the routeIdsToHide cascade below — it isn't a
      // card the user asked to clear, so it's never counted toward the
      // cleared/failed totals shown to the user.
      type ClearOp = {
        collectionName: string;
        id: string;
        field: string;
        cosmetic: boolean;
        mark: () => void;
      };
      const ops: ClearOp[] = [];

      nonSchoolRows.forEach((row) => {
        if (row._kind === "ride") {
          ops.push({
            collectionName: "bookings",
            id: row.id,
            field,
            cosmetic: false,
            mark: () => clearedRideIds.add(row.id),
          });
        } else if (row._kind === "booking") {
          ops.push({
            collectionName: "bookings",
            id: row.id,
            field,
            cosmetic: false,
            mark: () => clearedBookingIds.add(row.id),
          });
        } else if (row._kind === "application") {
          const collectionName = row.kind === "work" ? "workApplications" : "errandApplications";
          ops.push({
            collectionName,
            id: row.id,
            field,
            cosmetic: false,
            mark: () => (row.kind === "work" ? clearedWorkAppIds.add(row.id) : clearedErrandAppIds.add(row.id)),
          });
        } else if (row._kind === "trip") {
          ops.push({
            collectionName: row.collectionName,
            id: row.id,
            field: "deletedForDriver",
            cosmetic: false,
            mark: () => clearedTripIdsByCollection[row.collectionName].add(row.id),
          });
        }
      });

      // A driver hiding a routed booking card also hides that route's own
      // driverRoutes listing, same as the individual delete button does
      // (see hideGeneralBooking) — otherwise, once the booking card is
      // gone, the route would incorrectly reappear as "waiting for
      // booking" even though it's still genuinely booked. Purely cosmetic
      // dedup, never one of the "cards" this action reports
      // clearing/failing.
      const routeIdsToHide = new Set(
        nonSchoolRows
          .filter((r): r is TaggedBooking => r._kind === "booking")
          .map((r) => (viewer === "driver" ? r.routeId : ""))
          .filter((id): id is string => !!id),
      );
      routeIdsToHide.forEach((routeId) => {
        ops.push({
          collectionName: "driverRoutes",
          id: routeId,
          field: "deletedForDriver",
          cosmetic: true,
          mark: () => clearedTripIdsByCollection.driverRoutes.add(routeId),
        });
      });

      // Grouped by collection — never one giant cross-collection batch — so
      // a rules gap in ONE collection (or a transient failure) can never
      // block another collection's hides, and every failure can be
      // reported against the exact collection it happened in. A plain
      // writeBatch per chunk, never a transaction: hiding a card is always
      // an unconditional field set, with nothing to read first, so there's
      // no read/write interleaving to get wrong.
      const opsByCollection = new Map<string, ClearOp[]>();
      ops.forEach((op) => {
        const list = opsByCollection.get(op.collectionName) ?? [];
        list.push(op);
        opsByCollection.set(op.collectionName, list);
      });

      let clearedCount = 0;
      let failedCount = 0;

      // Dev-only diagnostic — which collections this press is about to hide,
      // and how many cards each — never the cards' own field values.
      console.log("CLEAR_ALL_SOURCE_COLLECTIONS", {
        feature: "runClearAllBookings",
        collections: [...opsByCollection.entries()].map(([name, list]) => ({
          collection: name,
          count: list.length,
        })),
      });

      for (const [collectionName, collectionOps] of opsByCollection) {
        // Firestore batched writes cap at 500 operations — chunk defensively.
        for (let i = 0; i < collectionOps.length; i += 450) {
          const chunk = collectionOps.slice(i, i + 450);
          const batch = writeBatch(db);

          chunk.forEach((op) => {
            batch.update(doc(db, op.collectionName, op.id), {
              [op.field]: true,
              updatedAt: serverTimestamp(),
            });
          });

          try {
            await batch.commit();
            chunk.forEach((op) => {
              op.mark();
              if (!op.cosmetic) clearedCount += 1;
            });
          } catch (error: any) {
            // Dev-only diagnostic — collection + operation + error CODE
            // only, never a booking's own child name, return code, or any
            // other private field.
            console.log("Clear All hide failed", {
              feature: "runClearAllBookings",
              collection: collectionName,
              operation: "hide",
              code: error?.code,
            });
            failedCount += chunk.filter((op) => !op.cosmetic).length;
          }
        }
      }

      // Only ids whose write actually committed are removed from local
      // state — a card whose collection failed stays visible exactly as it
      // was.
      if (viewer === "passenger") {
        setPassengerRides((prev) => prev.filter((r) => !clearedRideIds.has(r.id)));
        setBookings((prev) => prev.filter((b) => !clearedBookingIds.has(b.id)));
        setMyWorkApps((prev) => prev.filter((a) => !clearedWorkAppIds.has(a.id)));
        setMyErrandApps((prev) => prev.filter((a) => !clearedErrandAppIds.has(a.id)));
      } else {
        setDriverRides((prev) => prev.filter((r) => !clearedRideIds.has(r.id)));
        setDriverRoadside((prev) => prev.filter((b) => !clearedBookingIds.has(b.id)));
        setAsProviderWork((prev) => prev.filter((a) => !clearedWorkAppIds.has(a.id)));
        setAsProviderErrand((prev) => prev.filter((a) => !clearedErrandAppIds.has(a.id)));
        setRoutes((prev) => prev.filter((t) => !clearedTripIdsByCollection.driverRoutes.has(t.id)));
        setWorkJobs((prev) => prev.filter((t) => !clearedTripIdsByCollection.workJobs.has(t.id)));
        setErrandJobs((prev) => prev.filter((t) => !clearedTripIdsByCollection.errandJobs.has(t.id)));
      }

      const schoolResult = await school.clearAllSchoolRows(bucket);
      clearedCount += schoolResult.cleared;
      failedCount += schoolResult.failed;

      if (failedCount > 0) {
        Alert.alert(
          t("booking.clearAllSomeCouldNotBeCleared"),
          t("booking.clearAllSummary", { cleared: clearedCount, failed: failedCount }),
        );
      } else {
        Alert.alert(t("roadsideHelp.clearAllTitle"), t("booking.clearAllCardsRemoved", { count: clearedCount }));
      }
    } catch (error: any) {
      // Only an unexpected exception outside the per-chunk/per-row handling
      // above (which never throws) reaches here.
      Alert.alert(t("common.error"), error?.message || t("roadsideHelp.couldNotClearAll"));
    } finally {
      setClearingAll(false);
    }
  };

  // Confirms + kicks off Clear All for the CURRENT role tab + status tab
  // only (clearAllScopeRows — the unsearched, bucket-scoped full list, never
  // filteredPassengerRows/filteredDriverRows), so an active search query can
  // never shrink either the confirmation count or what actually gets
  // cleared. In Progress never cancels/hides anything — an actively started
  // trip must be completed/ended first, so this only ever shows an
  // explanatory (or "nothing to clear") message for that tab.
  const handleClearAllBookings = () => {
    if (clearingAll) return;

    const totalCount = clearAllScopeRows.length;

    // Dev-only diagnostic — role/tab/row-count/handler name only, never a
    // card's own name, child code, route, or any other private field. Proof
    // that exactly this one handler (never a stale/duplicate one) is what
    // the visible Clear All button actually calls.
    console.log("CLEAR_ALL_BUTTON_PRESSED", {
      feature: "handleClearAllBookings",
      role: tab,
      statusTab: bucketTab,
      sourceRowCount: totalCount,
      handler: "runClearAllBookings",
    });

    if (bucketTab === "inProgress") {
      Alert.alert(
        t("roadsideHelp.clearAllTitle"),
        totalCount === 0
          ? t("booking.clearAllNothingToClear")
          : t("booking.clearAllActiveTripsBlocked"),
      );
      return;
    }

    if (totalCount === 0) {
      Alert.alert(t("roadsideHelp.clearAllTitle"), t("booking.clearAllNothingToClear"));
      return;
    }

    // One wording for every clearable bucket — Clear All never cancels
    // anything regardless of which tab it's pressed from, so the message
    // never differs by bucket the way it used to when Upcoming still meant
    // "cancel".
    Alert.alert(
      t("booking.clearAllAreYouSureTitle"),
      t("booking.clearAllRemoveConfirm", { count: totalCount }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("roadsideHelp.clearAllButton"),
          style: "destructive",
          // "violations" is a driver-only bucket added locally for the new
          // no-show Violations tab (see DriverBucketTab above) — it reads
          // from a separate driverViolations subscription, never from
          // clearAllScopeRows/CombinedRow, so this cast is safe: this
          // "Clear All" action is never meaningfully reachable while that
          // bucket is selected.
          onPress: () => runClearAllBookings(clearAllScopeRows, tab, bucketTab as BookingBucket),
        },
      ],
    );
  };

  const openRebook = (booking: BookingItem) => {
    setRebook({
      category: booking.category,
      from: booking.from,
      to: booking.to,
      date: booking.date || "",
      time: booking.time || "",
      seats: booking.seats ?? 1,
    });

    setRebookDate(booking.date || "");
    setRebookTime(booking.time || "");
  };

  const openRideRebook = (ride: RideBooking) => {
    setRebook({
      category: "personal",
      from: ride.from,
      to: ride.to,
      date: ride.date || "",
      time: ride.time || "",
      seats: ride.seats ?? 1,
    });

    setRebookDate(ride.date || "");
    setRebookTime(ride.time || "");
  };

  const submitRebook = () => {
    if (!rebook) return;

    if (!rebookDate || !rebookTime) {
      Alert.alert(t("auth.missingDetails"), t("booking.chooseNewDateTimeMessage"));
      return;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        from: rebook.from,
        to: rebook.to,
        category: rebook.category,
        seats: String(rebook.seats || 1),
        tripDate: rebookDate,
        time: rebookTime,
        bookingType: "quick",
        bookForWholeWeek: "false",
      },
    } as any);

    setRebook(null);
  };

  const handleRideStart = (r: RideBooking) => {
    if (!canStartTrip(r)) {
      Alert.alert(
        t("booking.notAvailableYetTitle"),
        getStartTripBlockedReason(r) ||
          t("booking.startTripOnlyOnTripDate"),
      );
      return;
    }

    runApp(r.id, async () => {
      const blocked = await getDriverSuspensionBlockedReason(r.driverId);
      if (blocked) {
        Alert.alert(t("driver.accountSuspendedTitle"), blocked);
        return;
      }

      await startRide(r.id, r);
      router.push({
        pathname: "/driver/ride-navigation",
        params: { id: r.id },
      } as any);
    });
  };

  const handleRideOpenMap = (r: RideBooking) =>
    router.push({
      pathname: "/driver/ride-navigation",
      params: { id: r.id },
    } as any);

  const handleRideArrived = (r: RideBooking) =>
    runApp(r.id, () => arriveRide(r.id, r));

  // The real "Start Ride" step, distinct from handleRideStart (which only
  // means "began driving toward pickup") — only shown once the ride has
  // reached "arrived_pickup". Moves the card from Upcoming to In Progress —
  // see getDriverTripBucket in bookingsLib.ts.
  const handleRideStartTrip = (r: RideBooking) =>
    runApp(r.id, () => startRideInProgress(r.id, r));

  const handleRideFinish = (r: RideBooking) =>
    runApp(r.id, () => finishRide(r.id, r));

  const handleCancelRideBooking = (r: RideBooking, viewer: Tab) => {
    const blocked = getRideCancelBlockedReason(r, viewer);
    if (blocked) {
      Alert.alert(t("booking.cannotCancelTitle"), blocked);
      return;
    }

    const title =
      viewer === "driver" ? t("schoolTrip.cancelTripButton") : t("booking.cancelBookingTitle");
    const message =
      viewer === "driver" ? t("schoolTrip.cancelTripConfirm") : t("booking.cancelBookingConfirm");

    confirmDriverCancellation(
      r.id,
      viewer === "driver",
      title,
      message,
      title,
      async () => {
        const result = await cancelRideBooking(r.id, r, viewer);
        showDriverCancellationStandingAlert(result);
      },
      translateCancellationError,
    );
  };

  const handleCancelGeneralBooking = (b: BookingItem, viewer: Tab) => {
    // Roadside Help's PASSENGER cancellation has its own, stricter rule —
    // owner only, and only while the accepted helper hasn't pressed Start
    // Driving yet (tripStatus still "booked") — enforced here, again inside
    // cancelRoadsideRequestByPassenger's own transaction, and a third time
    // in firestore.rules, so a direct client write can never bypass it
    // either. This never touches driver-side cancellation or any other
    // booking category, both of which keep using the generic path below.
    if (b.category === "roadside" && viewer === "passenger") {
      if (b.tripStatus !== "booked") return; // button is hidden for this stage; stay safe regardless.

      Alert.alert(t("booking.cancelBookingTitle"), t("booking.cancelBookingConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("booking.cancelBookingTitle"),
          style: "destructive",
          onPress: () =>
            runApp(
              b.id,
              () => cancelRoadsideRequestByPassenger(b.requestId),
              (error: any) => error?.message || t("booking.somethingWentWrong"),
            ),
        },
      ]);
      return;
    }

    const blocked = getGeneralBookingCancelBlockedReason(b, viewer);
    if (blocked) {
      Alert.alert(t("booking.cannotCancelTitle"), blocked);
      return;
    }

    const title =
      viewer === "driver" ? t("schoolTrip.cancelTripButton") : t("booking.cancelBookingTitle");
    const message =
      viewer === "driver" ? t("schoolTrip.cancelTripConfirm") : t("booking.cancelBookingConfirm");

    confirmDriverCancellation(
      b.id,
      viewer === "driver",
      title,
      message,
      title,
      async () => {
        const result = await cancelGeneralBooking(b.id, b, viewer);
        showDriverCancellationStandingAlert(result);

        // cancelGeneralBooking only ever touches the shared `bookings`
        // doc (it's generic across every category) — for Roadside
        // Help specifically, the driver-facing `roadsideRequests`
        // record (Help Requests screen, RoadsideAcceptedCard) needs
        // its own status flipped too, or it would keep showing stale
        // action buttons forever. Safe to call directly and let it
        // resolve either way: syncCancelledRoadsideRequest already
        // catches and logs its own errors internally (see
        // roadsideLib.ts) rather than throwing — the booking is
        // ALREADY cancelled by the time this runs, so this must never
        // be able to turn into a false "cancellation failed" here.
        if (b.category === "roadside" && b.requestId) {
          await syncCancelledRoadsideRequest(b.requestId);
        }
      },
      translateCancellationError,
    );
  };

  const bookingNeedsRating = (
    b: BookingItem | RideBooking | NormalizedApplication,
  ) => {
    const item: any = b;

    if (ratedSchoolBookingIds.includes(b.id)) {
      return false;
    }

    // tripStatus is the real completion signal; `status` is a second,
    // independently-written field on every one of these types (BookingItem/
    // RideBooking/SchoolBooking/NormalizedApplication all set both together
    // at the same finish/completion call) — require them to agree instead
    // of trusting either alone, so a partial/legacy write can never open
    // this popup early.
    return (
      item.tripStatus === "completed" &&
      item.status === "completed" &&
      // Never just a status string — the trip must actually carry a real
      // completion timestamp (item.completedAtSeconds > 0 means Firestore
      // resolved a real completedAt, not merely a field that was set to
      // "completed" without the corresponding serverTimestamp() write).
      item.completedAtSeconds > 0 &&
      item.needsPassengerRating === true &&
      item.ratingSubmitted !== true &&
      typeof item.rating !== "number" &&
      // BookingItem/RideBooking carry driverId; NormalizedApplication
      // (work/errand) carries providerId — the driver/service owner either way.
      !!(item.driverId || item.providerId)
    );
  };

const openSchoolRatingModal = (b: BookingItem) => {
  setSchoolRatingBooking(b);
  setRatingBooking(null);
  setAppRatingBooking(null);
  setRoadsideRatingBooking(null);
  setRatingStars(0);
  setRatingComment("");
};

const openAppRatingModal = (a: NormalizedApplication) => {
  setAppRatingBooking(a);
  setRatingBooking(null);
  setSchoolRatingBooking(null);
  setRoadsideRatingBooking(null);
  setRatingStars(0);
  setRatingComment("");
};

const openRoadsideRatingModal = (b: BookingItem) => {
  setRoadsideRatingBooking(b);
  setRatingBooking(null);
  setSchoolRatingBooking(null);
  setAppRatingBooking(null);
  setRatingStars(0);
  setRatingComment("");
};

// Despite the name, this is the rating path for EVERY generic BookingItem
// rating on the `bookings` collection, not just School — WEEKLY Personal
// Ride occurrences are created with category "personal" (see
// createWeeklyBookings in weeklyBookingLib.ts) and are BookingItems too, so
// they're rated through here via openSchoolRatingModal, never through
// rideBookingLib.ts's submitRideRating (that's the ONE-TIME "personal_ride"
// category path only — see renderBookingCard's own isPersonalCategory
// comment). firestore.rules' isValidDriverReview/
// isValidPassengerBookingRatingUpdate both explicitly allow category
// "personal" for exactly this reason.
const submitSchoolRating = async (
  booking: BookingItem,
  stars: number,
  comment: string,
) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(t("auth.pleaseLoginFirst"));
  }

  const cleanStars = Math.round(stars);
  if (!Number.isInteger(cleanStars) || cleanStars < 1 || cleanStars > 5) {
    throw new Error(t("validation.invalidRating"));
  }

  const item: any = booking;

  // driverId must be the driver's real Firebase UID — never this booking's
  // own id or its routeId — so the rating is never attributed to the wrong
  // profile.
  if (
    !item.driverId ||
    item.driverId === booking.id ||
    item.driverId === item.routeId ||
    item.driverId === user.uid
  ) {
    throw new Error(t("roadsideHelp.missingDriverIdField"));
  }

  const bookingRef = doc(db, "bookings", booking.id);
  const driverRef = doc(db, "users", item.driverId);
  // bookingId AS the review doc id — see firestore.rules' driverReviews
  // `allow create`, which requires this to match and rejects a second
  // rating attempt for the same booking outright (create on an
  // already-existing doc id always fails).
  const reviewRef = doc(db, "driverReviews", booking.id);

  const ratingWritePaths = {
    review: `driverReviews/${booking.id}`,
    booking: `bookings/${booking.id}`,
    driver: `users/${item.driverId}`,
  };
  console.log("[rating] transaction started", ratingWritePaths);

  try {
  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error(t("rides.bookingNotFound"));
    }

    const bookingData: any = bookingSnap.data();

    // Never trust the already-loaded `booking` object — re-verify ownership
    // + real completion against the current server state.
    if (bookingData.passengerId !== user.uid) {
      throw new Error(t("workErrand.mustBeLoggedIn"));
    }
    if (bookingData.tripStatus !== "completed" || bookingData.status !== "completed") {
      throw new Error(t("booking.tripNotCompletedYet"));
    }
    if (bookingData.ratingSubmitted === true) {
      return;
    }

    const reviewSnap = await transaction.get(reviewRef);
    if (reviewSnap.exists()) {
      return;
    }

    const driverSnap = await transaction.get(driverRef);
    const driverData: any = driverSnap.exists() ? driverSnap.data() : {};

    const oldCount = Number(driverData.ratingCount || 0);
    const oldSum = Number(driverData.ratingSum || 0);

    const newCount = oldCount + 1;
    const newSum = oldSum + cleanStars;
    // Stored RAW (never toFixed()'d) — firestore.rules checks
    // ratingAverage == ratingSum / ratingCount for exact equality.
    const newAverage = newSum / newCount;

    transaction.set(reviewRef, {
      bookingId: booking.id,
      routeId: item.routeId || "",
      category: item.category || "school",

      driverId: item.driverId,
      driverName: item.driverName || "Driver",

      passengerId: user.uid,
      passengerName: item.passengerName || user.displayName || "Passenger",

      rating: cleanStars,
      comment: comment.trim(),

      from: item.from || "",
      to: item.to || "",
      date: item.date || "",
      time: item.time || "",

      createdAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      rating: cleanStars,
      reviewComment: comment.trim(),
      ratingSubmitted: true,
      needsPassengerRating: false,
      ratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(
      driverRef,
      {
        ratingCount: newCount,
        ratingSum: newSum,
        ratingAverage: newAverage,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

    console.log("[rating] transaction succeeded", { bookingId: booking.id });
  } catch (error) {
    console.log("[rating] transaction failed", { ...ratingWritePaths, error });
    throw error;
  }
};

  const openRatingModal = (r: RideBooking) => {
    setRatingBooking(r);
    setSchoolRatingBooking(null);
    setAppRatingBooking(null);
    setRoadsideRatingBooking(null);
    setRatingStars(0);
    setRatingComment("");
  };

const submitRating = async () => {
  if (ratingStars < 1 || ratingBusy) return;

  try {
    setRatingBusy(true);

    if (schoolRatingBooking) {
      const bookingToRate = schoolRatingBooking;
      const ratedId = bookingToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      // Wait for Firestore to actually accept the rating before touching
      // any local UI state — the stars / "Rate Driver" -> "Book Again"
      // swap must never show unless the transaction really succeeded.
      await submitSchoolRating(bookingToRate, stars, comment);
      await dismissRatingNotifications(ratedId);

      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      setBookings((prev) =>
        prev.map((b) =>
          b.id === ratedId
            ? ({
                ...b,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              } as any)
            : b,
        ),
      );

      setSchoolRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");
      return;
    }

    if (appRatingBooking) {
      const appToRate = appRatingBooking;
      const ratedId = appToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      await submitApplicationRating(
        appToRate.kind,
        appToRate.id,
        appToRate,
        stars,
        comment,
      );
      await dismissRatingNotifications(ratedId);

      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      const patchApp = (list: NormalizedApplication[]) =>
        list.map((a) =>
          a.id === ratedId
            ? {
                ...a,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              }
            : a,
        );

      if (appToRate.kind === "work") {
        setMyWorkApps(patchApp);
      } else {
        setMyErrandApps(patchApp);
      }

      setAppRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");
      return;
    }

    if (roadsideRatingBooking) {
      const bookingToRate = roadsideRatingBooking;
      const ratedId = bookingToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      await submitRoadsideRating(bookingToRate.id, bookingToRate, stars, comment);
      await dismissRatingNotifications(ratedId);

      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      setBookings((prev) =>
        prev.map((b) =>
          b.id === ratedId
            ? {
                ...b,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              }
            : b,
        ),
      );

      setRoadsideRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");
      return;
    }

    if (ratingBooking) {
      const bookingToRate = ratingBooking;
      const ratedId = bookingToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      await submitRideRating(bookingToRate.id, bookingToRate, stars, comment);
      await dismissRatingNotifications(ratedId);

      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      setPassengerRides((prev) =>
        prev.map((r) =>
          r.id === ratedId
            ? {
                ...r,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              }
            : r,
        ),
      );

      setRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");
    }
  } catch (error: any) {
    // Rating modal / stars / "Rate Driver" button are all left exactly as
    // they were — nothing above this point touched local state, since
    // every branch now awaits the transaction FIRST.
    Alert.alert(t("common.error"), error?.message || t("booking.couldNotSubmitRating"));
  } finally {
    setRatingBusy(false);
  }
};

// The rating modal now NEVER opens on its own just because a completed,
// unrated booking exists in the list — only a tapped rating notification
// (pendingRatingBookingId, set from the params effect above) can open it,
// and only for the exact booking that notification named. This effect gets
// exactly one shot per pending id: whether or not a match is found (and
// whether or not it's still eligible), it clears pendingRatingBookingId so
// it can never reopen the modal again for the same tap — useMySchoolRows
// (new-style school trips, a separate schoolBookings collection this
// component has no visibility into) gets the same id as a parameter and
// runs the same one-shot search independently; only one of the two will
// ever actually find it.
useEffect(() => {
  if (!pendingRatingBookingId) return;
  if (tab !== "passenger") return;
  // Wait for this screen's own Firestore subscriptions to resolve at least
  // once — giving up while still loading would wrongly treat a booking that
  // just hasn't arrived yet as "not found here, must be useMySchoolRows".
  if (loading) return;
  if (ratingBooking || schoolRatingBooking || appRatingBooking || roadsideRatingBooking) {
    return;
  }

  const targetId = pendingRatingBookingId;

  const ride = passengerRides.find((r) => r.id === targetId);
  if (ride) {
    if (bookingNeedsRating(ride)) openRatingModal(ride);
    setPendingRatingBookingId(null);
    return;
  }

  const roadsideBooking = bookings.find((b) => b.id === targetId && b.category === "roadside");
  if (roadsideBooking) {
    if (bookingNeedsRating(roadsideBooking)) openRoadsideRatingModal(roadsideBooking);
    setPendingRatingBookingId(null);
    return;
  }

  const legacyBooking = bookings.find((b) => b.id === targetId && b.category !== "roadside");
  if (legacyBooking) {
    if (bookingNeedsRating(legacyBooking)) openSchoolRatingModal(legacyBooking);
    setPendingRatingBookingId(null);
    return;
  }

  const app = passengerApps.find((a) => a.id === targetId);
  if (app) {
    if (bookingNeedsRating(app)) openAppRatingModal(app);
    setPendingRatingBookingId(null);
    return;
  }

  // Not one of this screen's own bookings — leave pendingRatingBookingId set
  // so it's still passed to useMySchoolRows; it clears it via
  // onConsumePendingRating once it has had its own shot.
}, [
  pendingRatingBookingId,
  tab,
  loading,
  bookings,
  passengerRides,
  passengerApps,
  ratingBooking,
  schoolRatingBooking,
  appRatingBooking,
  roadsideRatingBooking,
]);


  const renderDeleteButton = (onPress: () => void) => (
    <Pressable style={styles.deleteButton} onPress={onPress} hitSlop={8}>
      <Ionicons name="trash-outline" size={18} color="#B91C1C" />
    </Pressable>
  );

  // Driver no-show violation card (see driverNoShowLib.ts — a completely
  // separate system from the driver cancellation-violation warnings
  // elsewhere in this file). Mirrors renderRideCard's shell (styles.card /
  // accentBorderStart / styles.catChip / styles.infoRow / styles.metaRow)
  // for visual consistency with every other card in this screen.
  const renderViolationCard = (v: DriverViolation) => {
    const statusMeta: Record<string, { key: string; color: string }> = {
      open: { key: "driverNoShow.statusViolationRecorded", color: "#B0413E" },
      appeal_pending: { key: "driverNoShow.statusAppealUnderReview", color: "#B8860B" },
      appeal_approved: { key: "driverNoShow.statusAppealApprovedRemoved", color: "#2E7D32" },
      appeal_rejected: { key: "driverNoShow.statusAppealRejectedActive", color: "#B0413E" },
    };
    const meta = statusMeta[v.status] || statusMeta.open;
    const canAppeal = canSubmitAppeal({ appealId: v.appealId, active: v.active });

    return (
      <View key={`violation-${v.id}`} style={[styles.card, accentBorderStart(4, meta.color, isRTL)]}>
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}>
            <Ionicons name="warning-outline" size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>{t("driverNoShow.driverNoShow")}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{t(meta.key)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="pricetag-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{translateCategoryLabel(v.category, v.category, t)}</Text>
        </View>

        {renderRouteLine(v.routeFrom, v.routeTo, "")}

        <View style={styles.infoRow}>
          <Ionicons name="people-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>
            {t("driverNoShow.affectedPassengers", { count: v.passengerCount })}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="card-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{t(`driverNoShow.refundStatus.${v.refundStatus}`)}</Text>
        </View>

        {v.resolutionNote ? (
          <View style={styles.infoRow}>
            <Ionicons name="chatbox-ellipses-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{t("driverNoShow.adminDecisionNote", { note: v.resolutionNote })}</Text>
          </View>
        ) : null}

        {canAppeal ? (
          <Pressable
            style={styles.violationAppealButton}
            onPress={() => setAppealModalViolation({ id: v.id, tripId: v.tripId, violationSource: "driverViolations" })}
          >
            <Text style={styles.violationAppealButtonText}>{t("driverNoShow.submitAppeal")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  // Driver-cancellation violation card (see driverViolationCore.ts — a
  // completely separate WRITE path from the no-show card above, merged into
  // the same on-screen list — see mergedViolationRows). No Appeal button
  // here: unlike a no-show, the driver themselves chose to cancel, so
  // there's no factual dispute to appeal — only an admin can excuse it
  // (already handled on the admin driver-detail screen, not here).
  const renderCancellationViolationCard = (v: DriverCancellationViolation) => {
    // Same 4-state status pill as renderViolationCard (no-show) above —
    // reuses the EXACT SAME i18n keys for the 3 appeal states, so a driver
    // sees identical wording regardless of which violation system this
    // card is about. Only the "open" (never appealed) state has its own
    // cancellation-specific wording, since "Missed Trip Recorded" wouldn't
    // make sense for a cancellation.
    const statusMeta: Record<string, { key: string; color: string }> = {
      open: { key: "driverNoShow.statusCancellationActive", color: "#B0413E" },
      appeal_pending: { key: "driverNoShow.statusAppealUnderReview", color: "#B8860B" },
      appeal_approved: { key: "driverNoShow.statusAppealApprovedRemoved", color: "#2E7D32" },
      appeal_rejected: { key: "driverNoShow.statusAppealRejectedActive", color: "#B0413E" },
    };
    // A directly-excused (non-appeal) violation never reaches appeal_approved
    // — adminExcused can be set true from status "open" too (see the admin
    // Excuse button, independent of the appeal flow) — so that still needs
    // its own excused wording rather than falling through to "open"'s.
    const meta =
      !v.active && v.status === "open"
        ? { key: "driverNoShow.statusCancellationExcused", color: "#2E7D32" }
        : statusMeta[v.status] || statusMeta.open;
    const canAppeal = canSubmitAppeal({ appealId: v.appealId, active: v.active });

    return (
      <View key={`cancellation-violation-${v.id}`} style={[styles.card, accentBorderStart(4, meta.color, isRTL)]}>
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}>
            <Ionicons name="close-circle-outline" size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>{t("driverNoShow.driverCancellation")}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{t(meta.key)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="pricetag-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{translateCategoryLabel(v.sourceCategory, v.sourceCategory, t)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="people-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>
            {t("driverNoShow.affectedPassengers", { count: v.passengerBookingCount })}
          </Text>
        </View>

        {v.lateCancellation ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{t("admin.lateCancellationBadge")}</Text>
          </View>
        ) : null}

        {canAppeal ? (
          <Pressable
            style={styles.violationAppealButton}
            onPress={() =>
              setAppealModalViolation({ id: v.id, tripId: v.tripId, violationSource: "cancellationViolations" })
            }
          >
            <Text style={styles.violationAppealButtonText}>{t("driverNoShow.submitAppeal")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderPassengerDriverDetails = (r: RideBooking) => {
    const hasCarDetails =
      !!r.driverCar || !!r.driverCarColor || !!r.driverCarPlateLast3;
    const hasPhone = !!r.driverPhone;

    if (!hasCarDetails && !hasPhone) return null;

    return (
      <View style={styles.driverDetailsBox}>
        <Text style={styles.driverDetailsTitle}>{t("booking.driverDetailsTitle")}</Text>

        {r.driverCar ? (
          <View style={styles.infoRow}>
            <Ionicons name="car-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{t("rides.carLabel", { car: r.driverCar })}</Text>
          </View>
        ) : null}

        {r.driverCarColor ? (
          <View style={styles.infoRow}>
            <Ionicons name="color-palette-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{t("rides.colorLabel", { color: r.driverCarColor })}</Text>
          </View>
        ) : null}

        {r.driverCarPlateLast3 ? (
          <View style={styles.infoRow}>
            <Ionicons name="barcode-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {t("rides.plateLabel", { last3: r.driverCarPlateLast3 })}
            </Text>
          </View>
        ) : null}

        {hasPhone ? (
          <Pressable
            style={styles.phoneRow}
            onPress={() => callPhone(r.driverPhone)}
          >
            <Ionicons name="call-outline" size={15} color="#F58220" />
            <Text style={[styles.phoneText, ltrContentStyle]}>
              {formatPhoneForDisplay(r.driverPhone)}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderRideStatus = (status: RideStatus, label?: string) => {
    const done = status === "completed";
    const dead = status === "cancelled";
    const pillStyle = done
      ? styles.statusDone
      : dead
        ? styles.statusDead
        : styles.statusOngoing;
    const textStyle = done
      ? styles.statusTextDone
      : dead
        ? styles.statusTextDead
        : styles.statusTextOngoing;

    return (
      <View style={[styles.statusPill, pillStyle]}>
        <Text style={[styles.statusText, textStyle]}>
          {label || translateStatus(t, "rides", status) || RIDE_STATUS_LABEL[status]}
        </Text>
      </View>
    );
  };

  const renderRideCard = (r: RideBooking, viewer: Tab) => {
    const meta = getCategoryMeta(RIDE_CATEGORY);
    const otherName = viewer === "passenger" ? r.driverName : r.passengerName;
    const busy = busyId === r.id;
    const rideCanStart = canStartTrip(r);
    const rideBlockedReason = getStartTripBlockedReason(r);
    const rideCancelBlocked =
      r.status === "booked" ? getRideCancelBlockedReason(r, viewer) : null;
    // Driver-only — the passenger's own selected pickup point (never their
    // live location or profile home address — only the ONE point they
    // intentionally picked for THIS request), shown before Start/Cancel so
    // the driver can judge whether the passenger is close enough to pick up
    // before acting on the request. Safe on old bookings made before this
    // field existed (pickupLocation is null) — see this feature's own
    // "Pickup location not provided" fallback below.
    const pickupDistanceKm =
      viewer === "driver"
        ? computeApproxDistanceKm(r.pickupLocation, { latitude: r.driverFromLat, longitude: r.driverFromLng })
        : null;

    return (
      <View
        key={`ride-${r.id}`}
        style={[
          styles.card,
          accentBorderStart(4, meta.color, isRTL),
          r.status === "completed" && styles.cardDone,
        ]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {translateCategoryLabel(RIDE_CATEGORY, meta.label, t)}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {renderRideStatus(
              r.status,
              // Driver-only — RideStatus itself has no "in_progress" value
              // (see updateTripStatus in ride-navigation.tsx), so the badge
              // must be overridden here once the trip has actually started;
              // Passenger's own rendering is completely untouched. Driver
              // no-show (see driverNoShowLib.ts) is the passenger-facing
              // exception to that: r.status never gets written to
              // "cancelled" for a no-show (only tripStatus is set), so the
              // badge needs the same clear-reason override the generic
              // booking card gets from getBookingTripLabel.
              viewer === "driver" && r.tripStatus === "in_progress"
                ? t("rides.tripInProgress")
                : String(r.tripStatus) === "driver_no_show"
                  ? t("driverNoShow.passengerCancelledReason")
                  : undefined,
            )}
            {r.status === "completed"
              ? renderDeleteButton(() => confirmHideRideBooking(r, viewer))
              : null}
          </View>
        </View>

        {renderRouteLine(r.from, r.to, "")}

        {r.schoolName ? (
          <View style={styles.infoRow}>
            <Ionicons name="school-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{r.schoolName}</Text>
          </View>
        ) : null}

        {r.destinationDetails ? (
          <View style={styles.infoRow}>
            <Ionicons name="flag-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{r.destinationDetails}</Text>
          </View>
        ) : null}

        {r.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {r.date}
              {r.day ? ` (${r.day})` : ""}
            </Text>
          </View>
        ) : null}

        {r.time ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{r.time}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{otherName}</Text>
        </View>

        {viewer === "passenger" ? renderPassengerDriverDetails(r) : null}

        <View style={styles.metaRow}>
          {typeof r.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{r.price} ₪</Text>
            </View>
          ) : null}

          {typeof r.seats === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{t("booking.seatsCount", { count: r.seats })}</Text>
            </View>
          ) : null}
        </View>

        {r.paymentMethod ? (
          <View style={styles.payRow}>
            <Ionicons name="card-outline" size={14} color="#7C5F46" />
            <Text style={styles.payText}>
              {paymentMethodLabel(r.paymentMethod, t)}
              {r.cardLast4 ? ` (•••• ${r.cardLast4})` : ""}
            </Text>
          </View>
        ) : null}

        {r.status === "completed" && typeof r.rating === "number" ? (
          <View style={styles.ratingSummaryRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={i}
                name={i < (r.rating || 0) ? "star" : "star-outline"}
                size={16}
                color="#F58220"
              />
            ))}

            {r.reviewComment ? (
              <Text style={[styles.ratingComment, marginEnd(6, isRTL)]}>“{r.reviewComment}”</Text>
            ) : null}
          </View>
        ) : null}

          {viewer === "passenger" ? (
            <>
              {/* Personal Ride never shows Live Tracking — renderRideCard is
                  exclusively the personal ride pipeline (RIDE_CATEGORY). */}

              {r.status === "booked" ? (
                <>
                  <Pressable
                    style={[
                      styles.cancelBookingButton,
                      (!!rideCancelBlocked || busy) && styles.cancelBookingButtonDisabled,
                    ]}
                    onPress={() => handleCancelRideBooking(r, viewer)}
                    disabled={!!rideCancelBlocked || busy}
                  >
                    <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
                    <Text style={styles.cancelBookingButtonText}>
                      {t("booking.cancelBookingTitle")}
                    </Text>
                  </Pressable>

                  {rideCancelBlocked ? (
                    <Text style={styles.appHint}>{rideCancelBlocked}</Text>
                  ) : null}
                </>
              ) : null}

              {r.status === "completed" && bookingNeedsRating(r) ? (
                <>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={() => openRatingModal(r)}
                  >
                    <Ionicons name="star-outline" size={17} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>{t("passenger.rateDriver")}</Text>
                  </Pressable>

                  <Text style={styles.rateDriverHint}>{t("booking.rateToBookAgainHint")}</Text>
                </>
              ) : null}

            {r.status === "completed" &&
            !bookingNeedsRating(r) &&
            typeof r.rating === "number" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openRideRebook(r)}
              >
                <Ionicons name="refresh" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>{t("booking.bookAgainTitle")}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            {r.status === "booked" ? (
              <View style={styles.pickupInfoBox}>
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={15} color="#7C5F46" />
                  <Text style={styles.infoText}>
                    {t("booking.passengerAreaLabel", {
                      area: r.pickupLocation?.area || r.pickupLocation?.address || t("booking.pickupLocationNotProvided"),
                    })}
                  </Text>
                </View>

                {r.pickupLocation?.address ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="pin-outline" size={15} color="#7C5F46" />
                    <Text style={styles.infoText}>{r.pickupLocation.address}</Text>
                  </View>
                ) : null}

                {pickupDistanceKm !== null ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="navigate-outline" size={15} color="#7C5F46" />
                    <Text style={styles.infoText}>
                      {t("booking.approxDistanceFromRoute", { distance: pickupDistanceKm })}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {r.status === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.startButton,
                    !rideCanStart && styles.startDisabled,
                  ]}
                  onPress={() => handleRideStart(r)}
                  disabled={busy || !rideCanStart}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>{t("booking.startDrivingToPickup")}</Text>
                </Pressable>

                {!rideCanStart && rideBlockedReason ? (
                  <Text style={styles.appHint}>{rideBlockedReason}</Text>
                ) : null}

                <Pressable
                  style={[
                    styles.cancelBookingButton,
                    (!!rideCancelBlocked || busy) && styles.cancelBookingButtonDisabled,
                  ]}
                  onPress={() => handleCancelRideBooking(r, viewer)}
                  disabled={!!rideCancelBlocked || busy}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
                  <Text style={styles.cancelBookingButtonText}>
                    {t("schoolTrip.cancelTripButton")}
                  </Text>
                </Pressable>

                {rideCancelBlocked ? (
                  <Text style={styles.appHint}>{rideCancelBlocked}</Text>
                ) : null}
              </>
            ) : null}

            {r.status === "on_the_way" ? (
              <View style={styles.appActionsRow}>
                <Pressable
                  style={[styles.completeButton, styles.completeButtonFlex]}
                  onPress={() => handleRideOpenMap(r)}
                >
                  <Ionicons name="navigate-outline" size={16} color="#166534" />
                  <Text style={styles.completeButtonText}>{t("booking.openMapButton")}</Text>
                </Pressable>

                <Pressable
                  style={styles.startButton}
                  onPress={() => handleRideArrived(r)}
                  disabled={busy}
                >
                  <Text style={styles.startButtonText}>{t("booking.iArrivedButton")}</Text>
                </Pressable>
              </View>
            ) : null}

            {r.status === "arrived" && r.tripStatus !== "in_progress" ? (
              <Pressable
                style={styles.startButton}
                onPress={() => handleRideStartTrip(r)}
                disabled={busy}
              >
                <Ionicons name="play" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>{t("booking.startTripButton")}</Text>
              </Pressable>
            ) : null}

            {r.status === "arrived" && r.tripStatus === "in_progress" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => handleRideFinish(r)}
                disabled={busy}
              >
                <Ionicons name="checkmark-done" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>{t("booking.finishTripButton")}</Text>
              </Pressable>
            ) : null}

            {r.status === "completed" ? (
              <Pressable
                style={[styles.republishButton, republishSubmitting && styles.republishButtonDisabled]}
                onPress={() => openRepublishRideDriverTrip(r)}
                disabled={republishSubmitting}
              >
                <Ionicons name="refresh" size={16} color="#F58220" />
                <Text style={styles.republishButtonText}>{t("booking.republishTripButton")}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const renderStatus = (status: string, label?: string) => {
    // Mirrors renderBookingTripStatus's exact "dead" (red) treatment for a
    // cancelled row, so a cancelled trip listing reads identically to a
    // cancelled booking/application anywhere else in this screen.
    const cancelled = status === "cancelled";
    const done = !cancelled && status === "completed";

    return (
      <View
        style={[
          styles.statusPill,
          cancelled ? styles.statusDead : done ? styles.statusDone : styles.statusOngoing,
        ]}
      >
        <Ionicons
          name={cancelled ? "close-circle" : done ? "checkmark-circle" : "time"}
          size={13}
          color={cancelled ? "#B91C1C" : done ? "#166534" : "#B86115"}
        />
        <Text
          style={[
            styles.statusText,
            cancelled ? styles.statusTextDead : done ? styles.statusTextDone : styles.statusTextOngoing,
          ]}
        >
          {label ||
            (cancelled
              ? t("bookings.status.cancelled")
              : done
                ? t("common.completed")
                : t("booking.statusOngoing"))}
        </Text>
      </View>
    );
  };

  const renderRouteLine = (from: string, to: string, place: string) => {
    if (from || to) {
      return (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>
            {from || "?"} → {to || "?"}
          </Text>
        </View>
      );
    }

    if (place) {
      return (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{place}</Text>
        </View>
      );
    }

    return null;
  };

  const renderBookingCard = (b: BookingItem, viewer: Tab = "passenger") => {
    const meta = getCategoryMeta(b.category);
    const busy = busyId === b.id;
    const tripStatus = (b as any).tripStatus;
    // Driver no-show reads as "cancelled" for styling purposes too (card
    // grey-out) — this card only ever renders a no-show row for the
    // PASSENGER viewer; the driver's own no-show rows are excluded from
    // every generic bucket entirely (see getDriverTripBucket).
    const cancelled = b.status === "cancelled" || tripStatus === "driver_no_show";
    const done = !cancelled && (b.status === "completed" || tripStatus === "completed");
    const finished = done || cancelled;
    const isSchool = b.category === "school";
    const isPersonalCategory = b.category === "personal";
    // School and (weekly) personal bookings both drive through the ride
    // navigation screen for their Start Ride -> Finish Trip lifecycle.
    const usesRideNavigation = isSchool || isPersonalCategory;
    const isDriverView = viewer === "driver";
    const bookingCanStart = canStartTrip(b);
    const bookingBlockedReason = getStartTripBlockedReason(b);
    const bookingCancelBlocked =
      !finished && tripStatus === "booked"
        ? getGeneralBookingCancelBlockedReason(b, viewer)
        : null;

    return (
      <View
        key={b.id}
        style={[styles.card, accentBorderStart(4, meta.color, isRTL), finished && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {translateCategoryLabel(b.category, meta.label, t)}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {renderBookingTripStatus(b)}
            {finished
              ? renderDeleteButton(() => confirmHideGeneralBooking(b, viewer))
              : null}
          </View>
        </View>

        {renderRouteLine(b.from, b.to, "")}

        {b.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{b.date}</Text>
          </View>
        ) : null}

        {b.time ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{b.time}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>
            {isDriverView ? b.passengerName : b.driverName}
          </Text>
        </View>

        <View style={styles.metaRow}>
          {typeof b.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{b.price} ₪</Text>
            </View>
          ) : null}

          {typeof b.seats === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{t("booking.seatsCount", { count: b.seats })}</Text>
            </View>
          ) : null}
        </View>

        {viewer === "passenger" ? (
          <>
            {tripStatus === "arrived_pickup" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="car-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  {t("booking.driverArrivedGoToCar")}
                </Text>
              </View>
            ) : null}

            {canShowLiveTracking(b) ? (
              <Pressable
                style={styles.liveTrackButton}
                onPress={() => openLiveTracking(b.id)}
              >
                <Ionicons name="map-outline" size={17} color="#FFFFFF" />
                <Text style={styles.liveTrackButtonText}>{t("rides.liveTracking")}</Text>
              </Pressable>
            ) : null}

            {done && bookingNeedsRating(b) ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openSchoolRatingModal(b)}
              >
                <Ionicons name="star-outline" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>{t("passenger.rateDriver")}</Text>
              </Pressable>
            ) : null}

            {done && !bookingNeedsRating(b) ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openRebook(b)}
              >
                <Ionicons name="refresh" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>{t("booking.bookAgainTitle")}</Text>
              </Pressable>
            ) : null}

            {!finished && tripStatus === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.cancelBookingButton,
                    (!!bookingCancelBlocked || busy) && styles.cancelBookingButtonDisabled,
                  ]}
                  onPress={() => handleCancelGeneralBooking(b, viewer)}
                  disabled={!!bookingCancelBlocked || busy}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
                  <Text style={styles.cancelBookingButtonText}>
                    {t("booking.cancelBookingTitle")}
                  </Text>
                </Pressable>

                {bookingCancelBlocked ? (
                  <Text style={styles.appHint}>{bookingCancelBlocked}</Text>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            {usesRideNavigation && tripStatus === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.startButton,
                    !bookingCanStart && styles.startDisabled,
                  ]}
                  onPress={() => {
                    if (!canStartTrip(b)) {
                      Alert.alert(
                        t("booking.notAvailableYetTitle"),
                        getStartTripBlockedReason(b) ||
                          t("booking.startTripOnlyOnTripDate"),
                      );
                      return;
                    }

                    openSchoolRideNavigation(b.id);
                  }}
                  disabled={!bookingCanStart}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>{t("booking.startRideButton")}</Text>
                </Pressable>

                {!bookingCanStart && bookingBlockedReason ? (
                  <Text style={styles.appHint}>{bookingBlockedReason}</Text>
                ) : null}
              </>
            ) : null}

            {usesRideNavigation &&
            (tripStatus === "driver_on_way" ||
              tripStatus === "arrived_pickup" ||
              tripStatus === "in_progress") ? (
              <Pressable
                style={styles.startButton}
                onPress={() => openSchoolRideNavigation(b.id)}
              >
                <Ionicons name="navigate-outline" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>{t("booking.openRideNavigationButton")}</Text>
              </Pressable>
            ) : null}

            {!finished && tripStatus === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.cancelBookingButton,
                    (!!bookingCancelBlocked || busy) && styles.cancelBookingButtonDisabled,
                  ]}
                  onPress={() => handleCancelGeneralBooking(b, viewer)}
                  disabled={!!bookingCancelBlocked || busy}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
                  <Text style={styles.cancelBookingButtonText}>
                    {t("schoolTrip.cancelTripButton")}
                  </Text>
                </Pressable>

                {bookingCancelBlocked ? (
                  <Text style={styles.appHint}>{bookingCancelBlocked}</Text>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const renderTripCard = (trip: TaggedTrip) => {
    const meta = getCategoryMeta(trip.category);
    const busy = busyId === trip.id;
    const done = trip.status === "completed";
    const cancelled = trip.status === "cancelled";
    const finished = done || cancelled;
    const daysText = trip.days.length > 0 ? trip.days.join(", ") : "";
    const waitingForBooking = trip.waitingForBooking;
    // Same distinction getDriverTripStatus uses for the Unbooked Trips
    // bucket — future zero-booking trips read "Waiting for booking", past
    // ones read "Expired — No bookings", never the same text once the
    // departure time has passed.
    const isExpiredUnbooked = waitingForBooking && getDriverTripStatus(trip) === "expiredNoBookings";
    // Every trip's own date/time (never a value shared across cards) — the
    // exact 5-hour driver window every other category already uses, so a
    // trip less than 5 hours from departure never disables any OTHER
    // trip's button.
    const cancelBlockedReason = !finished
      ? getTimeBasedCancelBlockedReason(trip, DRIVER_CANCEL_LOCK_HOURS)
      : null;

    return (
      <View
        key={`${trip.collectionName}-${trip.id}-${trip.date}`}
        style={[styles.card, accentBorderStart(4, meta.color, isRTL), finished && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {translateCategoryLabel(trip.category, meta.label, t)}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {renderStatus(
              trip.status,
              waitingForBooking
                ? isExpiredUnbooked
                  ? t("booking.expiredNoBookingsLabel")
                  : t("booking.waitingForBookingLabel")
                : undefined,
            )}
            {finished ? renderDeleteButton(() => confirmDeleteTrip(trip)) : null}
          </View>
        </View>

        {trip.title ? <Text style={styles.tripTitle}>{trip.title}</Text> : null}

        {renderRouteLine(trip.from, trip.to, trip.location)}

        {trip.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{trip.date}</Text>
          </View>
        ) : null}

        {daysText ? (
          <View style={styles.infoRow}>
            <Ionicons name="repeat-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{daysText}</Text>
          </View>
        ) : null}

        {trip.time ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{trip.time}</Text>
          </View>
        ) : null}

        <View style={styles.metaRow}>
          {typeof trip.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{trip.price} ₪</Text>
            </View>
          ) : null}

          {trip.collectionName === "workJobs" ? (
            <>
              {typeof trip.totalSeats === "number" ? (
                <View style={styles.metaItem}>
                  <Ionicons name="people-outline" size={15} color="#F58220" />
                  <Text style={styles.metaText}>
                    {t("workErrand.workersNeededCount", { count: trip.totalSeats })}
                  </Text>
                </View>
              ) : null}

              {typeof trip.acceptedWorkersCount === "number" &&
              trip.acceptedWorkersCount > 0 ? (
                <View style={styles.metaItem}>
                  <Ionicons name="person-add-outline" size={15} color="#F58220" />
                  <Text style={styles.metaText}>
                    {t("booking.acceptedColon", { count: trip.acceptedWorkersCount })}
                  </Text>
                </View>
              ) : null}

              {typeof trip.remainingSeats === "number" ? (
                <View style={styles.metaItem}>
                  <Ionicons
                    name="checkmark-done-outline"
                    size={15}
                    color="#F58220"
                  />
                  <Text style={styles.metaText}>
                    {t("workErrand.placesRemainingCount", { count: trip.remainingSeats })}
                  </Text>
                </View>
              ) : null}
            </>
          ) : typeof trip.seats === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{trip.seats}</Text>
            </View>
          ) : null}
        </View>

{done ? (
  <Pressable
    style={[styles.republishButton, republishSubmitting && styles.republishButtonDisabled]}
    onPress={() => openRepublishDriverTrip(trip)}
    disabled={republishSubmitting}
  >
    <Ionicons name="refresh" size={16} color="#F58220" />
    <Text style={styles.republishButtonText}>{t("booking.republishTripButton")}</Text>
  </Pressable>
) : null}

{!finished &&
!waitingForBooking &&
!(trip.collectionName === "driverRoutes" && trip.category === "school") ? (
  <Pressable
    style={styles.completeButton}
    onPress={() => confirmComplete(trip.collectionName, trip.id, t("booking.tripWord"))}
  >
    <Ionicons name="checkmark-done" size={17} color="#166534" />
    <Text style={styles.completeButtonText}>{t("booking.markAsCompletedTitle")}</Text>
  </Pressable>
) : null}

{/* "Cancel Trip" — same wording and the same 5-hour (DRIVER_CANCEL_LOCK_HOURS)
    window as every other driver-cancel button in this file
    (renderRideCard/renderBookingCard's driver view), computed fresh from
    THIS trip's own date/time above — never shared with or disabled by any
    other card. Always shown for a not-yet-completed trip regardless of
    booking count (never "Delete Trip" wording); only whether it ALSO
    records a driver cancellation violation depends on activeBookingCount
    (see cancelDriverTrip above) — a zero-booking listing never does.
    Same large full-width bordered button for every category (Personal Ride,
    School, Work/Errand) — matches the driver's own "cancel my listing"
    button in useMySchoolRows.tsx's renderTripCard (cancelBookingBoxButton),
    so a Personal Ride and a School listing look identical here too. */}
{!finished ? (
  <>
    <Pressable
      style={[
        styles.cancelBookingButton,
        (!!cancelBlockedReason || busy) && styles.cancelBookingButtonDisabled,
      ]}
      onPress={() => confirmCancelDriverTrip(trip)}
      disabled={!!cancelBlockedReason || busy}
    >
      <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
      <Text style={styles.cancelBookingButtonText}>{t("schoolTrip.cancelTripButton")}</Text>
    </Pressable>

    {cancelBlockedReason ? (
      <Text style={styles.appHint}>{cancelBlockedReason}</Text>
    ) : null}
  </>
) : null}
      </View>
    );
  };

  const goToLiveTracking = (b: BookingItem) => {
    router.push({ pathname: "/booking/live-tracking", params: { id: b.id } } as any);
  };

  const openReportProblemModal = (b: BookingItem) => {
    setReportDescription("");
    setReportBooking(b);
  };

  const submitProblemReport = async () => {
    if (!reportBooking || !reportDescription.trim() || submittingReport) return;

    try {
      setSubmittingReport(true);
      await createReport({
        category: "booking",
        targetType: "booking",
        targetId: reportBooking.id,
        description: reportDescription.trim(),
      });
      setReportBooking(null);
      setReportDescription("");
      Alert.alert(t("profile.reportSentTitle"), t("profile.reportSent"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("profile.couldNotSendReport"));
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleConfirmCompletion = (b: BookingItem) => {
    Alert.alert(
      t("roadsideHelp.confirmCompletionTitle"),
      t("roadsideHelp.confirmCompletionConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          onPress: () =>
            runApp(b.id, () => confirmCompletion(b.id), (error: any) => error?.message || t("roadsideHelp.couldNotConfirmCompletion")),
        },
      ],
    );
  };

  const handlePayWithBit = (b: BookingItem) => {
    openBitPayment(b.driverPhone || "", b.price ?? null);
  };

  const renderRoadsideCard = (b: BookingItem, viewer: Tab) => {
    const meta = getCategoryMeta("roadside");
    const otherName = viewer === "passenger" ? b.driverName : b.passengerName;
    const otherPhone = viewer === "passenger" ? b.driverPhone : b.passengerPhone;
    const isDriverView = viewer === "driver";

    const isCancelled = b.status === "cancelled";
    const isAccepted = b.status !== "completed" && !b.helpCompleted && !isCancelled;
    const isCompletionPendingStage = b.tripStatus === "completion_pending";
    const isCompletedStage = b.status === "completed" || b.helpCompleted;
    const isPaid = b.paymentStatus === "paid";
    const isBitMethod = b.paymentMethod === "bit";

    // Live Tracking is shown from the moment an offer is accepted through
    // the helper's whole visit — disabled (spec #1) until they press Start
    // Driving, and hidden again once the request is cancelled/fully done.
    const showLiveTracking = !isCancelled && !isCompletedStage;
    const liveTrackingReady =
      b.tripStatus === "driver_on_way" ||
      b.tripStatus === "arrived_pickup" ||
      b.tripStatus === "in_progress";

    // Passenger cancellation: allowed ONLY while tripStatus is still
    // "booked" (open/helper_assigned — before the helper presses Start
    // Driving). Once it advances (driver_on_way/arrived_pickup/in_progress/
    // completion_pending/completed), the button is removed from the card
    // entirely — no disabled state, no "can no longer be cancelled" text
    // (see cancelRoadsideRequestByPassenger + firestore.rules, which
    // enforce this exact same cutoff server-side). Driver-view keeps its
    // existing (unrestricted) cancel behavior, unchanged.
    const canCancelRoadsideAsPassenger =
      !isDriverView && isAccepted && b.tripStatus === "booked";

    const driverRoadsideCancelBlocked =
      isDriverView && isAccepted ? getGeneralBookingCancelBlockedReason(b, viewer) : null;

    const stageBadge = isPaid
      ? { label: t("roadsideHelp.badgeCompleted"), style: styles.statusDone, textStyle: styles.statusTextDone, icon: "cash" as const }
      : isCancelled
        ? { label: t("roadsideHelp.badgeCancelled"), style: styles.statusDead, textStyle: styles.statusTextDead, icon: "close-circle" as const }
        : isCompletedStage
          ? { label: t("roadsideHelp.badgeCompleted"), style: styles.statusDone, textStyle: styles.statusTextDone, icon: "checkmark-done" as const }
          : isCompletionPendingStage
            ? { label: t("roadsideHelp.badgeAwaitingConfirmation"), style: styles.statusOngoing, textStyle: styles.statusTextOngoing, icon: "time" as const }
            : b.tripStatus === "in_progress"
              ? { label: t("roadsideHelp.badgeInProgress"), style: styles.statusOngoing, textStyle: styles.statusTextOngoing, icon: "construct" as const }
              : b.tripStatus === "arrived_pickup"
                ? { label: t("roadsideHelp.badgeArrived"), style: styles.statusOngoing, textStyle: styles.statusTextOngoing, icon: "flag" as const }
                : b.tripStatus === "driver_on_way"
                  ? { label: t("roadsideHelp.badgeOnTheWay"), style: styles.statusOngoing, textStyle: styles.statusTextOngoing, icon: "navigate" as const }
                  : { label: t("roadsideHelp.badgeAccepted"), style: styles.statusOngoing, textStyle: styles.statusTextOngoing, icon: "checkmark-circle" as const };

    return (
      <View
        key={`roadside-${b.id}`}
        style={[styles.card, accentBorderStart(4, meta.color, isRTL), !isAccepted && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {t("rideCategory.categories.help.title")}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            <View style={[styles.statusPill, stageBadge.style]}>
              <Ionicons name={stageBadge.icon} size={13} color={stageBadge.textStyle === styles.statusTextDone ? "#166534" : stageBadge.textStyle === styles.statusTextDead ? "#B91C1C" : "#B86115"} />
              <Text style={[styles.statusText, stageBadge.textStyle]}>{stageBadge.label}</Text>
            </View>
            {!isAccepted
              ? renderDeleteButton(() =>
                  confirmHideGeneralBooking(b, viewer, t("booking.roadsideHelpLowercase")),
                )
              : null}
          </View>
        </View>

        {b.problemTypes.length > 0 ? (
          <View style={styles.chipRow}>
            {b.problemTypes.map((p) => (
              <View key={p} style={styles.problemChip}>
                <Text style={styles.problemChipText}>{translateProblemType(p, t)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {b.description ? (
          <Text style={styles.description}>{b.description}</Text>
        ) : null}

        {b.address ? (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{b.address}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{otherName}</Text>
        </View>

        {otherPhone ? (
          <Pressable style={styles.infoRow} onPress={() => callPhone(otherPhone)}>
            <Ionicons name="call-outline" size={15} color="#F58220" />
            <Text style={styles.infoText}>{otherPhone}</Text>
          </Pressable>
        ) : null}

        <View style={styles.metaRow}>
          {typeof b.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{b.price} ₪</Text>
            </View>
          ) : null}

          {typeof b.etaMinutes === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{t("booking.minutesShort", { count: b.etaMinutes })}</Text>
            </View>
          ) : null}

          {!isDriverView && b.paymentMethod ? (
            <View style={styles.metaItem}>
              <Ionicons
                name={isBitMethod ? "phone-portrait-outline" : "cash-outline"}
                size={15}
                color="#7C5F46"
              />
              <Text style={styles.metaTextMuted}>
                {isBitMethod ? t("roadsideHelp.payWithBit") : t("common.cash")}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Live Tracking — see requirement #1: disabled + explanatory
            message until the helper presses Start Driving. */}
        {!isDriverView && showLiveTracking ? (
          <>
            <Pressable
              style={[styles.startButton, !liveTrackingReady && styles.startDisabled]}
              onPress={() => goToLiveTracking(b)}
              disabled={!liveTrackingReady}
            >
              <Ionicons name="navigate-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.startButtonText}>{t("roadsideHelp.liveTrackingButton")}</Text>
            </Pressable>

            {!liveTrackingReady ? (
              <Text style={styles.appHint}>{t("roadsideHelp.waitingForHelperToStartDriving")}</Text>
            ) : b.tripStatus === "arrived_pickup" ? (
              <Text style={styles.appHint}>{t("roadsideHelp.helperArrivedHint")}</Text>
            ) : b.tripStatus === "in_progress" ? (
              <Text style={styles.appHint}>{t("roadsideHelp.helpInProgressHint")}</Text>
            ) : null}
          </>
        ) : null}

        {/* Completion_pending — ONLY the customer ever sees these two
            buttons (spec #2/#3): confirm the problem is resolved, or flag
            an issue instead via the existing Reports flow. Stacked
            vertically (never side-by-side) as two full-width, same-height
            buttons — Report a Problem on top, Confirm Completion (green)
            underneath. */}
        {!isDriverView && isCompletionPendingStage ? (
          <View style={styles.completionActionsColumn}>
            <Pressable
              style={styles.reportProblemButtonFull}
              onPress={() => openReportProblemModal(b)}
            >
              <Text style={styles.reportProblemButtonText}>{t("roadsideHelp.reportProblemButton")}</Text>
            </Pressable>

            <Pressable
              style={[styles.primaryButtonFull, styles.completionConfirmButton]}
              onPress={() => handleConfirmCompletion(b)}
            >
              <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{t("roadsideHelp.confirmCompletionButton")}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Payment — cash is settled directly between the two people (only
            the accepted helper's own Confirm Cash Received ever marks it
            paid, see RoadsideAcceptedCard.tsx); Bit only ever opens the Bit
            app (see bitPayment.ts) and NEVER marks itself paid here. */}
        {!isDriverView && isCompletedStage && !isPaid ? (
          isBitMethod ? (
            <Pressable style={styles.primaryButtonFull} onPress={() => handlePayWithBit(b)}>
              <Ionicons name="phone-portrait-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{t("roadsideHelp.payWithBit")}</Text>
            </Pressable>
          ) : (
            <View style={styles.payRow}>
              <Ionicons name="cash-outline" size={16} color="#7C5F46" />
              <Text style={styles.payText}>
                {t("roadsideHelp.payCashDirectlyMessage", { amount: b.price ?? 0, name: otherName })}
              </Text>
            </View>
          )
        ) : null}

        {isPaid ? (
          <View style={styles.payRow}>
            <Ionicons name="checkmark-done-circle" size={16} color="#166534" />
            <Text style={styles.payText}>
              {t("roadsideHelp.paymentReceivedAmount", { amount: b.price ?? 0 })}
            </Text>
          </View>
        ) : null}

        {typeof b.rating === "number" ? (
          <View style={styles.ratingSummaryRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={i}
                name={i < (b.rating || 0) ? "star" : "star-outline"}
                size={16}
                color="#F58220"
              />
            ))}

            {b.reviewComment ? (
              <Text style={[styles.ratingComment, marginEnd(6, isRTL)]}>“{b.reviewComment}”</Text>
            ) : null}
          </View>
        ) : null}

        {/* Rating only unlocks after the CUSTOMER confirms completion
            (tripStatus reaches "completed") — never merely after the
            helper's own Finish Help. */}
        {!isDriverView && bookingNeedsRating(b) ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => openRoadsideRatingModal(b)}
          >
            <Ionicons name="star-outline" size={17} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>{t("booking.rateHelperButton")}</Text>
          </Pressable>
        ) : null}

        {/* Passenger: Cancel Booking shows ONLY while still cancellable
            (tripStatus "booked") — completely absent for every later stage,
            never a disabled button or a "can no longer be cancelled" hint. */}
        {canCancelRoadsideAsPassenger ? (
          <Pressable
            style={styles.cancelBookingButton}
            onPress={() => handleCancelGeneralBooking(b, viewer)}
          >
            <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
            <Text style={styles.cancelBookingButtonText}>{t("booking.cancelBookingTitle")}</Text>
          </Pressable>
        ) : null}

        {/* Driver-view fallback keeps its existing (unrestricted) cancel
            behavior, unchanged. */}
        {isDriverView && isAccepted ? (
          <>
            <Pressable
              style={[
                styles.cancelBookingButton,
                !!driverRoadsideCancelBlocked && styles.cancelBookingButtonDisabled,
              ]}
              onPress={() => handleCancelGeneralBooking(b, viewer)}
              disabled={!!driverRoadsideCancelBlocked}
            >
              <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
              <Text style={styles.cancelBookingButtonText}>
                {t("schoolTrip.cancelTripButton")}
              </Text>
            </Pressable>

            {driverRoadsideCancelBlocked ? (
              <Text style={styles.appHint}>{driverRoadsideCancelBlocked}</Text>
            ) : null}
          </>
        ) : null}
      </View>
    );
  };

  // Weekly bookings share a bookingGroupId (one document per booked day,
  // possibly with different drivers). Render each group's day-cards together
  // under one "Weekly booking" header instead of scattering them in the list.
  const renderWeeklyGroup = (groupItems: BookingItem[], viewer: Tab) => {
    const sorted = [...groupItems].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

    const dayLabels = sorted
      .map((item) =>
        item.dayName ? translateStoredDayName(item.dayName, t) : item.date,
      )
      .filter(Boolean)
      .join(", ");

    return (
      <View
        key={`group-${sorted[0].bookingGroupId}`}
        style={styles.weeklyGroupBox}
      >
        <View style={styles.weeklyGroupHeader}>
          <Ionicons name="calendar-outline" size={15} color="#F58220" />
          <Text style={styles.weeklyGroupHeaderText}>
            {t("booking.weeklyBookingLabel")}{dayLabels ? ` · ${dayLabels}` : ""}
          </Text>
        </View>

        {sorted.map((item) => renderBookingCard(item, viewer))}
      </View>
    );
  };

  const renderWithCardRef = (id: string, node: React.ReactNode) => (
    <View
      key={`ref-${id}`}
      ref={(n) => {
        appCardRefs.current[id] = n;
      }}
      style={highlightAppId === id ? styles.highlightWrap : undefined}
    >
      {node}
    </View>
  );

  // Single dispatcher for the ONE combined, already-sorted list — never
  // re-groups or re-sorts by category. `rows` is whatever order
  // sortMyBookings produced; this only picks the right card renderer per row.
  const renderCombinedRows = (rows: CombinedRow[], viewer: Tab) => {
    const renderedGroupIds = new Set<string>();

    return rows.map((row) => {
      if (row._kind === "ride") {
        return renderRideCard(row, viewer);
      }

      if (row._kind === "trip") {
        return renderTripCard(row);
      }

      if (row._kind === "application") {
        return renderWithCardRef(row.id, renderApplicationCard(row, viewer));
      }

      if (
        row._kind === "schoolBooking" ||
        row._kind === "schoolTrip" ||
        row._kind === "schoolWaiting"
      ) {
        return row.render();
      }

      // row._kind === "booking"
      if (row.category === "roadside") {
        // Driver side renders the SAME shared card + SAME roadsideRequests
        // source of truth as Help Requests (see roadsideLib.ts). Passenger
        // side keeps its own card (payment button, no driver actions).
        const liveRequest =
          viewer === "driver" && row.requestId
            ? driverRoadsideRequestsById.get(row.requestId)
            : undefined;

        if (liveRequest) {
          return renderWithCardRef(
            row.id,
            <RoadsideAcceptedCard
              key={`live-${row.id}`}
              request={liveRequest}
              onDelete={() =>
                confirmHideGeneralBooking(row, viewer, t("booking.roadsideHelpLowercase"))
              }
            />,
          );
        }

        return renderWithCardRef(row.id, renderRoadsideCard(row, viewer));
      }

      if (row.bookingGroupId) {
        if (renderedGroupIds.has(row.bookingGroupId)) return null;

        renderedGroupIds.add(row.bookingGroupId);

        const groupItems: BookingItem[] = rows.filter(
          (r): r is TaggedBooking =>
            r._kind === "booking" && r.bookingGroupId === row.bookingGroupId,
        );

        return renderWeeklyGroup(groupItems, viewer);
      }

      return renderBookingCard(row, viewer);
    });
  };

  const renderApplicationCard = (a: NormalizedApplication, viewer: Tab) => {
    const meta = getCategoryMeta(a.category);
    const done = a.status === "completed";
    const dead = a.status === "cancelled" || a.status === "rejected";
    const busy = busyId === a.id;

    const statusStyle =
      a.status === "completed"
        ? styles.statusDone
        : dead
          ? styles.statusDead
          : styles.statusOngoing;

    const statusTextStyle =
      a.status === "completed"
        ? styles.statusTextDone
        : dead
          ? styles.statusTextDead
          : styles.statusTextOngoing;

    const otherName = viewer === "passenger" ? a.providerName : a.customerName;

    const future = startState(a.date) === "future";
    // Role-specific: the driver/provider gets the 5-hour window, the
    // passenger/customer the 2-hour window (see workErrandLib.ts's
    // cancelBlockedReason) — `viewer` already tells us which side this
    // particular card render is for.
    const cancelBlocked = cancelBlockedReason(a, viewer);

    return (
      <View
        key={`${a.kind}-app-${a.id}`}
        style={[styles.card, accentBorderStart(4, meta.color, isRTL), (done || dead) && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {translateCategoryLabel(a.category, meta.label, t)}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            <View style={[styles.statusPill, statusStyle]}>
              <Text style={[styles.statusText, statusTextStyle]}>
                {translateStatus(t, "bookings", a.status) || STATUS_LABEL[a.status]}
              </Text>
            </View>

            {done || dead
              ? renderDeleteButton(() => confirmHideApplication(a, viewer))
              : null}
          </View>
        </View>

        {a.title ? <Text style={styles.tripTitle}>{a.title}</Text> : null}

        {a.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {a.date}
              {a.startTime ? `  ${a.startTime}` : ""}
              {a.endTime ? ` - ${a.endTime}` : ""}
            </Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{otherName}</Text>
        </View>

        {viewer === "driver" ? (
          <View style={styles.infoRow}>
            <Ionicons name="business-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {a.city}
              {a.neighborhood ? ` · ${a.neighborhood}` : ""}
            </Text>
          </View>
        ) : null}

        {/* The applicant's own selected pickup point — never their live
            location or profile home address, only the ONE point they
            intentionally picked for THIS request (see this feature's own
            requirement). Shown before Accept/Reject so the employer/driver
            can judge whether the applicant is close enough. Safe on old
            applications made before this field existed. */}
        {viewer === "driver" ? (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {t("booking.passengerAreaLabel", {
                area: a.pickupLocation?.area || a.pickupLocation?.address || t("booking.pickupLocationNotProvided"),
              })}
            </Text>
          </View>
        ) : null}

        {viewer === "driver" && a.pickupLocation?.address ? (
          <View style={styles.infoRow}>
            <Ionicons name="pin-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{a.pickupLocation.address}</Text>
          </View>
        ) : null}

        {viewer === "driver" && a.status === "pending" ? (
          // Pending Accept/Reject decision: show the passenger's age instead
          // of the price/wage — the driver needs the age to decide, not the
          // price. Price/hourlyPay stay in Firestore untouched for payment
          // later; they're just not the headline here.
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="person-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>
                {a.customerAge !== null
                  ? t("booking.passengerAgeYears", { age: a.customerAge })
                  : t("booking.passengerAgeNotAvailable")}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.metaRow}>
            {a.price !== null ? (
              <View style={styles.metaItem}>
                <Ionicons name="cash-outline" size={15} color="#F58220" />
                <Text style={styles.metaText}>{a.price} ₪</Text>
              </View>
            ) : null}

            {a.hourlyPay !== null ? (
              <View style={styles.metaItem}>
                <Ionicons name="cash-outline" size={15} color="#F58220" />
                <Text style={styles.metaText}>{a.hourlyPay} ₪/hr</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.payRow}>
          <Ionicons name="card-outline" size={14} color="#7C5F46" />
          <Text style={styles.payText}>
            {a.kind === "work"
              ? // Work is paid in reverse (driver -> passenger, after
                // completion) — say so plainly instead of reusing the
                // generic "paymentStatus" wording, which means the opposite
                // thing for every other booking type.
                a.driverPaymentStatus === "paid"
                ? `${t("booking.paidToWorkerLabel")}${
                    a.paymentMethod
                      ? ` · ${paymentMethodLabel(a.paymentMethod, t)}`
                      : ""
                  }${a.cardLast4 ? ` (•••• ${a.cardLast4})` : ""}`
                : a.status === "completed"
                  ? t("booking.paymentToWorkerPending")
                  : t("booking.paymentToWorkerDueAfterFinish")
              : a.paymentMethod
                ? `${paymentMethodLabel(a.paymentMethod, t)} · ${
                    a.paymentStatus === "paid" ? t("common.paid") : t("common.unpaid")
                  }${a.cardLast4 ? ` (•••• ${a.cardLast4})` : ""}`
                : t("booking.paymentUnpaidLabel")}
          </Text>
        </View>

        {viewer === "passenger" ? (
          <>
            {a.kind === "errand" && a.status === "payment_pending_passenger" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => goToPayment(a)}
              >
                <Ionicons name="card" size={16} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>
                  {t("rides.continueToPayment")}
                </Text>
              </Pressable>
            ) : null}

            {a.kind === "work" &&
            a.status === "completed" &&
            a.driverPaymentStatus !== "paid" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  {t("booking.waitingForEmployerPayment")}
                </Text>
              </View>
            ) : null}

            {a.status === "completed" && bookingNeedsRating(a) ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openAppRatingModal(a)}
              >
                <Ionicons name="star-outline" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>{t("passenger.rateDriver")}</Text>
              </Pressable>
            ) : null}

            {a.status === "accepted" || isAwaitingPayment(a.status) ? (
              <>
                <Pressable
                  style={[
                    styles.cancelBookingButton,
                    !!cancelBlocked && styles.cancelBookingButtonDisabled,
                  ]}
                  onPress={() => handleAppCancel(a, "passenger")}
                  disabled={!!cancelBlocked}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
                  <Text style={styles.cancelBookingButtonText}>
                    {t("booking.cancelBookingTitle")}
                  </Text>
                </Pressable>

                {cancelBlocked ? <Text style={styles.appHint}>{cancelBlocked}</Text> : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            {a.status === "pending" ? (
              <View style={styles.appActionsRow}>
                <Pressable
                  style={styles.rejectButton}
                  onPress={() => handleAppReject(a)}
                  disabled={busy}
                >
                  <Text style={styles.rejectButtonText}>{t("roadsideHelp.rejectButton")}</Text>
                </Pressable>

                <Pressable
                  style={styles.startButton}
                  onPress={() => handleAppAccept(a)}
                  disabled={busy}
                >
                  <Text style={styles.startButtonText}>{t("booking.acceptButton")}</Text>
                </Pressable>
              </View>
            ) : null}

            {a.kind === "errand" && a.status === "payment_pending_passenger" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  {t("booking.waitingForCustomerPayment")}
                </Text>
              </View>
            ) : null}

            {a.status === "accepted" ? (
              <>
                <Pressable
                  style={[styles.startButton, future && styles.startDisabled]}
                  onPress={() => handleAppStart(a)}
                  disabled={future || busy}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>{t("booking.startButton")}</Text>
                </Pressable>

                {future ? (
                  <Text style={styles.appHint}>
                    {a.kind === "work"
                      ? t("booking.startAvailableOnJobDate")
                      : t("booking.startAvailableOnErrandDate")}
                  </Text>
                ) : null}
              </>
            ) : null}

            {a.status === "on_the_way" ? (
              <View style={styles.appActionsRow}>
                <Pressable
                  style={[styles.completeButton, styles.completeButtonFlex]}
                  onPress={() => openNavigation(a)}
                >
                  <Ionicons name="navigate-outline" size={16} color="#166534" />
                  <Text style={styles.completeButtonText}>{t("booking.openMapButton")}</Text>
                </Pressable>

                <Pressable
                  style={styles.startButton}
                  onPress={() => handleAppArrive(a)}
                  disabled={busy}
                >
                  <Text style={styles.startButtonText}>{t("booking.iArrivedButton")}</Text>
                </Pressable>
              </View>
            ) : null}

            {a.status === "arrived" ? (
              <Pressable
                style={styles.startButton}
                onPress={() => handleAppStartTrip(a)}
                disabled={busy}
              >
                <Ionicons name="play" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>{t("booking.startTripButton")}</Text>
              </Pressable>
            ) : null}

            {a.status === "in_progress" ? (
              <Pressable
                style={styles.startButton}
                onPress={() => handleAppFinish(a)}
                disabled={busy}
              >
                <Ionicons name="checkmark-done" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>
                  {a.kind === "work" ? t("booking.finishWork") : t("booking.finishErrand")}
                </Text>
              </Pressable>
            ) : null}

            {a.kind === "work" &&
            a.status === "completed" &&
            a.driverPaymentStatus === "paid" ? (
              <View style={styles.waitBanner}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={16}
                  color="#166534"
                />
                <Text style={styles.waitText}>{t("booking.workerPaidLabel")}</Text>
              </View>
            ) : null}

            {a.status === "accepted" || isAwaitingPayment(a.status) ? (
              <>
                <Pressable
                  style={[
                    styles.cancelBookingButton,
                    !!cancelBlocked && styles.cancelBookingButtonDisabled,
                  ]}
                  onPress={() => handleAppCancel(a, "driver")}
                  disabled={!!cancelBlocked}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#B91C1C" />
                  <Text style={styles.cancelBookingButtonText}>
                    {t("schoolTrip.cancelTripButton")}
                  </Text>
                </Pressable>

                {cancelBlocked ? <Text style={styles.appHint}>{cancelBlocked}</Text> : null}
              </>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const isEmpty = rowsForTab.length === 0;

  // Reused by every per-bucket "nothing here" text (completed, unbooked
  // trips, upcoming/in-progress) — never touches the OUTER isEmpty card
  // below, which gets its own distinct icon/title treatment. When filters
  // are active, swaps the normal bucket-specific message for a shared
  // "no match" one with its own Clear Filters action; otherwise renders the
  // original bucket-specific text unchanged.
  const renderBucketEmptyText = (normalKey: string) =>
    hasActiveFilters ? (
      <View style={styles.filteredEmptyBox}>
        <Text style={styles.sectionEmptyText}>{t("booking.noBookingsMatchFilters")}</Text>
        <Pressable onPress={handleClearFilters} hitSlop={8}>
          <Text style={styles.filterClearInlineText}>{t("booking.clearFiltersButton")}</Text>
        </Pressable>
      </View>
    ) : (
      <Text style={styles.sectionEmptyText}>{t(normalKey)}</Text>
    );

  return (
    <DirectionalScreen style={styles.page}>
      <KeyboardAvoidingWrapper>
      <ScrollView
        ref={mainScrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t("bookings.title")}</Text>

          {!isEmpty ? (
            <Pressable
              onPress={handleClearAllBookings}
              disabled={clearingAll}
              hitSlop={8}
            >
              <Text style={styles.clearAllText}>
                {clearingAll
                  ? t("roadsideHelp.clearingButton")
                  : bucketTab === "completed"
                    ? t("booking.clearAllCompletedBookingsTitle")
                    : t("booking.clearAllBookingsTitle")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.toggle}>
          <Pressable
            style={[
              styles.toggleBtn,
              tab === "passenger" && styles.toggleBtnActive,
            ]}
            onPress={() => setTab("passenger")}
          >
            <Ionicons
              name="person-outline"
              size={16}
              color={tab === "passenger" ? "#FFFFFF" : "#7C5F46"}
            />
            <Text
              style={[
                styles.toggleText,
                tab === "passenger" && styles.toggleTextActive,
              ]}
            >
              {t("booking.passengerTab")}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.toggleBtn,
              tab === "driver" && styles.toggleBtnActive,
            ]}
            onPress={() => setTab("driver")}
          >
            <Ionicons
              name="car-outline"
              size={16}
              color={tab === "driver" ? "#FFFFFF" : "#7C5F46"}
            />
            <Text
              style={[
                styles.toggleText,
                tab === "driver" && styles.toggleTextActive,
              ]}
            >
              {t("booking.driverTab")}
            </Text>
          </Pressable>
        </View>

        <View style={styles.searchFilterRow}>
          <View style={[styles.searchRow, styles.searchRowFlex]}>
            <Ionicons name="search-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.searchInput}
              placeholder={t("booking.searchByDriverNamePlaceholder")}
              placeholderTextColor="#8B7B6B"
              value={search}
              onChangeText={setSearch}
            />

            {search ? (
              <Pressable onPress={() => setSearch("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#8B7B6B" />
              </Pressable>
            ) : null}
          </View>

          {/* Category/Date/Location no longer render as separate chips here
              — they now live inside the Filters modal below (same
              categoryFilter/dateFilter/locationFilter state, same
              categoryMenuOpen/dateMenuOpen/locationMenuOpen sub-modals,
              completely unchanged). This is the one compact entry point. */}
          <Pressable
            style={styles.filtersButton}
            onPress={() => setFiltersModalOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("booking.filtersButton")}
          >
            <Ionicons name="options-outline" size={18} color="#7C5F46" />
            <Text style={styles.filtersButtonText}>{t("booking.filtersButton")}</Text>
            {hasActiveFilters ? <View style={styles.filtersButtonBadge} /> : null}
          </Pressable>
        </View>

        {/* One shared Upcoming/In Progress/Completed tab row, above every
            card, controlling all categories (School, Personal Ride,
            Work Helper, Errands, Roadside) together — for both
            Passenger and Driver. Unbooked Trips is a 4th, driver-only tab —
            the Passenger tab structure otherwise stays exactly 3-way. */}
        <View
          style={styles.driverBucketRow}
          onLayout={(e) => {
            bucketScrollViewportWidthRef.current = e.nativeEvent.layout.width;
          }}
        >
          <ScrollView
            ref={bucketScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.driverBucketRowContent}
            onScroll={(e) => {
              bucketScrollOffsetRef.current = e.nativeEvent.contentOffset.x;
            }}
            scrollEventThrottle={16}
          >
            {(
              [
                { key: "upcoming", icon: "calendar-outline", rows: upcomingRows, labelKey: "booking.bucketUpcoming" },
                { key: "inProgress", icon: "navigate-outline", rows: inProgressRows, labelKey: "booking.bucketInProgress" },
                {
                  key: "completed",
                  icon: "checkmark-circle-outline",
                  // Excludes cancelled trips for both roles — they render in
                  // their own separated section instead (see below).
                  rows: trulyCompletedRows,
                  labelKey: "booking.bucketCompleted",
                },
                ...(tab === "driver"
                  ? [
                      {
                        key: "unbookedTrips" as const,
                        icon: "car-outline" as const,
                        rows: unbookedTripsRows,
                        labelKey: "booking.bucketUnbookedTrips",
                      },
                      // Driver no-show violations (see driverNoShowLib.ts) —
                      // shows full history (including resolved appeals, per
                      // the product spec's "keep the historical violation
                      // visible with the status Appeal approved / Violation
                      // removed"); the badge count below is overridden to
                      // show only the live ACTIVE count, not this array's
                      // full length.
                      {
                        key: "violations" as const,
                        icon: "warning-outline" as const,
                        rows: mergedViolationRows,
                        labelKey: "driverNoShow.violationsTab",
                      },
                    ]
                  : []),
              ] as const
            ).map((bucket) => {
              const active = bucketTab === bucket.key;

              return (
                <Pressable
                  key={bucket.key}
                  style={[styles.driverBucketButton, active && styles.driverBucketButtonActive]}
                  onPress={() => setBucketTab(bucket.key)}
                  onLayout={(e) => {
                    bucketButtonLayoutsRef.current[bucket.key] = {
                      x: e.nativeEvent.layout.x,
                      width: e.nativeEvent.layout.width,
                    };
                  }}
                >
                  <Ionicons
                    name={bucket.icon}
                    size={15}
                    color={active ? "#FFFFFF" : "#7C5F46"}
                  />
                  <Text
                    style={[
                      styles.driverBucketButtonText,
                      active && styles.driverBucketButtonTextActive,
                    ]}
                  >
                    {t(bucket.labelKey)} ({bucket.key === "violations" ? mergedActiveViolationCount : bucket.rows.length})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {loading || school.loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : isEmpty ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name={hasActiveFilters ? "filter-outline" : tab === "passenger" ? "bag-handle-outline" : "car-outline"}
              size={40}
              color="#8B7B6B"
            />
            <Text style={styles.emptyTitle}>
              {hasActiveFilters
                ? t("booking.noBookingsMatchFilters")
                : tab === "passenger"
                  ? t("booking.noBookingsYet")
                  : t("booking.noTripsYet")}
            </Text>
            <Text style={styles.emptyText}>
              {hasActiveFilters
                ? t("booking.noBookingsMatchFiltersHint")
                : tab === "passenger"
                  ? t("booking.bookingsEmptyHintPassenger")
                  : t("booking.bookingsEmptyHintDriver")}
            </Text>

            {hasActiveFilters ? (
              <Pressable
                style={[styles.filterClearButton, { marginTop: 14 }]}
                onPress={handleClearFilters}
              >
                <Ionicons name="close-outline" size={14} color="#F58220" />
                <Text style={styles.filterClearButtonText}>{t("booking.clearFiltersButton")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : bucketTab === "completed" ? (
          (() => {
            // Truly-completed rows, then (if any) a clearly separated
            // "Cancelled" section below — cancelled is bucketed with
            // Completed (see getDriverTripBucket/getPassengerTripBucket) but
            // is never the same thing as a successful completion, and is
            // never counted in the tab's own count above. Same treatment for
            // both roles — no new main tab for either.
            const primaryRows = trulyCompletedRows;
            const cancelledRows = cancelledHistoryRows;

            if (primaryRows.length === 0 && cancelledRows.length === 0) {
              return renderBucketEmptyText("booking.noCompletedTrips");
            }

            return (
              <>
                {primaryRows.length > 0 ? (
                  <View style={styles.list}>{renderCombinedRows(primaryRows, tab)}</View>
                ) : (
                  <Text style={styles.sectionEmptyText}>{t("booking.noCompletedTrips")}</Text>
                )}

                {cancelledRows.length > 0 ? (
                  <>
                    <View style={styles.sectionSeparator} />

                    <View style={styles.sectionHeaderRow}>
                      <Ionicons name="close-circle-outline" size={16} color="#7C5F46" />
                      <Text style={styles.sectionHeaderText}>{t("booking.cancelledTripsSection")}</Text>
                    </View>

                    <View style={styles.list}>{renderCombinedRows(cancelledRows, tab)}</View>
                  </>
                ) : null}
              </>
            );
          })()
        ) : bucketTab === "unbookedTrips" ? (
          (() => {
            // Two clearly separated sections, never one mixed list —
            // Waiting for booking (ascending, nearest first) above Expired —
            // No bookings (descending, most-recently-expired first). The
            // Expired heading only renders when that section has rows; the
            // Waiting heading is shown whenever there's anything above it
            // to label, so an all-expired or all-waiting tab never shows an
            // empty/redundant heading.
            if (waitingForBookingRows.length === 0 && expiredNoBookingsRows.length === 0) {
              return renderBucketEmptyText("booking.noUnbookedTrips");
            }

            return (
              <>
                {waitingForBookingRows.length > 0 ? (
                  <>
                    <View style={styles.sectionHeaderRow}>
                      <Ionicons name="hourglass-outline" size={16} color="#7C5F46" />
                      <Text style={styles.sectionHeaderText}>
                        {t("booking.waitingForBookingLabel")}
                      </Text>
                    </View>
                    <View style={styles.list}>{renderCombinedRows(waitingForBookingRows, tab)}</View>
                  </>
                ) : null}

                {expiredNoBookingsRows.length > 0 ? (
                  <>
                    {waitingForBookingRows.length > 0 ? <View style={styles.sectionSeparator} /> : null}

                    <View style={styles.sectionHeaderRow}>
                      <Ionicons name="time-outline" size={16} color="#7C5F46" />
                      <Text style={styles.sectionHeaderText}>
                        {t("booking.expiredNoBookingsLabel")}
                      </Text>
                    </View>
                    <View style={styles.list}>{renderCombinedRows(expiredNoBookingsRows, tab)}</View>
                  </>
                ) : null}
              </>
            );
          })()
        ) : bucketTab === "violations" ? (
          mergedViolationRows.length === 0 ? (
            renderBucketEmptyText("driverNoShow.noViolations")
          ) : (
            <View style={styles.list}>
              {mergedViolationRows.map((violation) =>
                violation.violationType === "driver_cancellation"
                  ? renderCancellationViolationCard(violation)
                  : renderViolationCard(violation),
              )}
            </View>
          )
        ) : (
          (() => {
            const bucketRows = bucketTab === "upcoming" ? upcomingRows : inProgressRows;

            const bucketEmptyKey =
              bucketTab === "upcoming" ? "booking.noBookedActiveTrips" : "booking.noTripsInProgress";

            return bucketRows.length === 0 ? (
              renderBucketEmptyText(bucketEmptyKey)
            ) : (
              <View style={styles.list}>{renderCombinedRows(bucketRows, tab)}</View>
            );
          })()
        )}
      </ScrollView>
      </KeyboardAvoidingWrapper>

      {school.modals}

      <Modal
        visible={!!rebook}
        transparent
        animationType="fade"
        onRequestClose={() => setRebook(null)}
      >
        <KeyboardAvoidingWrapper style={styles.rebookOverlay}>
          <DirectionalCard style={styles.rebookSheet}>
            <Text style={styles.rebookTitle}>{t("booking.bookAgainTitle")}</Text>
            <Text style={styles.modalSub}>
              {t("booking.bookAgainSubtitle")}
            </Text>

            {rebook ? (
              <View style={styles.modalSummary}>
                {(() => {
                  const meta = getCategoryMeta(rebook.category);

                  return (
                    <View
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: `${meta.color}18`,
                          alignSelf: "flex-start",
                        },
                      ]}
                    >
                      <Ionicons name={meta.icon} size={15} color={meta.color} />
                      <Text style={[styles.catText, { color: meta.color }]}>
                        {translateCategoryLabel(rebook.category, meta.label, t)}
                      </Text>
                    </View>
                  );
                })()}

                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={15} color="#7C5F46" />
                  <Text style={styles.infoText}>
                    {rebook.from || "?"} → {rebook.to || "?"}
                  </Text>
                </View>

                {typeof rebook.seats === "number" ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="people-outline" size={15} color="#7C5F46" />
                    <Text style={styles.infoText}>{t("booking.seatsCount", { count: rebook.seats })}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <DateInput
              label={t("booking.newDateLabel")}
              value={rebookDate}
              onChange={setRebookDate}
              showPicker={showDatePicker}
              setShowPicker={setShowDatePicker}
            />

            <TimeInput
              label={t("booking.newTimeLabel")}
              value={rebookTime}
              onChange={setRebookTime}
              showPicker={showTimePicker}
              setShowPicker={setShowTimePicker}
            />

            <Pressable style={styles.rebookSearchButton} onPress={submitRebook}>
              <Ionicons name="search-outline" size={16} color="#FFFFFF" />
              <Text style={styles.rebookSearchText}>{t("booking.searchDrivers")}</Text>
            </Pressable>

            <Pressable style={styles.rebookCancelButton} onPress={() => setRebook(null)}>
              <Text style={styles.rebookCancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </DirectionalCard>
        </KeyboardAvoidingWrapper>
      </Modal>

      <RepublishTripModal
        visible={!!republish}
        title={t("booking.republishTripButton")}
        subtitle={t("booking.republishModalSubtitle")}
        routeLabel={
          republish?.from || republish?.to
            ? `${republish?.from || "?"} → ${republish?.to || "?"}`
            : republish?.title || ""
        }
        subLabel={republish?.location || undefined}
        dateLabel={t("booking.newDateLabel")}
        date={republishDate}
        onChangeDate={setRepublishDate}
        showDatePicker={showRepublishDatePicker}
        setShowDatePicker={setShowRepublishDatePicker}
        timeLabel={t("booking.newTimeLabel")}
        time={republishTime}
        onChangeTime={setRepublishTime}
        showTimePicker={showRepublishTimePicker}
        setShowTimePicker={setShowRepublishTimePicker}
        priceLabel={t("booking.newPriceLabel")}
        price={republishPrice}
        onChangePrice={setRepublishPrice}
        seatsLabel={t("booking.newSeatsLabel")}
        seats={republishSeats}
        onChangeSeats={setRepublishSeats}
        submitLabel={t("booking.republishTripButton")}
        cancelLabel={t("common.cancel")}
        onSubmit={submitRepublish}
        onCancel={closeRepublishModal}
        submitting={republishSubmitting}
      />

      {/* The single "Filters" entry sheet — Category/Date/Location rows
          below HAND OFF to the SAME categoryMenuOpen/dateMenuOpen/
          locationMenuOpen modals just below (their own state/logic is
          completely unchanged): tapping a row closes THIS modal and opens
          the target one in the same state update, so two <Modal>s are never
          visible at once. RN's Modal renders via a native overlay above the
          ENTIRE app (not just this screen — that's how it can sit above a
          tab bar at all), and two of them open simultaneously is what was
          leaving the whole app's touch dispatch stuck after closing either
          one. Also only mounted in the tree at all while open (conditional
          render, not a permanently-mounted `visible={bool}` Modal) per the
          same reasoning. Apply Filters just closes this sheet (filters
          already apply live as they're picked, exactly like before); Clear
          All reuses the existing handleClearFilters unchanged. */}
      {filtersModalOpen ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setFiltersModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={{ flex: 1 }} onPress={() => setFiltersModalOpen(false)} />

            <DirectionalCard style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t("booking.filtersButton")}</Text>

              <Pressable
                style={styles.filtersModalRow}
                onPress={() => {
                  setFiltersModalOpen(false);
                  setCategoryMenuOpen(true);
                }}
              >
                <View style={styles.filtersModalRowLabel}>
                  <Ionicons name="pricetag-outline" size={18} color="#7C5F46" />
                  <Text style={styles.filtersModalRowLabelText}>{t("booking.filterCategoryButton")}</Text>
                </View>
                <View style={styles.filtersModalRowValue}>
                  <Text style={[styles.filtersModalRowValueText, categoryFilter !== "all" && styles.filtersModalRowValueTextActive]} numberOfLines={1}>
                    {categoryFilter === "all"
                      ? t("booking.filterAllCategories")
                      : translateCategoryLabel(
                          CATEGORY_FILTER_META_KEY[categoryFilter],
                          getCategoryMeta(CATEGORY_FILTER_META_KEY[categoryFilter]).label,
                          t,
                        )}
                  </Text>
                  {categoryFilter !== "all" ? (
                    <Pressable
                      hitSlop={10}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setCategoryFilter("all");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("booking.clearCategoryFilterA11y")}
                    >
                      <Ionicons name="close-circle" size={18} color="#8B7B6B" />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#8B7B6B" />
                  )}
                </View>
              </Pressable>

              <Pressable
                style={styles.filtersModalRow}
                onPress={() => {
                  setFiltersModalOpen(false);
                  setDateMenuOpen(true);
                }}
              >
                <View style={styles.filtersModalRowLabel}>
                  <Ionicons name="calendar-outline" size={18} color="#7C5F46" />
                  <Text style={styles.filtersModalRowLabelText}>{t("booking.filterDateButton")}</Text>
                </View>
                <View style={styles.filtersModalRowValue}>
                  <Text style={[styles.filtersModalRowValueText, !!dateFilter && styles.filtersModalRowValueTextActive]} numberOfLines={1}>
                    {dateFilter ? formatLocalizedDateFromYMD(dateFilter, language) : t("booking.filterAllDates")}
                  </Text>
                  {dateFilter ? (
                    <Pressable
                      hitSlop={10}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setDateFilter(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("booking.clearDateFilterA11y")}
                    >
                      <Ionicons name="close-circle" size={18} color="#8B7B6B" />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#8B7B6B" />
                  )}
                </View>
              </Pressable>

              <Pressable
                style={styles.filtersModalRow}
                onPress={() => {
                  setFiltersModalOpen(false);
                  setLocationQuery("");
                  setLocationMenuOpen(true);
                }}
              >
                <View style={styles.filtersModalRowLabel}>
                  <Ionicons name="location-outline" size={18} color="#7C5F46" />
                  <Text style={styles.filtersModalRowLabelText}>{t("booking.filterLocationButton")}</Text>
                </View>
                <View style={styles.filtersModalRowValue}>
                  <Text style={[styles.filtersModalRowValueText, !!locationFilter && styles.filtersModalRowValueTextActive]} numberOfLines={1}>
                    {locationFilter ? locationFilter.label : t("booking.filterAllLocations")}
                  </Text>
                  {locationFilter ? (
                    <Pressable
                      hitSlop={10}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setLocationFilter(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("booking.clearLocationFilterA11y")}
                    >
                      <Ionicons name="close-circle" size={18} color="#8B7B6B" />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#8B7B6B" />
                  )}
                </View>
              </Pressable>

              <Pressable
                style={styles.rebookSearchButton}
                onPress={() => setFiltersModalOpen(false)}
              >
                <Text style={styles.rebookSearchText}>{t("booking.applyFiltersButton")}</Text>
              </Pressable>

              <Pressable
                style={[styles.filterClearButton, { marginTop: 10 }]}
                onPress={() => {
                  handleClearFilters();
                  setFiltersModalOpen(false);
                }}
              >
                <Ionicons name="close-outline" size={14} color="#F58220" />
                <Text style={styles.filterClearButtonText}>{t("booking.clearAllFiltersButton")}</Text>
              </Pressable>
            </DirectionalCard>
          </View>
        </Modal>
      ) : null}

      <Modal
        visible={categoryMenuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryMenuOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setCategoryMenuOpen(false)} />

          <DirectionalCard style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t("booking.filterCategoryButton")}</Text>

            {CATEGORY_FILTER_OPTIONS.map((option) => {
              const isActive = categoryFilter === option;
              const label =
                option === "all"
                  ? t("booking.filterAllCategories")
                  : translateCategoryLabel(
                      CATEGORY_FILTER_META_KEY[option],
                      getCategoryMeta(CATEGORY_FILTER_META_KEY[option]).label,
                      t,
                    );

              return (
                <Pressable
                  key={option}
                  style={styles.filterOptionRow}
                  onPress={() => {
                    setCategoryFilter(option);
                    setCategoryMenuOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      isActive && styles.filterOptionTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                  {isActive ? (
                    <Ionicons name="checkmark" size={18} color="#F58220" />
                  ) : null}
                </Pressable>
              );
            })}
          </DirectionalCard>
        </View>
      </Modal>

      <Modal
        visible={dateMenuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDateMenuOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setDateMenuOpen(false)} />

          <DirectionalCard style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{t("booking.filterDateButton")}</Text>

              {Platform.OS === "ios" ? (
                <Pressable
                  style={styles.modalDoneCircle}
                  onPress={() => setDateMenuOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.done")}
                >
                  <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>

            <DateTimePicker
              value={(dateFilter && parseDateInput(dateFilter)) || new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "calendar"}
              // Deliberately far in the past (not "today or later" like
              // DateInput's default) — the date filter must match any
              // already-happened trip, never just future ones.
              minimumDate={new Date(2000, 0, 1)}
              onChange={(_event: any, selectedDate?: Date) => {
                if (Platform.OS === "android" || Platform.OS === "web") {
                  setDateMenuOpen(false);
                }

                if (selectedDate) {
                  setDateFilter(formatDateToYMD(selectedDate));
                }
              }}
            />
          </DirectionalCard>
        </View>
      </Modal>

      <Modal
        visible={locationMenuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationMenuOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setLocationMenuOpen(false)} />

          {/* The Modal itself is NOT keyboard-aware — the software keyboard
              is an OS overlay that simply covers whatever sits at the
              bottom of the screen underneath it. Shrinking the sheet's
              height alone (previous attempt) left it still anchored to the
              very bottom of the FULL screen, so the keyboard just covered
              its lower portion — title and search field included — leaving
              only a sliver of the list peeking above the keyboard, which is
              exactly the broken state reported. Fixing this needs BOTH:
              (1) shrink the sheet so sheet height + keyboard height fits
              within the screen (never pushes the top off-screen), AND
              (2) marginBottom: keyboardHeight, so the flex-end-anchored
              sheet is actually LIFTED to sit directly above the keyboard
              instead of staying pinned to the physical screen bottom where
              the keyboard renders. */}
          <DirectionalCard
            style={[
              styles.modalSheet,
              styles.locationModalSheet,
              {
                height: Math.max(
                  240,
                  Math.min(
                    windowHeight * 0.85,
                    windowHeight - keyboardHeight - safeAreaInsets.top - 12,
                  ),
                ),
                marginBottom: keyboardHeight,
                paddingBottom: keyboardHeight > 0 ? 12 : Math.max(safeAreaInsets.bottom, 16),
              },
            ]}
          >
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t("booking.filterLocationButton")}</Text>

            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color="#8B7B6B" />
              <TextInput
                style={styles.searchInput}
                placeholder={t("booking.searchLocationPlaceholder")}
                placeholderTextColor="#8B7B6B"
                value={locationQuery}
                onChangeText={setLocationQuery}
                autoFocus
              />

              {locationQuery ? (
                <Pressable onPress={() => setLocationQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color="#8B7B6B" />
                </Pressable>
              ) : null}
            </View>

            <FlatList
              style={styles.locationSuggestionList}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.id}
              data={locationSuggestions}
              ListHeaderComponent={
                <Pressable
                  style={styles.filterOptionRow}
                  onPress={() => {
                    setLocationFilter(null);
                    setLocationQuery("");
                    setLocationMenuOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      !locationFilter && styles.filterOptionTextActive,
                    ]}
                  >
                    {t("booking.filterAllLocations")}
                  </Text>
                  {!locationFilter ? (
                    <Ionicons name="checkmark" size={18} color="#F58220" />
                  ) : null}
                </Pressable>
              }
              ListEmptyComponent={
                <Text style={styles.sectionEmptyText}>{t("booking.noMatchingLocations")}</Text>
              }
              renderItem={({ item }: { item: IsraelLocation }) => {
                const displayLabel = getLocalizedLocationName(item, language);
                const isActive = locationFilter?.canonicalId === item.id;

                return (
                  <Pressable
                    style={styles.filterOptionRow}
                    onPress={() => {
                      setLocationFilter({ canonicalId: item.id, label: displayLabel });
                      setLocationQuery(displayLabel);
                      setLocationMenuOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        isActive && styles.filterOptionTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {displayLabel}
                    </Text>
                    {isActive ? (
                      <Ionicons name="checkmark" size={18} color="#F58220" />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </DirectionalCard>
        </View>
      </Modal>

      <Modal
        visible={
          !!ratingBooking ||
          !!schoolRatingBooking ||
          !!appRatingBooking ||
          !!roadsideRatingBooking
        }
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRatingBooking(null);
          setSchoolRatingBooking(null);
          setAppRatingBooking(null);
          setRoadsideRatingBooking(null);
        }}
      >
        <KeyboardAvoidingWrapper style={styles.ratingBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setRatingBooking(null);
              setSchoolRatingBooking(null);
              setAppRatingBooking(null);
              setRoadsideRatingBooking(null);
            }}
          />

          <DirectionalCard style={styles.ratingCard}>
            <View style={styles.ratingIconCircle}>
              <Ionicons name="checkmark-circle" size={34} color="#F58220" />
            </View>

            {roadsideRatingBooking ? (
              <>
                <Text style={styles.ratingTitle}>{t("booking.rateYourHelperTitle")}</Text>
                <Text style={styles.ratingSubtitle}>
                  {t("booking.roadsideRatingQuestion", { name: roadsideRatingBooking.driverName })}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.ratingTitle}>{t("booking.arrivedSafelyTitle")}</Text>
                <Text style={styles.ratingSubtitle}>{t("booking.rateYourDriverSubtitle")}</Text>
                <Text style={styles.ratingRebookHint}>{t("booking.rateToBookAgainHint")}</Text>
              </>
            )}

            <View style={styles.ratingStarsRow}>
              {Array.from({ length: 5 }).map((_, i) => {
                const value = i + 1;
                const active = value <= ratingStars;

                return (
                  <Pressable
                    key={value}
                    onPress={() => setRatingStars(value)}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={active ? "star" : "star-outline"}
                      size={38}
                      color={active ? "#F58220" : "#D8C9BC"}
                    />
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.ratingInput}
              value={ratingComment}
              onChangeText={setRatingComment}
              placeholder={t("booking.leaveCommentOptional")}
              placeholderTextColor="#9B7A68"
              multiline
              textAlignVertical="top"
            />

            <Pressable
              style={[
                styles.ratingSubmit,
                (ratingStars < 1 || ratingBusy) && styles.ratingSubmitDisabled,
              ]}
              onPress={submitRating}
              disabled={ratingStars < 1 || ratingBusy}
            >
              {ratingBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ratingSubmitText}>{t("booking.submitRatingButton")}</Text>
              )}
            </Pressable>
          </DirectionalCard>
        </KeyboardAvoidingWrapper>
      </Modal>

      <Modal
        visible={!!reportBooking}
        transparent
        animationType="fade"
        onRequestClose={() => setReportBooking(null)}
      >
        <KeyboardAvoidingWrapper style={styles.ratingBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setReportBooking(null)}
          />

          <DirectionalCard style={styles.ratingCard}>
            <View style={styles.ratingIconCircle}>
              <Ionicons name="alert-circle-outline" size={34} color="#B91C1C" />
            </View>

            <Text style={styles.ratingTitle}>{t("roadsideHelp.reportProblemTitle")}</Text>
            <Text style={styles.ratingSubtitle}>{t("roadsideHelp.reportProblemSubtitle")}</Text>

            <TextInput
              style={styles.ratingInput}
              value={reportDescription}
              onChangeText={setReportDescription}
              placeholder={t("admin.describeIssue")}
              placeholderTextColor="#9B7A68"
              multiline
              textAlignVertical="top"
            />

            <Pressable
              style={[
                styles.ratingSubmit,
                (!reportDescription.trim() || submittingReport) && styles.ratingSubmitDisabled,
              ]}
              onPress={submitProblemReport}
              disabled={!reportDescription.trim() || submittingReport}
            >
              {submittingReport ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ratingSubmitText}>{t("roadsideHelp.submitReportButton")}</Text>
              )}
            </Pressable>
          </DirectionalCard>
        </KeyboardAvoidingWrapper>
      </Modal>

      {appealModalViolation ? (
        <ViolationAppealModal
          visible={!!appealModalViolation}
          violationId={appealModalViolation.id}
          violationSource={appealModalViolation.violationSource}
          tripId={appealModalViolation.tripId}
          onClose={() => setAppealModalViolation(null)}
          onSubmitted={() => setAppealModalViolation(null)}
        />
      ) : null}
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  highlightWrap: {
    borderWidth: 2,
    borderColor: "#F58220",
    borderRadius: 26,
    backgroundColor: "rgba(245,130,32,0.08)",
    padding: 2,
    marginBottom: -2,
  },
  weeklyGroupBox: {
    borderWidth: 1,
    borderColor: "#F58220",
    borderRadius: 20,
    padding: 10,
    marginBottom: 18,
    backgroundColor: "#FFF8F2",
    gap: 12,
  },
  weeklyGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
  },
  weeklyGroupHeaderText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#B86115",
    flexShrink: 1,
  },
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  clearAllText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 14,
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: "#F1E7DD",
    borderRadius: 16,
    padding: 5,
    gap: 5,
    marginBottom: 14,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  toggleBtnActive: {
    backgroundColor: "#F58220",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  toggleText: {
    fontWeight: "900",
    color: "#7C5F46",
    fontSize: 15,
  },
  toggleTextActive: {
    color: "#FFFFFF",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  // [ Search field ][ Filters button ] row — searchRowFlex overrides
  // searchRow's own marginBottom (the wrapping row below carries it
  // instead) and makes it share the row with the Filters button.
  searchFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  searchRowFlex: {
    flex: 1,
    marginBottom: 0,
  },
  filtersButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  filtersButtonText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
  },
  filtersButtonBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F58220",
  },
  filtersModalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EFE7DE",
  },
  filtersModalRowLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filtersModalRowLabelText: {
    color: "#111827",
    fontWeight: "700",
    fontSize: 15,
  },
  filtersModalRowValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    maxWidth: "50%",
  },
  filtersModalRowValueText: {
    color: "#8B7B6B",
    fontWeight: "700",
    fontSize: 14,
    flexShrink: 1,
  },
  filtersModalRowValueTextActive: {
    color: "#F58220",
  },
  searchInput: {
    flex: 1,
    color: "#111827",
    fontWeight: "600",
    padding: 0,
  },
  loadingBox: {
    paddingVertical: 50,
    alignItems: "center",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 30,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  emptyText: {
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    gap: 14,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 12,
  },
  sectionHeaderText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  sectionSeparator: {
    height: 1,
    backgroundColor: "#E7DCD1",
    marginVertical: 22,
  },
  sectionEmptyText: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  driverBucketRow: {
    marginBottom: 16,
  },
  driverBucketRowContent: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 2,
  },
  driverBucketButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 118,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  driverBucketButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  driverBucketButtonText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 12,
  },
  driverBucketButtonTextActive: {
    color: "#FFFFFF",
  },
  filterClearButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#F58220",
    backgroundColor: "#FFF3E9",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  filterClearButtonText: {
    color: "#F58220",
    fontWeight: "800",
    fontSize: 12,
  },
  filterOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EFE7DE",
  },
  filterOptionText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
    fontSize: 15,
  },
  filterOptionTextActive: {
    color: "#F58220",
  },
  locationModalSheet: {
    flexShrink: 0,
    paddingBottom: 0,
  },
  locationSuggestionList: {
    flex: 1,
    marginTop: 4,
  },
  filteredEmptyBox: {
    gap: 6,
    marginBottom: 8,
  },
  filterClearInlineText: {
    color: "#F58220",
    fontWeight: "800",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  cardDone: {
    backgroundColor: "#F8F6F2",
    borderColor: "#E7E1D8",
  },
  cardTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    rowGap: 6,
    columnGap: 10,
    marginBottom: 12,
  },
  // flexShrink lets this group (and the status pill's own text inside it)
  // give way instead of pushing the row wider than the card on a long
  // category label + a long status label (e.g. "Expired — No bookings")
  // together on a narrow screen.
  cardTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F1",
    borderWidth: 1,
    borderColor: "#F7C7C7",
  },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 13,
  },
  catText: {
    fontWeight: "900",
    fontSize: 13,
    flexShrink: 1,
  },
  tripTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  problemChip: {
    backgroundColor: "#FFF2E8",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 13,
  },
  problemChipText: {
    color: "#B86115",
    fontWeight: "900",
    fontSize: 12,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusOngoing: {
    backgroundColor: "#FFF2E8",
  },
  statusDone: {
    backgroundColor: "#E7F7EC",
  },
  statusText: {
    fontWeight: "900",
    fontSize: 12,
    flexShrink: 1,
  },
  statusTextOngoing: {
    color: "#B86115",
  },
  statusTextDone: {
    color: "#166534",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  pickupInfoBox: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    backgroundColor: "#FFFDFC",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 2,
    marginBottom: 10,
  },
  infoText: {
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  description: {
    color: "#3C2319",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 16,
    marginTop: 2,
    marginBottom: 14,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
  },
  metaText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
    flexShrink: 1,
  },
  metaTextMuted: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7C5F46",
    flexShrink: 1,
  },
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#BBE7C6",
    backgroundColor: "#F1FBF4",
    borderRadius: 14,
    paddingVertical: 14,
  },
  // Only for completeButton's two appActionsRow pairings (open map + I've
  // arrived) — makes it share the row evenly with its flex:1 sibling
  // startButton, instead of shrinking to a cramped, oddly-placed pill.
  // Never applied to completeButton's OTHER, standalone "Mark as Completed"
  // usage, which must stay full-width in its own vertical stack.
  completeButtonFlex: {
    flex: 1,
  },
  completeButtonText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 15,
  },
  republishButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#F58220",
    backgroundColor: "#FFF3E9",
    borderRadius: 14,
    paddingVertical: 13,
    marginBottom: 10,
  },
  republishButtonDisabled: {
    opacity: 0.6,
  },
  republishButtonText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 15,
  },
  cancelBookingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#F5C2C2",
    backgroundColor: "#FEF2F2",
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 8,
  },
  cancelBookingButtonText: {
    color: "#B91C1C",
    fontWeight: "900",
    fontSize: 15,
  },
  cancelBookingButtonDisabled: {
    opacity: 0.5,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  primaryButtonFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  // Completion_pending's two passenger-only actions — always stacked
  // vertically, never side-by-side, both full-width with identical height/
  // radius/spacing so they read as one aligned pair (see renderRoadsideCard).
  completionActionsColumn: {
    gap: 10,
    marginTop: 4,
  },
  reportProblemButtonFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#E4DDD7",
    backgroundColor: "#FFFDFC",
    borderRadius: 14,
    paddingVertical: 14,
  },
  reportProblemButtonText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  // Cancels out primaryButtonFull's own marginTop so the two buttons in
  // completionActionsColumn are separated by exactly one consistent gap.
  completionConfirmButton: {
    marginTop: 0,
  },
  finishButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#BBE7C6",
    backgroundColor: "#F1FBF4",
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 10,
  },
  finishButtonText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  statusDead: {
    backgroundColor: "#F1E7E7",
  },
  statusTextDead: {
    color: "#B91C1C",
  },
  driverDetailsBox: {
    backgroundColor: "#FFFDFC",
    borderWidth: 1,
    borderColor: "#EFE3D6",
    borderRadius: 14,
    padding: 12,
    marginTop: 2,
    marginBottom: 14,
  },
  driverDetailsTitle: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  phoneText: {
    color: "#F58220",
    fontSize: 14,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  payText: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  startButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
  },
  startDisabled: {
    backgroundColor: "#D8C9BC",
  },
  startButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  appHint: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  rateDriverHint: {
    color: "#F58220",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  appActionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  rejectButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFDFC",
  },
  rejectButtonText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  waitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 14,
  },
  waitText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
  },
  cancelLink: {
    alignItems: "center",
    marginTop: 12,
  },
  cancelLinkText: {
    color: "#B91C1C",
    fontWeight: "800",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 34,
  },
  modalHandle: {
    width: 46,
    height: 5,
    borderRadius: 20,
    backgroundColor: "#D8C9BC",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalDoneCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F58220",
    alignItems: "center",
    justifyContent: "center",
  },
  modalSub: {
    width: "100%",
    color: "#7C5F46",
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  modalSummary: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  rebookOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  rebookSheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
  },
  rebookTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  rebookSearchButton: {
    width: "100%",
    height: 56,
    borderRadius: 16,
    backgroundColor: "#F58220",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
  rebookSearchText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  rebookCancelButton: {
    marginTop: 10,
    paddingVertical: 8,
  },
  rebookCancelText: {
    color: "#7C5F46",
    fontWeight: "800",
  },
  ratingSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexWrap: "wrap",
    marginBottom: 6,
  },
  ratingComment: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    fontStyle: "italic",
    flexShrink: 1,
  },
  ratingBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  ratingCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#EFE3D6",
    paddingHorizontal: 24,
    paddingVertical: 26,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 6,
  },
  ratingIconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  ratingTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 6,
  },
  ratingSubtitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 18,
  },
  ratingRebookHint: {
    fontSize: 12.5,
    fontWeight: "500",
    color: "#9B7A68",
    textAlign: "center",
    marginTop: -12,
    marginBottom: 16,
  },
  ratingStarsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
  },
  ratingInput: {
    width: "100%",
    minHeight: 84,
    backgroundColor: "#FBF7F1",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#111827",
    marginBottom: 18,
  },
  ratingSubmit: {
    width: "100%",
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ratingSubmitDisabled: {
    opacity: 0.5,
  },
  ratingSubmitText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  liveTrackButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  liveTrackButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  violationAppealButton: {
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "#7C5F46",
    alignItems: "center",
  },
  violationAppealButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
