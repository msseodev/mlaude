// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RateLimitBanner } from '@/components/RateLimitBanner';

describe('RateLimitBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the rate limit message', () => {
    const future = new Date(Date.now() + 90_000).toISOString();
    render(<RateLimitBanner waitingUntil={future} retryCount={0} />);
    expect(screen.getByText(/rate limit reached/i)).toBeTruthy();
  });

  it('shows a countdown that includes minutes and seconds', () => {
    const future = new Date(Date.now() + 90_000).toISOString(); // 1m 30s
    render(<RateLimitBanner waitingUntil={future} retryCount={0} />);
    expect(screen.getByText(/1m 30s/)).toBeTruthy();
  });

  it('shows only seconds when under a minute', () => {
    const future = new Date(Date.now() + 45_000).toISOString(); // 45s
    render(<RateLimitBanner waitingUntil={future} retryCount={0} />);
    expect(screen.getByText(/45s/)).toBeTruthy();
  });

  it('shows attempt count when retryCount > 0', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    render(<RateLimitBanner waitingUntil={future} retryCount={2} />);
    expect(screen.getByText(/attempt 2/)).toBeTruthy();
  });

  it('does not show attempt when retryCount is 0', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    render(<RateLimitBanner waitingUntil={future} retryCount={0} />);
    expect(screen.queryByText(/attempt/)).toBeNull();
  });

  it('shows "resuming..." when the countdown elapses', () => {
    const future = new Date(Date.now() + 2_000).toISOString(); // 2s from now
    render(<RateLimitBanner waitingUntil={future} retryCount={0} />);
    // Advance past the target time
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText(/resuming\.\.\./)).toBeTruthy();
  });

  it('decrements the countdown each second', () => {
    const future = new Date(Date.now() + 5_000).toISOString();
    render(<RateLimitBanner waitingUntil={future} retryCount={0} />);
    // Initially 5s
    expect(screen.getByText(/5s/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(/4s/)).toBeTruthy();
  });
});
