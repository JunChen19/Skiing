'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = readFileSync(join(__dirname, '../src/leaderboard.js'), 'utf8');
const base = 'https://test-project.supabase.co';
function client(config, fetch) {
  const storage = new Map();
  return vm.runInNewContext(source + '\nmakeLeaderboard()', {
    window: { SKI_CONFIG: { SUPABASE_URL: base, ...config } },
    CFG: { BOARD_KEY: 'board' },
    localStorage: { getItem: key => storage.get(key), setItem: (k, v) => storage.set(k, v) },
    fetch, AbortController, setTimeout, clearTimeout, crypto: { randomUUID },
  });
}

for (const config of [
  { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' },
  { SUPABASE_ANON_KEY: 'eyJ.example.jwt' },
]) {
  const legacy = !!config.SUPABASE_ANON_KEY;
  test('Supabase submit and reload using ' + (legacy ? 'legacy anon' : 'publishable') + ' key', async () => {
    const rows = [{ id: randomUUID(), name: '滑雪者', score: 120 }];
    const request = async (url, options) => {
      const address = new URL(url);
      assert.equal(address.origin + address.pathname, base + '/rest/v1/scores');
      const key = Object.values(config)[0];
      assert.equal(options.headers.apikey, key);
      assert.equal(options.headers.Authorization, legacy ? 'Bearer ' + key : undefined);
      if (options.method === 'POST') {
        const data = JSON.parse(options.body);
        assert.equal(data.score, 120);
        assert.equal(data.name, '滑雪者');
        rows.push(data);
        return new Response(null, { status: 201 });
      }
      assert.equal(address.searchParams.get('order'), 'score.desc,created_at.asc,id.asc');
      assert.equal(address.searchParams.get('limit'), '50');
      assert.equal(address.searchParams.get('select'), 'id,name,score');
      return Response.json(rows);
    };
    const board = client(config, request);
    assert.equal((await board.top(50)).length, 1);
    assert.equal((await board.submit('滑雪者', 120.8)).rank, 2);
    assert.equal((await client(config, request).top(50)).length, 2);
  });
}

test('a successful insert remains confirmed if the rank lookup fails', async () => {
  const board = client({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' },
    async (_, options) => new Response(null, { status: options.method === 'POST' ? 201 : 503 }));
  const result = await board.submit('滑雪者', 80);
  assert.equal(result.ok, true);
  assert.equal(result.rank, null);
  const offline = await board.top(50);
  assert.equal(offline[0].offline, true);
  assert.equal(offline.length, 1);
});

test('a failed submit retains the score for the offline board', async () => {
  const board = client({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' },
    async () => new Response(null, { status: 503 }));
  assert.equal((await board.submit('滑雪者', 80)).ok, false);
  const offline = await board.top(50);
  assert.equal(offline[0].offline, true);
  assert.equal(offline[1].score, 80);
});
