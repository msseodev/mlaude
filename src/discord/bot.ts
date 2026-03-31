import { Client, GatewayIntentBits, Message } from 'discord.js';
import { loadConfig } from './config';
import { MlaudeApiClient } from './api-client';
import { registerCommands, handleCommand } from './commands';
import { handleButton } from './buttons';
import { startSSEListeners, stopSSEListeners, ceoRequestThreadMap } from './notifications';
import { setupChatHandler, stopChatHandler } from './chat-handler';

function parseCEOStatus(text: string): { status: string; response: string } {
  const firstLine = text.trimStart().split('\n')[0].trim().toLowerCase();

  if (firstLine === '승인' || firstLine === 'approve' || firstLine === 'approved') {
    return { status: 'approved', response: text };
  }
  if (firstLine === '거절' || firstLine === 'reject' || firstLine === 'rejected') {
    return { status: 'rejected', response: text };
  }
  return { status: 'answered', response: text };
}

function setupCEOReplyHandler(client: Client, config: ReturnType<typeof loadConfig>, apiClient: MlaudeApiClient) {
  client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== config.discordOwnerId) return;
    if (!message.channel.isThread()) return;

    const requestId = ceoRequestThreadMap.get(message.channel.id);
    if (!requestId) return;

    const { status, response } = parseCEOStatus(message.content);

    try {
      await apiClient.respondToCEORequest(requestId, status, response);
      ceoRequestThreadMap.delete(message.channel.id);
      await message.reply(`CEO 응답이 반영되었습니다. (${status})`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ceo-reply] Error:', errMsg);
      await message.reply(`CEO 응답 처리 중 오류가 발생했습니다: ${errMsg}`);
    }
  });
}

async function main() {
  const config = loadConfig();
  const apiClient = new MlaudeApiClient(config.mlaudeBaseUrl, config.mlaudeApiKey);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', async () => {
    console.log(`Discord bot logged in as ${client.user!.tag}`);
    await registerCommands(client, config);
    startSSEListeners(client, config);
    setupChatHandler(client, config, apiClient);
    setupCEOReplyHandler(client, config, apiClient);
  });

  client.on('interactionCreate', async (interaction) => {
    // Owner check: only the configured owner can use the bot
    if (interaction.user.id !== config.discordOwnerId) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'Unauthorized.', flags: 64 }); // ephemeral
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction, apiClient);
    } else if (interaction.isButton()) {
      await handleButton(interaction, apiClient);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down Discord bot...');
    stopSSEListeners();
    stopChatHandler();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.login(config.discordBotToken);
}

main().catch((err) => {
  console.error('Bot failed to start:', err);
  process.exit(1);
});
