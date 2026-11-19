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
    jumpPhase: 0, jumpHeight: 0,
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
    st.jumpPhase = st.jumpHeight = 0;
  }

  // 输入（-1 左 … 1 右？不：-1 左，+1 右，见 input 映射；这里 s>0 = 右转）
  function step(dt, sTarget, launch = false) {
    if (st.crashed) { st.crashT += dt; return; }
    if (launch || st.jumpPhase > 0) {
      const p = st.jumpPhase + dt / 1.12;
      st.jumpPhase = p < 1 ? p : 0;
      st.jumpHeight = 4 * 1.65 * st.jumpPhase * (1 - st.jumpPhase);
    }

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
    const turnLimit = Math.min(omegaMax, omegaByGrip) * (st.jumpPhase ? 0.58 : 1);
    // 松手后逐渐朝下坡回正，仍受当前速度的抓地上限约束。
    const recenter = U.clamp(-st.heading * CFG.RECENTER_RATE, -turnLimit, turnLimit);
    const omega = -st.steer * turnLimit + recenter * (1 - Math.abs(st.steer));
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

// ---- 触屏操作：左右压刃、上划起跳 ----
function makeInput(el) {
  let finger = null, jumpPending = false;
  let target = 0, startX = 0, initialTurn = 0;
  let swipeX = 0, swipeY = 0, jumped = false;
  let throwWidth = 90, jumpDistance = 40;

  function begin(touch) {
    finger = touch.identifier;
    startX = swipeX = touch.clientX;
    swipeY = touch.clientY;
    jumped = false;
    const width = window.innerWidth;
    const shortSide = Math.min(width, window.innerHeight);
    throwWidth = U.clamp(shortSide * 0.23, 60, 130);
    jumpDistance = U.clamp(shortSide * 0.095, 32, 58);
    // The middle third is neutral for starting a straight glide or jump.
    const side = startX / width * 2 - 1;
    initialTurn = Math.sign(side) * U.smoothstep(0.30, 0.84, Math.abs(side));
    target = initialTurn;
  }

  function move(touch) {
    const dx = touch.clientX - startX;
    // A short horizontal drag can reach full edge on phones and tablets.
    const drag = Math.sign(dx) * Math.max(0, Math.abs(dx) - 4) / throwWidth;
    target = U.clamp(initialTurn + drag, -1, 1);
    const across = Math.abs(touch.clientX - swipeX);
    const up = swipeY - touch.clientY;
    if (!jumped && up >= jumpDistance && up > across * 1.35) {
      jumpPending = true;
      jumped = true;
    }
    // Let a player carve first, then flick upward from the new hand position.
    if (up < 0 || across > jumpDistance && across > Math.abs(up) * 1.6) {
      swipeX = touch.clientX;
      swipeY = touch.clientY;
    }
  }

  function findFinger(touches) {
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === finger) return touches[i];
    }
    return null;
  }
  el.addEventListener('touchstart', (e) => {
    if (finger === null) begin(e.changedTouches[0]);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const touch = findFinger(e.changedTouches);
    if (touch) { move(touch); e.preventDefault(); }
  }, { passive: false });
  function finish(e) {
    const last = findFinger(e.changedTouches);
    if (!last) return;
    if (e.type === 'touchend') move(last);
    else jumpPending = false;
    finger = null;
    target = 0;
    if (e.targetTouches.length) begin(e.targetTouches[0]);
  }
  el.addEventListener('touchend', finish, { passive: true });
  el.addEventListener('touchcancel', finish, { passive: true });

  const input = {
    steer: 0,
    update() { input.steer = target; },
    consumeJump() {
      const result = jumpPending;
      jumpPending = false;
      return result;
    },
    reset() { finger = null; target = 0; jumpPending = false; input.steer = 0; },
  };
  window.addEventListener('blur', input.reset);
  return input;
}
