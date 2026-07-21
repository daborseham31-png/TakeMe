// ---------------------------------------------------------------------------
// Forces Arabic-Indic (٠-٩) and Extended Arabic-Indic/Persian (۰-۹) digits to
// plain Western 0-9. The RTL/Arabic keyboard on some devices returns these
// for any numeric field regardless of keyboardType, so every time/code value
// this app stores or compares must be normalized through here before it's
// used — never store or compare a value that might still contain them.
// ---------------------------------------------------------------------------

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export const normalizeToWesternDigits = (value: string): string => {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EXTENDED_ARABIC_INDIC_DIGITS.indexOf(digit)));
};
