/* ================= main.js ================= */
// 装配与主循环：渲染/光照/摄像机/难度/碰撞/流程状态机
'use strict';

(function bootGame() {
  if (typeof document === 'undefined') return;   // 供 node 冒烟测试跳过

  const canvas = document.getElementById('c');
  const isMobile = navigator.maxTouchPoints > 0 &&
    (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  document.getElementById('app').classList.toggle('desktop-preview', !isMobile);
  document.getElementById('phone-entry').hidden = isMobile;
  const board = makeLeaderboard();
  const boardHandlers = {
    onBoard: () => board.top(50),
    boardModeText() {
      if (board.mode === 'self-hosted') return '共享排行榜';
      return board.isCloud ? '☁ 全球共享' : '💾 本机记录（未配置共享榜）';
    },
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    if (!isMobile) {
      const preview = makeUI(boardHandlers);
      preview.bindBoard();
      preview.showBoot();
      return;
    }
    document.getElementById('loading').textContent = '此设备/浏览器不支持 WebGL，无法运行游戏';
    return;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;    // 色调映射在后处理里做

  // ---- 场景 ----
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color('#c5d7e3').convertSRGBToLinear(), 75, 420);
  const camera = new THREE.PerspectiveCamera(CFG.CAM_FOV_BASE, 1, 0.1, 3200);

  // ---- 光照：侧后方暖阳（顺光照亮雪面）+ 天空环境光 ----
  const sunDirRef = new THREE.Vector3(-0.34, 0.52, 0.78).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff3df').convertSRGBToLinear(), 1.78);
  sun.castShadow = true;
  const SHADOW_RES = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  const SE = 48;
  sun.shadow.camera.left = -SE; sun.shadow.camera.right = SE;
  sun.shadow.camera.top = SE; sun.shadow.camera.bottom = -SE;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00055;
  sun.shadow.normalBias = 0.055;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(
    new THREE.Color('#c5dafa').convertSRGBToLinear(),
    new THREE.Color('#d3dce3').convertSRGBToLinear(), 0.96
  );
  scene.add(hemi);

  // ---- 世界 ----
  let seed = (Math.random() * 2147483647) | 0;
  const sky = makeSky(scene, seed);
  const terrain = makeTerrain(scene, seed);
  const treesMod = makeTrees(scene, seed, sunDirRef);
  const rocks = makeRocks(scene, seed);
  const particles = makeParticles(scene);
  const tracks = makeTracks(scene);
  const skier = buildSkier(scene, seed);
  const postfx = makePostFX(renderer, scene, camera);
  const phys = makePhysics(seed);
  const input = makeInput(canvas);
  const sfx = makeSfx();

  const ui = makeUI({
    onStart(name) { sfx.init(); sfx.click(); startRun(); },
    onRetry() { sfx.click(); startRun(false); },
    onNew() { sfx.click(); startRun(); },
    onResume() { sfx.click(); togglePause(false); },
    onQuit() { sfx.click(); toMenu(); },
    onMute() { sfx.setMuted(!sfx.muted); ui.setMuteIcon(sfx.muted); },
    onPause() { if (state === 'RUN') togglePause(true); },
    ...boardHandlers,
  });
  ui.bind();
  ui.setMuteIcon(sfx.muted);

  // ---- 质量自适应（可降可升）----
  let quality = 2;   // 2 高 / 1 中 / 0 低
  let shadowAge = Infinity;
  function applyQuality(q) {
    quality = q;
    sun.castShadow = q > 0;
    const size = q === 2 ? SHADOW_RES : SHADOW_RES / 2;
    sun.shadow.mapSize.set(size, size);
    postfx.setQuality(q);
    terrain.setQuality(q);
    treesMod.setQuality(q);
    shadowAge = Infinity;
    renderer.shadowMap.needsUpdate = true;
    if (q > 0 && window.__SKI) updateSun();
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    onResize();
  }
  applyQuality(isMobile ? 1 : 2);

  // ---- 状态机 ----
  let state = 'MENU';          // MENU / RUN / CRASH / OVER / PAUSE
  let pausedFrom = 'RUN';
  let timeScale = 1;
  const menuLane = {};
  let frameSeconds = 1 / 60, qTimer = 0, upStreak = 0, lastUpAt = -1e9;
  let lastPk = -1;
  let runBest = board.localBest(), hudAt = 0;
  let trauma = 0;              // 镜头抖动能量

  const stages = [
    { name: '开阔坡', end: 42 }, { name: '连续弯', end: 222 }, { name: '林间分线', end: COURSE_LENGTH },
  ];
  const splits = [], routeBests = [];
  let stageIndex = 0, sector = 0, elapsed = 0, stageStart = 0, runId = 0;
  let overRock = false, clearNoticeUntil = 0;
  function stageEnd() { return sectorDistance(sector, stages[stageIndex].end); }
  function timeStep(dt, oldDistance) {
    elapsed += dt;
    const end = stageEnd(), distance = phys.st.dist;
    if (distance < end) return;
    const crossing = elapsed - dt * (distance - end) / Math.max(0.001, distance - oldDistance);
    const time = crossing - stageStart;
    const index = sector * stages.length + stageIndex;
    const best = routeBests[index];
    splits.push({ label: end + ' m · ' + stages[stageIndex].name, time, delta: best == null ? null : time - best });
    routeBests[index] = best == null ? time : Math.min(best, time);
    stageStart = crossing;
    if (++stageIndex === stages.length) { stageIndex = 0; sector++; }
  }

  function refreshWorld() {
    terrain.ensure(phys.st.z);
    const [kLo, kHi] = terrain.rangeFor(phys.st.z);
    treesMod.syncChunks(kLo, kHi);
    treesMod.rebuildInstances(phys.st.z);
    lastPk = Math.max(0, Math.floor(-phys.st.z / CFG.CHUNK_LEN));
  }

  function hardReset(freshSeed) {
    if (freshSeed) seed = (Math.random() * 2147483647) | 0;
    phys.reset(seed);
    skier.reset(seed);
    tracks.reset();
    sprayTime = 0;
    input.reset();
    shadowAge = Infinity;
    accum = 0;
    Object.assign(prevState, phys.st);
    terrain.reset(seed);
    treesMod.reset(seed);
    rocks.reset(seed);
    rocks.sync(phys.st.z, 0);
    lastPk = -1;
    refreshWorld();
    terrain.finishNearest();
    particles.resetDrift(phys.st.x, phys.st.y + 10, phys.st.z - 20);
    snapCamera();
  }

  function startRun(freshSeed = true) {
    if (!isMobile) return;
    hardReset(freshSeed);
    if (freshSeed) routeBests.length = 0;
    runId++;
    splits.length = 0;
    hudAt = 0;
    overRock = false;
    clearNoticeUntil = 0;
    stageIndex = sector = elapsed = stageStart = 0;
    clock.getDelta();
    timeScale = 1; trauma = 0;
    state = 'RUN';
    treesMod.setVisible(true);
    ui.startRun();
    runBest = board.localBest();
  }

  function toMenu() {
    hardReset(true);
    timeScale = 1; state = 'MENU';
    treesMod.setVisible(true);
    ui.showBoot();
  }

  function togglePause(on) {
    if (on && state === 'RUN') { input.reset(); pausedFrom = state; state = 'PAUSE'; ui.showPause(true); }
    else if (!on && state === 'PAUSE') { clock.getDelta(); input.reset(); state = pausedFrom; ui.showPause(false); }
  }

  // ---- 撞树流程 ----
  let crashTimer = 0;
  let crashObstacle = 'tree';
  function doCrash(obstacle = 'tree') {
    crashObstacle = obstacle;
    state = 'CRASH';
    crashTimer = 0;
    phys.crash();
    skier.startCrash({ x: phys.st.vx, y: 0, z: phys.st.vz });
    particles.emitBurst(phys.st.x, phys.st.y + phys.st.jumpHeight, phys.st.z, 1.4);
    sfx.crash();
    trauma = 1;
    timeScale = CFG.SLOWMO;
  }

  async function finishRun() {
    state = 'OVER';
    timeScale = 1;
    const score = Math.floor(phys.st.dist);
    const isBest = board.setLocalBest(score);
    const partial = { label: '本段 · ' + stages[stageIndex].name + '（未完成）', time: elapsed - stageStart, delta: null };
    ui.showOver(score, isBest, [...splits, partial], crashObstacle);
    if (isBest) sfx.newBest(); else sfx.over();
    const name = localStorage.getItem(CFG.NAME_KEY) || '无名滑雪者';
    const submittingRun = runId;
    const res = await board.submit(name, score);
    if (submittingRun !== runId || state !== 'OVER') return;
    if (res.ok && res.cloud && res.rank) ui.setRank(`排行榜第 ${res.rank} 名`);
    else if (res.ok && res.cloud) ui.setRank('已提交到共享排行榜');
    else if (res.ok && !res.cloud) ui.setRank('已记入本机排行榜');
    else if (!res.ok && res.cloud) ui.setRank('提交未确认，成绩已存本机');
  }

  // ---- 碰撞 & 擦树 ----
  function checkTrees(list) {
    const st = phys.st;
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
    camFov = CFG.CAM_FOV_BASE;
    camera.fov = camFov;
    camera.updateProjectionMatrix();
    camPos.set(st.x, st.y + CFG.CAM_UP, st.z + CFG.CAM_BACK);
    camLook.set(st.x, st.y + 1, st.z - 10);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }
  function updateCamera(dt, st) {
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
    camLook.y = U.damp(camLook.y, terrainHeight(px + fx * CFG.CAM_AHEAD, pz + fz * CFG.CAM_AHEAD, seed) + 1.4, 8, dt);
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
    const texel = (SE * 2) / sun.shadow.mapSize.x;
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
  let sprayTime = 0;
  function emitSprayAtSkis(st, dt) {
    const turn = Math.abs(st.steer) * (0.35 + st.speedN);
    const power = U.clamp(st.slip + turn * 0.85, 0, 1.5);
    sprayTime += dt;
    if (sprayTime < 1 / 45) return;
    const bursts = Math.min(3, Math.floor(sprayTime * 45));
    sprayTime %= 1 / 45;
    if (power < 0.05) return;
    const sn = Math.sin(st.heading), cs = Math.cos(st.heading);
    const side = Math.sign(st.lean);
    for (const tail of skier.tails) {
      for (let i = 0; i < bursts; i++) {
        particles.emitSpray(tail.x, tail.y, tail.z, sn, cs, side * cs, -side * sn, power * 0.7, st.speed);
      }
    }
  }

  // ---- 主循环 ----
  const clock = new THREE.Clock();
  let accum = 0;
  const H = 1 / 120;
  const animState = {}, prevState = {};
  const interpolated = ['x', 'y', 'z', 'vx', 'vz', 'heading', 'lean', 'steer', 'compression', 'tuck', 'jumpHeight'];

  function frame() {
    requestAnimationFrame(frame);
    const rawDt = clock.getDelta();
    if (state === 'PAUSE' || state === 'OVER') return;
    const dt = Math.min(rawDt, 0.12) * timeScale;
    if (rawDt > 0) frameSeconds = U.damp(frameSeconds, Math.min(rawDt, 1), 2, rawDt);
    terrainTimeUniform.value += dt;
    if (state === 'RUN' || state === 'MENU') {
      input.update();
      accum += dt;
      const candidates = state === 'RUN' ? treesMod.nearTrees(phys.st.z) : null;
      while (accum + 1e-10 >= H && !phys.st.crashed) {
        Object.assign(prevState, phys.st);
        let steer = input.steer;
        if (state === 'MENU') {
          const ahead = U.clamp(phys.st.speed * 0.46, 5, 15);
          courseAt(phys.st.dist + ahead, seed, menuLane);
          const heading = -Math.atan2(menuLane.x - phys.st.x, ahead);
          steer = U.clamp((phys.st.heading - heading) * 4.2, -1, 1);
        }
        let launch = false;
        if (state === 'RUN') {
          launch = input.consumeJump() && !phys.st.jumpPhase;
          if (launch) sfx.whoosh();
        } else if (!phys.st.jumpPhase) {
          const st = phys.st;
          const next = rocks.nextRock(st.x, st.z, st.vx, st.vz);
          launch = next && next.distance < st.speed * 0.52;
        }
        phys.step(H, steer, launch);
        accum = Math.max(0, accum - H);
        if (state === 'RUN') {
          timeStep(H, prevState.dist);
          checkTrees(candidates);
          if (!phys.st.crashed) {
            const st = phys.st;
            if (rocks.hits(st.x, st.z, st.jumpHeight)) doCrash('rock');
            else if (st.jumpHeight > 0 && !overRock && rocks.hits(st.x, st.z, 0)) overRock = true;
            else if (overRock && !st.jumpPhase) {
              overRock = false;
              clearNoticeUntil = elapsed + 1.1;
            }
          }
        }
      }
      if (state === 'MENU' && phys.st.dist > 320) hardReset(true);
    } else if (state === 'CRASH') {
      phys.step(dt, 0);
      crashTimer += rawDt;
      if (crashTimer >= CFG.CRASH_TIME) finishRun();
    }

    // 世界跟随
    refreshWorldIfNeeded();

    // 人物（复用状态对象，避免每帧分配）
    const st = phys.st;
    Object.assign(animState, st);
    if (!st.crashed) {
      const alpha = U.sat(accum / H);
      for (const key of interpolated) animState[key] = U.lerp(prevState[key], st[key], alpha);
      const phase = prevState.jumpPhase > 0 && st.jumpPhase === 0 ? 1 : st.jumpPhase;
      animState.jumpPhase = U.lerp(prevState.jumpPhase, phase, alpha);
    }
    skier.update(animState, dt, terrainTimeUniform.value);
    terrain.contact.value.set(animState.x, animState.z, Math.sin(animState.heading), Math.cos(animState.heading));
    if (animState.jumpHeight > 0 || st.crashed) {
      tracks.breakLine();
    } else {
      tracks.append(skier.tails, animState.heading, terrainTimeUniform.value);
      emitSprayAtSkis(animState, dt);
    }
    particles.updateSpray(dt);
    particles.updateDrift(dt, camera.position);
    sfx.update(dt, st);
    updateCamera(dt, animState);
    sky.update(camera, dt, st.z);
    // Cache the shadow depth pass between updates. Limit the distance travelled
    // between samples so the ski tips and trunk shadows stay attached at speed.
    shadowAge += dt;
    const shadowInterval = Math.min(quality === 2 ? 1 / 40 : 1 / 28, 0.35 / Math.max(st.speed, 1));
    if (quality > 0 && shadowAge >= shadowInterval) {
      updateSun();
      renderer.shadowMap.needsUpdate = true;
      shadowAge = 0;
    }

    // Keep DOM updates independent of the render frequency.
    if (state === 'RUN' && elapsed >= hudAt) {
      hudAt = elapsed + 0.08;
      const next = rocks.nextRock(st.x, st.z, st.vx, st.vz);
      const nearRock = next && next.distance < Math.max(15, st.speed * 1.6);
      let cue = '距分段点 ' + Math.max(0, Math.ceil(stageEnd() - st.dist)) + ' m';
      if (nearRock && !st.jumpPhase) {
        cue = next.distance > st.speed * 0.80
          ? '前方矮石 · ' + Math.ceil(next.distance) + ' m' : '↑ 现在上划空翻';
      } else if (elapsed < clearNoticeUntil) cue = '已越过矮石';
      ui.hud(st.speed * 3.6, st.dist, runBest, stages[stageIndex].name, cue);
    }

    // 自动降质（卡顿立即降）+ 缓慢升质（持续流畅才回升，带冷却防振荡）
    qTimer += rawDt;
    if (qTimer > 2) {
      qTimer = 0;
      if (frameSeconds > 1 / 45 && quality > 0) { applyQuality(quality - 1); upStreak = 0; }
    }
    if (quality < 2 && frameSeconds < 1 / 57) {
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
      treesMod.rebuildInstances(phys.st.z);
      rocks.sync(st.z, state === 'MENU' ? 0 : elapsed);
    }
    terrain.update(3.5);   // 地形构建按预算分帧推进，不卡主循环
  }

  // ---- 尺寸 / 可见性 / 杂项 ----
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.4 : 1.6);
    const maxPixels = [480000, 960000, 1800000][quality];
    const ratio = Math.min(dpr * [0.75, 0.90, 1][quality], Math.sqrt(maxPixels / (w * h)));
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    postfx.setSize(size.x, size.y);
    if (window.__SKI && (state === 'PAUSE' || state === 'OVER')) postfx.render(terrainTimeUniform.value);
  }
  window.addEventListener('resize', onResize);
  onResize();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'RUN') togglePause(true);
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---- 启动 ----
  hardReset(true);
  ui.showBoot();

  // 调试钩子（开发/测试用）
  window.__SKI = {
    get state() { return state; },
    get seed() { return seed; },
    phys, postfx, renderer, scene, camera, particles, skier,
    get quality() { return quality; },
    setQuality: applyQuality,
  };
  frame();
})();
