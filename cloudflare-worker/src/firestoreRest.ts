// ---------------------------------------------------------------------------
// Minimal Firestore REST v1 client, authenticated as a Google Cloud service
// account — the Worker's server-side access to Firestore.
//
// Why REST + a hand-signed OAuth2 assertion instead of firebase-admin: the
// Admin SDK's Firestore client talks gRPC over a raw TCP/HTTP2 socket, which
// the Workers runtime does not expose (see firebaseAuth.ts's header comment
// for the same point re: token verification). The Firestore REST API is
// plain HTTPS/JSON, which `fetch` handles natively, so this is the reliable,
// actually-supported way to reach Firestore from a Cloudflare Worker today.
//
// Auth flow (the standard "service account without a client library" OAuth2
// flow Google documents): sign a short-lived JWT assertion with the service
// account's own RSA private key (Web Crypto — no Node `crypto` module, no
// nodejs_compat needed), exchange it at Google's token endpoint for a Bearer
// access token scoped to `https://www.googleapis.com/auth/datastore`, then
// use that token on every Firestore REST call. The access token is cached
// per-isolate (~1 hour lifetime) so a warm isolate doesn't re-sign/exchange
// on every request.
//
// This file never receives a client-controlled value — every call site in
// schoolChildren.ts passes only server-derived data (the verified uid, and
// document ids/hashes it computed itself).
// ---------------------------------------------------------------------------

import type { Env } from "./env";

const FIRESTORE_BASE = "https://firestore.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

// ---------------------------------------------------------------------------
// base64url + PEM helpers
// ---------------------------------------------------------------------------

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

// A service-account private key secret is stored as a single-line value with
// literal "\n" escape sequences in place of real newlines (see env.ts) —
// this restores the real PEM before decoding it to DER bytes.
function pemToDer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n");
  const base64 = normalized
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Service-account -> Google OAuth2 access token
// ---------------------------------------------------------------------------

type AccessTokenCache = { accessToken: string; expiresAt: number };
let accessTokenCache: AccessTokenCache | null = null;

async function signServiceAccountAssertion(env: Env): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: DATASTORE_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const unsignedToken = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(
    JSON.stringify(claims),
  )}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.FIREBASE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now) {
    return accessTokenCache.accessToken;
  }

  const assertion = await signServiceAccountAssertion(env);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    // Never forward Google's response body — it can echo back request
    // details we'd rather not surface to a Worker-level caller, let alone a
    // client. Generic, logged status only.
    console.error("firestoreRest: token exchange failed", { status: response.status });
    throw new Error("Could not authenticate to Firestore.");
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  accessTokenCache = {
    accessToken: data.access_token,
    // Refresh a minute early so an in-flight request never races the
    // token's real expiry.
    expiresAt: now + Math.max(0, data.expires_in - 60) * 1000,
  };

  return accessTokenCache.accessToken;
}

// ---------------------------------------------------------------------------
// Firestore value encoding — only the JSON value types this project's
// School Child documents actually use (string/bool/timestamp). Deliberately
// narrow — see toFirestoreValue's `throw` for anything else, so a caller
// passing an unsupported shape fails loudly instead of writing something
// silently wrong.
// ---------------------------------------------------------------------------

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(Math.trunc(value)) };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null || value === undefined) return { nullValue: null };
  throw new Error("Unsupported Firestore value type.");
}

function toFirestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = toFirestoreValue(value);
  }
  return result;
}

function fromFirestoreValue(value: any): unknown {
  if (value == null) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue?.fields || {});
  if ("arrayValue" in value) {
    return (value.arrayValue?.values || []).map(fromFirestoreValue);
  }
  return null;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

function documentName(projectId: string, collection: string, docId: string): string {
  return `projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type FirestoreDocument = {
  data: Record<string, unknown>;
  // Opaque RFC3339 timestamp string — pass back as a `currentDocument.
  // updateTime` precondition (see buildUpdateWrite) to make a later write
  // fail atomically if the document changed since this read (optimistic
  // concurrency — see schoolChildren.ts's reset flow).
  updateTime: string;
};

