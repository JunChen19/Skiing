/* ================= physics.js ================= */
// 滑雪 carve（走刃）物理：
//   输入 → 立刃/转向角速度 → 航向变化；速度方向以“抓地”速率贴合航向，
//   贴不上就侧滑（泄速 + 雪雾）；坡度重力、空气阻力、雪面摩擦全积分。
//   所有横向运动都由转向产生 —— 惯性、走漂、泄速全部符合直觉。
'use strict';

function makePhysics(seed) {
  const st = {
    x: 0, z: -2,
    vx: 0, vz: -CFG.START_SPEED,
    heading: 0,          // 0 = 朝 -Z
    speed: CFG.START_SPEED,
    steer: 0, steerRate: 0,
    slip: 0,
    lean: 0,
    latA: 0,
    y: 0, yVel: 0,       // 悬挂弹簧（颠簸缓冲）
    compression: 0,      // 压缩量 0..1（视觉下蹲加成）
    tuck: 0,
    speedN: 0,
    dist: 0,
    crashed: false,
    crashT: 0,
  };

  const nrm = new THREE.Vector3();

  function reset(newSeed) {
    seed = newSeed;
    st.x = 0; st.z = -2;
    st.vx = 0; st.vz = -CFG.START_SPEED;
    st.heading = 0;
    st.speed = CFG.START_SPEED;
    st.steer = 0; st.steerRate = 0;
    st.slip = 0; st.lean = 0; st.latA = 0;
    st.y = terrainHeight(st.x, st.z, seed);
    st.yVel = 0;
    st.compression = 0; st.tuck = 0; st.speedN = 0;
    st.dist = 0;
    st.crashed = false; st.crashT = 0;
  }

  // 输入（-1 左 … 1 右？不：-1 左，+1 右，见 input 映射；这里 s>0 = 右转）
  function step(dt, sTarget) {
    if (st.crashed) { st.crashT += dt; return; }

    // ---- 输入平滑（贴边时叠加朝谷心的回正辅助，避免在雪堤上磨停）----
    const wallBias = U.smoothstep(CFG.CORRIDOR - 7, CFG.CORRIDOR + 3, Math.abs(st.x)) * 0.6;
    const effTarget = U.clamp(sTarget, -1, 1) - Math.sign(st.x || 1) * wallBias;
    const prevSteer = st.steer;
    st.steer = U.damp(st.steer, U.clamp(effTarget, -1, 1), CFG.STEER_SMOOTH, dt);
    st.steerRate = U.damp(st.steerRate, (st.steer - prevSteer) / Math.max(dt, 1e-4), 12, dt);

    // ---- 转向：角速度随速度衰减，侧向加速度封顶（走刃极限）----
    // 约定：steer > 0 = 右转（朝 +X）；heading φ 的 forward = (-sinφ, -cosφ)，
    // φ 减小 → 朝 +X，故 ω = -steer × rate
    const v = st.speed;
    const omegaMax = CFG.TURN_RATE / (1 + v * CFG.TURN_SPEED_DAMP);
    const omegaByGrip = 34 / Math.max(v, 2); // 侧向抓地上限（保证 25m/s 时半径 ~18m，可躲树）
    const omega = -st.steer * Math.min(omegaMax, omegaByGrip);
    st.heading += omega * dt;
    st.heading = U.clamp(st.heading, -1.35, 1.35); // 不许倒滑/横穿上山
    st.latA = v * omega;

    const fx = -Math.sin(st.heading), fz = -Math.cos(st.heading); // 雪板朝向

    // ---- 坡度重力 ----
    terrainNormalAt(st.x, st.z, seed, nrm);
    const gx = -nrm.x / nrm.y, gz = -nrm.z / nrm.y;       // ∇h
    const gMag2 = 1 + gx * gx + gz * gz;
    const aG = CFG.G / gMag2;
    let ax = -aG * gx, az = -aG * gz;

    // ---- 摩擦（走刃低耗 + 侧滑泄速 + 出界深雪）----
    const slopeCos = 1 / Math.sqrt(gMag2);
    let mu = CFG.FRICTION + st.slip * CFG.SLIP_FRICTION;
    const outD = Math.max(0, Math.abs(st.x) - CFG.CORRIDOR);
    if (outD > 0) mu *= 2.2;                               // 两岸野雪减速
    if (v > 0.01) {
      const fr = mu * CFG.G * slopeCos;
      ax -= fr * (st.vx / v); az -= fr * (st.vz / v);
    }

    // ---- 空气阻力（tuck 减阻）----
    st.tuck = U.damp(st.tuck, U.clamp((v - 15) / 19, 0, 1), 2.5, dt);
    if (v > 0.01) {
      const k = CFG.DRAG_AIR * (1 - st.tuck * 0.18);
      ax -= k * v * st.vx; az -= k * v * st.vz;
    }

    // ---- 两岸雪堤推回 ----
    if (outD > 0) {
      const dir = -Math.sign(st.x);
      const push = Math.min(11, outD * 1.5 + 0.14 * outD * outD);
      ax += dir * push;
    }

    // ---- 积分 ----
    st.vx += ax * dt; st.vz += az * dt;

    // ---- 抓地：速度方向贴合雪板朝向 ----
    const spd = Math.hypot(st.vx, st.vz);
    if (spd > 0.05) {
      let vAng = Math.atan2(-st.vx, -st.vz);              // 与 heading 同构的角度
      let diff = st.heading - vAng;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const gripStep = Math.min(Math.abs(diff), CFG.GRIP * dt) * Math.sign(diff);
      vAng += gripStep;
      st.slip = U.clamp(Math.abs(diff) / 0.75, 0, 1);
      const ns = Math.hypot(st.vx, st.vz);
      st.vx = -Math.sin(vAng) * ns;
      st.vz = -Math.cos(vAng) * ns;
    } else {
      st.slip = 0;
    }

    st.speed = Math.hypot(st.vx, st.vz);
    if (st.speed > CFG.MAX_SPEED) {
      const k = CFG.MAX_SPEED / st.speed;
      st.vx *= k; st.vz *= k; st.speed = CFG.MAX_SPEED;
    }
    st.x += st.vx * dt;
    st.z += st.vz * dt;
    st.dist = Math.max(st.dist, -st.z);
    st.speedN = U.clamp(st.speed / CFG.MAX_SPEED, 0, 1);

    // ---- 侧倾（物理离心 → 视觉入弯）----
    const leanT = U.clamp(Math.atan2(st.latA, CFG.G), -0.72, 0.72);
    st.lean = U.damp(st.lean, leanT, 7, dt);

    // ---- 悬挂弹簧（颠簸/压缩）----
    const hC = terrainHeight(st.x, st.z, seed);
    const stiff = 90, dampC = 11;
    const aY = stiff * (hC - st.y) - dampC * st.yVel;
    st.yVel += aY * dt;
    st.y += st.yVel * dt;
    if (st.y < hC - 1.5) { st.y = hC - 1.5; st.yVel = Math.abs(st.yVel) * 0.3; } // 不穿地太多
    st.compression = U.clamp((hC - st.y) * 1.8 + U.clamp(st.yVel * 0.06, -0.3, 0.5), -0.2, 1);
  }

  function crash() {
    st.crashed = true;
    st.crashT = 0;
  }

  reset(seed);
  return { st, step, crash, reset };
}

