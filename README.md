# TakeMe

TakeMe is a cross-platform community transportation and services platform that connects passengers and drivers directly. The system supports personal rides, school transportation, work and errands, roadside assistance, driver management, live tracking, notifications, and administration tools.

The project is built with **Expo / React Native**, **TypeScript**, **Firebase**, and **Cloudflare Workers**, with support for Web/PWA and a standalone desktop administration application.

---

## Project Information

* **Project Name:** TakeMe
* **Students:** Marwa Shahada, Seham Dabour
* **Supervisor:** Mr. Andreas Nasir
* **Institution:** Jezreel Valley Academic College
* **Program:** Information Systems

---

## Project Links

* **School Dashboard:** [School Dashboard](https://takeme-id-reader.yvcstudent4.workers.dev/school-kiosk/?schoolId=278010)
* **User Guide:** [TakeMe User Guide](docs/TakeMe_User_Guide.pdf)

> The GitHub repository is private. Access can be granted to the project supervisor and examiner through GitHub Collaborators.

---

## Main Features

### For Passengers

* Book personal rides
* Book one-time or weekly school rides
* Select pickup and destination locations using map-based location selection
* Choose available drivers based on ride requirements
* Manage active, upcoming, and completed bookings
* Cancel eligible bookings
* Rebook completed rides
* Rate drivers after completed trips
* Receive ride-related notifications
* Track supported active rides in real time
* Save frequently used locations
* Browse work and errand opportunities
* Request roadside assistance
* Follow the progress of an accepted roadside-help request

---

### For Drivers

* Register and apply to become a driver
* Submit ID and driving-license information for verification
* Create personal rides
* Create school rides
* Create work and errand opportunities
* Create recurring weekly rides
* Manage passenger booking requests
* Accept or reject relevant requests
* Manage trip stages:

  * Start Driving
  * Arrived
  * Start Trip
  * Finish Trip
* Navigate to pickup and destination locations
* Handle school-trip verification flows
* Receive ratings and reviews
* View cancellation and no-show violations
* Submit appeals for eligible violations
* Respond to roadside-help requests

---

### School Transportation

TakeMe includes dedicated school-transport functionality.

Features include:

* One-time school ride booking
* Weekly school ride booking
* Child selection before booking
* School and pickup location selection
* Driver selection
* Ride verification
* School-trip status management
* Live tracking during supported active school trips
* Return-trip support
* School-related notifications

---

### Work & Errands

Users can browse available work and errand listings and submit requests based on the listing details.

The system supports:

* Work opportunities
* Errand requests
* Location information
* Request and approval flows
* Status updates
* Notifications

---

### Roadside Help

Users can request roadside assistance when they need help with situations such as:

* Flat tire
* Dead battery
* Fuel-related problems
* Towing
* Other roadside issues

Nearby helpers can review requests and send or accept assistance offers depending on the flow.

The requester can follow the progress of an accepted helper through the application.

---

### Payments

TakeMe supports booking-related payment flows.

Depending on the service, supported payment options include:

* Cash
* Card-related payment flows
* Bit-assisted payment flow

The Bit integration uses an application deep-link flow rather than a direct public Bit payment API.

---

## Admin System

TakeMe includes administration tools for managing the platform.

Admin capabilities include:

* View platform statistics
* Manage users
* Manage drivers
* Approve or review driver verification
* Block or suspend users when necessary
* Review driver violations
* Review cancellation and no-show cases
* Review driver appeals
* Manage notifications
* Review reports
* Manage school-related information
* Monitor relevant system activity

A standalone desktop administration application is also included in the project.

---

## Driver Verification

Driver verification includes ID and driving-license processing.

The project uses backend processing through **Cloudflare Workers** for document-analysis-related flows.

The verification process combines:

* User-provided driver details
* ID document processing
* Driving-license processing
* Administrative review and approval

---

## Notifications

TakeMe includes notification flows for important system events, such as:

* Booking updates
* Driver status updates
* Ride progress
* Driver arrival
* School transportation events
* Violations
* Appeals
* Roadside-help updates
* Administrative notifications

---

## Route Matching

TakeMe uses local route-matching logic to identify suitable rides without depending entirely on a paid external routing service.

The route-matching logic uses geographic calculations such as:

* Distance between coordinates
* Route-corridor calculations
* Pickup proximity
* Destination compatibility
* Detour estimation

This helps the system determine whether a passenger's requested pickup point can reasonably match an available driver's route.

---

## Architecture

TakeMe follows a client/serverless architecture.

### Client

* Expo
* React Native
* Expo Router
* TypeScript

### Authentication

* Firebase Authentication

### Database

* Cloud Firestore

### Backend Services

* Cloudflare Workers

Backend services are used for tasks that should not run only on the client, including selected document-processing and scheduled background operations.

### Web

* Expo Web
* Progressive Web App (PWA)

### Administration

* Standalone desktop administration application
* Administrative management screens and tools

---

## Tech Stack

* [Expo](https://expo.dev/) / React Native
* React
* TypeScript
* [Expo Router](https://docs.expo.dev/router/introduction/)
* Firebase Authentication
* Cloud Firestore
* Cloudflare Workers
* [react-i18next](https://react.i18next.com/)
* Vitest
* Expo Web / PWA

---

## Localization

TakeMe supports four languages:

* Arabic
* Hebrew
* English
* Russian

Arabic and Hebrew include RTL support.

Localization is handled through `react-i18next` and the translation files used by the application.

---

## Project Structure

```text
app/
├── (tabs)/                 Main tab-based application screens
├── admin/                  Administration-related screens
├── booking/                Booking and service flows
├── driver/                 Driver screens and trip management
├── login/                  Authentication and registration
└── i18n/                   Localization configuration and translations

components/                 Shared UI and cross-platform components

cloudflare-worker/          Serverless backend services and scheduled jobs

takeme-admin-desktop/       Standalone desktop administration application

tests/                      Unit and logic tests

assets/                     Images, icons, and other application assets

public/                     Web/PWA public resources
```

The exact structure may include additional feature-specific folders and shared utilities.

---

## Getting Started

### Prerequisites

Install:

* Node.js
* npm

For mobile testing, Expo-compatible tools or devices can be used.

---

### Install Dependencies

```bash
npm install
```

---

### Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Then configure the required environment variables according to the comments in `.env.example`.

> Do not commit private API keys, credentials, passwords, or other secrets to GitHub.

---

### Run the Application

```bash
npx expo start
```

Available development options may include:

```bash
npm run ios
npm run android
npm run web
```

---

## Web & PWA

TakeMe includes a web build and Progressive Web App support.

To run the web version:

```bash
npm run web
```

To create a production web export:

```bash
npx expo export --platform web
```

The PWA configuration includes web application metadata and icons for supported browsers.

---

## Testing

Run the available tests with:

```bash
npm test
```

---

## Type Checking

Run TypeScript type checking with:

```bash
npx tsc --noEmit
```

---

## Documentation

Project documentation includes:

* User Guide
* Project report
* Gantt plan
* Use Case Diagram
* Class Diagram

The user guide should be available directly inside the repository:

```text
docs/TakeMe_User_Guide.pdf
```

---

## Repository Organization

The repository uses organized branch naming conventions such as:

```text
feature/...
docs/...
ui/...
archive/...
```

Examples:

```text
feature/admin-improvements
feature/my-bookings
feature/roadside-help
feature/school-flow-updates
feature/waze-navigation
feature/driver-violations-appeals
docs/readme
ui/home-screen-redesign
```

The `main` branch represents the main project version.

---

## Security

The project uses:

* Firebase Authentication
* Firestore security rules
* Role-based access logic
* Driver approval and verification flows
* Backend processing for selected privileged operations

Sensitive configuration values should be stored in environment variables and must not be committed to the repository.

---

## Authors

**Marwa Shahada**
**Seham Dabour**

Final Project — Information Systems
Jezreel Valley Academic College
