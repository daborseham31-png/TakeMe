import { Redirect } from "expo-router";

// Chat now lives at /messages (a shared WhatsApp-style page). Driver + passenger
// work/errand REQUESTS are managed in My Bookings + Notifications. This route is
// kept only so any old link to /driver/messages still lands somewhere sensible.
export default function DriverMessagesRedirect() {
  return <Redirect href="/messages" />;
}
