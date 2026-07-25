// ---------------------------------------------------------------------------
// Firebase ID token verification — WITHOUT the Firebase Admin SDK.
//
// Why not the Admin SDK: firebase-admin's Firestore/Auth clients are built
// on Node's gRPC stack (raw TCP sockets, HTTP/2 framing outside `fetch`),
// none of which the Workers runtime provides — even with the `nodejs_compat`
// compatibility flag, which polyfills specific Node *APIs* (buffers, some
// `node:` built-ins) but not a TCP/gRPC transport. Every network call this
// Worker makes, here and in firestoreRest.ts, therefore goes through the
// platform's own `fetch` + Web Crypto — no Admin SDK dependency at all.
//
// This reimplements exactly what `admin.auth().verifyIdToken()` does, using
// the same public inputs Google documents for third-party verifiers:
//   1. Fetch Google's current public keys for the `securetoken` service
//      account (a JWKS — JSON Web Key Set — endpoint anyone can call).
//   2. Verify the ID token's RS256 signature against the key named by its
//      header's `kid`.
//   3. Check `exp`/`iat`/`aud`/`iss`/`sub` exactly as Firebase's own SDKs do.
// ---------------------------------------------------------------------------

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Firebase rotates these keys periodically (Google recommends respecting the
// endpoint's own Cache-Control) — this cache is per-isolate only, exactly
// like the OAuth2 access-token cache in firestoreRest.ts. A cold isolate just
// refetches; that's the correct, safe default (never cached indefinitely).
type JwksCache = { keys: JsonWebKey[]; expiresAt: number };
let jwksCache: JwksCache | null = null;

const DEFAULT_JWKS_TTL_SECONDS = 3600;

async function getGoogleSecureTokenJWKS(): Promise<JsonWebKey[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const response = await fetch(JWKS_URL, {
    cf: { cacheTtl: DEFAULT_JWKS_TTL_SECONDS, cacheEverything: true },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch Google's public keys (status ${response.status}).`);
  }

  const data = (await response.json()) as { keys: JsonWebKey[] };
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("Google's public key response was empty or malformed.");
  }

  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAgeMatch = /max-age=(\d+)/.exec(cacheControl);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : DEFAULT_JWKS_TTL_SECONDS;

  jwksCache = { keys: data.keys, expiresAt: now + maxAgeSeconds * 1000 };
  return data.keys;
}

// ---------------------------------------------------------------------------
// Base64url helpers — the Workers runtime has atob()/btoa() (plain base64,
// binary-string based), not a built-in base64url<->bytes helper.
// ---------------------------------------------------------------------------

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJwtSegment(segment: string): any {
  const bytes = base64UrlToBytes(segment);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class AuthError extends Error {}

export type VerifiedFirebaseUser = {
  uid: string;
  email: string | null;
};

const CLOCK_SKEW_SECONDS = 60;

// Verifies a Firebase Auth ID token and returns the authenticated uid. Throws
// AuthError with a short, safe, generic message on ANY failure (expired,
// malformed, wrong project, bad signature, unreachable JWKS, ...) — callers
// map this straight to an HTTP 401 and never forward the underlying detail
// to the client.
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
): Promise<VerifiedFirebaseUser> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Malformed ID token.");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: any;
  let payload: any;
  try {
    header = decodeJwtSegment(headerB64);
    payload = decodeJwtSegment(payloadB64);
  } catch {
    throw new AuthError("Malformed ID token.");
  }

  if (header?.alg !== "RS256" || typeof header?.kid !== "string" || !header.kid) {
    throw new AuthError("Unsupported or malformed ID token header.");
  }

  let keys: JsonWebKey[];
  try {
    keys = await getGoogleSecureTokenJWKS();
  } catch {
    throw new AuthError("Could not verify the ID token right now.");
  }

  const jwk = keys.find((key: any) => key.kid === header.kid);
  if (!jwk) {
    throw new AuthError("Unknown token signing key.");
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new AuthError("Could not verify the ID token right now.");
  }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);

  const validSignature = await crypto.subtle
    .verify("RSASSA-PKCS1-v1_5", publicKey, signature, signedData)
    .catch(() => false);

  if (!validSignature) {
    throw new AuthError("Invalid ID token signature.");
  }

  const nowSeconds = Date.now() / 1000;

  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new AuthError("ID token has expired.");
  }
  if (typeof payload.iat !== "number" || payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new AuthError("ID token is not yet valid.");
  }
  if (payload.aud !== projectId) {
    throw new AuthError("ID token audience mismatch.");
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new AuthError("ID token issuer mismatch.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new AuthError("ID token missing subject.");
  }

  // uid the rest of this Worker must use as parentId — NEVER a client-sent
  // field. See schoolChildren.ts, which only ever receives this value from
  // the verified token, never from the request body.
  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}
