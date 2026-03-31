import { Client, Message, ThreadChannel } from 'discord.js';
import { DiscordBotConfig } from './config';
import { MlaudeApiClient } from './api-client';

// Map Discord thread ID -> mlaude chat session ID
const threadSessionMap = new Map<string, string>();

// Track active SSE connections per thread
const activeStreams = new Map<string, AbortController>();

export function setupChatHandler(client: Client, config: DiscordBotConfig, apiClient: MlaudeApiClient) {
  if (!config.discordChatChannelId) {
    console.log('DISCORD_CHAT_CHANNEL_ID not set, chat handler disabled');
    return;
  }

  client.on('messageCreate', async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Owner check
    if (message.author.id !== config.discordOwnerId) return;

    // Check if message is in chat channel or a thread of chat channel
    const isInChatChannel = message.channelId === config.discordChatChannelId;
    const isInChatThread = message.channel.isThread() &&
      message.channel.parentId === config.discordChatChannelId;

    if (!isInChatChannel && !isInChatThread) return;

    try {
      if (isInChatChannel) {
        // New conversation - create thread
        await handleNewConversation(message, apiClient);
      } else if (isInChatThread) {
        // Continue conversation in thread
        await handleThreadMessage(message, message.channel as ThreadChannel, apiClient);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[chat-handler] Error:', errMsg);
      try {
        await message.reply(`Error: ${errMsg}`);
      } catch {
        // Ignore reply error
      }
    }
  });

  console.log(`Chat handler enabled for channel ${config.discordChatChannelId}`);
}

async function handleNewConversation(message: Message, apiClient: MlaudeApiClient) {
  // Create a thread from the message
  const thread = await message.startThread({
    name: message.content.slice(0, 50) + (message.content.length > 50 ? '...' : ''),
    autoArchiveDuration: 1440, // 24 hours
  });

  // Create a chat session
  const session = await apiClient.createChatSession();
  const sessionId = session.id;
  threadSessionMap.set(thread.id, sessionId);

  // Switch to this session so SSE works
  await apiClient.switchChatSession(sessionId);

  // Send the message
  await apiClient.sendChatMessage(message.content, sessionId);

  // Listen for response via SSE (filtered by sessionId)
  await streamResponseToThread(thread, sessionId, apiClient);
}

async function handleThreadMessage(
  message: Message,
  thread: ThreadChannel,
  apiClient: MlaudeApiClient,
) {
  let sessionId = threadSessionMap.get(thread.id);

  // If we don't have a session for this thread, create one
  if (!sessionId) {
    const session = await apiClient.createChatSession();
    sessionId = session.id;
    threadSessionMap.set(thread.id, sessionId);
  }

  // Switch to this session
  await apiClient.switchChatSession(sessionId);

  // Send the message
  await apiClient.sendChatMessage(message.content, sessionId);

  // Listen for response via SSE (filtered by sessionId)
  await streamResponseToThread(thread, sessionId, apiClient);
}

async function streamResponseToThread(
  thread: ThreadChannel,
  targetSessionId: string,
  apiClient: MlaudeApiClient,
) {
  // Cancel any existing stream for this thread
  const existingController = activeStreams.get(thread.id);
  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  activeStreams.set(thread.id, controller);

  let accumulatedText = '';
  let currentMessage: Message | null = null;
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL = 1000; // Update message every 1s to avoid rate limits

  try {
    const baseUrl = apiClient.getBaseUrl();
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
    };
    const apiKey = apiClient.getApiKey();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/api/chat/stream`, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          // Filter events by sessionId to prevent cross-session interference
          const eventSessionId = event.data?.sessionId;
          if (eventSessionId && eventSessionId !== targetSessionId) {
            break; // Skip events from other sessions
          }

          switch (event.type) {
            case 'text_delta': {
              const text = event.data?.text;
              if (text) {
                accumulatedText += text;

                const now = Date.now();
                if (now - lastUpdateTime >= UPDATE_INTERVAL) {
                  lastUpdateTime = now;
                  const displayText = truncateForDiscord(accumulatedText + ' ...');
                  if (currentMessage) {
                    await currentMessage.edit(displayText);
                  } else {
                    currentMessage = await thread.send(displayText);
                  }
                }
              }
              break;
            }

            case 'message_complete': {
              const content = event.data?.content || accumulatedText;
              const costUsd = event.data?.cost_usd;
              const durationMs = event.data?.duration_ms;

              let footer = '';
              if (costUsd || durationMs) {
                const parts: string[] = [];
                if (costUsd) parts.push(`$${Number(costUsd).toFixed(4)}`);
                if (durationMs) parts.push(`${(Number(durationMs) / 1000).toFixed(1)}s`);
                footer = `\n-# ${parts.join(' | ')}`;
              }

              const finalText = truncateForDiscord(content + footer);
              if (currentMessage) {
                await currentMessage.edit(finalText);
              } else {
                await thread.send(finalText);
              }

              // Cleanup
              activeStreams.delete(thread.id);
              return;
            }

            case 'message_failed': {
              const error = event.data?.error || 'Unknown error';
              const errorText = `**Error:** ${truncateForDiscord(String(error), 1900)}`;
              if (currentMessage) {
                await currentMessage.edit(errorText);
              } else {
                await thread.send(errorText);
              }

              activeStreams.delete(thread.id);
              return;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return; // Intentional abort
    }
    console.error('[chat-handler] Stream error:', error);
    try {
      await thread.send('Stream connection lost. Please try again.');
    } catch {
      // Ignore
    }
  } finally {
    activeStreams.delete(thread.id);
  }
}

function truncateForDiscord(text: string, maxLength = 2000): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 4) + ' ...';
}

// Cleanup function
export function stopChatHandler() {
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
  threadSessionMap.clear();
}
