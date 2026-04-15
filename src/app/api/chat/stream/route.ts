import { chatManager } from '@/lib/chat-manager';
import { createSSEStreamRoute } from '@/lib/sse-stream-factory';

export const dynamic = 'force-dynamic';

const handler = createSSEStreamRoute(chatManager, { snapshotEventType: 'chat_status' });

export function GET(): Response {
  return handler();
}
