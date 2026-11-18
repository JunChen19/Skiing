/**
 * 雪线 SNOWLINE — 构建脚本
 * 将 vendor/three.min.js + src/ 全部模块内联成单文件 index.html（零外部依赖、可离线、秒开）。
 * 用法: node build.js
 * 修改 src 后重新构建即可；也可以直接改 index.html 顶部的 window.SKI_CONFIG 块（云端排行榜开关）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcDir = path.join(root, 'src');

// 模块按依赖顺序拼接（同一作用域，无 import/export）
const MODULES = [
  'config.js',
  'utils.js',
  'sky.js',
  'terrain.js',
  'trees.js',
  'particles.js',
  'skier.js',
  'physics.js',
  'postfx.js',
  'audio.js',
  'leaderboard.js',
  'ui.js',
  'main.js',
];

const read = (p) => fs.readFileSync(p, 'utf8');
const banner = (f) => `\n/* ================= ${f} ================= */\n`;

const css = read(path.join(srcDir, 'style.css'));
const three = read(path.join(root, 'vendor', 'three.min.js'));
const game = MODULES.map((f) => banner(f) + read(path.join(srcDir, f))).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0c1424">
<meta name="description" content="雪线 SNOWLINE — 无尽程序化雪山滑降，物理走刃，全球排行榜">
<title>雪线 SNOWLINE · 无尽滑雪</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M8 52 L40 8 L56 8 L24 52 Z' fill='%23ff5a4e'/%3E%3Cpath d='M14 52 L46 8 L50 8 L18 52 Z' fill='%23fff' opacity='.85'/%3E%3C/svg%3E">
<style>
${css}
</style>
</head>
<body>
<div id="app">
  <canvas id="c"></canvas>

  <!-- HUD -->
  <div id="hud" hidden>
    <div class="hud-left">
      <div class="hud-item"><span class="hud-label">速度</span><span class="hud-val"><b id="hud-speed">0</b><i>km/h</i></span></div>
      <div class="hud-item"><span class="hud-label">滑行</span><span class="hud-val"><b id="hud-dist">0</b><i>m</i></span></div>
    </div>
    <div class="hud-right">
      <div class="hud-item"><span class="hud-label">最佳</span><span class="hud-val"><b id="hud-best">—</b></span></div>
    </div>
    <div class="hud-buttons">
      <button id="btn-mute" class="icon-btn" title="静音">♪</button>
      <button id="btn-pause" class="icon-btn" title="暂停">II</button>
    </div>
  </div>

  <!-- 开始界面 -->
  <div id="boot" class="screen">
    <div class="panel boot-panel">
      <div class="logo"><span class="logo-zh">雪线</span><span class="logo-en">SNOWLINE</span></div>
      <div class="tagline">无尽雪坡 · 物理走刃 · 全球排行</div>
      <div class="field">
        <label for="inp-name">你的名字</label>
        <input id="inp-name" type="text" maxlength="16" placeholder="输入用户名，记录到排行榜" autocomplete="off">
      </div>
      <button id="btn-start" class="btn primary big">开始滑行</button>
      <button id="btn-board-boot" class="btn ghost">排行榜</button>
      <div class="hint">桌面：移动鼠标左右走刃 · 手机：按住屏幕左右滑动</div>
    </div>
  </div>

  <!-- 结算界面 -->
  <div id="over" class="screen" hidden>
    <div class="panel over-panel">
      <div class="over-title">撞树了！</div>
      <div class="over-score"><b id="over-score">0</b><i>m</i></div>
      <div class="over-sub" id="over-sub"></div>
      <div id="over-rank" class="over-rank"></div>
      <button id="btn-retry" class="btn primary big">再滑一次</button>
      <button id="btn-board-over" class="btn ghost">排行榜</button>
    </div>
  </div>

  <!-- 排行榜 -->
  <div id="board" class="screen" hidden>
    <div class="panel board-panel">
      <div class="board-head">
        <span class="board-title">排行榜</span>
        <span id="board-mode" class="board-mode"></span>
      </div>
      <div id="board-list" class="board-list"></div>
      <button id="btn-board-back" class="btn ghost">返回</button>
    </div>
  </div>

  <!-- 暂停 -->
  <div id="pause" class="screen" hidden>
    <div class="panel pause-panel">
      <div class="pause-title">已暂停</div>
      <button id="btn-resume" class="btn primary big">继续</button>
      <button id="btn-quit" class="btn ghost">回到首页</button>
    </div>
  </div>

  <div id="toast" hidden></div>
  <div id="loading">正在生成雪山…</div>
</div>
<script>
${three}
</script>
<script>
(function () {
'use strict';
${game}
})();
</script>
</body>
</html>
`;

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`built index.html (${kb} KB, ${MODULES.length} modules inlined)`);
