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
  // Added for noShowDetection.ts's driverViolations writes (passengerIds,
  // paymentMethods) — every element must itself be a supported scalar type
  // (reusing this same function recursively); reading arrays back was
  // already supported by fromFirestoreValue below, this is only the write
  // side that was missing.
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
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
// Single-field "greater than or equal" range query — added for
// noShowDetection.ts's gatherCandidates (see that file's header on the
// "Quota exceeded." incident this fixes): lets a caller restrict a read to
// e.g. "tripDate >= 30 days ago" server-side instead of downloading an
// entire collection and discarding old documents in JS.
//
// Deliberately ONE filter, on ONE field, with no other `where` clause
// combined into the same query — Firestore requires a composite index for
// any query that combines an equality/other filter with a range filter on a
// DIFFERENT field, but a query with a SINGLE range filter (whose field also
// appears as the first/only `orderBy`, as required) is served entirely by
// Firestore's automatic single-field index. No index to provision, no
// deploy required for this function to work.
//
// No pagination: matches queryFirestoreDocuments' own existing precedent
// (also a single, unpaginated runQuery call) — Firestore's REST `runQuery`
// returns every matching document in one response when no `limit` is set,
// which is exactly what the current (pre-fix) full-collection call already
// relies on successfully today. A 30-day-window read is always a subset of
// what that same call already handles in one response, so no new pagination
// need is introduced here.
// ---------------------------------------------------------------------------

export async function queryFirestoreDocumentsWhereGte(
  env: Env,
  collection: string,
  fieldPath: string,
  minValue: string,
): Promise<FirestoreQueryDocument[]> {
  const accessToken = await getAccessToken(env);
  const url = `${FIRESTORE_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const structuredQuery = {
    from: [{ collectionId: collection }],
    where: {
      fieldFilter: {
        field: { fieldPath },
        op: "GREATER_THAN_OR_EQUAL",
        value: { stringValue: minValue },
      },
    },
    orderBy: [{ field: { fieldPath }, direction: "ASCENDING" }],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!response.ok) {
    console.error("firestoreRest: runQuery (GTE) failed", { collection, status: response.status });
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
// Bulk "field IN [...]" query, WITH pagination — added for
// noShowDetection.ts's bulk booking fetch (see that file's header): instead
// of one queryFirestoreDocuments call per candidate trip (which blew past
// the Worker's per-invocation subrequest limit at ~50 candidates), this lets
// a caller fetch every booking belonging to a bounded batch of trip ids in
// ONE request. Firestore's IN operator supports at most 30 comparison
// values, so callers must chunk their id list to <=30 per call (this
// function throws loudly rather than silently dropping ids past 30, so a
// caller that forgets to chunk fails fast instead of silently missing data).
//
// Pagination: `runQuery` has no separate page-token field — instead it's
// bounded by an explicit `limit` and continued via a document-name cursor
// (`orderBy __name__` + `startAt`), the standard Firestore REST pagination
// pattern. IN queries don't require the orderBy to match the filtered field
// (that constraint only applies to inequality/array-contains operators), so
// ordering by `__name__` here needs no composite index — same "equality-only,
// no composite index" property this file's header already documents for its
// other queries. In practice a single ≤30-trip chunk's bookings will almost
// always fit in one page; the loop below exists so a chunk that ever DOES
// exceed one page is still read completely, never silently truncated.
// ---------------------------------------------------------------------------

export async function queryFirestoreDocumentsByIn(
  env: Env,
  collection: string,
  fieldPath: string,
  values: string[],
  pageSize = 300,
): Promise<{ documents: FirestoreQueryDocument[]; pagesFetched: number }> {
  if (values.length === 0) return { documents: [], pagesFetched: 0 };
  if (values.length > 30) {
    throw new Error("queryFirestoreDocumentsByIn: values.length exceeds Firestore's 30-value IN limit.");
  }

  const accessToken = await getAccessToken(env);
  const url = `${FIRESTORE_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const where = {
    fieldFilter: {
      field: { fieldPath },
      op: "IN",
      value: { arrayValue: { values: values.map((v) => ({ stringValue: v })) } },
    },
  };

  const documents: FirestoreQueryDocument[] = [];
  let cursorDocumentName: string | null = null;
  let pagesFetched = 0;

  while (true) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: collection }],
      where,
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: pageSize,
      ...(cursorDocumentName
        ? { startAt: { values: [{ referenceValue: cursorDocumentName }], before: false } }
        : {}),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ structuredQuery }),
    });
    pagesFetched += 1;

    if (!response.ok) {
      console.error("firestoreRest: runQuery (IN) failed", { collection, status: response.status });
      throw new Error("Could not read from Firestore.");
    }

    const page = (await response.json()) as Array<{ document?: { name: string; fields?: Record<string, any> } }>;
    const pageDocs = page.filter(
      (entry): entry is { document: { name: string; fields?: Record<string, any> } } => !!entry.document,
    );

    for (const entry of pageDocs) {
      const { name } = entry.document;
      const id = name.slice(name.lastIndexOf("/") + 1);
      documents.push({ id, data: fromFirestoreFields(entry.document.fields || {}) });
    }

    // Fewer than a full page means this was the last one — never assume a
    // full page is the last page, since that would silently drop the rest.
    if (pageDocs.length < pageSize) break;
    cursorDocumentName = pageDocs[pageDocs.length - 1].document.name;
  }

  return { documents, pagesFetched };
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
