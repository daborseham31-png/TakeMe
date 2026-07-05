import { router } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert, StyleSheet } from "react-native";

import { auth, db } from "../../../firebase";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const languageOptions = [
  { key: "ar", label: "Arabic" },
  { key: "he", label: "Hebrew" },
  { key: "en", label: "English" },
  { key: "ru", label: "Russian" },
];

export const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Text / number helpers
// ---------------------------------------------------------------------------

export const normalize = (value: string) => {
  return value.trim().toLowerCase();
};

export const getDigitsOnly = (value: string) => {
  return value.replace(/\D/g, "");
};

export const normalizePhoneFromAccount = (value: any) => {
  const digits = String(value || "").replace(/\D/g, "");

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

export const normalizeLanguagesFromAccount = (data: any) => {
  const rawLanguages =
    data.languages ||
    data.language ||
    data.lang ||
    data.userLanguage ||
    data.selectedLanguage ||
    "";

  const toCode = (value: any) => {
    const clean = String(value || "")
      .trim()
      .toLowerCase();

    if (
      clean === "ar" ||
      clean === "arabic" ||
      clean === "عربي" ||
      clean === "العربية"
    ) {
      return "ar";
    }

    if (clean === "he" || clean === "hebrew" || clean === "עברית") {
      return "he";
    }

    if (clean === "en" || clean === "english") {
      return "en";
    }

    if (clean === "ru" || clean === "russian" || clean === "русский") {
      return "ru";
    }

    return "";
  };

  if (Array.isArray(rawLanguages)) {
    return rawLanguages
      .map(toCode)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  const singleLanguage = toCode(rawLanguages);

  return singleLanguage ? [singleLanguage] : [];
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export const formatDateToYMD = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export const parseDateInput = (dateText: string) => {
  const value = dateText.trim();

  let year: number;
  let month: number;
  let day: number;

  const ymdMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmyMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (ymdMatch) {
    year = Number(ymdMatch[1]);
    month = Number(ymdMatch[2]);
    day = Number(ymdMatch[3]);
  } else if (dmyMatch) {
    day = Number(dmyMatch[1]);
    month = Number(dmyMatch[2]);
    year = Number(dmyMatch[3]);
  } else {
    return null;
  }

  const parsedDate = new Date(year, month - 1, day);

  const isRealDate =
    parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 &&
    parsedDate.getDate() === day;

  if (!isRealDate) return null;

  parsedDate.setHours(0, 0, 0, 0);

  return parsedDate;
};

export const isTodayOrFutureDate = (date: Date) => {
  const selectedDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return selectedDate >= today;
};

export const normalizeDateToYMD = (dateText: string) => {
  const parsedDate = parseDateInput(dateText);

  if (!parsedDate) return null;
  if (!isTodayOrFutureDate(parsedDate)) return null;

  return formatDateToYMD(parsedDate);
};

export const getDayFromDate = (date: Date) => {
  return dayNames[date.getDay()];
};

export const getDayFromDateText = (dateText: string) => {
  const cleanDate = normalizeDateToYMD(dateText);

  if (!cleanDate) return "";

  const parsedDate = parseDateInput(cleanDate);

  if (!parsedDate) return "";

  return getDayFromDate(parsedDate);
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export const normalizeTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
};

export const timeToMinutes = (timeValue: string) => {
  const cleanTime = normalizeTime(timeValue);

  if (!cleanTime) return null;

  const [hours, minutes] = cleanTime.split(":").map(Number);

  return hours * 60 + minutes;
};

export const cleanTimeInput = (value: string) => {
  return value.replace(/[^\d:]/g, "").slice(0, 5);
};

export const formatTimeToHM = (date: Date) => {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
};

export const parseTimeToDate = (value: string) => {
  const cleanTime = normalizeTime(value);
  const date = new Date();

  if (cleanTime) {
    const [hours, minutes] = cleanTime.split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
  } else {
    date.setSeconds(0, 0);
  }

  return date;
};

// ---------------------------------------------------------------------------
// Account validation shared by every create page
// ---------------------------------------------------------------------------

export type AccountInfo = {
  cleanPhone: string;
  cleanDriverAge: number;
};

export const validateAccountInfo = (
  driverName: string,
  phone: string,
  driverAge: string,
): AccountInfo | null => {
  const cleanPhone = normalizePhoneFromAccount(phone);
  const cleanDriverAge = Number(driverAge);

  if (!driverName.trim()) {
    Alert.alert(
      "Missing name",
      "Your name is missing from your account profile.",
    );
    return null;
  }

  if (cleanPhone.length !== 10) {
    Alert.alert(
      "Invalid phone",
      "Your phone number in your account must be exactly 10 digits.",
    );
    return null;
  }

  if (
    Number.isNaN(cleanDriverAge) ||
    cleanDriverAge < 18 ||
    cleanDriverAge > 80
  ) {
    Alert.alert(
      "Invalid age",
      "Your age in your account must be between 18 and 80.",
    );
    return null;
  }

  return {
    cleanPhone,
    cleanDriverAge,
  };
};

// ---------------------------------------------------------------------------
// Shared hook: loads the signed-in user's account info
// ---------------------------------------------------------------------------

export const useDriverAccount = () => {
  const [driverName, setDriverName] = useState("");
  const [phone, setPhone] = useState("");
  const [driverAge, setDriverAge] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [languages, setLanguages] = useState<string[]>([]);

  useEffect(() => {
    const loadDriverInfo = async () => {
      const user = auth.currentUser;

      if (!user) {
        router.replace("/");
        return;
      }

      const userSnap = await getDoc(doc(db, "users", user.uid));

      if (userSnap.exists()) {
        const data = userSnap.data();

        setDriverName(data.name || "");
        setPhone(normalizePhoneFromAccount(data.phone));

        const profileAge =
          data.age || data.driverAge || data.userAge || data.birthAge || "";

        setDriverAge(getDigitsOnly(String(profileAge)));

        if (data.gender === "Female" || data.gender === "female") {
          setGender("female");
        } else {
          setGender("male");
        }

        setLanguages(normalizeLanguagesFromAccount(data));
      }
    };

    loadDriverInfo();
  }, []);

  const toggleLanguage = (lang: string) => {
    setLanguages((prev) =>
      prev.includes(lang)
        ? prev.filter((item) => item !== lang)
        : [...prev, lang],
    );
  };

  return {
    driverName,
    phone,
    driverAge,
    gender,
    setGender,
    languages,
    toggleLanguage,
  };
};

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

export const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 16,
    paddingTop: 45,
    paddingBottom: 40,
  },
  backButton: {
    width: 42,
    height: 42,
    justifyContent: "center",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 24,
  },
  subtitleSmall: {
    fontSize: 13,
    color: "#7C5F46",
    marginTop: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 9,
    marginTop: 16,
  },
  profileBox: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    backgroundColor: "#FFFDFC",
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  profileLabel: {
    color: "#7C5F46",
    fontWeight: "800",
  },
  profileValue: {
    color: "#111827",
    fontWeight: "900",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: "#111827",
    marginBottom: 10,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  calendarButton: {
    width: 42,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  rowInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    color: "#111827",
  },
  autoDayText: {
    color: "#F58220",
    fontWeight: "900",
    marginTop: 8,
  },
  licenseButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  licenseButtonText: {
    color: "#111827",
    fontWeight: "800",
  },
  licensePreview: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    marginTop: 6,
    marginBottom: 10,
  },
  tripGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tripType: {
    width: "31.8%",
    minHeight: 100,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    backgroundColor: "#FFFFFF",
  },
  tripTypeActive: {
    borderColor: "#F58220",
    backgroundColor: "#FFF8F2",
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  tripText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
  },
  optionRow: {
    flexDirection: "row",
    gap: 8,
  },
  optionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  optionButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  optionText: {
    color: "#7C5F46",
    fontWeight: "800",
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  languageButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  languageButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  languageText: {
    color: "#7C5F46",
    fontWeight: "700",
  },
  languageTextActive: {
    color: "#FFFFFF",
  },
  submitButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
  daySettingsBox: {
    marginTop: 4,
  },
  dayItem: {
    paddingVertical: 12,
  },
  dayItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1E7DD",
  },
  dayTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  dayFieldsRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  dayFieldColumn: {
    flex: 1,
  },
  weeklySeatsRow: {
    height: 50,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    backgroundColor: "#FFFDFC",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  weeklySeatButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  weeklySeatsNumber: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    minWidth: 24,
    textAlign: "center",
  },
});
