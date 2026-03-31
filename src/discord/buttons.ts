import { ButtonInteraction } from 'discord.js';
import { MlaudeApiClient } from './api-client';

export async function handleButton(interaction: ButtonInteraction, apiClient: MlaudeApiClient): Promise<void> {
  await interaction.deferReply({ flags: 64 }); // ephemeral

  try {
    switch (interaction.customId) {
      case 'mlaude:pause':
        await apiClient.pauseRun();
        await interaction.editReply('Paused.');
        break;
      case 'mlaude:stop':
        await apiClient.stopRun();
        await interaction.editReply('Stopped.');
        break;
      case 'mlaude:run-again':
        await apiClient.startRun();
        await interaction.editReply('Queue started.');
        break;
      case 'mlaude:auto-pause':
        await apiClient.pauseAuto();
        await interaction.editReply('Auto mode paused.');
        break;
      case 'mlaude:auto-stop':
        await apiClient.stopAuto();
        await interaction.editReply('Auto mode stopped.');
        break;
      default:
        await interaction.editReply('Unknown action.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Failed: ${message}`);
  }

  // Disable buttons on the original message to prevent double-click
  try {
    await interaction.message.edit({ components: [] });
  } catch { /* ignore if can't edit */ }
}
