/* ================= leaderboard.js ================= */
// 排行榜双模式：配置了 Supabase = 全球共享；否则 localStorage 本机榜
'use strict';

function sanitizeName(raw) {
  return String(raw || '')
    .replace(/[<>&"'`\\/\x00-\x1f]/g, '')
    .trim()
    .slice(0, 16);
}

function makeLeaderboard() {
  const cfg = (typeof window !== 'undefined' && window.SKI_CONFIG) || {};
  const URL_BASE = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = cfg.SUPABASE_ANON_KEY || '';
  const isCloud = !!(URL_BASE && KEY);
  const HEADERS = {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json',
  };

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
      const r = await fetch(
        `${URL_BASE}/rest/v1/scores?select=name,score&order=score.desc&limit=50`,
        { headers: HEADERS, signal: ctrl.signal }
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json();
      cache = { t: Date.now(), data: rows };
      return rows.slice(0, n);
    } finally { clearTimeout(timer); }
  }

  return {
    mode: isCloud ? 'cloud' : 'local',
    isCloud,

    async top(n) {
      n = n || 20;
      if (isCloud) {
        try { return await cloudTop(n); }
        catch (e) {
          return [{ name: '(云端暂不可达)', score: 0, offline: true }];
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
          const r = await fetch(`${URL_BASE}/rest/v1/scores`, {
            method: 'POST',
            headers: Object.assign({}, HEADERS, { 'Prefer': 'return=minimal' }),
            body: JSON.stringify({ name, score: Math.floor(score) }),
            signal: ctrl.signal,
          });
          if (!r.ok && r.status !== 201) throw new Error('HTTP ' + r.status);
          cache = { t: 0, data: null }; // 立刻刷新缓存
          const top50 = await cloudTop(50);
          const idx = top50.findIndex((row) => row.name === name && row.score === Math.floor(score));
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
