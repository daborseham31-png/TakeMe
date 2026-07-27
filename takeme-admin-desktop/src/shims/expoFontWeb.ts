// ---------------------------------------------------------------------------
// Replaces the whole `expo-font` package for this desktop build. The real
// package's web font-loading path goes through expo-modules-core's
// NativeModule registration system, which expects `globalThis.expo` to
// already exist — set up by Expo's own runtime bootstrap during an
// Expo-CLI build, which this project doesn't have (it's a plain Vite
// bundle), causing a hard crash on load.
//
// @expo/vector-icons' createIconSet.js only ever calls two functions from
// `expo-font` for normal icon rendering: isLoaded(name) and
// loadAsync(fontMap) (renderToImageAsync is a separate, optional
// "render icon as image" feature no admin screen uses). This reimplements
// exactly those two using the standard browser Font Loading API
// (FontFace/document.fonts) — the actual mechanism a browser needs to
// register a downloadable icon font, with no Expo runtime involved at all.
// ---------------------------------------------------------------------------

const loadedFonts = new Set<string>();
const pendingLoads = new Map<string, Promise<void>>();

export function isLoaded(fontFamily: string): boolean {
  return loadedFonts.has(fontFamily);
}

// `fontMap` is `{ [fontFamily]: assetSource }` — for a Vite-bundled .ttf
// import, assetSource is the built asset's URL string.
export async function loadAsync(fontMap: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(fontMap);

  await Promise.all(
    entries.map(async ([fontFamily, source]) => {
      if (loadedFonts.has(fontFamily)) return;

      const existing = pendingLoads.get(fontFamily);
      if (existing) return existing;

      const url = typeof source === "string" ? source : (source as { default?: string })?.default;
      if (!url) return;

      const promise = (async () => {
        const face = new FontFace(fontFamily, `url(${JSON.stringify(url)})`);
        const loaded = await face.load();
        document.fonts.add(loaded);
        loadedFonts.add(fontFamily);
      })();

      pendingLoads.set(fontFamily, promise);
      await promise;
    }),
  );
}

export async function renderToImageAsync(): Promise<never> {
  throw new Error("Font.renderToImageAsync is not available in the TakeMe Admin desktop app.");
}

export function unloadAsync(): Promise<void> {
  return Promise.resolve();
}

// Not used by createIconSet.js (it calls loadAsync/isLoaded directly), but
// exported defensively in case any other @expo/vector-icons code path
// references it — returns "not loaded, no error" rather than throwing.
export function useFonts(_fontMap: Record<string, unknown>): [boolean, Error | null] {
  return [false, null];
}
