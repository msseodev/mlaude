import fs from 'fs/promises';
import path from 'path';

const COMMANDS_DIR = '.claude/commands';
const PREFIX = 'mlaude-';

export async function syncCommands(targetProject: string): Promise<void> {
  const sourceDir = path.join(process.cwd(), 'src/lib/autonomous/commands');
  const targetDir = path.join(targetProject, COMMANDS_DIR);

  // Read all .md files from source commands directory
  let entries: string[];
  try {
    entries = await fs.readdir(sourceDir);
  } catch {
    console.warn('[auto] No commands directory found at', sourceDir);
    return;
  }

  const mdFiles = entries.filter((f) => f.endsWith('.md'));
  if (mdFiles.length === 0) {
    return;
  }

  // Ensure target commands directory exists
  await fs.mkdir(targetDir, { recursive: true });

  let synced = 0;
  for (const file of mdFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetFile = `${PREFIX}${file}`;
    const targetPath = path.join(targetDir, targetFile);

    const sourceContent = await fs.readFile(sourcePath, 'utf-8');

    // Compare with existing target file
    try {
      const existingContent = await fs.readFile(targetPath, 'utf-8');
      if (existingContent.trim() === sourceContent.trim()) {
        continue;
      }
    } catch {
      // File doesn't exist — will be created
    }

    await fs.writeFile(targetPath, sourceContent, 'utf-8');
    synced++;
    console.log(`[auto] Synced command: ${targetFile}`);
  }

  if (synced > 0) {
    console.log(`[auto] Synced ${synced} command(s) to ${targetDir}`);
  }
}
