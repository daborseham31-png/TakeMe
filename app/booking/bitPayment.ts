// ---------------------------------------------------------------------------
// BIT (ביט) deep-link integration — shared by every payment screen that
// replaced its "Card" option with "Pay with BIT" (ride-payment, work-errand
// payment, work "Pay Worker", roadside-help payment).
//
// BIT is Bank Hapoalim's Israeli P2P payments app (Android package
// com.bnhp.payments.paymentsapp). It registers the custom URL scheme
// `bit://` — confirmed via the web-to-app link BIT itself publishes on
// bitpay.co.il: `intent://www.bitpay.co.il/app/bitcom-info;scheme=bit;
// package=com.bnhp.payments.paymentsapp;end`.
//
// IMPORTANT LIMITATION — read before changing this:
// BIT does not publish any documented deep-link query parameters for
// pre-filling a peer-to-peer recipient phone number or amount. The only
// BIT integration that opens straight to a pre-filled pay screen is
// "BIT for Business", and that link is generated server-side by a
// registered payment processor (Tranzila/Grow/Z-Credit/Hyp/...) after the
// business signs up for a merchant account — it is not something a phone
// number can be turned into client-side. Inventing a URL like
// `bit://pay?phone=...&amount=...` would look plausible but do nothing
// (BIT ignores unknown parameters and just opens its own home screen), so
// this module intentionally does not pretend to support that.
//
// What we do instead, as the best real integration available: clean and
// copy the recipient's phone number to the clipboard (so the user never has
// to type it), confirm the copy, then open the official BIT app so they can
// paste it straight into BIT's own "Send money to" field. If BIT isn't
// installed, we say so plainly instead of failing silently.
//
// This module never marks a payment as completed — opening BIT (or copying
// the number) has no effect on any booking/payment status. The caller's own
// existing verification flow (or an admin) is what moves a payment out of
// "pending".
// ---------------------------------------------------------------------------

import * as Clipboard from "expo-clipboard";
import { Alert, Linking } from "react-native";

const BIT_SCHEME = "bit://";
const BIT_WEB_FALLBACK = "https://www.bitpay.co.il/app/bitcom-info";

// Strips spaces, dashes, brackets/parentheses, dots, and any other
// formatting characters a phone number might have been typed/stored with —
// keeping only digits and a leading "+" (international prefix) if present —
// so the value pasted into BIT's "Send money to" field is always clean.
export const cleanPhoneNumber = (value: string): string => {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");

  if (!digitsOnly) return "";

  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
};

const tryOpenBit = async (): Promise<boolean> => {
  try {
    const canOpen = await Linking.canOpenURL(BIT_SCHEME);
    if (canOpen) {
      await Linking.openURL(BIT_SCHEME);
      return true;
    }
  } catch {
    // canOpenURL/openURL can both throw on some Android OEM ROMs even when
    // the target app is installed — fall through and try opening directly.
  }

  try {
    await Linking.openURL(BIT_SCHEME);
    return true;
  } catch {
    return false;
  }
};

// Cleans and copies the recipient's phone number to the clipboard, without
// opening BIT. Never throws — clipboard failures are swallowed since
// copying is a convenience, not a hard requirement. Returns the cleaned
// number that was (attempted to be) copied, or "" if there was nothing
// usable to copy.
export const copyRecipientPhone = async (
  recipientPhone: string,
): Promise<string> => {
  const phone = cleanPhoneNumber(recipientPhone);

  if (!phone) {
    Alert.alert(
      "Phone number unavailable",
      "We don't have a phone number on file to pay through BIT. Please try Cash instead.",
    );
    return "";
  }

  try {
    await Clipboard.setStringAsync(phone);
  } catch {
    // Clipboard is a convenience — never block the rest of the flow on it
    // failing.
  }

  return phone;
};

// Shows BIT's "not installed" message. Only offers to open BIT's own public
// info page as a fallback — that URL already existed in this module before
// this change (BIT_WEB_FALLBACK above), so this isn't inventing a new
// external destination, just reusing the one already considered safe here.
const showBitNotInstalled = () => {
  Alert.alert(
    "Bit is not installed on this device.",
    "Install BIT to complete this payment, or choose Cash instead.",
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Get BIT",
        onPress: () => {
          Linking.openURL(BIT_WEB_FALLBACK).catch(() => {});
        },
      },
    ],
  );
};

// Cleans + copies the recipient's phone number, shows a short confirmation,
// then opens BIT so the passenger can paste it straight into BIT's own
// "Send money to" field. `amount` is accepted for parity with every existing
// call site (and so callers can keep passing the real payment amount through
// without it being silently dropped), even though the confirmation text
// itself intentionally stays generic per the simplified flow.
//
// Never marks anything as paid — see the module note above.
export const openBitPayment = async (
  recipientPhone: string,
  amount: number | null,
): Promise<void> => {
  void amount;

  const phone = await copyRecipientPhone(recipientPhone);
  if (!phone) return;

  Alert.alert("Phone number copied", "Phone number copied. Paste it in Bit.", [
    {
      text: "OK",
      onPress: async () => {
        const opened = await tryOpenBit();
        if (!opened) {
          showBitNotInstalled();
        }
      },
    },
  ]);
};
