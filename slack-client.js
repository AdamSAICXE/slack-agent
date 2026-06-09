/**
 * slack-client.js
 * Handles all Slack API communication
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'https://slack.com/api';

class SlackClient {
  constructor() {
    this.token = process.env.SLACK_BOT_TOKEN;
    if (!this.token) throw new Error('SLACK_BOT_TOKEN not found in .env');

    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async initialize() {
    const { data } = await this.http.get('/auth.test');
    if (!data.ok) throw new Error(`Slack auth failed: ${data.error}`);
    this.botUserId = data.user_id;
    this.workspaceName = data.team;
    console.log(`[SLACK] Connected to ${this.workspaceName} as ${data.user}`);
    return { workspace: this.workspaceName, botUserId: this.botUserId };
  }

  // List all channels the bot has access to
  async listChannels(limit = 100) {
    const { data } = await this.http.get('/conversations.list', {
      params: { limit, types: 'public_channel,private_channel', exclude_archived: true }
    });
    if (!data.ok) throw new Error(`conversations.list failed: ${data.error}`);
    return data.channels.map(c => ({ id: c.id, name: c.name, is_private: c.is_private, num_members: c.num_members }));
  }

  // Get recent messages from a channel
  async getChannelMessages(channelId, limit = 20) {
    const { data } = await this.http.get('/conversations.history', {
      params: { channel: channelId, limit }
    });
    if (!data.ok) throw new Error(`conversations.history failed: ${data.error}`);
    return data.messages;
  }

  // Get replies in a thread
  async getThreadReplies(channelId, threadTs, limit = 20) {
    const { data } = await this.http.get('/conversations.replies', {
      params: { channel: channelId, ts: threadTs, limit }
    });
    if (!data.ok) throw new Error(`conversations.replies failed: ${data.error}`);
    return data.messages;
  }

  // Search messages across the workspace
  async searchMessages(query, count = 20) {
    const { data } = await this.http.get('/search.messages', {
      params: { query, count, sort: 'timestamp', sort_dir: 'desc' }
    });
    if (!data.ok) throw new Error(`search.messages failed: ${data.error}`);
    return data.messages?.matches || [];
  }

  // Get user info by ID
  async getUser(userId) {
    const { data } = await this.http.get('/users.info', {
      params: { user: userId }
    });
    if (!data.ok) throw new Error(`users.info failed: ${data.error}`);
    return data.user;
  }

  // List workspace members
  async listUsers(limit = 200) {
    const { data } = await this.http.get('/users.list', { params: { limit } });
    if (!data.ok) throw new Error(`users.list failed: ${data.error}`);
    return data.members
      .filter(u => !u.is_bot && !u.deleted)
      .map(u => ({ id: u.id, name: u.real_name || u.name, display_name: u.profile?.display_name }));
  }

  // Find a channel by name
  async findChannel(name) {
    const channels = await this.listChannels(200);
    const normalized = name.replace(/^#/, '').toLowerCase();
    return channels.find(c => c.name.toLowerCase() === normalized) || null;
  }

  // Resolve a username to a user ID
  async findUser(nameOrDisplay) {
    const users = await this.listUsers();
    const normalized = nameOrDisplay.toLowerCase();
    return users.find(u =>
      u.name?.toLowerCase().includes(normalized) ||
      u.display_name?.toLowerCase().includes(normalized)
    ) || null;
  }

  // Send a message to a channel (optionally in a thread)
  async sendMessage(channelId, text, threadTs = null) {
    const payload = { channel: channelId, text };
    if (threadTs) payload.thread_ts = threadTs;
    const { data } = await this.http.post('/chat.postMessage', payload);
    if (!data.ok) throw new Error(`chat.postMessage failed: ${data.error}`);
    return { channel: data.channel, ts: data.ts };
  }

  // Pin a message in a channel
  async pinMessage(channelId, ts) {
    const { data } = await this.http.post('/pins.add', { channel: channelId, timestamp: ts });
    if (!data.ok && data.error !== 'already_pinned') throw new Error(`pins.add failed: ${data.error}`);
    return data.ok;
  }

  // Format a Slack timestamp to a readable date/time
  formatTs(ts) {
    return new Date(parseFloat(ts) * 1000).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
  }
}

module.exports = SlackClient;
