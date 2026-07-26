// ---------------------------------------------------------------------------
// Shared Worker environment bindings — every secret this Worker reads, in
// one place. All three FIREBASE_* values are Cloudflare secrets (`wrangler
// secret put ...`), never committed to source, never placed in the Expo app
// or any client-visible config. See firestoreRest.ts / firebaseAuth.ts for
// how each is used, and the final report for the exact `wrangler secret put`
// commands.
// ---------------------------------------------------------------------------

export interface Env {
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;

  // The Firebase/Google Cloud project id (e.g. "take-me-cc3de") — not
  // secret by itself (it's already public in the Expo app's own
  // firebase.ts config), but kept as a Cloudflare secret anyway for
  // deployment convenience (one `wrangler secret put` alongside the two
  // truly sensitive values below, no separate `vars` entry to keep in sync
  // across environments).
  FIREBASE_PROJECT_ID: string;

  // The service account's client_email — identifies WHICH service account
  // is signing the OAuth2 assertion in firestoreRest.ts. Not secret by
  // itself, but kept alongside the private key for the same reason as
  // FIREBASE_PROJECT_ID above.
  FIREBASE_CLIENT_EMAIL: string;

  // The service account's PEM private key (PKCS8, RSA). MUST be a
  // Cloudflare secret — this is the one value that would let anyone holding
  // it mint Firestore-authenticated Google OAuth2 access tokens for this
  // project. Stored with literal "\n" sequences in place of real newlines
  // (see firestoreRest.ts's `.replace(/\\n/g, "\n")`) since secrets are
  // single-line values — see the final report for exactly how to set this.
  FIREBASE_PRIVATE_KEY: string;

  // Optional KV binding backing the durable half of the /school-kiosk/lookup
  // rate limiter (see rateLimit.ts's isKioskLookupRateLimited) — this
  // endpoint is public (no Firebase ID token), so the per-uid in-memory
  // limiter every other route uses isn't enough on its own. Genuinely
  // OPTIONAL at the type level: this binding does not exist until someone
  // runs the `wrangler kv namespace create` + wrangler.jsonc steps in this
  // project's final report, and the Worker must keep working (falling back
  // to the in-memory-only check) before that's done.
  SCHOOL_KIOSK_RATE_LIMIT?: KVNamespace;
}
