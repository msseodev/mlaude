export interface StreamSource<TEvent> {
  getStatus(): unknown;
  addListener(cb: (e: TEvent) => void): () => void;
}

interface SSEStreamOptions {
  heartbeatMs?: number;
  snapshotEventType?: string;
}

export function createSSEStreamRoute<TEvent>(
  source: StreamSource<TEvent>,
  opts?: SSEStreamOptions,
): () => Response {
  const heartbeatMs = opts?.heartbeatMs ?? 30_000;
  const snapshotEventType = opts?.snapshotEventType ?? 'session_status';

  return (): Response => {
    const encoder = new TextEncoder();
    let removeListener: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial snapshot
        const snapshot = source.getStatus();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: snapshotEventType, data: snapshot, timestamp: new Date().toISOString() })}\n\n`
          )
        );

        // Subscribe to events
        removeListener = source.addListener((event: TEvent) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          } catch {
            if (heartbeat) clearInterval(heartbeat);
            removeListener?.();
          }
        });

        // Heartbeat to keep connection alive
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            if (heartbeat) clearInterval(heartbeat);
            removeListener?.();
          }
        }, heartbeatMs);
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        removeListener?.();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  };
}
