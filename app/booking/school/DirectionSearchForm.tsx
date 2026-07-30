// ---------------------------------------------------------------------------
// NEW school-ride search — outbound only / return only / round trip
// (AGENTS.md #4). Searches the NEW schoolTrips collection via
// /booking/school/trip-results, independent of the legacy driverRoutes-based
// LegacySchoolSearchForm reachable from the "Weekly / classic" tab (that
// legacy form has no per-child concept at all, so none of this applies
// there).
//
// School Name / From / To are three fully independent fields, exactly like
// the driver-side creation form (SchoolTripForm.tsx) — the school is never
// used as (and never auto-fills) the From/To area. See AGENTS.md's
// correction: "Nazareth" (From) and "Mashhad" (To) are general trip areas;
// "Mashhad Elementary School" (School) is the exact building, independent
// of them.
//
// Every child slot on this form MUST be linked to a durable
// schoolChildren/{childId} profile (see schoolChildrenLib.ts) — there is no
// free-text "just type a name" path anymore. This is what makes the child's
// own permanent return identification code (schoolChildren.returnCode)
// available to show read-only on this form, and what makes every return
// booking resolvable back to a real child (see useMySchoolRows.tsx's
// childEntryMatchesReturnBooking).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  DirectionalCard,
  DirectionalRow,
  DirectionalText,
  PhysicalDirectionalBlockText,
} from "../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../i18n/LanguageProvider";
import { ltrContentStyle } from "../../i18n/rtl";
import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import DateInput, { TimeInput } from "../../driver/create/DateInput";
import { normalizeDateToYMD, styles } from "../../driver/create/driverHelpers";
import IsraelLocationAutocomplete from "../IsraelLocationAutocomplete";
import { IsraelLocation } from "../israelLocations";
import { resolveLocationCoordinates } from "../locationSearch";
import PickupLocationPicker, { PickupLocation } from "../PickupLocationPicker";
import SchoolAutocomplete from "../SchoolAutocomplete";
import { getLocalizedSchoolName, SchoolLocation } from "../schools";
import { SchoolChild, subscribeMyChildren } from "./schoolChildrenLib";

type DirectionMode = "outbound" | "return" | "roundTrip";

