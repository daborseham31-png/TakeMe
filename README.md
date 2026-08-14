# TakeMe

TakeMe is a cross-platform ride, school-transport, work/errand, and roadside-help marketplace app — passengers and drivers connect directly, with an admin dashboard for moderation and support. Built with Expo (iOS, Android, and Web) and Firebase.

## Features

**For passengers**
- Book personal rides, one-off or weekly school rides, and browse work/errand listings
- Pick a pickup location on a map (current location, saved places, or a dropped pin)
- Request roadside help with live tracking of the assigned helper
- Manage bookings — cancel, rebook, rate a driver
- Save frequently used locations
- Live in-app notifications

**For drivers**
- Apply to become a driver with ID/license verification (automated document scanning)
- Publish personal, school, work, or errand trips, including recurring weekly schedules
- Manage incoming booking requests and trip stages (start driving → arrived → in progress → finished)
- Offer and complete roadside-help jobs
- Ratings, cancellation/no-show violation tracking, and an appeal flow

**For admins**
- Dashboard with platform statistics
- User and driver management (approve, block, suspend)
- Review reports, roadside requests, and driver violation appeals
- Broadcast notifications

**Platform**
- iOS, Android, and Web (installable as a PWA) from a single codebase
- Full Arabic / Hebrew / English / Russian localization, including RTL layout
- Firebase Authentication and Firestore for data, Cloudflare Workers for backend jobs that don't fit a client-only app (document scanning, scheduled no-show detection, notifications)

## Tech stack

- [Expo](https://expo.dev) (SDK 54) / React Native / React
- [Expo Router](https://docs.expo.dev/router/introduction/) for file-based navigation
- TypeScript
- Firebase (Auth, Firestore)
- Cloudflare Workers for serverless backend jobs (see `cloudflare-worker/`)
- [react-i18next](https://react.i18next.com/) for localization
- [Vitest](https://vitest.dev/) for unit tests

## Getting started

### Prerequisites

- Node.js and npm
- The [Expo Go](https://expo.dev/go) app (for quickest testing on a physical device) or an iOS/Android simulator

### Setup

```bash
npm install
```

Copy the example environment file and fill in any values you need (see the comments inside for what each one is used for):

```bash
cp .env.example .env
```

### Run

```bash
npx expo start
```

From the output you can open the app in a development build, an iOS simulator, an Android emulator, Expo Go, or a browser.

Platform-specific shortcuts:

```bash
npm run ios       # iOS simulator
npm run android   # Android emulator
npm run web       # Web (browser)
```

### Tests

```bash
npm test
```

### Type checking

```bash
npx tsc --noEmit
```

## Project structure

```
app/                 Screens and routes (Expo Router file-based routing)
  (tabs)/             Bottom-tab screens (Home, My Bookings, Messages, Profile)
  admin/               Admin dashboard screens
  booking/             Booking flows (rides, school, work & errand, roadside help)
  driver/              Driver-facing screens
  login/               Auth screens
  i18n/                Localization setup and translation files
components/           Cross-platform components (e.g. native/web map variants)
cloudflare-worker/    Serverless backend (document scanning, scheduled jobs, notifications)
takeme-admin-desktop/ Standalone desktop build of the admin dashboard
tests/                Vitest unit tests
```

## Web & PWA

The web build is deployed via [EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/) and is installable as a Progressive Web App on both iOS Safari and Android Chrome (Add to Home Screen), with its own manifest and icons (see `app/+html.tsx` and `public/`).

To produce a production web build locally:

```bash
npx expo export --platform web
```

## Localization

All user-facing strings live in `app/i18n/locales/` (`en`, `ar`, `he`, `ru`). Arabic and Hebrew are fully right-to-left; see `app/i18n/` for the RTL layout primitives used throughout the app.
