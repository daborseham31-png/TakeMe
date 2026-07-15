// ---------------------------------------------------------------------------
// Admin-sent notifications. Reuses the exact `notifications` collection
// field shape written by notify() (app/booking/work-errand/workErrandLib.ts)
// so recipients see these in the SAME in-app notifications screen
// (app/notifications.tsx) with no changes needed there. Single-user sends
// go through notify() directly; broadcasts batch-write the identical shape
// (chunked at 450 docs per commit, same limit the app's own "clear all"
// uses) since notify() only handles one receiver at a time.
//
// This does NOT send a push notification — no Expo push token registration
// exists anywhere in this project yet, so pretending push delivery works
// would be exactly the kind of fake behavior we were told not to build.
// Recipients see these the next time they open the in-app notifications
// screen, which is the real, working delivery mechanism today.
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
import { writeAuditLog } from "./adminAuditLib";
import { NotificationAudience } from "./adminTypes";

export type SendNotificationInput = {
  audience: NotificationAudience;
  title: string;
  message: string;
  targetUserId?: string;
};

const BATCH_CHUNK_SIZE = 450;

const broadcastTo = async (userIds: string[], title: string, message: string) => {
  const senderId = auth.currentUser?.uid || null;

  for (let start = 0; start < userIds.length; start += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = userIds.slice(start, start + BATCH_CHUNK_SIZE);

    chunk.forEach((userId) => {
      const ref = collection(db, "notifications");
      const docRef = doc(ref);

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
  }
};

export const sendAdminNotification = async (input: SendNotificationInput): Promise<number> => {
  if (!input.title.trim() || !input.message.trim()) {
    throw new Error("Please enter a title and a message.");
  }

  let recipientCount = 0;

  if (input.audience === "single_user" || input.audience === "single_driver") {
    if (!input.targetUserId) {
      throw new Error("Please choose a recipient.");
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
    reason: `${input.audience} (${recipientCount} recipient${recipientCount === 1 ? "" : "s"})`,
  });

  return recipientCount;
};
