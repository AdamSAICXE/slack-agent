/**
 * server.js
 * REST API for the Slack agent — deploy on Railway
 */

require('dotenv').config();
const express = require('express');
const { initSlack, runAgent, getSlack } = require('./agent-core');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.REST_AUTH_TOKEN;

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!AUTH_TOKEN || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'slack-agent', timestamp: new Date().toISOString() });
});

app.post('/query', requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const { response } = await runAgent(question, []);
    res.json({ response });
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Direct send endpoint — bypasses the LLM agent loop for automated callers
// Supports optional thread_ts for thread replies and pin for pinning the message
app.post('/send', requireAuth, async (req, res) => {
  const { channel, text, thread_ts, pin } = req.body;
  if (!channel || !text) return res.status(400).json({ error: 'channel and text are required' });

  try {
    const slack = getSlack();
    let channelId = channel;
    if (!channel.startsWith('C')) {
      const found = await slack.findChannel(channel);
      if (!found) return res.status(404).json({ error: `Channel not found: ${channel}` });
      channelId = found.id;
    }
    const result = await slack.sendMessage(channelId, text, thread_ts || null);
    if (pin) {
      try { await slack.pinMessage(channelId, result.ts); } catch (e) { console.warn('[PIN]', e.message); }
    }
    res.json({ status: 'sent', channel: result.channel, ts: result.ts });
  } catch (err) {
    console.error('[SEND ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function main() {
  console.log('[SLACK AGENT] Starting...');
  await initSlack();
  app.listen(PORT, () => {
    console.log(`[SLACK AGENT] REST API running on port ${PORT}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
