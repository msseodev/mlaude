import fs from 'node:fs';
import path from 'node:path';

export interface DiscordBotConfig {
  discordBotToken: string;
  discordChannelId: string;
  discordChatChannelId: string | null; // Channel for chat messages
  discordOwnerId: string;
  discordGuildId: string | null; // optional, for instant command registration
  mlaudeApiKey: string;
  mlaudeBaseUrl: string;
}

export function loadConfig(): DiscordBotConfig {
  // Read .env.local from project root
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  const discordBotToken = process.env.DISCORD_BOT_TOKEN;
  const discordChannelId = process.env.DISCORD_CHANNEL_ID;
  const discordOwnerId = process.env.DISCORD_OWNER_ID;

  if (!discordBotToken || !discordChannelId || !discordOwnerId) {
    throw new Error('Missing required env vars: DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, DISCORD_OWNER_ID');
  }

  return {
    discordBotToken,
    discordChannelId,
    discordChatChannelId: process.env.DISCORD_CHAT_CHANNEL_ID || null,
    discordOwnerId,
    discordGuildId: process.env.DISCORD_GUILD_ID || null,
    mlaudeApiKey: process.env.MLAUDE_API_KEY || '',
    mlaudeBaseUrl: process.env.MLAUDE_BASE_URL || 'http://localhost:51793',
  };
}
