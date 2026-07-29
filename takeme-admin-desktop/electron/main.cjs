// ---------------------------------------------------------------------------
// Electron main process. Security posture (per the migration brief):
//   - nodeIntegration disabled, contextIsolation enabled, sandbox enabled
//   - no remote-module, no disabled web security
//   - preload exposes nothing privileged — the renderer talks to Firebase
//     directly over HTTPS/WSS (same as the browser build), so there is no
//     Node/Electron API surface the admin UI actually needs from main.
//   - navigation is locked to the app's own origin; any attempt to navigate
//     elsewhere or open a new window is blocked.
// ---------------------------------------------------------------------------

const { app, BrowserWindow, session, shell } = require("electron");
const path = require("path");

// Handles Squirrel.Windows' --squirrel-install/--squirrel-updated/
// --squirrel-uninstall/--squirrel-obsolete invocations (creates/removes the
// Desktop + Start Menu shortcuts, sets up the uninstall entry) and quits
// immediately during those silent install-time launches, before any window
// would otherwise open. Must run before app.whenReady()/anything else below.
if (require("electron-squirrel-startup")) {
  app.quit();
}

const isDev = process.env.NODE_ENV === "development";
const DEV_SERVER_URL = "http://localhost:5173";

// Only one running copy of the admin app at a time.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "TakeMe Admin",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#FBF7F1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  // Strict CSP for the packaged production app (no inline scripts at all).
  // Dev mode is intentionally more permissive ('unsafe-inline' for scripts)
  // because Vite's HMR client bootstraps itself via an inline <script> tag
  // injected into index.html — that only ever exists in the dev server
  // response, never in the built dist/index.html Electron loads in
  // production, so this doesn't weaken the shipped app's real policy.
  const csp = isDev
    ? "default-src 'self' http://localhost:5173 ws://localhost:5173; " +
      "script-src 'self' 'unsafe-inline' http://localhost:5173; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' ws://localhost:5173 http://localhost:5173 https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;"
    : "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  if (isDev) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // The menu bar is auto-hidden (autoHideMenuBar above), so there's normally
  // no visible way to open DevTools in the packaged app — this keyboard
  // shortcut (same one Chrome/most Electron apps use) is the only way to
  // reach it, which matters for an admin tool where diagnosing a real
  // problem on-site (not just in development) is a real scenario.
  win.webContents.on("before-input-event", (_event, input) => {
    const isDevToolsToggle =
      input.key === "F12" || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i");
    if (isDevToolsToggle) {
      win.webContents.toggleDevTools();
    }
  });

  // Surface load failures / renderer crashes in the main process log even
  // without DevTools open — this is the one signal an admin running the app
  // from a normal (non-console) shortcut launch would otherwise have no way
  // to see at all.
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[TakeMe Admin] Failed to load ${url}: ${desc} (${code})`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[TakeMe Admin] Renderer process gone:", details);
  });

  // Never allow the window to navigate away from the app itself, and never
  // allow it to open new BrowserWindows — any external link (there shouldn't
  // be any in this admin UI) opens in the OS default browser instead.
  win.webContents.on("will-navigate", (event, url) => {
    const isDevServer = isDev && url.startsWith(DEV_SERVER_URL);
    const isAppFile = url.startsWith("file://");
    if (!isDevServer && !isAppFile) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Defense in depth: this app never needs webview tags or permission
// requests beyond what Firebase Auth/Firestore use over plain HTTPS/WSS —
// deny anything else outright instead of prompting.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