// ---- 输入：鼠标 / 触控 / 键盘统一 ----
function makeInput(el) {
  const inp = {
    steer: 0,
    active: false,
    _key: 0,
    _ptrX: null,
  };
  function curve(x) {
    if (Math.abs(x) < 0.035) return 0;
    const c = Math.sign(x) * Math.pow(Math.abs(x), CFG.STEER_EXP);
    return U.clamp(c * 1.18, -1, 1);
  }
  function update() {
    if (inp._key !== 0) { inp.steer = inp._key; inp.active = true; return; }
    if (inp._ptrX === null) { inp.steer = 0; return; }
    inp.steer = curve(inp._ptrX * 2 - 1);  // 0..1 → -1..1
    inp.active = true;
  }

  el.addEventListener('mousemove', (e) => { inp._ptrX = e.clientX / window.innerWidth; }, { passive: true });
  el.addEventListener('mouseleave', () => { inp._ptrX = null; });
  // 触控：按住时以触点横坐标控制（绝对位置，直觉）
  el.addEventListener('touchstart', (e) => {
    inp._ptrX = e.touches[0].clientX / window.innerWidth;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    inp._ptrX = e.touches[0].clientX / window.innerWidth;
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', () => { inp._ptrX = null; }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') inp._key = -1;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') inp._key = 1;
  });
  window.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'a', 'A', 'ArrowRight', 'd', 'D'].includes(e.key)) inp._key = 0;
  });
  inp.update = update;
  return inp;
}
