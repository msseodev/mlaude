import { NextRequest, NextResponse } from 'next/server';
import { getPrompts, getPromptPlanMap, createPrompt } from '@/lib/db';

export async function GET() {
  try {
    const prompts = getPrompts();
    const planMap = getPromptPlanMap();
    const result = prompts.map((p) => ({
      ...p,
      plans: planMap[p.id] || [],
    }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch prompts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, content, working_directory } = body;

    if (!title || !content) {
      return NextResponse.json(
        { error: 'title and content are required' },
        { status: 400 }
      );
    }

    const prompt = createPrompt(title, content, working_directory ?? null);
    return NextResponse.json(prompt, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create prompt' },
      { status: 500 }
    );
  }
}
