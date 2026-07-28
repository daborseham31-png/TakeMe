// ---------------------------------------------------------------------------
// Real user-to-user chat (WhatsApp-style)
//
// Chat messages stay in Firestore exactly as before. After a message is saved,
// the app sends only conversationId + messageId to the Cloudflare Worker.
// The Worker verifies the Firebase user, re-reads the exact conversation and
// message, confirms the caller is the sender and both users are participants,
// then sends OneSignal web push to the receiver's linked iPhone.
// ---------------------------------------------------------------------------

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";

export type ChatUser = {
  id: string;
  name: string;
  role: string;
};

const NOTIFICATION_WORKER_URL =
  "https://takeme-notifications.yvcstudent4.workers.dev";

export const conversationId = (a: string, b: string) => [a, b].sort().join("_");

const sendExternalChatPush = async (
  convId: string,
  messageId: string,
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !convId || !messageId) return;

  try {
    const idToken = await user.getIdToken(true);

    const response = await fetch(
      `${NOTIFICATION_WORKER_URL}/send-chat-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          conversationId: convId,
          messageId,
        }),
      },
    );

    if (!response.ok && response.status !== 404) {
      const details = await response.text().catch(() => "");
      console.warn("Chat external push failed", response.status, details);
    }
  } catch (error) {
    // The Firestore message already exists. Push failure must not delete it
    // or make the Send button look unsuccessful.
    console.warn("Chat external push failed", error);
  }
};

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
        name: data.name || i18n.t("common.user"),
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

  if (!me) {
    throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));
  }

  const id = conversationId(me.uid, other.id);
  const ref = doc(db, "conversations", id);
  const snap = await getDoc(ref);

  let myName = me.displayName || "You";

  try {
    const meSnap = await getDoc(doc(db, "users", me.uid));

    if (meSnap.exists()) {
      myName = meSnap.data().name || myName;
    }
  } catch {
    // Keep fallback.
  }

  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [me.uid, other.id],
      participantNames: {
        [me.uid]: myName,
        [other.id]: other.name,
      },
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: null,
      unreadCount: {
        [me.uid]: 0,
        [other.id]: 0,
      },
      hiddenFor: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
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

  if (!me) {
    throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));
  }

  const clean = text.trim();
  if (!clean) return;

  const messageRef = await addDoc(
    collection(db, "conversations", convId, "messages"),
    {
      senderId: me.uid,
      receiverId,
      text: clean,
      read: false,
      createdAt: serverTimestamp(),
    },
  );

  await updateDoc(doc(db, "conversations", convId), {
    lastMessage: clean,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: me.uid,
    updatedAt: serverTimestamp(),
    [`unreadCount.${receiverId}`]: increment(1),
  });

  await sendExternalChatPush(convId, messageRef.id);
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

// Hide a conversation from the current user's list only.
export const hideConversation = async (convId: string) => {
  const me = auth.currentUser;
  if (!me) return;

  await updateDoc(doc(db, "conversations", convId), {
    hiddenFor: arrayUnion(me.uid),
  });
};

// Hide every currently-visible conversation for the current user.
export const clearAllConversations = async (conversationIds: string[]) => {
  const me = auth.currentUser;
  if (!me || conversationIds.length === 0) return;

  for (let i = 0; i < conversationIds.length; i += 450) {
    const batch = writeBatch(db);

    conversationIds.slice(i, i + 450).forEach((id) => {
      batch.update(doc(db, "conversations", id), {
        hiddenFor: arrayUnion(me.uid),
      });
    });

    await batch.commit();
  }
};
