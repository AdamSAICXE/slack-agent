/**
 * agent-core.js
 * Claude-powered agent loop for Slack read operations
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const SlackClient = require('./slack-client');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_ITERATIONS = 10;

let slack = null;

async function initSlack() {
  slack = new SlackClient();
  await slack.initialize();
}

const SYSTEM_PROMPT = `You are a Slack assistant for an Account Manager / Customer Experience professional at a voice AI company. You have read-only access to their Slack workspace.

You help them stay on top of internal communications without having to switch over to Slack. You can read channels, search messages, find conversations about specific topics or people, and summarize what's been discussed.

TOOLS:
- list_channels: See all available channels
- get_channel_messages: Read recent messages from a specific channel
- get_thread_replies: Read replies in a thread
- search_messages: Search across the workspace for a keyword, topic, or person's name
- list_users: See who is in the workspace
- get_user_info: Look up a specific person

RESPONSE STYLE:
- Concise and direct. Lead with the answer.
- When showing messages, include the sender name, timestamp, and message text.
- Group messages by thread or topic when it helps readability.
- If nothing relevant was found, say so clearly.
- Never fabricate message content — only report what the API returns.`;

const TOOLS = [
  {
    name: 'list_channels',
    description: 'List all Slack channels the bot has access to.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_channel_messages',
    description: 'Get recent messages from a Slack channel by name or ID.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (e.g. "general") or ID' },
        limit: { type: 'number', description: 'Number of messages to fetch (default 20, max 100)' }
      },
      required: ['channel']
    }
  },
  {
    name: 'get_thread_replies',
    description: 'Get replies in a specific message thread.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name or ID containing the thread' },
        thread_ts: { type: 'string', description: 'Timestamp of the parent message' }
      },
      required: ['channel', 'thread_ts']
    }
  },
  {
    name: 'search_messages',
    description: 'Search Slack messages across the entire workspace.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — can be a keyword, person name, topic, or phrase' },
        count: { type: 'number', description: 'Number of results (default 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_users',
    description: 'List all members in the Slack workspace.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_user_info',
    description: 'Look up info about a specific Slack user by name.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name or real name of the person' }
      },
      required: ['name']
    }
  }
];

async function resolveChannel(nameOrId) {
  if (nameOrId.startsWith('C')) return nameOrId; // already an ID
  const found = await slack.findChannel(nameOrId);
  if (!found) throw new Error(`Channel not found: ${nameOrId}`);
  return found.id;
}

async function formatMessages(messages) {
  if (!messages || messages.length === 0) return 'No messages found.';

  const userCache = {};
  const lines = [];

  for (const msg of messages) {
    if (msg.subtype) continue; // skip join/leave/etc events
    let sender = msg.username || msg.user;
    if (msg.user && !userCache[msg.user]) {
      try {
        const u = await slack.getUser(msg.user);
        userCache[msg.user] = u.real_name || u.name;
      } catch {
        userCache[msg.user] = msg.user;
      }
    }
    if (msg.user) sender = userCache[msg.user];
    lines.push(`[${slack.formatTs(msg.ts)}] ${sender}: ${msg.text}`);
  }

  return lines.join('\n') || 'No messages found.';
}

async function executeTool(name, input) {
  switch (name) {
    case 'list_channels': {
      const channels = await slack.listChannels();
      return channels.map(c => `#${c.name}${c.is_private ? ' (private)' : ''} — ${c.num_members} members`).join('\n');
    }

    case 'get_channel_messages': {
      const channelId = await resolveChannel(input.channel);
      const messages = await slack.getChannelMessages(channelId, input.limit || 20);
      return await formatMessages(messages);
    }

    case 'get_thread_replies': {
      const channelId = await resolveChannel(input.channel);
      const replies = await slack.getThreadReplies(channelId, input.thread_ts);
      return await formatMessages(replies);
    }

    case 'search_messages': {
      const results = await slack.searchMessages(input.query, input.count || 20);
      if (results.length === 0) return 'No messages found matching that query.';
      return results.map(m =>
        `[${m.channel?.name ? '#' + m.channel.name : 'unknown'}] [${slack.formatTs(m.ts)}] ${m.username || m.user}: ${m.text}`
      ).join('\n');
    }

    case 'list_users': {
      const users = await slack.listUsers();
      return users.map(u => `${u.name}${u.display_name ? ` (@${u.display_name})` : ''}`).join('\n');
    }

    case 'get_user_info': {
      const user = await slack.findUser(input.name);
      if (!user) return `No user found matching "${input.name}"`;
      return `Name: ${user.name}\nDisplay: ${user.display_name || 'N/A'}\nID: ${user.id}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

async function runAgent(question, history = []) {
  const messages = [...history, { role: 'user', content: question }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text')?.text || '';
      return { response: text, history: messages };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await executeTool(block.name, block.input);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
  }

  return { response: 'Reached maximum steps. Please try a simpler request.', history: messages };
}

module.exports = { initSlack, runAgent };
