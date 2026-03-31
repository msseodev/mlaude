import { describe, it, expect } from 'vitest';
import { buildCycleCommitMessage } from '../../src/lib/autonomous/cycle-engine';

describe('buildCycleCommitMessage', () => {
  it('uses conventional commit format with finding title', () => {
    const finding = { priority: 'P0', title: 'Fix login button' };

    const msg = buildCycleCommitMessage(3, finding);

    expect(msg).toContain('fix: Fix login button');
    expect(msg).toContain('Finding: P0 - Fix login button');
  });

  it('does not include [mlaude-auto] prefix', () => {
    const finding = { priority: 'P0', title: 'Fix login button' };

    const msg = buildCycleCommitMessage(3, finding);

    expect(msg).not.toContain('[mlaude-auto]');
  });

  it('uses chore type when no finding is provided', () => {
    const msg = buildCycleCommitMessage(5, null);

    expect(msg).toContain('chore: autonomous cycle 5 changes');
    expect(msg).not.toContain('Finding:');
    expect(msg).not.toContain('[mlaude-auto]');
  });

  it('does not include Agents or Cost metadata lines', () => {
    const finding = { priority: 'P1', title: 'Improve error handling' };

    const msg = buildCycleCommitMessage(1, finding);

    expect(msg).not.toContain('Agents:');
    expect(msg).not.toContain('Cost:');
    expect(msg).not.toContain('Duration:');
  });

  it('produces correct multi-line format with finding', () => {
    const finding = { priority: 'P1', title: 'Improve error handling' };

    const msg = buildCycleCommitMessage(7, finding);
    const lines = msg.split('\n');

    // Title line
    expect(lines[0]).toBe('fix: Improve error handling');
    // Empty line after title
    expect(lines[1]).toBe('');
    // Finding info
    expect(lines[2]).toBe('Finding: P1 - Improve error handling');
  });

  it('produces single-line format without finding', () => {
    const msg = buildCycleCommitMessage(1, null);
    const lines = msg.split('\n');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('chore: autonomous cycle 1 changes');
  });
});
