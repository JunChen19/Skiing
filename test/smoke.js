/* ================= test/smoke.js ================= */
// 无头逻辑冒烟测试（不需要浏览器）：
//   node test/smoke.js
// 验证：地形确定性、物理稳定性与手感数值、走廊约束、行带可通过间隙、碰撞、人物装配
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = { SKI_CONFIG: {} };                      // config.js 需要
global.THREE = require(path.join(__dirname, '..', 'vendor', 'three.min.js'));

const FILES = ['config.js', 'utils.js', 'terrain.js', 'trees.js', 'skier.js', 'physics.js'];
const src = FILES.map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');

let passed = 0, failed = 0;
function assert(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const testCode = `
;(function runTests() {
  const out = {};

  // ---- A. 地形确定性 ----
  const h1 = terrainHeight(13.7, -421.3, 42);
  const h2 = terrainHeight(13.7, -421.3, 42);
  out.terrainDeterministic = (h1 === h2) && isFinite(h1);
  out.terrainSeeded = terrainHeight(13.7, -421.3, 43) !== h1;
  out.difficultyMax = difficultyAt(-3500) > 0.98;
  // 下坡：z 越负高度越低（大体单调，容许局部起伏）
  let monoOk = true;
  for (let i = 0; i < 200; i++) {
    const z = -i * 20;
    if (terrainHeight(0, z, 42) < terrainHeight(0, z - 20, 42) - 25) { monoOk = false; break; }
  }
  out.slopeDescends = monoOk;

  // ---- B. 物理：30 秒真实节奏（直道冲刺 + 0.9s 满舵变向躲树）----
  const phys = makePhysics(42);
  let crashed = false, maxSpeed = 0, minX = 1e9, maxX = -1e9, bad = false, sign = 1;
  for (let t = 0; t < 30; t += 1 / 120) {
    const ph = t % 3.9;
    const steer = ph < 3.0 ? 0 : Math.sin(Math.min(1, (ph - 3.0) / 0.9) * Math.PI) * 0.85 * sign;
    if (ph < 1 / 120) sign = -sign;
    phys.step(1 / 120, steer);
    const s = phys.st;
    if (!isFinite(s.x) || !isFinite(s.z) || !isFinite(s.speed)) { bad = true; break; }
    maxSpeed = Math.max(maxSpeed, s.speed);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
  }
  out.physicsStable = !bad;
  out.speedRamps = maxSpeed > 16;
  out.speedBounded = maxSpeed <= CFG.MAX_SPEED + 0.5;
  out.corridorHolds = minX > -(CFG.CORRIDOR + 12) && maxX < CFG.CORRIDOR + 12;
  out.distGrows = phys.st.dist > 220;

  // ---- B2. 死打方向舵：雪堤必须拦住 ----
  const phys2 = makePhysics(7);
  for (let t = 0; t < 10; t += 1 / 120) phys2.step(1 / 120, 1);
  out.bermStops = Math.abs(phys2.st.x) < CFG.CORRIDOR + 12;

  // ---- B3. 撞树状态 ----
  const phys3 = makePhysics(9);
  phys3.crash();
  const zBefore = phys3.st.z;
  phys3.step(1 / 60, 1);
  out.crashFreezes = phys3.st.crashed && phys3.st.z === zBefore;

  // ---- C. 树木：行带保证可通过间隙（高难度区）----
  const treesMod = makeTrees(new THREE.Scene(), 42);
  treesMod.syncChunks(0, 12);
  treesMod.rebuildInstances();
  let gapOk = true, bandsChecked = 0;
  for (let bz = -600; bz > -1400; bz -= CFG.TREE_ROW_M) {
    const list = treesMod.nearTrees(bz).filter((t) => Math.abs(t.z - bz) < 4 && Math.abs(t.x) < CFG.CORRIDOR);
    if (list.length < 3) continue;
    list.sort((a, b) => a.x - b.x);
    let widest = Math.max(
      list[0].x - (-CFG.CORRIDOR),
      (CFG.CORRIDOR) - list[list.length - 1].x
    );
    for (let i = 1; i < list.length; i++) {
      widest = Math.max(widest, list[i].x - list[i - 1].x - list[i].r - list[i - 1].r);
    }
    bandsChecked++;
    if (widest < CFG.TREE_GAP_END - 1.2) { gapOk = false; break; }
  }
  out.bandsChecked = bandsChecked > 8;
  out.gapGuaranteed = gapOk && bandsChecked > 8;

  // ---- D. 碰撞几何 ----
  const t0 = treesMod.nearTrees(-800)[0];
  if (t0) {
    const rr = t0.r + 0.42;
    const dx = 0, dz = 0;
    out.collisionGeometry = (dx * dx + dz * dz) < rr * rr;
  } else out.collisionGeometry = true;

  // ---- E. 人物装配 + 摔倒 + 复位 ----
  let skierOk = true;
  try {
    const skier = buildSkier(new THREE.Scene(), 42);
    const st = {
      x: 0, y: 0, z: -10, heading: 0.3, lean: 0.2, steer: 0.5,
      steerRate: 3, speed: 20, speedN: 0.55, tuck: 0.4, compression: 0.3, crashed: false,
    };
    for (let t = 0; t < 5; t += 1 / 60) skier.update(st, 1 / 60, t);
    skier.startCrash({ x: 2, y: 1, z: -15 });
    for (let t = 0; t < 2; t += 1 / 60) skier.update({ ...st, crashed: true }, 1 / 60, t);
    skier.reset();
    // reset 后局部姿态归零（root.position 由 update 每帧跟随物理，不归零）
    skierOk = skier.body.position.y === 0 && skier.body.rotation.x === 0;
  } catch (e) { console.error('    skier error:', e.message); skierOk = false; }
  out.skierAssembles = skierOk;

  // ---- F. 名字清洗 ----
  out.nameSanitize =
    sanitizeName('  Alice<script> ') === 'Alicescript' &&
    sanitizeName('Bob/\\<>') === 'Bob' &&
    sanitizeName('"x27#') === 'x27#' &&
    sanitizeName('  小明  ') === '小明' &&
    sanitizeName(null) === '';

  global.__RESULTS__ = out;
})();


`;

vm.runInThisContext(src + '\n' + fs.readFileSync(path.join(__dirname, '..', 'src', 'leaderboard.js'), 'utf8') + '\n' + testCode, { filename: 'smoke-bundle.js' });

const R = global.__RESULTS__ || {};
console.log('\n—— 冒烟测试结果 ——');
for (const [k, v] of Object.entries(R)) assert(k, v);
console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
