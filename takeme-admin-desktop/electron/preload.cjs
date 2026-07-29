// ---------------------------------------------------------------------------
// Preload script — runs in an isolated, sandboxed context
// (contextIsolation: true, sandbox: true). The renderer (the admin React
// app) talks to Firebase directly over HTTPS/WSS and needs no privileged
// main-process API at all, so this deliberately exposes nothing via
// contextBridge — the true minimum. (The app version shown in Settings
// comes from a Vite build-time constant, __APP_VERSION__, not from here.)
// ---------------------------------------------------------------------------
