// ---------------------------------------------------------------------------
// NEW school-ride search — outbound only / return only / round trip
// (AGENTS.md #4). Searches the NEW schoolTrips collection via
// /booking/school/trip-results, independent of the legacy driverRoutes-based
// LegacySchoolSearchForm reachable from the "Weekly / classic" tab.
//
// School Name / From / To are three fully independent fields, exactly like
// the driver-side creation form (SchoolTripForm.tsx) — the school is never
// used as (and never auto-fills) the From/To area. See AGENTS.md's
// correction: "Nazareth" (From) and "Mashhad" (To) are general trip areas;
// "Mashhad Elementary School" (School) is the exact building, independent
// of them.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import DateInput, { TimeInput } from "../../driver/create/DateInput";
import { normalizeDateToYMD, styles } from "../../driver/create/driverHelpers";
import IsraelLocationAutocomplete from "../IsraelLocationAutocomplete";
import { IsraelLocation } from "../israelLocations";
import { resolveLocationCoordinates } from "../locationSearch";
import SchoolAutocomplete from "../SchoolAutocomplete";
import { getLocalizedSchoolName, SchoolLocation } from "../schools";

type DirectionMode = "outbound" | "return" | "roundTrip";

// One draft row per seat/child (AGENTS.md #3 — "each seat may represent a
// different child"). localId is a client-only, session-scoped id (never a
// Firestore id) carried through to SchoolPassengerEntry/RideRequest/
// SchoolBooking once the parent actually searches/books. Kept local to this
// form; trip-results.tsx re-derives its own working copy from the
// `childEntries` param this screen serializes on search.
type ChildEntryDraft = { localId: string; name: string; returnTime: string };

