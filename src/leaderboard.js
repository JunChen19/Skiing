/* ================= leaderboard.js ================= */
// 排行榜支持自建服务、Supabase 和浏览器本机记录。
'use strict';

function sanitizeName(raw) {
  return String(raw || '')
    .replace(/[<>&"'`\\/\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 16);
}

function makeLeaderboard() {
  const browser = typeof window !== 'undefined' ? window : {};
  const cfg = browser.SKI_CONFIG || {};
  const selfHosted = browser.SKI_LOCAL_LEADERBOARD || cfg.LEADERBOARD_URL;
  const endpoint = selfHosted ? new URL(selfHosted, browser.location.href) : null;
  const apiHeaders = { Accept: 'application/json' };
  if (endpoint) {
    endpoint.searchParams.set('ruleset', cfg.LEADERBOARD_RULESET || 'snowline-v1');
    if (/\.(ngrok-free\.(app|dev)|ngrok\.io)$/.test(endpoint.hostname)) {
      apiHeaders['ngrok-skip-browser-warning'] = '1';
    }
  }
  const URL_BASE = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY || '';
  const isCloud = !!(endpoint || (URL_BASE && KEY));
  const HEADERS = {
    'apikey': KEY,
    'Content-Type': 'application/json',
  };
  // Legacy anon keys are JWTs. Publishable keys belong only in apikey.
  if (KEY.startsWith('eyJ')) HEADERS.Authorization = 'Bearer ' + KEY;

  // ---- 本地模式 ----
  function localBoard() {
    try { return JSON.parse(localStorage.getItem(CFG.BOARD_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function localSave(list) {
    try { localStorage.setItem(CFG.BOARD_KEY, JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }

  // ---- 云端模式 ----
  let cache = { t: 0, data: null };
  async function cloudTop(n) {
    if (cache.data && Date.now() - cache.t < 30000) return cache.data.slice(0, n);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const url = endpoint || `${URL_BASE}/rest/v1/scores?select=id,name,score&order=score.desc,created_at.asc,id.asc&limit=50`;
      const r = await fetch(url, { headers: endpoint ? apiHeaders : HEADERS, signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json();
      cache = { t: Date.now(), data: rows };
      return rows.slice(0, n);
    } finally { clearTimeout(timer); }
  }

  return {
    mode: endpoint ? 'self-hosted' : isCloud ? 'cloud' : 'local',
    isCloud,

    async top(n) {
      n = n || 20;
      if (isCloud) {
        try { return await cloudTop(n); }
        catch (e) {
          return [{ offline: true }, ...localBoard().slice(0, n)];
        }
      }
      return localBoard().slice(0, n);
    },

    async submit(name, score) {
      name = sanitizeName(name) || '无名滑雪者';
      if (isCloud) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const id = crypto.randomUUID();
          const r = await fetch(endpoint || `${URL_BASE}/rest/v1/scores`, {
            method: 'POST',
            headers: endpoint ? { ...apiHeaders, 'Content-Type': 'application/json' }
              : { ...HEADERS, 'Prefer': 'return=minimal' },
            body: JSON.stringify(endpoint
              ? { name, score: Math.floor(score), runId: id }
              : { id, name, score: Math.floor(score) }),
            signal: ctrl.signal,
          });
          if (!r.ok && r.status !== 201) throw new Error('HTTP ' + r.status);
          cache = { t: 0, data: null }; // 立刻刷新缓存
          if (endpoint) {
            const { rank } = await r.json();
            return { ok: true, cloud: true, rank };
          }
          // The insert has succeeded even if the follow-up rank lookup is offline.
          const top50 = await cloudTop(50).catch(() => []);
          const idx = top50.findIndex((row) => row.id === id);
          return { ok: true, cloud: true, rank: idx >= 0 ? idx + 1 : null };
        } catch (e) {
          // 云端失败 → 本地兜底
          const list = localBoard();
          list.push({ name, score: Math.floor(score), ts: Date.now() });
          list.sort((a, b) => b.score - a.score);
          localSave(list);
          return { ok: false, cloud: true, error: e.message };
        } finally { clearTimeout(timer); }
      }
      const list = localBoard();
      list.push({ name, score: Math.floor(score), ts: Date.now() });
      list.sort((a, b) => b.score - a.score);
      localSave(list);
      const rank = list.findIndex((row) => row.score === Math.floor(score) && row.ts);
      return { ok: true, cloud: false, rank: rank >= 0 ? rank + 1 : null };
    },

    localBest() {
      const b = parseInt(localStorage.getItem(CFG.BEST_KEY) || '0', 10) || 0;
      const lb = localBoard()[0];
      return Math.max(b, lb ? lb.score : 0);
    },
    setLocalBest(score) {
      const b = this.localBest();
      if (score > b) { try { localStorage.setItem(CFG.BEST_KEY, String(Math.floor(score))); } catch (e) {} return true; }
      return false;
    },
  };
}
