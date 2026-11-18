/* ================= main.js ================= */
// 装配与主循环：渲染/光照/摄像机/难度/碰撞/流程状态机
'use strict';

(function bootGame() {
  if (typeof document === 'undefined') return;   // 供 node 冒烟测试跳过

  const canvas = document.getElementById('c');
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || 'ontouchstart' in window;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2 && !renderer.capabilities.isWebGL1) throw new Error('no webgl');
  } catch (e) {
    document.getElementById('loading').textContent = '此设备/浏览器不支持 WebGL，无法运行游戏';
    return;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;    // 色调映射在后处理里做

  // ---- 场景 ----
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color('#dcc6a6').convertSRGBToLinear(), 40, 420);
  const camera = new THREE.PerspectiveCamera(CFG.CAM_FOV_BASE, 1, 0.1, 3200);

  // ---- 光照：侧后方暖阳（顺光照亮雪面）+ 天空环境光 ----
  const sunDirRef = new THREE.Vector3(-0.34, 0.52, 0.78).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff1e0').convertSRGBToLinear(), 1.55);
  sun.castShadow = true;
  const SHADOW_RES = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  const SE = 48;
  sun.shadow.camera.left = -SE; sun.shadow.camera.right = SE;
  sun.shadow.camera.top = SE; sun.shadow.camera.bottom = -SE;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00055;
  sun.shadow.normalBias = 1.2;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(
    new THREE.Color('#cfe0f5').convertSRGBToLinear(),
    new THREE.Color('#f0e6d8').convertSRGBToLinear(), 0.85
  );
  scene.add(hemi);

  // ---- 世界 ----
  let seed = (Math.random() * 2147483647) | 0;
  const sky = makeSky(scene, seed);
  const terrain = makeTerrain(scene, seed);
  const treesMod = makeTrees(scene, seed);
  const particles = makeParticles(scene);
  const skier = buildSkier(scene, seed);
  const postfx = makePostFX(renderer, scene, camera);
  const phys = makePhysics(seed);
  const input = makeInput(window);
  const sfx = makeSfx();
  const board = makeLeaderboard();

  const ui = makeUI({
    onStart(name) { sfx.init(); sfx.click(); startRun(); },
    onRetry() { sfx.click(); startRun(); },
    onResume() { sfx.click(); togglePause(false); },
    onQuit() { sfx.click(); toMenu(); },
    onMute() { sfx.setMuted(!sfx.muted); ui.setMuteIcon(sfx.muted); },
    onPause() { if (state === 'RUN') togglePause(true); },
    async onBoard() { return board.top(50); },
    boardModeText() { return board.isCloud ? '☁ 全球共享' : '💾 本机记录（未配置云端）'; },
  });
  ui.bind();
  ui.setMuteIcon(sfx.muted);

  // ---- 质量自适应（可降可升）----
  let quality = 2;   // 2 高 / 1 中 / 0 低
  function applyQuality(q) {
    quality = q;
    if (q === 2) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); sun.castShadow = true; postfx.setEnabled(true); }
    else if (q === 1) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); sun.castShadow = true; postfx.setEnabled(true); }
    else { renderer.setPixelRatio(1); sun.castShadow = false; postfx.setEnabled(false); }
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    onResize();
  }
  applyQuality(2);

  // ---- 状态机 ----
  let state = 'MENU';          // MENU / RUN / CRASH / OVER / PAUSE
  let pausedFrom = 'RUN';
  let timeScale = 1;
  let menuT = 0;
  let fpsEma = 60, qTimer = 0, upStreak = 0, lastUpAt = -1e9;
  let lastPk = -1;
  let runBest = board.localBest();
  let trauma = 0;              // 镜头抖动能量

  function refreshWorld() {
    terrain.ensure(phys.st.z);
    const [kLo, kHi] = terrain.rangeFor(phys.st.z);
    treesMod.syncChunks(kLo, kHi);
    treesMod.rebuildInstances();
    lastPk = Math.max(0, Math.floor(-phys.st.z / CFG.CHUNK_LEN));
  }

  function hardReset(freshSeed) {
    if (freshSeed) seed = (Math.random() * 2147483647) | 0;
    phys.reset(seed);
    skier.reset();
    terrain.reset(seed);
    treesMod.reset(seed);
    lastPk = -1;
    refreshWorld();
    // 近处地形同步构建（约 3 块），远处交给每帧的异步队列
    for (let i = 0; i < 3 && terrain.pending; i++) terrain.update(60);
    particles.resetDrift(phys.st.x, phys.st.y + 10, phys.st.z - 20);
    snapCamera();
  }

  function startRun() {
    hardReset(true);
    timeScale = 1; trauma = 0;
    state = 'RUN';
    treesMod.setVisible(true);
    ui.startRun();
    runBest = board.localBest();
  }

  function toMenu() {
    hardReset(true);
    timeScale = 1; state = 'MENU'; menuT = 0;
    treesMod.setVisible(false);   // 菜单背景走纯净雪坡，无穿模
    ui.showBoot();
  }

  function togglePause(on) {
    if (on && state === 'RUN') { pausedFrom = state; state = 'PAUSE'; ui.showPause(true); }
    else if (!on && state === 'PAUSE') { state = pausedFrom; ui.showPause(false); }
  }

  // ---- 撞树流程 ----
  let crashTimer = 0;
  function doCrash() {
    state = 'CRASH';
    crashTimer = 0;
    phys.crash();
    skier.startCrash({ x: phys.st.vx, y: 0, z: phys.st.vz });
    particles.emitBurst(phys.st.x, phys.st.y, phys.st.z, 1.4);
    sfx.crash();
    trauma = 1;
    timeScale = CFG.SLOWMO;
  }

  async function finishRun() {
    state = 'OVER';
    timeScale = 1;
    const score = Math.floor(phys.st.dist);
    const isBest = board.setLocalBest(score);
    ui.showOver(score, isBest);
    if (isBest) sfx.newBest(); else sfx.over();
    const name = localStorage.getItem(CFG.NAME_KEY) || '无名滑雪者';
    const res = await board.submit(name, score);
    if (res.ok && res.cloud && res.rank) ui.setRank(`全球第 ${res.rank} 名`);
    else if (res.ok && !res.cloud) ui.setRank('已记入本机排行榜');
    else if (!res.ok && res.cloud) ui.setRank('云端暂不可达，成绩已存本机');
  }

  // ---- 碰撞 & 擦树 ----
  function checkTrees() {
    const st = phys.st;
    const list = treesMod.nearTrees(st.z);
    for (const t of list) {
      const dz = t.z - st.z;
      if (dz < -3 || dz > 6) {
        if (!t._nm && dz > 0) t._nm = true;
        continue;
      }
      const dx = t.x - st.x;
      const rr = t.r + 0.42;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { doCrash(); return; }
      if (!t._nm && dz > 2 && Math.abs(dx) < t.r + CFG.NEAR_MISS) {
        t._nm = true;
        sfx.whoosh();
        trauma = Math.min(1, trauma + 0.18);
      }
    }
  }

  // ---- 摄像机 ----
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camFov = CFG.CAM_FOV_BASE;
  function snapCamera() {
    const st = phys.st;
    camPos.set(st.x, st.y + CFG.CAM_UP, st.z + CFG.CAM_BACK);
    camLook.set(st.x, st.y + 1, st.z - 10);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }
  function updateCamera(dt) {
    const st = phys.st;
    let fx = st.vx, fz = st.vz;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const px = st.x, py = st.y, pz = st.z;

    const dx = px - fx * CFG.CAM_BACK;
    const dz = pz - fz * CFG.CAM_BACK;
    let dy = py + CFG.CAM_UP;
    const groundGuard = terrainHeight(dx, dz, seed) + 1.4;
    if (dy < groundGuard) dy = groundGuard;

    camPos.x = U.damp(camPos.x, dx, 8, dt);
    camPos.y = U.damp(camPos.y, dy, 5, dt);
    camPos.z = U.damp(camPos.z, dz, 8, dt);
    camLook.x = U.damp(camLook.x, px + fx * CFG.CAM_AHEAD, 11, dt);
    camLook.y = U.damp(camLook.y, py + 1.15, 9, dt);
    camLook.z = U.damp(camLook.z, pz + fz * CFG.CAM_AHEAD, 11, dt);

    // 抖动（trauma²）
    trauma = Math.max(0, trauma - dt * 1.4);
    const tr = trauma * trauma;
    const tNow = performance.now() * 0.001;
    const shX = Math.sin(tNow * 61.7) * tr * 0.5;
    const shY = Math.cos(tNow * 47.3) * tr * 0.4;

    camera.position.set(camPos.x + shX, camPos.y + shY, camPos.z);
    camera.lookAt(camLook);
    camera.rotateZ(-st.lean * 0.10);

    const fovT = U.clamp(CFG.CAM_FOV_BASE + st.speed * 3.6 * CFG.CAM_FOV_SPEED, CFG.CAM_FOV_BASE, 80);
    camFov = U.damp(camFov, fovT, 3, dt);
    if (Math.abs(camera.fov - camFov) > 0.05) { camera.fov = camFov; camera.updateProjectionMatrix(); }
  }

  // ---- 太阳阴影跟随（贴图元对齐防闪烁）----
  function updateSun() {
    const st = phys.st;
    const texel = (SE * 2) / SHADOW_RES;
    const tx = Math.round(st.x / texel) * texel;
    const tz = Math.round(st.z / texel) * texel;
    const ty = terrainHeight(tx, tz, seed);
    sun.target.position.set(tx, ty, tz);
    sun.position.set(
      tx + sunDirRef.x * 150,
      ty + sunDirRef.y * 150,
      tz + sunDirRef.z * 150
    );
  }

  // ---- 雪雾发射 ----
  function emitSprayAtSkis() {
    const st = phys.st;
    const turn = Math.abs(st.steer) * (0.3 + st.speedN);
    const power = U.clamp(st.slip * 1.0 + turn * 0.85 + st.speedN * 0.15, 0, 1.5);
    if (power < 0.06) return;
    const bx = Math.sin(st.heading), bz = Math.cos(st.heading);   // 后方
    const rx = -Math.cos(st.heading), rz = Math.sin(st.heading);  // 右侧
    const side = -Math.sign(st.latA || 1);                        // 雪往弯外喷
    particles.emitSpray(
      st.x - bx * 0.85, st.y, st.z - bz * 0.85,
      bx, bz, rx * side, rz * side,
      power * 0.75 + 0.2, st.speed
    );
    particles.emitSpray(
      st.x - bx * 0.7 + rx * 0.28, st.y, st.z - bz * 0.7 + rz * 0.28,
      bx, bz, rx * side, rz * side,
      power * 0.5, st.speed
    );
  }

  // ---- 主循环 ----
  const clock = new THREE.Clock();
  let accum = 0;
  const H = 1 / 120;
  const animState = {
    x: 0, y: 0, z: 0, heading: 0, lean: 0, steer: 0, steerRate: 0,
    speed: 0, speedN: 0, tuck: 0, compression: 0, crashed: false,
  };

  function frame() {
    requestAnimationFrame(frame);
    let dt = Math.min(clock.getDelta(), 1 / 30);
    const rawDt = dt;
    fpsEma = fpsEma * 0.95 + (1 / Math.max(rawDt, 1e-4)) * 0.05;

    if (state === 'PAUSE') { postfx.render(0); return; }

    dt *= timeScale;
    terrainTimeUniform.value += dt;

    // 物理子步
    if (state === 'RUN' || state === 'MENU' || state === 'CRASH') {
      if (state === 'RUN') {
        input.update();
        accum += dt;
        let guard = 0;
        while (accum >= H && guard++ < 12) {
          phys.step(H, input.steer);
          accum -= H;
        }
        checkTrees();
      } else if (state === 'MENU') {
        menuT += dt;
        phys.step(dt, Math.sin(menuT * 0.5) * 0.42);
        if (phys.st.dist > 900) hardReset(true);
      } else if (state === 'CRASH') {
        phys.step(dt, 0);
        crashTimer += rawDt;
        if (crashTimer > CFG.CRASH_TIME) finishRun();
      }
    }

    // 世界跟随
    refreshWorldIfNeeded();

    // 人物（复用状态对象，避免每帧分配）
    const st = phys.st;
    animState.x = st.x; animState.y = st.y; animState.z = st.z;
    animState.heading = st.heading; animState.lean = st.lean; animState.steer = st.steer;
    animState.steerRate = st.steerRate; animState.speed = st.speed; animState.speedN = st.speedN;
    animState.tuck = st.tuck; animState.compression = st.compression; animState.crashed = st.crashed;
    skier.update(animState, dt, terrainTimeUniform.value);

    // 粒子 / 天空 / 光照 / 摄像机
    if (!st.crashed) emitSprayAtSkis();
    particles.updateSpray(dt);
    particles.updateDrift(dt, camera.position);
    sfx.update(dt, st);
    sky.update(camera, dt, st.z);
    updateSun();
    updateCamera(dt);

    // HUD
    if (state === 'RUN') {
      ui.hud(st.speed * 3.6, st.dist, Math.max(runBest, st.dist));
    }

    // 自动降质（卡顿立即降）+ 缓慢升质（持续流畅才回升，带冷却防振荡）
    qTimer += rawDt;
    if (qTimer > 2) {
      qTimer = 0;
      if (fpsEma < 45 && quality > 0) { applyQuality(quality - 1); upStreak = 0; }
    }
    if (quality < 2 && fpsEma > 57) {
      upStreak += rawDt;
      const now = performance.now() / 1000;
      if (upStreak > 8 && now - lastUpAt > 30) {
        applyQuality(quality + 1);
        lastUpAt = now; upStreak = 0;
      }
    } else {
      upStreak = 0;
    }

    postfx.render(terrainTimeUniform.value);
  }

  function refreshWorldIfNeeded() {
    const st = phys.st;
    const pk = Math.max(0, Math.floor(-st.z / CFG.CHUNK_LEN));
    if (pk !== lastPk) {
      lastPk = pk;
      terrain.ensure(st.z);
      const [kLo, kHi] = terrain.rangeFor(st.z);
      treesMod.syncChunks(kLo, kHi);
      treesMod.rebuildInstances();
    }
    terrain.update(3.5);   // 地形构建按预算分帧推进，不卡主循环
  }

  // ---- 尺寸 / 可见性 / 杂项 ----
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    postfx.setSize(size.x, size.y);
  }
  window.addEventListener('resize', onResize);
  onResize();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'RUN') togglePause(true);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (state === 'RUN') togglePause(true);
      else if (state === 'PAUSE') togglePause(false);
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---- 启动 ----
  hardReset(true);
  ui.showBoot();
  if (!board.isCloud) {
    setTimeout(() => ui.toast('排行榜当前为本机模式，全球共享配置见 README', 3200), 800);
  }
  // 调试钩子（开发/测试用）
  window.__SKI = {
    get state() { return state; },
    get seed() { return seed; },
    phys, postfx, renderer, scene, camera, particles,
    setQuality: applyQuality,
  };
  frame();
})();
