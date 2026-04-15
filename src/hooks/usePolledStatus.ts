'use client';

import { useEffect, useState, useCallback } from 'react';

export function usePolledStatus<T>(endpoint: string, intervalMs = 2000): {
  status: T | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const data: T = await res.json();
        setStatus(prev => {
          const next = JSON.stringify(data);
          return JSON.stringify(prev) === next ? prev : data;
        });
      }
    } catch {
      // ignore fetch errors
    } finally {
      setIsLoading(prev => (prev ? false : prev));
    }
  }, [endpoint]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [refresh, intervalMs]);

  return { status, isLoading, refresh };
}
