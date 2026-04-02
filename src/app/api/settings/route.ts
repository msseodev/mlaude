import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db';
import fs from 'fs';
import os from 'os';
import path from 'path';

export async function GET() {
  try {
    const settings = getAllSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { working_directory, claude_binary, global_prompt } = body;

    // Validate working_directory if provided and non-empty
    if (working_directory !== undefined && working_directory !== '') {
      const resolvedDir = working_directory.startsWith('~')
        ? path.join(os.homedir(), working_directory.slice(1))
        : working_directory;
      if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
        return NextResponse.json(
          { error: `Working directory does not exist: ${working_directory}` },
          { status: 400 }
        );
      }
    }

    // Validate claude_binary if provided and not the default
    if (claude_binary !== undefined && claude_binary !== '' && claude_binary !== 'claude') {
      if (path.isAbsolute(claude_binary)) {
        if (!fs.existsSync(claude_binary)) {
          return NextResponse.json(
            { error: `Claude binary not found: ${claude_binary}` },
            { status: 400 }
          );
        }
      }
      // If not absolute, it's a command name (like 'claude') - that's OK, will be resolved at runtime
    }

    if (working_directory !== undefined) {
      setSetting('working_directory', working_directory);
    }
    if (claude_binary !== undefined) {
      setSetting('claude_binary', claude_binary);
    }
    if (global_prompt !== undefined) {
      setSetting('global_prompt', global_prompt);
    }
    if (body.claude_session_key !== undefined) {
      setSetting('claude_session_key', body.claude_session_key);
    }
    if (body.claude_org_id !== undefined) {
      setSetting('claude_org_id', body.claude_org_id);
    }

    const settings = getAllSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
