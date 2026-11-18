/* ================= ui.js ================= */
// DOM UI：开始界面 / HUD / 结算 / 排行榜 / 暂停 / 提示
'use strict';

function makeUI(handlers) {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'), boot: $('boot'), over: $('over'), board: $('board'), pause: $('pause'),
    loading: $('loading'), toast: $('toast'),
    stage: $('hud-stage'), next: $('hud-next'), splits: $('splits'),
    speed: $('hud-speed'), dist: $('hud-dist'), best: $('hud-best'),
    name: $('inp-name'), start: $('btn-start'), boardBoot: $('btn-board-boot'),
    oScore: $('over-score'), oSub: $('over-sub'), oRank: $('over-rank'),
    retry: $('btn-retry'), boardOver: $('btn-board-over'),
    boardList: $('board-list'), boardMode: $('board-mode'), boardBack: $('btn-board-back'),
    resume: $('btn-resume'), quit: $('btn-quit'),
    mute: $('btn-mute'), pauseBtn: $('btn-pause'),
  };

  let boardReturnTo = 'boot';

  function bind() {
    el.start.addEventListener('click', () => {
      const name = sanitizeName(el.name.value) || '无名滑雪者';
      localStorage.setItem(CFG.NAME_KEY, name);
      handlers.onStart(name);
    });
    el.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.start.click(); });
    $('btn-new').addEventListener('click', handlers.onNew);
    el.retry.addEventListener('click', () => handlers.onRetry());
    el.resume.addEventListener('click', () => handlers.onResume());
    el.quit.addEventListener('click', () => handlers.onQuit());
    el.boardBoot.addEventListener('click', () => openBoard('boot'));
    el.boardOver.addEventListener('click', () => openBoard('over'));
    el.boardBack.addEventListener('click', () => {
      el.board.hidden = true;
      if (boardReturnTo === 'over') el.over.hidden = false;
      else el.boot.hidden = false;
    });
    el.mute.addEventListener('click', () => handlers.onMute());
    el.pauseBtn.addEventListener('click', () => handlers.onPause());
  }

  function openBoard(from) {
    boardReturnTo = from;
    el.boot.hidden = true;
    el.over.hidden = true;
    el.board.hidden = false;
    el.boardMode.textContent = handlers.boardModeText();
    el.boardList.innerHTML = '<div class="board-loading">加载中…</div>';
    handlers.onBoard().then((rows) => {
      if (el.board.hidden) return;
      renderBoard(rows);
    });
  }

  function renderBoard(rows) {
    if (!rows.length) {
      el.boardList.innerHTML = '<div class="board-loading">还没有记录，去滑出第一条吧！</div>';
      return;
    }
    const myName = localStorage.getItem(CFG.NAME_KEY) || '';
    el.boardList.innerHTML = rows.map((r, i) => {
      const me = r.name === myName ? ' me' : '';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
      return `<div class="row${me}"><span class="rk">${medal}</span><span class="nm"></span><span class="sc">${Math.floor(r.score)}<i>m</i></span></div>`
        .replace('<span class="nm"></span>', `<span class="nm">${escapeHtml(r.name || '无名')}</span>`);
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    bind,
    showBoot() {
      el.loading.hidden = true;
      el.hud.hidden = true; el.over.hidden = true; el.board.hidden = true; el.pause.hidden = true;
      el.boot.hidden = false;
      const saved = localStorage.getItem(CFG.NAME_KEY);
      if (saved && saved !== '无名滑雪者') el.name.value = saved;
    },
    startRun() {
      el.boot.hidden = true; el.over.hidden = true; el.board.hidden = true;
      el.hud.hidden = false;
    },
    hud(speedKmh, dist, best, stage, next) {
      el.stage.textContent = stage;
      el.next.textContent = next;
      el.speed.textContent = Math.round(speedKmh);
      el.dist.textContent = Math.floor(dist);
      el.best.textContent = best > 0 ? Math.floor(best) + 'm' : '—';
    },
    showOver(score, isBest, splits) {
      el.splits.replaceChildren();
      for (const split of splits.slice(-3)) {
        const row = document.createElement('div');
        const name = document.createElement('span');
        const time = document.createElement('b');
        name.textContent = split.label;
        time.textContent = split.time.toFixed(2) + ' 秒';
        if (split.delta !== null) {
          time.textContent += '（' + (split.delta > 0 ? '+' : '') + split.delta.toFixed(2) + '）';
        }
        row.append(name, time);
        el.splits.append(row);
      }
      el.hud.hidden = true;
      el.oScore.textContent = Math.floor(score);
      el.oSub.textContent = isBest ? '新纪录！' : '再试一次，走刃更顺一点';
      el.oSub.classList.toggle('best', isBest);
      el.oRank.textContent = '';
      el.over.hidden = false;
    },
    setRank(text) { el.oRank.textContent = text; },
    showPause(v) { el.pause.hidden = !v; },
    toast(msg, ms) {
      el.toast.textContent = msg;
      el.toast.hidden = false;
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.toast.hidden = true; }, ms || 2600);
    },
    setMuteIcon(muted) { el.mute.textContent = muted ? '♪̷' : '♪'; el.mute.classList.toggle('off', muted); },
    hideLoading() { el.loading.hidden = true; },
  };
}
