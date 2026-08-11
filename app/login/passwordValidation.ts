// ---------------------------------------------------------------------------
// Shared password strength policy — the ONE place the "strong password"
// rule set is defined, so every screen where a user actually chooses a new
// password (Sign Up today; any future in-app Change Password screen) checks
// the exact same requirements instead of re-implementing its own regex.
// Deliberately dependency-free (no react-native/firebase/expo imports) so
// it's importable from any screen AND unit-testable under vitest's plain-
// Node config — see this project's other *Core.ts files for the same
// reasoning (this file doesn't need an impure sibling, since nothing here
// touches Firestore/Auth — it's pure string evaluation end to end).
//
// This policy is ONLY for choosing/creating a password (Sign Up) — it must
// never be applied to the LOGIN screen (app/index.tsx), which only checks an
// existing password against Firebase Auth and must keep accepting a
// pre-existing driver/passenger's older, weaker password unchanged.
//
// The password-reset web page (web-reset-password/reset-password.html) is a
// STANDALONE static HTML/JS file deployed via Firebase Hosting, outside this
// Expo app's bundle entirely (see that file's own header) — it cannot
// import this module, so it re-implements these exact same five rules in
// plain JS. If this policy ever changes, update both places.
// ---------------------------------------------------------------------------

export type PasswordRequirementKey =
  | "minLength"
  | "uppercase"
  | "lowercase"
  | "number"
  | "specialChar";

export type PasswordRequirementResult = {
  key: PasswordRequirementKey;
  passed: boolean;
};

export const PASSWORD_MIN_LENGTH = 8;

// A broad, explicit set of common special characters — not "anything
// non-alphanumeric" (which would also silently accept e.g. accented letters
// or emoji as satisfying this requirement). Covers every example in the
// product spec (! @ # $ % ^ & * ( ) _ + - =) plus other common punctuation a
// real password manager might generate.
const SPECIAL_CHAR_REGEX = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/;

// Maps each requirement to the i18n key its checklist label lives under
// (see app/components/PasswordRequirementsChecklist.tsx, the one place
// these are ever rendered) — kept here, next to the rule it labels, so the
// two can never drift out of sync.
export const PASSWORD_REQUIREMENT_I18N_KEY: Record<PasswordRequirementKey, string> = {
  minLength: "auth.passwordReqMinLength",
  uppercase: "auth.passwordReqUppercase",
  lowercase: "auth.passwordReqLowercase",
  number: "auth.passwordReqNumber",
  specialChar: "auth.passwordReqSpecialChar",
};

// One entry per rule, in the exact order the UI checklist displays them —
// used to drive a LIVE checklist that updates on every keystroke (the
// caller just re-evaluates this on the current password state; there is no
// hidden/debounced state here).
export const evaluatePasswordRequirements = (
  password: string,
): PasswordRequirementResult[] => [
  { key: "minLength", passed: password.length >= PASSWORD_MIN_LENGTH },
  { key: "uppercase", passed: /[A-Z]/.test(password) },
  { key: "lowercase", passed: /[a-z]/.test(password) },
  { key: "number", passed: /[0-9]/.test(password) },
  { key: "specialChar", passed: SPECIAL_CHAR_REGEX.test(password) },
];

// The single boolean gate every "create/change a password" screen must
// check before allowing submission — true only when every requirement above
// passes.
export const isPasswordStrong = (password: string): boolean =>
  evaluatePasswordRequirements(password).every((requirement) => requirement.passed);
