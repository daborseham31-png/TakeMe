// This screen used to be the (insecure) admin destination — the real admin
// panel now lives at /admin, protected by app/admin/_layout.tsx's role
// guard. Kept as a redirect only so any stale link to this path still lands
// somewhere sensible instead of a blank stub.
import { Redirect } from "expo-router";
import React from "react";

export default function LegacyAdminRedirect() {
  return <Redirect href={"/admin" as any} />;
}
