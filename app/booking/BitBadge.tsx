import React from "react";
import { StyleSheet, Text, View } from "react-native";

// No official BIT logo asset exists in this repo's assets/ folder, so this
// is a styled text wordmark stand-in using BIT's brand teal — swap in the
// real logo (e.g. assets/images/bit-logo.png -> <Image>) if one is added.
export default function BitBadge({ size = 26 }: { size?: number }) {
  return (
    <View style={[styles.badge, { height: size, paddingHorizontal: size * 0.4 }]}>
      <Text style={[styles.text, { fontSize: size * 0.55 }]}>bit</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#00B2A9",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});
