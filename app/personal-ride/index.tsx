import { Redirect } from "expo-router";
import React from "react";

// Entry point for the "Personal Ride" section.
// Defaults to the Ride (Person) screen; the Ride Type toggle there
// switches to the Deliver Item screen.
export default function PersonalRideIndex() {
  return <Redirect href={"/personal-ride/ride-person" as any} />;
}
