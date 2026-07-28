// ---------------------------------------------------------------------------
// Admin-sent notifications.
//
// Single-recipient sends use the shared notify() helper, so they create the
// normal in-app notification and request the matching OneSignal web push.
//
// Broadcasts keep the efficient Firestore batch write. After each batch is
// committed, the app asks the Cloudflare Worker to deliver every newly-created
// notification outside the app. Push delivery is best-effort and never rolls
// back the real in-app notification.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import { notify } from "../booking/work-errand/workErrandLib";
import i18n from "../i18n";
import { writeAuditLog } from "./adminAuditLib";
import { NotificationAudience } from "./adminTypes";

export type SendNotificationInput = {
  audience: NotificationAudience;
  title: string;
  message: string;
  targetUserId?: string;
};

const BATCH_CHUNK_SIZE = 450;
const PUSH_REQUEST_CHUNK_SIZE = 12;

const NOTIFICATION_WORKER_URL =
  "https://takeme-notifications.yvcstudent4.workers.dev";

const sendExternalPushForNotification = async (
  notificationId: string,
  idToken: string,
): Promise<void> => {
  try {
    const response = await fetch(
      `${NOTIFICATION_WORKER_URL}/send-notification`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ notificationId }),
      },
    );

    if (!response.ok && response.status !== 404) {
      const details = await response.text().catch(() => "");
      console.warn(
        "Admin external push failed",
        notificationId,
        response.status,
        details,
      );
    }
  } catch (error) {
    console.warn("Admin external push failed", notificationId, error);
  }
};

const deliverBroadcastPushes = async (
  notificationIds: string[],
  idToken: string,
): Promise<void> => {
  for (
    let start = 0;
    start < notificationIds.length;
    start += PUSH_REQUEST_CHUNK_SIZE
  ) {
    const chunk = notificationIds.slice(start, start + PUSH_REQUEST_CHUNK_SIZE);

    await Promise.allSettled(
      chunk.map((notificationId) =>
        sendExternalPushForNotification(notificationId, idToken),
      ),
    );
  }
};

const broadcastTo = async (
  userIds: string[],
  title: string,
  message: string,
) => {
  const sender = auth.currentUser;

  if (!sender) {
    throw new Error(i18n.t("auth.pleaseLoginFirst"));
  }

  const senderId = sender.uid;
  const idToken = await sender.getIdToken(true);

  for (let start = 0; start < userIds.length; start += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = userIds.slice(start, start + BATCH_CHUNK_SIZE);
    const notificationIds: string[] = [];

    chunk.forEach((userId) => {
      const docRef = doc(collection(db, "notifications"));
      notificationIds.push(docRef.id);

      batch.set(docRef, {
        userId,
        receiverId: userId,
        senderId,
        type: "admin_broadcast",
        title,
        message,
        applicationId: null,
        relatedId: null,
        bookingId: null,
        kind: null,
        category: null,
        status: null,
        targetTab: null,
        roleTarget: null,
        openBookingTab: null,
        requestId: null,
        offerId: null,
        targetPage: null,
        amount: null,
        driverId: null,
        passengerId: null,
        read: false,
        readAt: null,
        deleted: false,
        createdAt: serverTimestamp(),
      });
    });

    await batch.commit();

    // Best-effort: the in-app notifications are already saved.
    await deliverBroadcastPushes(notificationIds, idToken);
  }
};

export const sendAdminNotification = async (
  input: SendNotificationInput,
): Promise<number> => {
  if (!input.title.trim() || !input.message.trim()) {
    throw new Error(i18n.t("admin.enterTitleAndMessage"));
  }

  let recipientCount = 0;

  if (input.audience === "single_user" || input.audience === "single_driver") {
    if (!input.targetUserId) {
      throw new Error(i18n.t("admin.chooseRecipient"));
    }

    await notify({
      receiverId: input.targetUserId,
      type: "admin_message",
      title: input.title.trim(),
      message: input.message.trim(),
      targetTab: input.audience === "single_driver" ? "driver" : "passenger",
    });

    recipientCount = 1;
  } else {
    const usersSnap = await getDocs(
      input.audience === "all_passengers"
        ? query(collection(db, "users"), where("role", "==", "passenger"))
        : input.audience === "all_drivers"
          ? query(collection(db, "users"), where("isDriver", "==", true))
          : collection(db, "users"),
    );

    const userIds = usersSnap.docs.map((d) => d.id);

    await broadcastTo(userIds, input.title.trim(), input.message.trim());

    recipientCount = userIds.length;
  }

  await writeAuditLog({
    action: "notification_sent",
    targetType: "notification",
    targetId: input.targetUserId || input.audience,
    reason: `${input.audience} (${recipientCount} recipient${
      recipientCount === 1 ? "" : "s"
    })`,
  });

  return recipientCount;
};
