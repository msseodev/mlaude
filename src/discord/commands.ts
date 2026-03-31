import {
  Client,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { MlaudeApiClient } from './api-client';
import { DiscordBotConfig } from './config';

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show current run status'),
  new SlashCommandBuilder()
    .setName('prompts')
    .setDescription('List all prompts'),
  new SlashCommandBuilder()
    .setName('prompt-add')
    .setDescription('Create a new prompt')
    .addStringOption((o) =>
      o.setName('title').setDescription('Prompt title').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('content').setDescription('Prompt content').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('run')
    .setDescription('Start manual queue execution'),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause current execution'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume paused execution'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop current execution'),
  new SlashCommandBuilder()
    .setName('auto-start')
    .setDescription('Start autonomous mode')
    .addStringOption((o) =>
      o
        .setName('prompt')
        .setDescription('Initial prompt (optional)')
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('auto-stop')
    .setDescription('Stop autonomous mode'),
  new SlashCommandBuilder()
    .setName('auto-status')
    .setDescription('Show autonomous mode status'),
  new SlashCommandBuilder()
    .setName('chat-new')
    .setDescription('Start a new chat session'),
  new SlashCommandBuilder()
    .setName('chat-sessions')
    .setDescription('List recent chat sessions'),
];

export async function registerCommands(
  client: Client,
  config: DiscordBotConfig,
) {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  const clientId = client.user!.id;

  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(clientId, config.discordGuildId),
      { body: commands.map((c) => c.toJSON()) },
    );
  } else {
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((c) => c.toJSON()),
    });
  }
  console.log('Slash commands registered.');
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: MlaudeApiClient,
) {
  await interaction.deferReply();

  try {
    switch (interaction.commandName) {
      case 'status': {
        const [runStatus, autoStatus] = await Promise.allSettled([
          apiClient.getRunStatus(),
          apiClient.getAutoStatus(),
        ]);

        const embed = new EmbedBuilder()
          .setTitle('mlaude Status')
          .setColor(0x6366f1)
          .setTimestamp();

        if (runStatus.status === 'fulfilled') {
          const s = runStatus.value;
          embed.addFields({
            name: 'Manual Mode',
            value: `Status: **${s.status}**\nProgress: ${s.completedCount ?? 0}/${s.totalCount ?? 0}${s.currentPromptTitle ? `\nCurrent: ${s.currentPromptTitle}` : ''}`,
          });
        } else {
          embed.addFields({ name: 'Manual Mode', value: 'Not available' });
        }

        if (autoStatus.status === 'fulfilled') {
          const s = autoStatus.value;
          embed.addFields({
            name: 'Auto Mode',
            value: `Status: **${s.status}**${s.currentCycle ? `\nCycle: #${s.currentCycle}` : ''}${s.currentPhase ? `\nPhase: ${s.currentPhase}` : ''}`,
          });
        } else {
          embed.addFields({ name: 'Auto Mode', value: 'Not available' });
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'prompts': {
        const prompts = await apiClient.getPrompts();
        const embed = new EmbedBuilder()
          .setTitle('Prompts')
          .setColor(0x6366f1)
          .setTimestamp();

        if (prompts.length === 0) {
          embed.setDescription('No prompts.');
        } else {
          const list = prompts.slice(0, 10);
          const statusEmoji: Record<string, string> = {
            pending: '\u23F3',
            running: '\uD83D\uDD04',
            completed: '\u2705',
            failed: '\u274C',
            skipped: '\u23ED\uFE0F',
          };
          for (const p of list) {
            embed.addFields({
              name: `${statusEmoji[p.status] || '\u2022'} ${p.title}`,
              value:
                p.content.slice(0, 100) + (p.content.length > 100 ? '...' : ''),
            });
          }
          if (prompts.length > 10) {
            embed.setFooter({ text: `and ${prompts.length - 10} more...` });
          }
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'prompt-add': {
        const title = interaction.options.getString('title', true);
        const content = interaction.options.getString('content', true);
        const prompt = await apiClient.createPrompt(title, content);
        await interaction.editReply(`Prompt created: **${prompt.title}**`);
        break;
      }

      case 'run': {
        const status = await apiClient.startRun();
        await interaction.editReply(
          `Queue started. Status: **${status.status}**`,
        );
        break;
      }

      case 'pause': {
        try {
          await apiClient.pauseRun();
          await interaction.editReply('Manual queue paused.');
        } catch {
          try {
            await apiClient.pauseAuto();
            await interaction.editReply('Auto mode paused.');
          } catch (e) {
            throw e;
          }
        }
        break;
      }

      case 'resume': {
        try {
          await apiClient.resumeRun();
          await interaction.editReply('Manual queue resumed.');
        } catch {
          try {
            await apiClient.resumeAuto();
            await interaction.editReply('Auto mode resumed.');
          } catch (e) {
            throw e;
          }
        }
        break;
      }

      case 'stop': {
        try {
          await apiClient.stopRun();
          await interaction.editReply('Manual queue stopped.');
        } catch {
          try {
            await apiClient.stopAuto();
            await interaction.editReply('Auto mode stopped.');
          } catch (e) {
            throw e;
          }
        }
        break;
      }

      case 'auto-start': {
        const prompt = interaction.options.getString('prompt') || undefined;
        const status = await apiClient.startAuto(prompt);
        await interaction.editReply(
          `Auto mode started. Status: **${status.status}**`,
        );
        break;
      }

      case 'auto-stop': {
        await apiClient.stopAuto();
        await interaction.editReply('Auto mode stopped.');
        break;
      }

      case 'auto-status': {
        const status = await apiClient.getAutoStatus();
        const embed = new EmbedBuilder()
          .setTitle('Auto Mode Status')
          .setColor(status.status === 'running' ? 0x3b82f6 : 0x6b7280)
          .addFields(
            {
              name: 'Status',
              value: status.status || 'idle',
              inline: true,
            },
            {
              name: 'Cycle',
              value: String(status.currentCycle ?? '-'),
              inline: true,
            },
            {
              name: 'Phase',
              value: status.currentPhase || '-',
              inline: true,
            },
          )
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'chat-new': {
        const session = await apiClient.createChatSession();
        await interaction.editReply(`New chat session created: \`${session.id.slice(0, 8)}\``);
        break;
      }

      case 'chat-sessions': {
        const sessions = await apiClient.getChatSessions();
        if (sessions.length === 0) {
          await interaction.editReply('No chat sessions.');
          break;
        }
        const list = sessions.slice(0, 10).map((s: { title: string; message_count: number; updated_at: string }, i: number) =>
          `${i + 1}. **${s.title}** — ${s.message_count} msgs — ${new Date(s.updated_at).toLocaleDateString()}`,
        ).join('\n');
        await interaction.editReply(`**Chat Sessions:**\n${list}`);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Error: ${message}`);
  }
}
