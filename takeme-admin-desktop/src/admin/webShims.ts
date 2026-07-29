// ---------------------------------------------------------------------------
// Desktop-only replacements for two native-module calls admin screens make
// (expo-clipboard, expo-image-picker). Both packages are built around
// Expo's native module system; the standard browser Clipboard/File APIs
// Electron's renderer already has are simpler and sufficient for the one
// call site each is used from — no other logic in those screens changes.
// ---------------------------------------------------------------------------

export const Clipboard = {
  setStringAsync: async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value);
  },
};

export type WebImagePickerResult =
  | { canceled: true }
  | { canceled: false; assets: [{ uri: string }] };

// Mirrors expo-image-picker's launchImageLibraryAsync result shape closely
// enough for settings.tsx's existing `if (!result.canceled) setPhoto(result.assets[0].uri)`
// logic to work unchanged. Opens the browser's native file picker and
// resolves the picked file as a data: URI (same kind of string the rest of
// the app already stores in the `photo` field).
export const ImagePicker = {
  launchImageLibraryAsync: (): Promise<WebImagePickerResult> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ canceled: true });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          resolve({ canceled: false, assets: [{ uri: String(reader.result) }] });
        };
        reader.onerror = () => resolve({ canceled: true });
        reader.readAsDataURL(file);
      };
      input.click();
    });
  },
};