// One draft row per seat/child (AGENTS.md #3 — "each seat may represent a
// different child"). localId is a client-only, session-scoped id (never a
// Firestore id) carried through to SchoolPassengerEntry/RideRequest/
// SchoolBooking once the parent actually searches/books.
//
// childId/schoolId/returnCode are only ever set TOGETHER, as a snapshot
// taken at the moment a saved schoolChildren profile is picked
// (handleSelectChildProfile) — never typed, never edited, never generated
// here. schoolId is kept on the row (not just re-derived from the form's
// own selectedSchool) so a stale selection can be detected and cleared if
// the parent changes the school afterwards (see the selectedSchool effect
// below). returnCode is the child's own PERMANENT return identification
// code, shown read-only under the row — this form only ever reads it, it
// never writes schoolChildren.returnCode.
type ChildEntryDraft = {
  localId: string;
  childId?: string;
  name: string;
  schoolId?: string;
  returnCode?: string;
  returnTime: string;
};

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

  // The outbound leg's real pickup point (see PickupLocationPicker.tsx) —
  // only meaningful for "outbound"/"roundTrip" (see handleSearch). A
  // standalone "return" search's real pickup is the school itself, fixed by
  // the driver at trip creation — never something the passenger picks here.
  const [pickupLocation, setPickupLocation] = useState<PickupLocation | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Round trip only — the return leg's destination ("To"). Its "From" is
  // always the outbound leg's "To" (auto, read-only, never re-entered).
  const [returnToAddress, setReturnToAddress] = useState("");
  const [returnToPlace, setReturnToPlace] = useState<IsraelLocation | null>(null);
  const [returnToError, setReturnToError] = useState("");

  const [date, setDate] = useState(getTodayDate());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [morningTime, setMorningTime] = useState("07:30");
  const [showMorningPicker, setShowMorningPicker] = useState(false);

  // Default return time seeded onto a brand-new child row, and the fallback
  // value for "use the same time for all children" — no longer rendered as
  // its own standalone field (every child row always has its own time
  // picker now, even when there's only one child).
  const [finishTime] = useState("14:00");
  // Which single child row's time picker is open — only one at a time,
  // same "one dropdown/picker open at once" convention used elsewhere.
  const [openChildTimeFor, setOpenChildTimeFor] = useState<string | null>(null);

  const [seats, setSeats] = useState("1");
  const [saving, setSaving] = useState(false);

  const [children, setChildren] = useState<ChildEntryDraft[]>(
    makeChildDrafts(1, finishTime, []),
  );

  // The parent's own durable School Child profiles (see schoolChildrenLib.ts)
  // — a live subscription, so a child added/edited/deactivated on the
  // Manage Children screen (reachable from the empty-state button below)
  // appears here immediately, with no app restart and no manual refresh:
  // this is the SAME onSnapshot listener the whole time the parent
  // navigates to Manage Children and back, never re-subscribed or paused.
  const [myChildren, setMyChildren] = useState<SchoolChild[]>([]);

  useEffect(() => {
    const unsub = subscribeMyChildren((next) => setMyChildren(next.filter((c) => c.active)));
    return unsub;
  }, []);

  // Saved profiles for the CURRENTLY selected school only — a profile
  // belongs to one school (schoolChildrenLib.ts), so a child saved for a
  // different school is never offered here. Compared by schoolId, never by
  // the school's displayed/localized name.
  const childProfilesForSchool = useMemo(
    () => (selectedSchool ? myChildren.filter((c) => c.schoolId === selectedSchool.id) : []),
    [myChildren, selectedSchool],
  );

  useEffect(() => {
    setChildren((prev) => makeChildDrafts(Math.max(1, Number(seats) || 1), finishTime, prev));
    // Only resync the LENGTH when seats changes — finishTime intentionally
    // isn't a dependency here so it never overwrites a child's already-
    // edited time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats]);

  // If the parent changes the selected school AFTER already linking
  // children, any row whose stored schoolId no longer matches the new
  // school is cleared back to unselected — a mismatched child is never
  // silently kept (AGENTS.md's school-matching requirement). Rows with no
  // childId yet are untouched.
  useEffect(() => {
    if (!selectedSchool) return;
    setChildren((prev) =>
      prev.map((c) =>
        c.childId && c.schoolId && c.schoolId !== selectedSchool.id
          ? { localId: c.localId, name: "", returnTime: c.returnTime }
          : c,
      ),
    );
  }, [selectedSchool]);

  const handleChildTimeChange = (localId: string, time: string) => {
    setChildren((prev) => prev.map((c) => (c.localId === localId ? { ...c, returnTime: time } : c)));
  };

  // Picking a saved profile snapshots childId/name/schoolId/returnCode onto
  // THIS row only (matched by its own stable localId — never by array
  // index, never by name, never by return time), leaving every other row
  // untouched. `profile: null` clears the row back to unselected.
  const handleSelectChildProfile = (localId: string, profile: SchoolChild | null) => {
    setChildren((prev) =>
      prev.map((c) =>
        c.localId === localId
          ? profile
            ? {
                ...c,
                childId: profile.id,
                name: profile.childName,
                schoolId: profile.schoolId,
                returnCode: profile.returnCode,
              }
            : { localId: c.localId, name: "", returnTime: c.returnTime }
          : c,
      ),
    );
  };

  const applySameReturnTimeToAll = (time: string) => {
    setChildren((prev) => prev.map((c) => ({ ...c, returnTime: time })));
  };

  // -------------------------------------------------------------------
  // Saved-child picker modal — which row (by localId) it's currently open
  // for. Eligible choices are this school's saved children MINUS whichever
  // ones are already linked to a DIFFERENT row (duplicate protection by
  // childId, never by name/position — see AGENTS.md's requirement that the
  // same child can never be picked into two rows in the same booking).
  // -------------------------------------------------------------------
  const [pickerForLocalId, setPickerForLocalId] = useState<string | null>(null);

  const openChildPicker = (localId: string) => setPickerForLocalId(localId);
  const closeChildPicker = () => setPickerForLocalId(null);

  const eligibleChildrenForPicker = useMemo(() => {
    if (!pickerForLocalId) return [];
    const usedElsewhere = new Set(
      children
        .filter((c) => c.localId !== pickerForLocalId && c.childId)
        .map((c) => c.childId),
    );
    return childProfilesForSchool.filter((profile) => !usedElsewhere.has(profile.id));
  }, [pickerForLocalId, children, childProfilesForSchool]);

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

    if (mode !== "return" && !pickupLocation) {
      Alert.alert(t("auth.missingDetails"), t("pickupLocation.pickupLocationRequired"));
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

    const includedChildren = children.slice(0, cleanSeats);

    // ---------------------------------------------------------------
    // Every included child row must be a real, valid, linked saved-child
    // selection before this ever reaches the search/booking screens — see
    // AGENTS.md: no manually typed unlinked name may ever proceed.
    // ---------------------------------------------------------------

    if (childProfilesForSchool.length === 0) {
      Alert.alert(t("schoolChildren.genericError"), t("schoolChildren.addChildrenFirstMessage"));
      return;
    }

    const missingChild = includedChildren.find((child) => !child.childId);
    if (missingChild) {
      Alert.alert(t("schoolChildren.genericError"), t("schoolChildren.childRequiredError"));
      return;
    }

    const seenChildIds = new Set<string>();
    const duplicateChild = includedChildren.find((child) => {
      if (!child.childId) return false;
      if (seenChildIds.has(child.childId)) return true;
      seenChildIds.add(child.childId);
      return false;
    });
    if (duplicateChild) {
      Alert.alert(t("schoolChildren.genericError"), t("schoolChildren.childAlreadySelectedError"));
      return;
    }

    const mismatchedSchoolChild = includedChildren.find(
      (child) => child.childId && child.schoolId && child.schoolId !== selectedSchool.id,
    );
    if (mismatchedSchoolChild) {
      Alert.alert(t("schoolChildren.genericError"), t("schoolChildren.childSchoolMismatchError"));
      return;
    }

    const missingCodeChild = includedChildren.find((child) => child.childId && !child.returnCode);
    if (missingCodeChild) {
      Alert.alert(
        t("schoolChildren.genericError"),
        t("schoolChildren.missingReturnCodeError", { child: missingCodeChild.name }),
      );
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
      // The actual time to search/notify against for a return leg is the
      // (first) child's OWN return time — set per-row since the per-child
      // return system replaced the single shared return-time field. Reading
      // the unused `finishTime` constant here instead (as this used to,
      // before that change) sends a stale default time no child actually
      // selected, which can miss an otherwise-matching driver trip entirely.
      const requestedTime =
        mode === "return" ? children[0]?.returnTime || finishTime : morningTime;

      // One entry per seat/child (AGENTS.md #3) — every child is now always
      // a real saved-profile selection (childId always present, validated
      // above), with its own requested return time for any return-carrying
      // mode. Never includes schoolId/returnCode here — the permanent code
      // stays out of every booking document (see this file's header); only
      // childId/childName travel onward.
      const childEntries = includedChildren.map((child) => ({
        localId: child.localId,
        childId: child.childId,
        childName: child.name,
        returnRequestedTime: mode === "outbound" ? undefined : child.returnTime || finishTime,
      }));

      let returnParams: Record<string, string> = {};

      if (mode === "roundTrip") {
        const returnToCoords = await resolveLocationCoordinates(
          returnToPlace,
          returnToAddress,
        );

        returnParams = {
          // Same fix as the standalone "return" mode's requestedTime above —
          // the round trip's return leg must search against the first
          // child's own selected return time, not the unused finishTime
          // constant.
          returnRequestedTime: children[0]?.returnTime || finishTime,
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
          // Outbound-only (see the state's own comment above) — a
          // standalone return search never has one.
          ...(pickupLocation
            ? {
                pickupLat: String(pickupLocation.latitude),
                pickupLng: String(pickupLocation.longitude),
                pickupAddress: pickupLocation.address,
                pickupSource: pickupLocation.source,
              }
            : {}),
        },
      } as any);
    } finally {
      setSaving(false);
    }
  };

  // A tappable "Child" field — shows the linked child's name once selected,
  // or a placeholder otherwise. Tapping ALWAYS opens the picker modal for
  // exactly this row (by localId), never any other row.
  const renderChildPickerField = (child: ChildEntryDraft) => (
    <Pressable onPress={() => openChildPicker(child.localId)}>
      <DirectionalRow style={localStyles.childPickerField}>
        <Ionicons
          name="person-circle-outline"
          size={18}
          color={child.childId ? "#3B82F6" : "#8B7B6B"}
        />
        <DirectionalText
          style={[localStyles.childPickerText, !child.childId && localStyles.childPickerPlaceholder]}
          numberOfLines={1}
        >
          {child.childId ? child.name : t("schoolChildren.selectChildPlaceholder")}
        </DirectionalText>
        <Ionicons name="chevron-down" size={16} color="#8B7B6B" />
      </DirectionalRow>
    </Pressable>
  );

  const renderManageChildrenCta = () => (
    <Pressable
      onPress={() => {
        closeChildPicker();
        router.push("/booking/school/my-children" as any);
      }}
    >
      <DirectionalRow style={localStyles.manageChildrenLinkButton}>
        <Ionicons name="people-outline" size={15} color="#3B82F6" />
        <DirectionalText style={localStyles.manageChildrenLinkText}>
          {t("schoolChildren.manageChildrenLink")}
        </DirectionalText>
      </DirectionalRow>
    </Pressable>
  );

  // One row per child — a mandatory saved-child selector + (for a
  // return-carrying row — withTime: true) that child's own permanent return
  // identification code (read-only) and own return time (AGENTS.md #3:
  // never reuse Child 1's time for Child 2/3). Shared by the standalone
  // "return" mode, round trip's return section, and (withTime: false) both
  // outbound contexts (standalone "outbound" mode and round trip's own
  // outbound leg).
  const renderChildSection = (associatedDate: string, withTime: boolean) => {
    if (!selectedSchool) {
      return (
        <View style={localStyles.childrenBox}>
          <PhysicalDirectionalBlockText style={styles.label}>
            {t("schoolChildren.selectChild")}
          </PhysicalDirectionalBlockText>
          <PhysicalDirectionalBlockText style={localStyles.noSavedChildrenHint}>
            {t("schoolTrip.selectSchoolFirst")}
          </PhysicalDirectionalBlockText>
        </View>
      );
    }

    if (childProfilesForSchool.length === 0) {
      return (
        <View style={localStyles.childrenBox}>
          <PhysicalDirectionalBlockText style={styles.label}>
            {t("schoolChildren.selectChild")}
          </PhysicalDirectionalBlockText>
          <View style={localStyles.noChildrenBox}>
            <Ionicons name="people-outline" size={22} color="#B86115" />
            <PhysicalDirectionalBlockText style={localStyles.noChildrenText}>
              {t("schoolChildren.addChildrenFirstMessage")}
            </PhysicalDirectionalBlockText>
            {renderManageChildrenCta()}
          </View>
        </View>
      );
    }

    return (
      <View style={localStyles.childrenBox}>
        <PhysicalDirectionalBlockText style={styles.label}>
          {withTime ? t("schoolTrip.childrenReturnTimesTitle") : t("schoolChildren.selectChild")}
        </PhysicalDirectionalBlockText>

        {children.map((child, index) => (
          <View key={child.localId} style={localStyles.childRow}>
            <PhysicalDirectionalBlockText style={localStyles.childRowTitle}>
              {t("schoolTrip.childNumber", { number: index + 1 })}
            </PhysicalDirectionalBlockText>

            <PhysicalDirectionalBlockText style={localStyles.fieldLabel}>
              {t("schoolChildren.selectChild")}
            </PhysicalDirectionalBlockText>
            {renderChildPickerField(child)}

            {withTime && child.childId ? (
              <DirectionalRow style={localStyles.returnCodeBox}>
                <DirectionalText style={localStyles.returnCodeLabel}>
                  {t("schoolChildren.returnIdentificationCodeLabel")}
                </DirectionalText>
                {child.returnCode ? (
                  <DirectionalText ltr style={localStyles.returnCodeValue}>
                    {child.returnCode}
                  </DirectionalText>
                ) : (
                  <DirectionalText style={localStyles.returnCodeErrorText}>
                    {t("schoolChildren.missingReturnCodeInline")}
                  </DirectionalText>
                )}
              </DirectionalRow>
            ) : null}

            {withTime ? (
              <TimeInput
                label={t("schoolTrip.finishingTime")}
                value={child.returnTime}
                onChange={(value) => handleChildTimeChange(child.localId, value)}
                showPicker={openChildTimeFor === child.localId}
                setShowPicker={(value) => setOpenChildTimeFor(value ? child.localId : null)}
                associatedDate={associatedDate}
              />
            ) : null}
          </View>
        ))}

        {withTime && children.length > 1 ? (
          <Pressable
            onPress={() => applySameReturnTimeToAll(children[0]?.returnTime || finishTime)}
          >
            <DirectionalRow style={localStyles.useSameButton}>
              <Ionicons name="copy-outline" size={15} color="#3B82F6" />
              <DirectionalText style={localStyles.useSameButtonText}>
                {t("schoolTrip.useSameTimeForAll")}
              </DirectionalText>
            </DirectionalRow>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingWrapper>
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View
        style={[
          localStyles.tabRow,
          { direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" },
        ]}
      >
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
            <Text
              style={[
                localStyles.tabText,
                mode === tab.key && localStyles.tabTextActive,
                {
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                },
              ]}
            >
              {t(tab.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        {mode === "roundTrip" ? (
          <DirectionalRow style={localStyles.sectionHeader}>
            <Ionicons name="arrow-up-circle-outline" size={18} color="#3B82F6" />
            <PhysicalDirectionalBlockText style={[localStyles.sectionTitle, { flex: 1 }]}>
              {t("schoolTrip.outboundTrip")}
            </PhysicalDirectionalBlockText>
          </DirectionalRow>
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

        {mode !== "return" ? (
          <>
            <PhysicalDirectionalBlockText style={styles.label}>
              {t("pickupLocation.fieldLabel")}
            </PhysicalDirectionalBlockText>
            <Pressable style={localStyles.pickupField} onPress={() => setPickerVisible(true)}>
              <Ionicons name="location-outline" size={18} color="#7C5F46" />
              <DirectionalText style={localStyles.pickupFieldText} numberOfLines={1}>
                {pickupLocation?.address || t("pickupLocation.notSelectedPlaceholder")}
              </DirectionalText>
              <Ionicons name="chevron-forward" size={16} color="#C7B9AC" />
            </Pressable>
          </>
        ) : null}

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

        <PhysicalDirectionalBlockText style={styles.label}>{t("booking.seats")}</PhysicalDirectionalBlockText>
        <View style={localStyles.seatsRow}>
          <Pressable style={localStyles.seatButton} onPress={decreaseSeats}>
            <Ionicons name="remove" size={20} color="#111827" />
          </Pressable>
          <Text style={[localStyles.seatsNumber, ltrContentStyle]}>{seats}</Text>
          <Pressable style={localStyles.seatButton} onPress={increaseSeats}>
            <Ionicons name="add" size={20} color="#111827" />
          </Pressable>
        </View>

        {renderChildSection(date, mode === "return")}
      </View>

      {mode === "roundTrip" ? (
        <View style={styles.card}>
          <DirectionalRow style={localStyles.sectionHeader}>
            <Ionicons name="arrow-down-circle-outline" size={18} color="#3B82F6" />
            <PhysicalDirectionalBlockText style={[localStyles.sectionTitle, { flex: 1 }]}>
              {t("schoolTrip.returnTrip")}
            </PhysicalDirectionalBlockText>
          </DirectionalRow>

          <PhysicalDirectionalBlockText style={styles.label}>{t("booking.from")}</PhysicalDirectionalBlockText>
          <DirectionalRow style={[styles.inputRow, localStyles.readOnlyRow]}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <DirectionalText style={localStyles.readOnlyText}>
              {toAddress || t("schoolTrip.selectAreaFirst")}
            </DirectionalText>
            <View style={localStyles.autoPill}>
              <DirectionalText style={localStyles.autoPillText}>
                {t("schoolTrip.automatic")}
              </DirectionalText>
            </View>
          </DirectionalRow>

          <View style={{ marginTop: 12 }}>
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
          </View>

          <PhysicalDirectionalBlockText style={styles.label}>{t("schoolTrip.schoolLabel")}</PhysicalDirectionalBlockText>
          <DirectionalRow style={[styles.inputRow, localStyles.readOnlyRow]}>
            <Ionicons name="school-outline" size={18} color="#8B7B6B" />
            <DirectionalText style={localStyles.readOnlyText}>
              {selectedSchool
                ? getLocalizedSchoolName(selectedSchool, language)
                : t("schoolTrip.selectSchoolFirst")}
            </DirectionalText>
            <View style={localStyles.autoPill}>
              <DirectionalText style={localStyles.autoPillText}>
                {t("schoolTrip.automatic")}
              </DirectionalText>
            </View>
          </DirectionalRow>

          {renderChildSection(date, true)}
        </View>
      ) : null}

      <Pressable
        style={[
          localStyles.searchButton,
          { flexDirection: isRTL ? "row-reverse" : "row" },
          saving && { opacity: 0.6 },
        ]}
        onPress={handleSearch}
        disabled={saving}
      >
        <Ionicons name="search-outline" size={18} color="#FFFFFF" />
        <DirectionalText style={localStyles.searchText}>
          {t("booking.searchDrivers")}
        </DirectionalText>
      </Pressable>

      <Modal
        visible={pickerForLocalId !== null}
        animationType="slide"
        transparent
        onRequestClose={closeChildPicker}
      >
        <View style={localStyles.modalOverlay}>
          <Pressable style={localStyles.modalBackdrop} onPress={closeChildPicker} />

          <DirectionalCard style={localStyles.modalCard}>
            <View style={localStyles.modalHandle} />
            <PhysicalDirectionalBlockText style={localStyles.modalTitle}>
              {t("schoolChildren.selectChild")}
            </PhysicalDirectionalBlockText>
            <PhysicalDirectionalBlockText style={localStyles.modalSubtitle}>
              {t("schoolChildren.chooseSavedChildHint")}
            </PhysicalDirectionalBlockText>

            {eligibleChildrenForPicker.length === 0 ? (
              <View style={localStyles.noChildrenBox}>
                <Ionicons name="people-outline" size={22} color="#B86115" />
                <PhysicalDirectionalBlockText style={localStyles.noChildrenText}>
                  {t("schoolChildren.addChildrenFirstMessage")}
                </PhysicalDirectionalBlockText>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                {eligibleChildrenForPicker.map((profile) => (
                  <Pressable
                    key={profile.id}
                    onPress={() => {
                      if (pickerForLocalId) handleSelectChildProfile(pickerForLocalId, profile);
                      closeChildPicker();
                    }}
                  >
                    <DirectionalRow style={localStyles.modalChildRow}>
                      <Ionicons name="person-circle-outline" size={20} color="#3B82F6" />
                      <DirectionalText style={localStyles.modalChildRowText}>
                        {profile.childName}
                      </DirectionalText>
                    </DirectionalRow>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {renderManageChildrenCta()}

            <Pressable style={localStyles.modalCancelButton} onPress={closeChildPicker}>
              <DirectionalText style={localStyles.modalCancelText}>
                {t("schoolChildren.cancel")}
              </DirectionalText>
            </Pressable>
          </DirectionalCard>
        </View>
      </Modal>

      <PickupLocationPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={setPickupLocation}
      />
    </ScrollView>
    </KeyboardAvoidingWrapper>
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
    color: "#3B82F6",
    fontSize: 12.5,
    marginBottom: 8,
    textTransform: "uppercase" as const,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800" as const,
    color: "#7C5F46",
    marginBottom: 6,
  },
  noSavedChildrenHint: {
    color: "#8B7B6B",
    fontSize: 12,
    fontWeight: "600" as const,
    marginBottom: 10,
  },
  noChildrenBox: {
    alignItems: "center" as const,
    backgroundColor: "#FFF8F0",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  noChildrenText: {
    color: "#7C5F46",
    fontWeight: "700" as const,
    fontSize: 13,
    textAlign: "center" as const,
  },
  manageChildrenLinkButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#3B82F6",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  manageChildrenLinkText: {
    color: "#3B82F6",
    fontWeight: "900" as const,
    fontSize: 13,
  },
  pickupField: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },
  pickupFieldText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700" as const,
    fontSize: 14.5,
  },
  childPickerField: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  childPickerText: {
    flex: 1,
    color: "#111827",
    fontWeight: "800" as const,
    fontSize: 14.5,
  },
  childPickerPlaceholder: {
    color: "#8B7B6B",
    fontWeight: "600" as const,
  },
  returnCodeBox: {
    marginTop: 10,
    backgroundColor: "#F3ECE3",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  returnCodeLabel: {
    color: "#7C5F46",
    fontWeight: "800" as const,
    fontSize: 12,
  },
  returnCodeValue: {
    color: "#111827",
    fontWeight: "900" as const,
    fontSize: 16,
    letterSpacing: 2,
    writingDirection: "ltr" as const,
  },
  returnCodeErrorText: {
    color: "#B91C1C",
    fontWeight: "800" as const,
    fontSize: 11.5,
    flexShrink: 1,
  },
  useSameButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
  },
  useSameButtonText: {
    color: "#3B82F6",
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
    color: "#3B82F6",
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
    backgroundColor: "#3B82F6",
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end" as const,
  },
  modalBackdrop: {
    ...({ position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 }),
  },
  modalCard: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: "85%" as const,
  },
  modalHandle: {
    alignSelf: "center" as const,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2D8CF",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900" as const,
    color: "#111827",
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: "#7C5F46",
    fontWeight: "600" as const,
    marginTop: 2,
    marginBottom: 14,
  },
  modalChildRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    backgroundColor: "#FFFFFF",
  },
  modalChildRowText: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: "#111827",
  },
  modalCancelButton: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: "center" as const,
  },
  modalCancelText: {
    color: "#7C5F46",
    fontWeight: "800" as const,
  },
};
