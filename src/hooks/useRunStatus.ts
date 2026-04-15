'use client';

import type { RunStatus } from '@/types';
import { usePolledStatus } from './usePolledStatus';

export function useRunStatus() {
  return usePolledStatus<RunStatus>('/api/run/status');
}
