import React from "react";

import RideForm from "./RideForm";

export default function PersonalScreen() {
  // Tapping "Personal Rides" goes straight to the ride (person) form,
  // with no inner chooser. Item delivery lives under "Item Delivery".
  return <RideForm category="personal" showPets />;
}
