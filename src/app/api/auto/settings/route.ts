import { NextRequest, NextResponse } from 'next/server';
import { getAllAutoSettings, setAutoSetting, initAutoTables } from '@/lib/autonomous/db';

// GET /api/auto/settings
export async function GET() {
  try {
    initAutoTables();
    const settings = getAllAutoSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT /api/auto/settings
export async function PUT(request: NextRequest) {
  try {
    initAutoTables();
    const body = await request.json();

    // Save each setting
    const settingKeys = [
      'target_project', 'test_command', 'max_cycles',
      'auto_commit', 'branch_name',
      'max_retries', 'max_consecutive_failures',
      // v2 settings
      'review_max_iterations', 'skip_designer_for_fixes', 'require_initial_prompt',
      // v3 settings: generic evaluation commands
      'build_command', 'lint_command',
      // v5 settings: screen capture
      'screenshot_dir',
      // v7 settings: global prompt
      'global_prompt',
      // v8 settings: parallel finding processing
      'parallel_mode', 'max_parallel_pipelines',
    ];

    for (const key of settingKeys) {
      if (body[key] !== undefined) {
        setAutoSetting(key, String(body[key]));
      }
    }

    const settings = getAllAutoSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
