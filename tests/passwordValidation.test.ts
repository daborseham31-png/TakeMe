// ---------------------------------------------------------------------------
// Regression tests for app/login/passwordValidation.ts — the shared
// "strong password" policy enforced at Sign Up (and any future in-app
// Change Password screen). Covers every example from the product spec
// verbatim, plus the individual-requirement breakdown the live checklist
// (app/components/PasswordRequirementsChecklist.tsx) depends on.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  evaluatePasswordRequirements,
  isPasswordStrong,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENT_I18N_KEY,
} from "../app/login/passwordValidation";

describe("isPasswordStrong", () => {
  it("accepts the exact valid example from the product spec", () => {
    expect(isPasswordStrong("TakeMe123!")).toBe(true);
  });

  it("accepts other passwords that satisfy every rule", () => {
    expect(isPasswordStrong("Str0ng#Pass")).toBe(true);
    expect(isPasswordStrong("A1b2C3d4$")).toBe(true);
    expect(isPasswordStrong("Correct-Horse9")).toBe(true);
  });

  it("rejects every invalid example from the product spec", () => {
    expect(isPasswordStrong("takeme123!")).toBe(false); // no uppercase
    expect(isPasswordStrong("TAKEME123!")).toBe(false); // no lowercase
    expect(isPasswordStrong("TakeMe!!!")).toBe(false); // no number
    expect(isPasswordStrong("TakeMe123")).toBe(false); // no special character
    expect(isPasswordStrong("12345678")).toBe(false); // no letters, no special character
  });

  it("rejects an otherwise-valid password that is one character short of the minimum length", () => {
    // "TakeMe1!" is 8 chars (valid); drop one letter to get 7.
    expect(isPasswordStrong("TakeM1!")).toBe(false);
    expect("TakeM1!".length).toBe(7);
  });

  it("accepts a password exactly at the minimum length", () => {
    const exactlyMin = "Tak3me!x"; // 8 characters, satisfies every rule
    expect(exactlyMin.length).toBe(PASSWORD_MIN_LENGTH);
    expect(isPasswordStrong(exactlyMin)).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(isPasswordStrong("")).toBe(false);
  });

  it("accepts passwords using different special characters from the spec's example list", () => {
    expect(isPasswordStrong("TakeMe123@")).toBe(true);
    expect(isPasswordStrong("TakeMe123#")).toBe(true);
    expect(isPasswordStrong("TakeMe123$")).toBe(true);
    expect(isPasswordStrong("TakeMe123^")).toBe(true);
    expect(isPasswordStrong("TakeMe123&")).toBe(true);
    expect(isPasswordStrong("TakeMe123*")).toBe(true);
    expect(isPasswordStrong("TakeMe123(")).toBe(true);
    expect(isPasswordStrong("TakeMe123)")).toBe(true);
    expect(isPasswordStrong("TakeMe123_")).toBe(true);
    expect(isPasswordStrong("TakeMe123+")).toBe(true);
    expect(isPasswordStrong("TakeMe123-")).toBe(true);
    expect(isPasswordStrong("TakeMe123=")).toBe(true);
  });

  it("does not accept a space or a plain letter/digit as satisfying the special-character rule", () => {
    expect(isPasswordStrong("TakeMe1234")).toBe(false);
    expect(isPasswordStrong("TakeMe 123")).toBe(false);
  });
});

describe("evaluatePasswordRequirements", () => {
  it("returns one result per rule, in a stable order, for a fully valid password", () => {
    const results = evaluatePasswordRequirements("TakeMe123!");
    expect(results.map((r) => r.key)).toEqual([
      "minLength",
      "uppercase",
      "lowercase",
      "number",
      "specialChar",
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("flags exactly the missing requirement(s) for a partially valid password", () => {
    // Has length/uppercase/lowercase/number, missing only a special char.
    const results = evaluatePasswordRequirements("TakeMe123");
    const byKey = Object.fromEntries(results.map((r) => [r.key, r.passed]));

    expect(byKey.minLength).toBe(true);
    expect(byKey.uppercase).toBe(true);
    expect(byKey.lowercase).toBe(true);
    expect(byKey.number).toBe(true);
    expect(byKey.specialChar).toBe(false);
  });

  it("flags every requirement as failed for an empty password", () => {
    const results = evaluatePasswordRequirements("");
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it("flags only length/special-char as failed for an all-digit password", () => {
    const results = evaluatePasswordRequirements("12345678");
    const byKey = Object.fromEntries(results.map((r) => [r.key, r.passed]));

    expect(byKey.minLength).toBe(true); // 8 digits meets the length rule
    expect(byKey.uppercase).toBe(false);
    expect(byKey.lowercase).toBe(false);
    expect(byKey.number).toBe(true);
    expect(byKey.specialChar).toBe(false);
  });

  it("updates live as characters are added, matching the UI checklist's incremental behavior", () => {
    expect(isPasswordStrong("T")).toBe(false);
    expect(isPasswordStrong("Ta")).toBe(false);
    expect(isPasswordStrong("TakeMe1")).toBe(false); // no special char yet, too short
    expect(isPasswordStrong("TakeMe123")).toBe(false); // no special char yet
    expect(isPasswordStrong("TakeMe123!")).toBe(true); // now satisfies every rule
  });
});

describe("PASSWORD_REQUIREMENT_I18N_KEY", () => {
  it("has exactly one i18n key per requirement produced by evaluatePasswordRequirements", () => {
    const requirementKeys = evaluatePasswordRequirements("").map((r) => r.key);
    for (const key of requirementKeys) {
      expect(PASSWORD_REQUIREMENT_I18N_KEY[key]).toBeTruthy();
      expect(PASSWORD_REQUIREMENT_I18N_KEY[key]).toMatch(/^auth\./);
    }
  });
});