const makeLocalId = () => `child_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const makeChildDrafts = (count: number, defaultTime: string, previous: ChildEntryDraft[]) =>
  Array.from({ length: count }, (_, index) => {
    const existing = previous[index];
    return existing
      ? existing
      : { localId: makeLocalId(), name: "", returnTime: defaultTime };
  });

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function DirectionSearchForm() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();

  const [mode, setMode] = useState<DirectionMode>("roundTrip");

  const [schoolQuery, setSchoolQuery] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolLocation | null>(null);
  const [schoolError, setSchoolError] = useState("");

  // Outbound leg's From/To (also used as-is for standalone "return" mode,
  // where From means the school's area and To means the passenger's home —
  // see the dynamic labels below). Never auto-filled from the school pick.
  const [fromAddress, setFromAddress] = useState("");
  const [fromPlace, setFromPlace] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");

  const [toAddress, setToAddress] = useState("");
  const [toPlace, setToPlace] = useState<IsraelLocation | null>(null);
  const [toError, setToError] = useState("");

  // Round trip only — the return leg's destination ("To"). Its "From" is
  // always the outbound leg's "To" (auto, read-only, never re-entered).
  const [returnToAddress, setReturnToAddress] = useState("");
  const [returnToPlace, setReturnToPlace] = useState<IsraelLocation | null>(null);
  const [returnToError, setReturnToError] = useState("");

  const [date, setDate] = useState(getTodayDate());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [morningTime, setMorningTime] = useState("07:30");
  const [showMorningPicker, setShowMorningPicker] = useState(false);

  const [finishTime, setFinishTime] = useState("14:00");
  const [showFinishPicker, setShowFinishPicker] = useState(false);
  // Which single child row's time picker is open — only one at a time,
  // same "one dropdown/picker open at once" convention used elsewhere.
  const [openChildTimeFor, setOpenChildTimeFor] = useState<string | null>(null);

  const [seats, setSeats] = useState("1");
  const [saving, setSaving] = useState(false);

  // Per-child return times — only meaningful once a return leg exists
  // (mode "return"/"roundTrip") AND there's more than one seat/child. Kept
  // in sync with `seats` below rather than recomputed ad hoc, so editing an
  // individual child's time/name survives increasing/decreasing the seat
  // count by an unrelated amount.
  const [children, setChildren] = useState<ChildEntryDraft[]>(
    makeChildDrafts(1, finishTime, []),
  );
  const showPerChildReturn = mode !== "outbound" && Number(seats) > 1;

  useEffect(() => {
    setChildren((prev) => makeChildDrafts(Math.max(1, Number(seats) || 1), finishTime, prev));
    // Only resync the LENGTH when seats changes — finishTime intentionally
    // isn't a dependency here so it never overwrites a child's already-
    // edited time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats]);

  const handleChildNameChange = (localId: string, name: string) => {
    setChildren((prev) => prev.map((c) => (c.localId === localId ? { ...c, name } : c)));
  };

  const handleChildTimeChange = (localId: string, time: string) => {
    setChildren((prev) => prev.map((c) => (c.localId === localId ? { ...c, returnTime: time } : c)));
  };

  const applySameReturnTimeToAll = (time: string) => {
    setChildren((prev) => prev.map((c) => ({ ...c, returnTime: time })));
  };

  const handleSchoolChange = (text: string) => {
    setSchoolQuery(text);
    setSelectedSchool(null);
    if (schoolError) setSchoolError("");
  };

  const handleFromChange = (text: string) => {
    setFromAddress(text);
    setFromPlace(null);
    if (fromError) setFromError("");

    // School suggestions are scoped to whichever area represents the
    // school's own location (fromArea for a return search) — a school
    // picked for a previous area is never silently kept once that area
    // changes (AGENTS.md's schoolSearchArea rule).
    if (mode === "return") {
      setSchoolQuery("");
      setSelectedSchool(null);
    }
  };

  const handleToChange = (text: string) => {
    setToAddress(text);
    setToPlace(null);
    if (toError) setToError("");

    // Same as above, for outbound/round-trip searches where the school's
    // area is the To field.
    if (mode !== "return") {
      setSchoolQuery("");
      setSelectedSchool(null);
    }
  };

  const handleReturnToChange = (text: string) => {
    setReturnToAddress(text);
    setReturnToPlace(null);
    if (returnToError) setReturnToError("");
  };

  const decreaseSeats = () => setSeats((prev) => String(Math.max(1, Number(prev) - 1)));
  const increaseSeats = () => setSeats((prev) => String(Math.min(8, Number(prev) + 1)));

  const handleModeChange = (nextMode: DirectionMode) => {
    setMode(nextMode);
    // Each mode's From/To have a different meaning (see dynamic labels) —
    // switching modes clears them so a value picked for one meaning is
    // never silently reused with a different meaning.
    setFromAddress("");
    setFromPlace(null);
    setToAddress("");
    setToPlace(null);
    setReturnToAddress("");
    setReturnToPlace(null);
    setSchoolQuery("");
    setSelectedSchool(null);
    setChildren(makeChildDrafts(Math.max(1, Number(seats) || 1), finishTime, []));
  };

  const fromLabel =
    mode === "return" ? t("schoolTrip.schoolAreaLabel") : t("schoolTrip.homePickupLabel");
  const toLabel =
    mode === "return" ? t("schoolTrip.homeDestinationLabel") : t("schoolTrip.schoolAreaLabel");

  // AGENTS.md's schoolSearchArea rule: outbound searches schools near the To
  // area, return searches schools near the From area (the school's own
  // location for a return trip).
  const schoolAreaLocationId = mode === "return" ? fromPlace?.id ?? null : toPlace?.id ?? null;

  const handleSearch = async () => {
    if (!selectedSchool) {
      setSchoolError(t("schoolTrip.selectSchoolFromList"));
      return;
    }

    if (!fromPlace) {
      setFromError(t("validation.selectLocationFromList"));
      return;
    }

    if (!toPlace) {
      setToError(t("validation.selectLocationFromList"));
      return;
    }

    if (mode === "roundTrip" && !returnToPlace) {
      setReturnToError(t("validation.selectLocationFromList"));
      return;
    }

    const cleanDate = normalizeDateToYMD(date);
    if (!cleanDate) {
      Alert.alert(t("validation.invalidDateTitle"), t("validation.invalidDateFuture"));
      return;
    }

    const cleanSeats = Number(seats);
    if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
      Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
      return;
    }

    try {
      setSaving(true);

      const fromCoords = await resolveLocationCoordinates(fromPlace, fromAddress);
      const toCoords = await resolveLocationCoordinates(toPlace, toAddress);

      const schoolParams = {
        schoolId: selectedSchool.id,
        // Localized for display only (header subtitles downstream) — the
        // real Hebrew name is always re-read from the trip document itself
        // (schoolId → schoolTrips) wherever it's actually booked/stored.
        schoolName: getLocalizedSchoolName(selectedSchool, language),
        schoolAddress: selectedSchool.city,
        schoolLat: String(selectedSchool.latitude),
        schoolLng: String(selectedSchool.longitude),
      };

      const areaParams = {
        fromArea: fromAddress,
        fromLat: fromCoords ? String(fromCoords.latitude) : "",
        fromLng: fromCoords ? String(fromCoords.longitude) : "",
        toArea: toAddress,
        toLat: toCoords ? String(toCoords.latitude) : "",
        toLng: toCoords ? String(toCoords.longitude) : "",
      };

      const direction = mode === "return" ? "from_school" : "to_school";
      const requestedTime = mode === "return" ? finishTime : morningTime;

      // One entry per seat/child (AGENTS.md #3) — every child always gets
      // its own localId + optional name; a return-carrying mode also gives
      // each child its own requested return time (never Child 1's time
      // reused for Child 2/3). Outbound-only search still produces entries
      // (for outbound booking tagging later) but with no per-child time.
      const activeChildren = mode === "outbound" ? makeChildDrafts(cleanSeats, "", []) : children;
      const childEntries = activeChildren.slice(0, cleanSeats).map((child) => ({
        localId: child.localId,
        childName: child.name.trim() || undefined,
        returnRequestedTime: mode === "outbound" ? undefined : child.returnTime || finishTime,
      }));

      let returnParams: Record<string, string> = {};

      if (mode === "roundTrip") {
        const returnToCoords = await resolveLocationCoordinates(
          returnToPlace,
          returnToAddress,
        );

        returnParams = {
          returnRequestedTime: finishTime,
          returnToArea: returnToAddress,
          returnToLat: returnToCoords ? String(returnToCoords.latitude) : "",
          returnToLng: returnToCoords ? String(returnToCoords.longitude) : "",
          returnChildEntries: JSON.stringify(childEntries),
        };
      }

      router.push({
        pathname: "/booking/school/trip-results",
        params: {
          direction,
          ...schoolParams,
          ...areaParams,
          date: cleanDate,
          requestedTime,
          seats: String(cleanSeats),
          roundTrip: mode === "roundTrip" ? "true" : "false",
          // Always present — the outbound leg needs its own roster too (to
          // tag a shared multi-child booking, see trip-confirm.tsx), not
          // only a standalone return search.
          childEntries: JSON.stringify(childEntries),
          ...returnParams,
        },
      } as any);
    } finally {
      setSaving(false);
    }
  };

  // One row per child — name (optional) + that child's own return time
  // (AGENTS.md #3: never reuse Child 1's time for Child 2/3). Shared by the
  // standalone "return" mode and round trip's return section below.
  const renderChildRows = (associatedDate: string) => (
    <View style={localStyles.childrenBox}>
      <Text style={[styles.label, isRTL && { textAlign: "right" }]}>
        {t("schoolTrip.childrenReturnTimesTitle")}
      </Text>

      {children.map((child, index) => (
        <View key={child.localId} style={localStyles.childRow}>
          <Text style={localStyles.childRowTitle}>
            {t("schoolTrip.childNumber", { number: index + 1 })}
          </Text>

          <TextInput
            style={[styles.input, isRTL && { textAlign: "right" }]}
            placeholder={t("schoolTrip.childName")}
            placeholderTextColor="#8B7B6B"
            value={child.name}
            onChangeText={(text) => handleChildNameChange(child.localId, text)}
          />

          <TimeInput
            label={t("schoolTrip.finishingTime")}
            value={child.returnTime}
            onChange={(value) => handleChildTimeChange(child.localId, value)}
            showPicker={openChildTimeFor === child.localId}
            setShowPicker={(value) => setOpenChildTimeFor(value ? child.localId : null)}
            associatedDate={associatedDate}
          />
        </View>
      ))}

      <Pressable
        style={localStyles.useSameButton}
        onPress={() => applySameReturnTimeToAll(children[0]?.returnTime || finishTime)}
      >
        <Ionicons name="copy-outline" size={15} color="#F58220" />
        <Text style={localStyles.useSameButtonText}>{t("schoolTrip.useSameTimeForAll")}</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={localStyles.tabRow}>
        {(
          [
            { key: "outbound", labelKey: "schoolTrip.outboundOnly" },
            { key: "return", labelKey: "schoolTrip.returnOnly" },
            { key: "roundTrip", labelKey: "schoolTrip.roundTrip" },
          ] as const
        ).map((tab) => (
          <Pressable
            key={tab.key}
            style={[localStyles.tab, mode === tab.key && localStyles.tabActive]}
            onPress={() => handleModeChange(tab.key)}
          >
            <Text style={[localStyles.tabText, mode === tab.key && localStyles.tabTextActive]}>
              {t(tab.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        {mode === "roundTrip" ? (
          <View style={localStyles.sectionHeader}>
            <Ionicons name="arrow-up-circle-outline" size={18} color="#F58220" />
            <Text style={localStyles.sectionTitle}>{t("schoolTrip.outboundTrip")}</Text>
          </View>
        ) : null}

        <IsraelLocationAutocomplete
          label={fromLabel}
          value={fromAddress}
          onChangeText={handleFromChange}
          onSelectLocation={(location) => {
            setFromPlace(location);
            setFromError("");

            // Round trip only: default the return leg's destination to
            // "back home" (the outbound From) the first time it's picked —
            // still fully editable afterwards, never re-copied on a later
            // change (see handleReturnToChange). Uses the location's own
            // english name rather than the `fromAddress` state, which is
            // still the pre-update value inside this same event.
            if (mode === "roundTrip" && !returnToAddress) {
              setReturnToAddress(location.english);
              setReturnToPlace(location);
            }
          }}
          placeholder={t("booking.enterDepartureCity")}
          error={fromError}
        />

        <IsraelLocationAutocomplete
          label={toLabel}
          value={toAddress}
          onChangeText={handleToChange}
          onSelectLocation={(location) => {
            setToPlace(location);
            setToError("");
          }}
          placeholder={t("booking.enterDestinationCity")}
          error={toError}
        />

        <SchoolAutocomplete
          label={t("schoolTrip.schoolLabel")}
          value={schoolQuery}
          onChangeText={handleSchoolChange}
          onSelectSchool={(school) => {
            setSelectedSchool(school);
            setSchoolError("");
          }}
          areaLocationId={schoolAreaLocationId}
          error={schoolError}
        />

        <DateInput
          label={t("booking.tripDate")}
          value={date}
          onChange={setDate}
          showPicker={showDatePicker}
          setShowPicker={setShowDatePicker}
        />

        {mode !== "return" ? (
          <TimeInput
            label={t("schoolTrip.morningRideTime")}
            value={morningTime}
            onChange={setMorningTime}
            showPicker={showMorningPicker}
            setShowPicker={setShowMorningPicker}
            associatedDate={date}
          />
        ) : null}

        {mode === "return" && !showPerChildReturn ? (
          <TimeInput
            label={t("schoolTrip.endOfSchoolTime")}
            value={finishTime}
            onChange={(value) => {
              setFinishTime(value);
              // Single-child case: keep the one child entry's own time in
              // sync so a later seat increase starts from this value.
              setChildren((prev) => prev.map((c) => ({ ...c, returnTime: value })));
            }}
            showPicker={showFinishPicker}
            setShowPicker={setShowFinishPicker}
            associatedDate={date}
          />
        ) : null}

        <Text style={[styles.label, isRTL && { textAlign: "right" }]}>{t("booking.seats")}</Text>
        <View style={localStyles.seatsRow}>
          <Pressable style={localStyles.seatButton} onPress={decreaseSeats}>
            <Ionicons name="remove" size={20} color="#111827" />
          </Pressable>
          <Text style={localStyles.seatsNumber}>{seats}</Text>
          <Pressable style={localStyles.seatButton} onPress={increaseSeats}>
            <Ionicons name="add" size={20} color="#111827" />
          </Pressable>
        </View>

        {mode === "return" && showPerChildReturn ? renderChildRows(date) : null}
      </View>

      {mode === "roundTrip" ? (
        <View style={styles.card}>
          <View style={localStyles.sectionHeader}>
            <Ionicons name="arrow-down-circle-outline" size={18} color="#3B82F6" />
            <Text style={localStyles.sectionTitle}>{t("schoolTrip.returnTrip")}</Text>
          </View>

          <Text style={styles.label}>{t("booking.from")}</Text>
          <View style={[styles.inputRow, localStyles.readOnlyRow]}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <Text style={localStyles.readOnlyText}>
              {toAddress || t("schoolTrip.selectAreaFirst")}
            </Text>
            <View style={localStyles.autoPill}>
              <Text style={localStyles.autoPillText}>{t("schoolTrip.automatic")}</Text>
            </View>
          </View>

          <IsraelLocationAutocomplete
            label={t("schoolTrip.homeDestinationLabel")}
            value={returnToAddress}
            onChangeText={handleReturnToChange}
            onSelectLocation={(location) => {
              setReturnToPlace(location);
              setReturnToError("");
            }}
            placeholder={t("booking.enterDestinationCity")}
            error={returnToError}
          />

          <Text style={styles.label}>{t("schoolTrip.schoolLabel")}</Text>
          <View style={[styles.inputRow, localStyles.readOnlyRow]}>
            <Ionicons name="school-outline" size={18} color="#8B7B6B" />
            <Text style={localStyles.readOnlyText}>
              {selectedSchool
                ? getLocalizedSchoolName(selectedSchool, language)
                : t("schoolTrip.selectSchoolFirst")}
            </Text>
            <View style={localStyles.autoPill}>
              <Text style={localStyles.autoPillText}>{t("schoolTrip.automatic")}</Text>
            </View>
          </View>

          {showPerChildReturn ? (
            renderChildRows(date)
          ) : (
            <TimeInput
              label={t("schoolTrip.endOfSchoolTime")}
              value={finishTime}
              onChange={(value) => {
                setFinishTime(value);
                setChildren((prev) => prev.map((c) => ({ ...c, returnTime: value })));
              }}
              showPicker={showFinishPicker}
              setShowPicker={setShowFinishPicker}
              associatedDate={date}
            />
          )}
        </View>
      ) : null}

      <Pressable
        style={[localStyles.searchButton, saving && { opacity: 0.6 }]}
        onPress={handleSearch}
        disabled={saving}
      >
        <Ionicons name="search-outline" size={18} color="#FFFFFF" />
        <Text style={localStyles.searchText}>{t("booking.searchDrivers")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const localStyles = {
  childrenBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#F0E5DC",
  },
  childRow: {
    backgroundColor: "#FFFDFC",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  childRowTitle: {
    fontWeight: "900" as const,
    color: "#F58220",
    fontSize: 12.5,
    marginBottom: 8,
    textTransform: "uppercase" as const,
  },
  useSameButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
  },
  useSameButtonText: {
    color: "#F58220",
    fontWeight: "800" as const,
    fontSize: 13,
  },
  tabRow: {
    flexDirection: "row" as const,
    backgroundColor: "#F3ECE3",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center" as const,
  },
  tabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  tabText: {
    fontWeight: "800" as const,
    color: "#7C5F46",
    fontSize: 12.5,
  },
  tabTextActive: {
    color: "#F58220",
  },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "900" as const,
    color: "#111827",
  },
  readOnlyRow: {
    backgroundColor: "#F3ECE3",
    marginBottom: 18,
    justifyContent: "space-between" as const,
  },
  readOnlyText: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    color: "#5B4A3A",
    fontWeight: "700" as const,
  },
  autoPill: {
    backgroundColor: "#E2D8CF",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  autoPillText: {
    fontSize: 10.5,
    fontWeight: "900" as const,
    color: "#5B4A3A",
  },
  seatsRow: {
    minHeight: 46,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    backgroundColor: "#FFFDFC",
    paddingHorizontal: 10,
    marginTop: 8,
  },
  seatButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#FFFFFF",
  },
  seatsNumber: {
    fontSize: 20,
    fontWeight: "900" as const,
    color: "#111827",
    minWidth: 28,
    textAlign: "center" as const,
  },
  searchButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 4,
  },
  searchText: {
    color: "#FFFFFF",
    fontWeight: "900" as const,
    fontSize: 16,
  },
};
