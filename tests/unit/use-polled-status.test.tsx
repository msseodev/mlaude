// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolledStatus } from '@/hooks/usePolledStatus';

interface FakeStatus {
  value: string;
}

describe('usePolledStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts with isLoading=true and status=null', () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 'hello' }),
    } as Response);

    const { result } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status')
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.status).toBeNull();
  });

  it('populates status after the initial fetch resolves', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 'hello' }),
    } as Response);

    const { result } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status')
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toEqual({ value: 'hello' });
  });

  it('re-fetches after the interval elapses', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ value: `call-${callCount}` }),
      } as Response;
    });

    const { result } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status', 2000)
    );

    // Initial fetch
    await act(async () => { await Promise.resolve(); });
    expect(callCount).toBe(1);

    // Advance one interval
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(callCount).toBe(2);
    expect(result.current.status).toEqual({ value: 'call-2' });
  });

  it('cancels the interval on unmount', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      return { ok: true, json: async () => ({ value: 'x' }) } as Response;
    });

    const { unmount } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status', 2000)
    );

    await act(async () => { await Promise.resolve(); });
    unmount();

    // Advance timer after unmount — should not trigger another fetch
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    expect(callCount).toBe(1); // only the initial one
  });

  it('preserves the same status object reference when response is deeply equal', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 'stable' }),
    } as Response);

    const { result } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status', 2000)
    );

    await act(async () => { await Promise.resolve(); });
    const firstRef = result.current.status;
    expect(firstRef).toEqual({ value: 'stable' });

    // Second poll returns identical data
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    // Same object reference — no spurious state update
    expect(result.current.status).toBe(firstRef);
  });

  it('refresh() triggers an immediate re-fetch', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      return { ok: true, json: async () => ({ value: `call-${callCount}` }) } as Response;
    });

    const { result } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status', 60_000)
    );

    await act(async () => { await Promise.resolve(); });
    expect(callCount).toBe(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(callCount).toBe(2);
  });

  it('ignores fetch errors silently', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() =>
      usePolledStatus<FakeStatus>('/api/fake/status')
    );

    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBeNull();
  });
});
