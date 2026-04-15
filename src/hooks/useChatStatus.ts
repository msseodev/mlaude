'use client';

import type { ChatStatus } from '@/lib/types';
import { usePolledStatus } from './usePolledStatus';

export function useChatStatus() {
  return usePolledStatus<ChatStatus>('/api/chat/status');
}
