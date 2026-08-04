// ---------------------------------------------------------------------------
// New file — the route table replacing expo-router's file-based routing
// convention for this standalone app. Every path below mirrors the exact
// mobile route it replaces (see the mapping comment on each), and every
// screen component is the same file copied verbatim from app/admin/**.
// ---------------------------------------------------------------------------

import React from "react";
import { Route, Routes, unstable_HistoryRouter as HistoryRouter } from "react-router-dom";

import AdminLayout from "../admin/_layout";
import AdminBookingDetailScreen from "../admin/bookings/[id]";
import AdminBookingsScreen from "../admin/bookings";
import AdminDriverDetailScreen from "../admin/drivers/[id]";
import AdminDriversScreen from "../admin/drivers";
import AdminDashboardScreen from "../admin/index";
import AdminNotificationsScreen from "../admin/notifications";
import AdminReportDetailScreen from "../admin/reports/[id]";
import AdminReportsScreen from "../admin/reports";
import AdminRideDetailScreen from "../admin/rides/[source]/[id]";
import AdminRidesScreen from "../admin/rides";
import AdminSchoolKioskLinksScreen from "../admin/school-kiosk-links";
import AdminSettingsScreen from "../admin/settings";
import AdminUserDetailScreen from "../admin/users/[id]";
import AdminUsersScreen from "../admin/users";
import AdminViolationDetailScreen from "../admin/violations/[id]";
import AdminViolationsScreen from "../admin/violations";
import LoginScreen from "../LoginScreen";
import { appHistory } from "./expoRouterShim";

export default function AppRouter() {
  return (
    <HistoryRouter history={appHistory as any}>
      <Routes>
        {/* app/index.tsx (mobile login) -> this desktop app's admin-only login */}
        <Route path="/" element={<LoginScreen />} />

        {/* app/admin/_layout.tsx's guard, wrapping every /admin/* route */}
        <Route path="/admin" element={<AdminLayout />}>
          {/* app/admin/index.tsx */}
          <Route index element={<AdminDashboardScreen />} />
          {/* app/admin/users.tsx */}
          <Route path="users" element={<AdminUsersScreen />} />
          {/* app/admin/users/[id].tsx */}
          <Route path="users/:id" element={<AdminUserDetailScreen />} />
          {/* app/admin/drivers.tsx */}
          <Route path="drivers" element={<AdminDriversScreen />} />
          {/* app/admin/drivers/[id].tsx */}
          <Route path="drivers/:id" element={<AdminDriverDetailScreen />} />
          {/* app/admin/rides.tsx */}
          <Route path="rides" element={<AdminRidesScreen />} />
          {/* app/admin/rides/[source]/[id].tsx */}
          <Route path="rides/:source/:id" element={<AdminRideDetailScreen />} />
          {/* app/admin/bookings.tsx */}
          <Route path="bookings" element={<AdminBookingsScreen />} />
          {/* app/admin/bookings/[id].tsx */}
          <Route path="bookings/:id" element={<AdminBookingDetailScreen />} />
          {/* app/admin/reports.tsx */}
          <Route path="reports" element={<AdminReportsScreen />} />
          {/* app/admin/reports/[id].tsx */}
          <Route path="reports/:id" element={<AdminReportDetailScreen />} />
          {/* app/admin/notifications.tsx */}
          <Route path="notifications" element={<AdminNotificationsScreen />} />
          {/* app/admin/violations.tsx */}
          <Route path="violations" element={<AdminViolationsScreen />} />
          {/* app/admin/violations/[id].tsx */}
          <Route path="violations/:id" element={<AdminViolationDetailScreen />} />
          {/* app/admin/school-kiosk-links.tsx */}
          <Route path="school-kiosk-links" element={<AdminSchoolKioskLinksScreen />} />
          {/* app/admin/settings.tsx */}
          <Route path="settings" element={<AdminSettingsScreen />} />
        </Route>
      </Routes>
    </HistoryRouter>
  );
}
