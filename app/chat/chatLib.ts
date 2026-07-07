// ---------------------------------------------------------------------------
// Real user-to-user chat (WhatsApp-style)
//
// This is SEPARATE from notifications. Notifications = system/request updates;
// chat = free-text conversations between two users.
//
// Collections:
//   - conversations                       (one doc per pair of users)
//   - conversations/{id}/messages         (subcollection of chat messages)
//   - users                               (read for search + names)
//
// The conversation id is deterministic (`${uidA}_${uidB}` sorted), so opening a
// chat is a direct doc read/write – no query or composite index needed.
// ---------------------------------------------------------------------------

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";

export type ChatUser = {
  id: string;
  name: string;
  role: string;
};

export const conversationId = (a: string, b: string) =>
  [a, b].sort().join("_");

// Search users by name (excluding yourself). Case-insensitive contains match,
// done client-side to avoid extra indexes.
export const searchUsers = async (term: string): Promise<ChatUser[]> => {
  const me = auth.currentUser;
  const clean = term.trim().toLowerCase();
  if (!clean) return [];

  const snap = await getDocs(collection(db, "users"));

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || "User",
        role: data.role || data.userType || "user",
      };
    })
    .filter((u) => u.id !== me?.uid)
    .filter((u) => u.name.toLowerCase().includes(clean))
    .slice(0, 20);
};

// Get or create the conversation between the current user and `other`.
export const openConversation = async (other: ChatUser): Promise<string> => {
  const me = auth.currentUser;
  if (!me) throw new Error("You must be logged in.");

  const id = conversationId(me.uid, other.id);
  const ref = doc(db, "conversations", id);
  const snap = await getDoc(ref);

  // My own display name (from the users doc, falling back to auth).
  let myName = me.displayName || "You";
  try {
    const meSnap = await getDoc(doc(db, "users", me.uid));
    if (meSnap.exists()) myName = meSnap.data().name || myName;
  } catch {
    // Keep fallback.
  }

  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [me.uid, other.id],
      participantNames: { [me.uid]: myName, [other.id]: other.name },
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: null,
      unreadCount: { [me.uid]: 0, [other.id]: 0 },
      hiddenFor: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    // Make sure I'm no longer hiding it (re-open) and names are fresh.
    const data = snap.data();
    const hiddenFor: string[] = Array.isArray(data.hiddenFor)
      ? data.hiddenFor.filter((x: string) => x !== me.uid)
      : [];
    await updateDoc(ref, {
      hiddenFor,
      [`participantNames.${me.uid}`]: myName,
      [`participantNames.${other.id}`]: other.name,
    });
  }

  return id;
};

// Send a message + update the conversation summary and the other user's unread.
export const sendMessage = async (
  convId: string,
  text: string,
  receiverId: string,
) => {
  const me = auth.currentUser;
  if (!me) throw new Error("You must be logged in.");

  const clean = text.trim();
  if (!clean) return;

  await addDoc(collection(db, "conversations", convId, "messages"), {
    senderId: me.uid,
    receiverId,
    text: clean,
    read: false,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "conversations", convId), {
    lastMessage: clean,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: me.uid,
    updatedAt: serverTimestamp(),
    [`unreadCount.${receiverId}`]: increment(1),
  });
};

// Mark the current user's unread count to 0 when they open a conversation.
export const markConversationRead = async (convId: string) => {
  const me = auth.currentUser;
  if (!me) return;
  try {
    await updateDoc(doc(db, "conversations", convId), {
      [`unreadCount.${me.uid}`]: 0,
    });
  } catch {
    // Non-fatal.
  }
};

// Hide a conversation from the current user's list (does not delete messages
// for the other participant).
export const hideConversation = async (convId: string) => {
  const me = auth.currentUser;
  if (!me) return;
  const ref = doc(db, "conversations", convId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const hiddenFor: string[] = Array.isArray(data.hiddenFor)
    ? data.hiddenFor
    : [];
  if (!hiddenFor.includes(me.uid)) hiddenFor.push(me.uid);
  await updateDoc(ref, { hiddenFor });
};
