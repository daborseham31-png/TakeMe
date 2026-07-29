// ---------------------------------------------------------------------------
// Electron Forge config. Packages the already-built `dist/` (Vite web
// build) + `electron/` (main/preload) as the app content — `npm run build`
// must run before `package`/`make` (both npm scripts already do this).
// ---------------------------------------------------------------------------

module.exports = {
  packagerConfig: {
    name: "TakeMe Admin",
    executableName: "TakeMeAdmin",
    icon: "assets/icon", // electron-packager appends .ico on Windows
    asar: true,
    // Only ship what the app actually needs at runtime — not the TS
    // source, not the Vite/TS toolchain itself.
    ignore: [
      /^\/src/,
      /^\/electron\/.*\.ts$/,
      /^\/forge\.config\.js$/,
      /^\/vite\.config\.ts$/,
      /^\/tsconfig\.json$/,
      /^\/\.gitignore$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "TakeMeAdmin",
        setupExe: "TakeMe Admin Setup.exe",
        setupIcon: "assets/icon.ico",
        noMsi: true,
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
};
