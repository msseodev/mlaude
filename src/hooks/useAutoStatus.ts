'use client';

import type { AutoRunStatus } from '@/types';
import { usePolledStatus } from './usePolledStatus';

export function useAutoStatus() {
  return usePolledStatus<AutoRunStatus>('/api/auto/status');
}