export async function getFirestoreDocument(
  env: Env,
  collection: string,
  docId: string,
): Promise<FirestoreDocument | null> {
  const accessToken = await getAccessToken(env);
  const url = `${FIRESTORE_BASE}/${documentName(env.FIREBASE_PROJECT_ID, collection, docId)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    console.error("firestoreRest: getDocument failed", { collection, status: response.status });
    throw new Error("Could not read from Firestore.");
  }

  const data = (await response.json()) as { fields?: Record<string, any>; updateTime?: string };

  return {
    data: fromFirestoreFields(data.fields || {}),
    updateTime: data.updateTime || "",
  };
}

// ---------------------------------------------------------------------------
// Structured query — schoolKiosk.ts's read-only lookup needs to find a
// child's return schoolBookings/rideRequests by childId + exact date, which
// getFirestoreDocument (single doc by id) can't do. Equality-only filters
// only (every field this project queries this way — childId, date,
// bookingDirection, requestedDate — is a plain string), ANDed together when
// there's more than one. Firestore serves a pure-equality multi-field query
// like this from its automatic single-field indexes — no composite index to
// provision.
// ---------------------------------------------------------------------------

export type FirestoreQueryDocument = {
  id: string;
  data: Record<string, unknown>;
};

export async function queryFirestoreDocuments(
  env: Env,
  collection: string,
  equalityFilters: Record<string, string>,
): Promise<FirestoreQueryDocument[]> {
  const accessToken = await getAccessToken(env);
  const url = `${FIRESTORE_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const filters = Object.entries(equalityFilters).map(([fieldPath, value]) => ({
    fieldFilter: {
      field: { fieldPath },
      op: "EQUAL",
      value: { stringValue: value },
    },
  }));

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collection }],
  };

  if (filters.length === 1) {
    structuredQuery.where = filters[0];
  } else if (filters.length > 1) {
    structuredQuery.where = { compositeFilter: { op: "AND", filters } };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!response.ok) {
    console.error("firestoreRest: runQuery failed", { collection, status: response.status });
    throw new Error("Could not read from Firestore.");
  }

  const results = (await response.json()) as Array<{
    document?: { name: string; fields?: Record<string, any> };
  }>;

  return results
    .filter((entry): entry is { document: { name: string; fields?: Record<string, any> } } => !!entry.document)
    .map((entry) => {
      const { name } = entry.document;
      const id = name.slice(name.lastIndexOf("/") + 1);
      return { id, data: fromFirestoreFields(entry.document.fields || {}) };
    });
}

// ---------------------------------------------------------------------------
// Writes — a single `:commit` call applies every listed write atomically
// (all succeed or none do), which is what makes the create/reserve and
// reserve/update/release sequences in schoolChildren.ts safe without a full
// interactive (beginTransaction/commit-by-id) transaction: each write's own
// `currentDocument` precondition is checked as part of that same atomic
// commit, so a collision or a concurrent change aborts the WHOLE batch, not
// just one write.
// ---------------------------------------------------------------------------

export type FirestoreWrite = Record<string, unknown>;

// Creates a new document — fields fully replace whatever's there, so this is
// only ever used for a document this Worker is the sole owner of.
// `requireAbsent: true` sets `currentDocument: { exists: false }`, so the
// commit fails atomically (see commitFirestoreWrites) if the document
// already exists — this is the whole basis of the return-code uniqueness
// check, no `where` query needed.
export function buildCreateWrite(
  projectId: string,
  collection: string,
  docId: string,
  fields: Record<string, unknown>,
  options: { requireAbsent?: boolean } = {},
): FirestoreWrite {
  return {
    update: {
      name: documentName(projectId, collection, docId),
      fields: toFirestoreFields(fields),
    },
    ...(options.requireAbsent ? { currentDocument: { exists: false } } : {}),
  };
}

// Partial update — `updateMask.fieldPaths` restricts the write to EXACTLY
// these fields (Firestore merge semantics), so this can never accidentally
// touch parentId/childName/schoolId/active/createdAt. `precondition.
// updateTime`, when given, makes the write fail atomically if the document
// changed since it was last read (optimistic concurrency — see
// schoolChildren.ts's resetSchoolChildReturnCode).
export function buildUpdateWrite(
  projectId: string,
  collection: string,
  docId: string,
  fields: Record<string, unknown>,
  updateMaskPaths: string[],
  precondition?: { updateTime?: string },
): FirestoreWrite {
  return {
    update: {
      name: documentName(projectId, collection, docId),
      fields: toFirestoreFields(fields),
    },
    updateMask: { fieldPaths: updateMaskPaths },
    ...(precondition?.updateTime ? { currentDocument: { updateTime: precondition.updateTime } } : {}),
  };
}

// A delete with no precondition succeeds even if the document is already
// gone (Firestore treats deleting a nonexistent document as a no-op, never
// an error) — exactly what's wanted for releasing an old code reservation.
export function buildDeleteWrite(projectId: string, collection: string, docId: string): FirestoreWrite {
  return { delete: documentName(projectId, collection, docId) };
}

export type CommitResult = { ok: true } | { ok: false; status: number; message: string };

export async function commitFirestoreWrites(env: Env, writes: FirestoreWrite[]): Promise<CommitResult> {
  const accessToken = await getAccessToken(env);
  const url = `${FIRESTORE_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ writes }),
  });

  if (response.ok) return { ok: true };

  const errorBody = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;

  return {
    ok: false,
    status: response.status,
    message: errorBody?.error?.message || `Firestore write failed with status ${response.status}.`,
  };
}
