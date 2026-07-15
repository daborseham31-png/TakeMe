// ---------------------------------------------------------------------------
// Shared "subscribe to a live Firestore collection with loading/error/manual
// refresh" hook. Every admin list screen (Users, Drivers, Rides, Bookings,
// Reports) uses this instead of re-implementing the same
// loading/error/refresh-key boilerplate.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

export type AdminSubscribe<T> = (
  onUpdate: (items: T[]) => void,
  onError: (error: unknown) => void,
) => () => void;

export function useAdminCollection<T>(subscribe: AdminSubscribe<T>) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = subscribe(
      (items) => {
        setData(items);
        setLoading(false);
      },
      (err) => {
        const message =
          err instanceof Error ? err.message : "Could not load data. Please try again.";
        setError(message);
        setLoading(false);
      },
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  return { data, loading, error, refresh };
}
