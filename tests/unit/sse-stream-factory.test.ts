import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSSEStreamRoute } from '@/lib/sse-stream-factory';

// In-memory fake StreamSource with emit capability
function createFakeSource<TEvent>() {
  let cb: ((e: TEvent) => void) | null = null;
  let unsubscribed = false;
  let snapshotData: unknown = { type: 'status', value: 'ok' };

  return {
    getStatus: () => snapshotData,
    setSnapshot: (data: unknown) => { snapshotData = data; },
    addListener: (listener: (e: TEvent) => void) => {
      cb = listener;
      return () => { unsubscribed = true; };
    },
    emit: (event: TEvent) => { cb?.(event); },
    wasUnsubscribed: () => unsubscribed,
  };
}

async function readSSEFrames(response: Response, count: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = '';

  while (frames.length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Split on SSE frame separator
    const parts = buffer.split('\n\n');
    buffer = parts.pop()!; // keep incomplete frame
    for (const part of parts) {
      if (part.trim()) frames.push(part.trim());
    }
  }
  reader.cancel();
  return frames;
}

describe('createSSEStreamRoute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a handler that returns a Response with SSE headers', async () => {
    const source = createFakeSource();
    const handler = createSSEStreamRoute(source);
    const response = handler();

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    response.body?.cancel();
  });

  it('sends the initial snapshot as the first SSE frame', async () => {
    const source = createFakeSource();
    source.setSnapshot({ state: 'idle' });
    const handler = createSSEStreamRoute(source, { snapshotEventType: 'session_status' });
    const response = handler();

    const frames = await readSSEFrames(response, 1);
    expect(frames.length).toBe(1);
    const parsed = JSON.parse(frames[0].replace(/^data: /, ''));
    expect(parsed.type).toBe('session_status');
    expect(parsed.data).toEqual({ state: 'idle' });
    expect(parsed.timestamp).toBeTruthy();
  });

  it('passes through events emitted by the source as SSE frames', async () => {
    const source = createFakeSource<{ type: string; payload: string }>();
    const handler = createSSEStreamRoute(source);
    const response = handler();

    let resolveFrame!: (s: string) => void;
    const framePromise = new Promise<string>(r => { resolveFrame = r; });
    const r = response.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';

    // Skip the snapshot frame, resolve on the second data frame
    let snapshotConsumed = false;
    const consumeFrames = async () => {
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop()!;
        for (const part of parts) {
          if (!part.trim()) continue;
          if (!snapshotConsumed) { snapshotConsumed = true; continue; }
          resolveFrame(part.trim());
          return;
        }
      }
    };
    consumeFrames();

    source.emit({ type: 'my_event', payload: 'hello' });
    const frame = await framePromise;
    expect(frame).toContain('data:');
    const parsed = JSON.parse(frame.replace(/^data: /, ''));
    expect(parsed.type).toBe('my_event');
    expect(parsed.payload).toBe('hello');
    r.cancel();
  });

  it('calls unsubscribe when the stream is cancelled', async () => {
    const source = createFakeSource();
    const handler = createSSEStreamRoute(source);
    const response = handler();

    // Read one frame then cancel
    const reader = response.body!.getReader();
    await reader.read(); // snapshot frame
    await reader.cancel();

    // Give microtasks time to propagate
    await Promise.resolve();
    expect(source.wasUnsubscribed()).toBe(true);
  });

  it('uses default snapshotEventType of "session_status" when not specified', async () => {
    const source = createFakeSource();
    const handler = createSSEStreamRoute(source);
    const response = handler();

    const frames = await readSSEFrames(response, 1);
    const parsed = JSON.parse(frames[0].replace(/^data: /, ''));
    expect(parsed.type).toBe('session_status');
  });
});
