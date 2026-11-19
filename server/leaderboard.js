'use strict';

const { createServer } = require('node:http');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const { values } = parseArgs({ options: { port: { type: 'string' }, 'data-dir': { type: 'string' } } });
const port = Number(values.port || process.env.SKI_PORT || 8715);
const dataDir = values['data-dir'] || process.env.SKI_DATA_DIR || (process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'SnowlineLeaderboard')
  : path.join(__dirname, 'data'));
const index = path.join(__dirname, '..', 'index.html');
const allowed = new Set([
  'https://junchen19.github.io',
  'http://127.0.0.1:' + port,
  'http://localhost:' + port,
]);
const RULESET = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHARS = /[<>&"'`/\\\x00-\x1f\x7f]/;
const MAX_BODY = 2048;

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'scores.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY,
    ruleset TEXT NOT NULL,
    run_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 16),
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10000000),
    UNIQUE (ruleset, run_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS scores_rank ON scores (ruleset, score DESC, id ASC);
`);
const top = db.prepare('SELECT name, score FROM scores WHERE ruleset = ? ORDER BY score DESC, id ASC LIMIT 50');
const insert = db.prepare('INSERT INTO scores (ruleset, run_id, name, score) VALUES (?, ?, ?, ?) ON CONFLICT (ruleset, run_id) DO NOTHING');
const saved = db.prepare('SELECT id, name, score FROM scores WHERE ruleset = ? AND run_id = ?');
const countAhead = db.prepare('SELECT count(*) AS n FROM scores WHERE ruleset = ? AND score > ?');
const countTied = db.prepare('SELECT count(*) AS n FROM scores WHERE ruleset = ? AND score = ? AND id < ?');

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readScore(req, res) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    json(res, 415, { error: 'Expected application/json' });
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.resume();
      json(res, 413, { error: 'Request too large' });
      return;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {};
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
  }
}

let minute = 0, writes = 0;
async function submit(req, res, ruleset) {
  const body = await readScore(req, res);
  if (res.writableEnded) return;
  const { runId, name, score } = body;
  if (typeof runId !== 'string' || !RUN_ID.test(runId) ||
      typeof name !== 'string' || !name.trim() || [...name].length > 16 || CHARS.test(name) ||
      !Number.isInteger(score) || score < 0 || score > 10000000) {
    return json(res, 400, { error: 'Invalid score or player name' });
  }
  const now = Math.floor(Date.now() / 60000);
  if (now !== minute) { minute = now; writes = 0; }
  if (++writes > 90) return json(res, 429, { error: 'Try again shortly' });

  const result = insert.run(ruleset, runId, name, score);
  const entry = saved.get(ruleset, runId);
  if (entry.name !== name || entry.score !== score) {
    return json(res, 409, { error: 'Run identifier already used' });
  }
  const rank = 1 + countAhead.get(ruleset, score).n + countTied.get(ruleset, score, entry.id).n;
  json(res, result.changes ? 201 : 200, { rank });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = readFileSync(index, 'utf8').replace('<!-- snowline-local-config -->',
      '<script>window.SKI_LOCAL_LEADERBOARD = "/api/scores";</script>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(html);
  }
  if (url.pathname === '/api/health' && req.method === 'GET') {
    db.prepare('SELECT 1').get();
    return json(res, 200, { ok: true, service: 'snowline-leaderboard' });
  }
  if (url.pathname !== '/api/scores') return json(res, 404, { error: 'Not found' });

  const origin = req.headers.origin;
  if (origin && !allowed.has(origin)) return json(res, 403, { error: 'Origin not allowed' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
      'Access-Control-Max-Age': '600' });
    return res.end();
  }
  const ruleset = url.searchParams.get('ruleset') || 'snowline-v1';
  if (!RULESET.test(ruleset)) return json(res, 400, { error: 'Invalid ruleset' });
  if (req.method === 'GET') return json(res, 200, top.all(ruleset));
  if (req.method === 'POST') return submit(req, res, ruleset);
  res.setHeader('Allow', 'GET, POST, OPTIONS');
  json(res, 405, { error: 'Method not allowed' });
}

const server = createServer({ requestTimeout: 10000, headersTimeout: 10000 }, (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  route(req, res).catch((error) => {
    console.error(error.message);
    if (!res.headersSent && !res.destroyed) json(res, 500, { error: 'Leaderboard unavailable' });
  });
});
server.listen(port, '127.0.0.1', () => console.log('Snowline leaderboard at http://127.0.0.1:' + port));
