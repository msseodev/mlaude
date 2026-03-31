import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

export interface CapturedFrames {
  frames: string[];       // Array of absolute image file paths
  source: 'recording' | 'screenshots' | 'none';
  capturedAt: string;     // ISO timestamp
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/**
 * Extract frames from a video recording file using ffmpeg.
 * Extracts 1 frame per second by default, max 20 frames.
 * If ffmpeg is not installed, gracefully returns empty frames.
 */
export async function extractFramesFromVideo(
  videoPath: string,
  outputDir: string,
  options?: { fps?: number; maxFrames?: number },
): Promise<CapturedFrames> {
  const maxFrames = options?.maxFrames ?? 20;
  const fps = options?.fps ?? 1;
  const interval = 1 / fps;

  // Ensure the output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Check if the video file exists
  try {
    await fs.access(videoPath);
  } catch {
    return { frames: [], source: 'none', capturedAt: new Date().toISOString() };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', `fps=1/${interval}`,
        '-frames:v', maxFrames.toString(),
        `${outputDir}/frame_%03d.png`,
      ]);

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });

    // Collect the generated frames
    const entries = await fs.readdir(outputDir);
    const frames = entries
      .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .slice(0, maxFrames)
      .map(f => path.resolve(outputDir, f));

    return {
      frames,
      source: frames.length > 0 ? 'recording' : 'none',
      capturedAt: new Date().toISOString(),
    };
  } catch {
    // ffmpeg not installed or failed — gracefully return empty
    return { frames: [], source: 'none', capturedAt: new Date().toISOString() };
  }
}

/**
 * Collect existing screenshots from a directory (sorted by modification time).
 */
export async function collectScreenshots(
  screenshotDir: string,
  maxFiles: number = 20,
): Promise<CapturedFrames> {
  try {
    await fs.access(screenshotDir);
  } catch {
    return { frames: [], source: 'none', capturedAt: new Date().toISOString() };
  }

  try {
    const entries = await fs.readdir(screenshotDir);
    const imageFiles = entries.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return IMAGE_EXTENSIONS.includes(ext);
    });

    if (imageFiles.length === 0) {
      return { frames: [], source: 'none', capturedAt: new Date().toISOString() };
    }

    // Sort by modification time (newest first, then take most recent)
    const filesWithStats = await Promise.all(
      imageFiles.map(async (f) => {
        const fullPath = path.resolve(screenshotDir, f);
        const stat = await fs.stat(fullPath);
        return { path: fullPath, mtimeMs: stat.mtimeMs };
      }),
    );

    filesWithStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const frames = filesWithStats.slice(0, maxFiles).map(f => f.path);

    return {
      frames,
      source: 'screenshots',
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return { frames: [], source: 'none', capturedAt: new Date().toISOString() };
  }
}

/**
 * Main function: Try video first, fall back to screenshots directory, then return none.
 */
export async function captureAppScreens(
  projectPath: string,
  options?: {
    videoPath?: string;
    screenshotDir?: string;
    maxFrames?: number;
  },
): Promise<CapturedFrames> {
  const maxFrames = options?.maxFrames ?? 20;

  // 1. If videoPath provided, try extractFramesFromVideo
  if (options?.videoPath) {
    const outputDir = path.join(projectPath, '.mlaude', 'extracted-frames');
    const result = await extractFramesFromVideo(options.videoPath, outputDir, { maxFrames });
    if (result.frames.length > 0) {
      return result;
    }
  }

  // 2. Look for screenshots in provided dir or .mlaude/screenshots/
  const screenshotDirs = [
    options?.screenshotDir,
    path.join(projectPath, '.mlaude', 'screenshots'),
    path.join(projectPath, 'tests', 'e2e', 'screenshots'),
  ].filter((d): d is string => !!d);

  for (const dir of screenshotDirs) {
    const result = await collectScreenshots(dir, maxFrames);
    if (result.frames.length > 0) {
      return result;
    }
  }

  // 3. Nothing found
  return { frames: [], source: 'none', capturedAt: new Date().toISOString() };
}
