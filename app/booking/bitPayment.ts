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
// What we do instead, as the best real integration available: copy the
// recipient's phone number to the clipboard (so the user never has to
// type it) and open the official BIT app so they can paste it straight
// into BIT's own "Send money to" field. If BIT isn't installed, we say so
// plainly instead of failing silently.
// ---------------------------------------------------------------------------

import * as Clipboard from "expo-clipboard";
import { Alert, Linking } from "react-native";

const BIT_SCHEME = "bit://";
const BIT_WEB_FALLBACK = "https://www.bitpay.co.il/app/bitcom-info";

const tryOpen = async (url: string): Promise<boolean> => {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
  } catch {
    // canOpenURL/openURL can both throw on some Android OEM ROMs even when
    // the target app is installed — fall through and try opening directly.
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
};

// Opens BIT for the given recipient. Never throws — every failure path ends
// in a user-facing Alert instead of a silent no-op.
export const openBitPayment = async (
  recipientPhone: string,
  amount: number | null,
): Promise<void> => {
  const phone = recipientPhone.trim();

  if (!phone) {
    Alert.alert(
      "Phone number unavailable",
      "We don't have a phone number on file to pay through BIT. Please try Cash instead.",
    );
    return;
  }

  try {
    await Clipboard.setStringAsync(phone);
  } catch {
    // Clipboard is a convenience — never block opening BIT on it failing.
  }

  const opened = await tryOpen(BIT_SCHEME);

  if (opened) {
    Alert.alert(
      "BIT opened",
      `We copied ${phone} to your clipboard${
        amount !== null ? ` for the ₪${amount} payment` : ""
      } — paste it into BIT's "Send money to" field to finish.`,
    );
    return;
  }

  Alert.alert(
    "BIT is required",
    "BIT is required to complete this payment, but it doesn't seem to be installed on this device. Install BIT to continue, or choose Cash instead.",
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
