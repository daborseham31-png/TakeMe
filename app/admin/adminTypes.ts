// ---------------------------------------------------------------------------
// Shared TypeScript types for the Admin Dashboard. Kept in one file so every
// admin lib/screen imports the same shapes instead of redeclaring them.
// ---------------------------------------------------------------------------

export type AccountStatus = "active" | "blocked" | "suspended";

export type DriverVerificationStatus =
  | "not_registered"
  | "pending_admin_review"
  | "approved"
  | "rejected"
  | "suspended";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "passenger" | "driver" | "admin" | "";
  isDriver: boolean;
  photo: string | null;
  accountStatus: AccountStatus;
  statusReason: string;
  driverVerificationStatus: DriverVerificationStatus | "";
  ratingAverage: number;
  ratingCount: number;
  carPlate: string;
  licenseExpiryDate: string;
  licenseDocumentType: string;
  licenseDocumentTypeConfidence: number;
  licenseNeedsManualDocumentReview: boolean;
  spokenLanguages: string[];
  gender: string;
  createdAtSeconds: number;
};

export type RideCategory = "personal" | "school" | "work" | "errand";

export type RideStatus = "upcoming" | "active" | "completed" | "cancelled";

export type AdminRideRow = {
  id: string;
  source: "driverRoutes" | "workJobs" | "errandJobs";
  category: RideCategory;
  driverId: string;
  driverName: string;
  from: string;
  to: string;
  title: string;
  date: string;
  time: string;
  price: number | null;
  seats: number | null;
  totalSeats: number | null;
  status: RideStatus;
  removed: boolean;
  createdAtSeconds: number;
  raw: Record<string, unknown>;
};

export type AdminBookingRow = {
  id: string;
  category: string;
  passengerId: string;
  passengerName: string;
  driverId: string;
  driverName: string;
  from: string;
  to: string;
  date: string;
  time: string;
  seats: number | null;
  price: number | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  routeId: string;
  createdAtSeconds: number;
};

export type ReportCategory =
  | "user"
  | "driver"
  | "ride"
  | "booking"
  | "payment"
  | "other";

export type ReportStatus = "open" | "under_review" | "resolved" | "rejected";

export type AdminReportRow = {
  id: string;
  reporterId: string;
  reporterName: string;
  targetType: "user" | "ride" | "booking" | "";
  targetId: string;
  category: ReportCategory;
  description: string;
  imageUrl: string;
  status: ReportStatus;
  adminResponse: string;
  internalNote: string;
  createdAtSeconds: number;
};

export type NotificationAudience =
  | "single_user"
  | "single_driver"
  | "all_passengers"
  | "all_drivers"
  | "all_users";

export type AdminAuditAction =
  | "user_blocked"
  | "user_unblocked"
  | "user_suspended"
  | "user_reactivated"
  | "user_role_changed"
  | "user_deleted"
  | "driver_approved"
  | "driver_rejected"
  | "driver_suspended"
  | "driver_reactivated"
  | "ride_cancelled"
  | "ride_removed"
  | "ride_restored"
  | "booking_cancelled"
  | "report_status_changed"
  | "report_resolved"
  | "notification_sent"
  | "driver_cancellation_violation_excused"
  | "driver_cancellation_suspension_lifted";

export type AdminAuditLogEntry = {
  adminId: string;
  action: AdminAuditAction;
  targetType:
    | "user"
    | "driver"
    | "ride"
    | "booking"
    | "report"
    | "notification";
  targetId: string;
  reason?: string;
};
