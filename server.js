/**
 * server.js
 * REST API for the Slack agent — deploy on Railway
 */

require('dotenv').config();
const express = require('express');
const { initSlack, runAgent } = require('./agent-core');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.REST_AUTH_TOKEN;

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.body?.token || req.query?.token;
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
