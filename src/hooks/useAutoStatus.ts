'use client';

import { useEffect, useState, useCallback } from 'react';
import type { AutoRunStatus } from '@/types';

export function useAutoStatus() {
  const [status, setStatus] = useState<AutoRunStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auto/status');
      if (res.ok) {
        const data: AutoRunStatus = await res.json();
        setStatus(prev => {
          const next = JSON.stringify(data);
          return JSON.stringify(prev) === next ? prev : data;
        });
      }
    } catch {
      // ignore fetch errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { status, isLoading, refresh };
}
