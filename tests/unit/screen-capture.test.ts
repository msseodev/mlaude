import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  collectScreenshots,
  captureAppScreens,
  extractFramesFromVideo,
} from '../../src/lib/autonomous/screen-capture';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-capture-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('collectScreenshots', () => {
  it('returns screenshots sorted by modification time', async () => {
    const screenshotDir = path.join(tmpDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    // Create test image files with staggered modification times
    await fs.writeFile(path.join(screenshotDir, 'step_001.png'), 'fake-png-1');
    // Small delay to ensure different modification times
    await new Promise(r => setTimeout(r, 50));
    await fs.writeFile(path.join(screenshotDir, 'step_002.png'), 'fake-png-2');
    await new Promise(r => setTimeout(r, 50));
    await fs.writeFile(path.join(screenshotDir, 'step_003.jpg'), 'fake-jpg-3');

    const result = await collectScreenshots(screenshotDir);

    expect(result.source).toBe('screenshots');
    expect(result.frames).toHaveLength(3);
    expect(result.frames[0]).toContain('step_001.png');
    expect(result.frames[1]).toContain('step_002.png');
    expect(result.frames[2]).toContain('step_003.jpg');
    expect(result.capturedAt).toBeTruthy();
  });

  it('returns none when directory does not exist', async () => {
    const result = await collectScreenshots('/nonexistent/path/screenshots');

    expect(result.source).toBe('none');
    expect(result.frames).toHaveLength(0);
  });

  it('returns none when directory is empty', async () => {
    const emptyDir = path.join(tmpDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await collectScreenshots(emptyDir);

    expect(result.source).toBe('none');
    expect(result.frames).toHaveLength(0);
  });

  it('ignores non-image files', async () => {
    const screenshotDir = path.join(tmpDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    await fs.writeFile(path.join(screenshotDir, 'notes.txt'), 'text file');
    await fs.writeFile(path.join(screenshotDir, 'data.json'), '{}');
    await fs.writeFile(path.join(screenshotDir, 'step_001.png'), 'fake-png');

    const result = await collectScreenshots(screenshotDir);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toContain('step_001.png');
  });

  it('respects maxFiles limit', async () => {
    const screenshotDir = path.join(tmpDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(path.join(screenshotDir, `step_${String(i).padStart(3, '0')}.png`), `fake-png-${i}`);
    }

    const result = await collectScreenshots(screenshotDir, 3);

    expect(result.frames).toHaveLength(3);
    expect(result.source).toBe('screenshots');
  });

  it('supports webp images', async () => {
    const screenshotDir = path.join(tmpDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    await fs.writeFile(path.join(screenshotDir, 'screen.webp'), 'fake-webp');

    const result = await collectScreenshots(screenshotDir);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toContain('screen.webp');
  });
});

describe('captureAppScreens', () => {
  it('returns none source when no screenshots exist', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });

    const result = await captureAppScreens(projectDir);

    expect(result.source).toBe('none');
    expect(result.frames).toHaveLength(0);
  });

  it('finds screenshots in .mlaude/screenshots/', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const screenshotDir = path.join(projectDir, '.mlaude', 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    await fs.writeFile(path.join(screenshotDir, 'step_001.png'), 'fake-png');
    await fs.writeFile(path.join(screenshotDir, 'step_002.png'), 'fake-png');

    const result = await captureAppScreens(projectDir);

    expect(result.source).toBe('screenshots');
    expect(result.frames).toHaveLength(2);
  });

  it('falls back to tests/e2e/screenshots/', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const e2eDir = path.join(projectDir, 'tests', 'e2e', 'screenshots');
    await fs.mkdir(e2eDir, { recursive: true });

    await fs.writeFile(path.join(e2eDir, 'test_screen.png'), 'fake-png');

    const result = await captureAppScreens(projectDir);

    expect(result.source).toBe('screenshots');
    expect(result.frames).toHaveLength(1);
  });

  it('uses explicit screenshotDir when provided', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    const customDir = path.join(tmpDir, 'custom-screenshots');
    await fs.mkdir(customDir, { recursive: true });

    await fs.writeFile(path.join(customDir, 'screen.png'), 'fake-png');

    const result = await captureAppScreens(projectDir, { screenshotDir: customDir });

    expect(result.source).toBe('screenshots');
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toContain('custom-screenshots');
  });

  it('respects maxFrames option', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const screenshotDir = path.join(projectDir, '.mlaude', 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    for (let i = 1; i <= 10; i++) {
      await fs.writeFile(
        path.join(screenshotDir, `step_${String(i).padStart(3, '0')}.png`),
        `fake-png-${i}`,
      );
    }

    const result = await captureAppScreens(projectDir, { maxFrames: 5 });

    expect(result.frames).toHaveLength(5);
  });

  it('prefers .mlaude/screenshots/ over tests/e2e/screenshots/', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const mlaudeDir = path.join(projectDir, '.mlaude', 'screenshots');
    const e2eDir = path.join(projectDir, 'tests', 'e2e', 'screenshots');
    await fs.mkdir(mlaudeDir, { recursive: true });
    await fs.mkdir(e2eDir, { recursive: true });

    await fs.writeFile(path.join(mlaudeDir, 'mlaude_screen.png'), 'fake');
    await fs.writeFile(path.join(e2eDir, 'e2e_screen.png'), 'fake');

    const result = await captureAppScreens(projectDir);

    expect(result.source).toBe('screenshots');
    // Should use the .mlaude dir (first priority)
    expect(result.frames[0]).toContain('.mlaude');
  });
});

describe('extractFramesFromVideo', () => {
  it('handles missing ffmpeg gracefully', async () => {
    const outputDir = path.join(tmpDir, 'frames');
    // Use a non-existent video path — ffmpeg will fail
    const result = await extractFramesFromVideo('/nonexistent/video.mp4', outputDir);

    expect(result.frames).toHaveLength(0);
    // Should be 'none' since no frames were extracted
    expect(result.source).toBe('none');
  });

  it('handles non-existent video file gracefully', async () => {
    const outputDir = path.join(tmpDir, 'frames');
    const result = await extractFramesFromVideo(
      path.join(tmpDir, 'missing-video.mp4'),
      outputDir,
    );

    expect(result.frames).toHaveLength(0);
    expect(result.source).toBe('none');
  });

  it('respects maxFrames option', async () => {
    const outputDir = path.join(tmpDir, 'frames');
    const result = await extractFramesFromVideo(
      '/nonexistent/video.mp4',
      outputDir,
      { maxFrames: 5 },
    );

    // Even with maxFrames set, no frames because file doesn't exist
    expect(result.frames).toHaveLength(0);
  });
});
