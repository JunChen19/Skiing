/* ================= skier.js ================= */
// 程序化滑雪者：几何体拼装 + 关节层级，
// 倾斜/下蹲/反弓/挥杖全部由物理状态驱动，零外部模型文件
'use strict';

function buildSkier(scene, seed) {
  // ---- 材质 ----
  const MAT = {
    jacket: new THREE.MeshStandardMaterial({ color: new THREE.Color('#e8622d').convertSRGBToLinear(), roughness: 0.62 }),
    jacketDark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#a8431c').convertSRGBToLinear(), roughness: 0.62 }),
    pants: new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b3440').convertSRGBToLinear(), roughness: 0.75 }),
    boot: new THREE.MeshStandardMaterial({ color: new THREE.Color('#1e1e22').convertSRGBToLinear(), roughness: 0.35 }),
    helmet: new THREE.MeshStandardMaterial({ color: new THREE.Color('#efece2').convertSRGBToLinear(), roughness: 0.3 }),
    frame: new THREE.MeshStandardMaterial({ color: new THREE.Color('#181c22').convertSRGBToLinear(), roughness: 0.5 }),
    lens: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8a4a66').convertSRGBToLinear(),
      metalness: 0.85, roughness: 0.16,
      emissive: new THREE.Color('#170b12').convertSRGBToLinear(),
    }),
    skin: new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9a077').convertSRGBToLinear(), roughness: 0.65 }),
    gaiter: new THREE.MeshStandardMaterial({ color: new THREE.Color('#23272e').convertSRGBToLinear(), roughness: 0.8 }),
    pack: new THREE.MeshStandardMaterial({ color: new THREE.Color('#334050').convertSRGBToLinear(), roughness: 0.8 }),
    bedroll: new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8d3c4').convertSRGBToLinear(), roughness: 0.85 }),
    mitt: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff7a4e').convertSRGBToLinear(), roughness: 0.6 }),
    skiTop: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff5a4e').convertSRGBToLinear(), roughness: 0.28 }),
    skiBase: new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a').convertSRGBToLinear(), roughness: 0.5 }),
    pole: new THREE.MeshStandardMaterial({ color: new THREE.Color('#16181c').convertSRGBToLinear(), roughness: 0.4, metalness: 0.5 }),
  };

  // 合并同材质几何体 → 单次绘制调用（人物从 ~64 mesh 降到 ~37）
  function mergeGeo(geos, mat) {
    let vc = 0, ic = 0;
    for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
    const idx = new Uint32Array(ic);
    let vo = 0, io = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io++] = gi[i] + vo;
      vo += g.attributes.position.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return new THREE.Mesh(geo, mat);
  }
  function tGeo(g, x, y, z, rx) {
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return g;
  }
  // 胶囊体（圆柱+双球合并为单网格）
  function capsule(r, len, mat, seg) {
    seg = seg || 10;
    const cyl = new THREE.CylinderGeometry(r, r, len, seg);
    const a = new THREE.SphereGeometry(r, seg, 8); a.translate(0, len / 2, 0);
    const b = new THREE.SphereGeometry(r, seg, 8); b.translate(0, -len / 2, 0);
    return mergeGeo([cyl, a, b], mat);
  }
  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }
  function sph(r, mat, sx, sy, sz) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    if (sx) m.scale.set(sx, sy, sz);
    return m;
  }
  function shadowAll(root) {
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }

  // ---- 关节层级 ----
  const root = new THREE.Group();          // 位于雪面，rotation.y = 航向
  const body = new THREE.Group();          // 下蹲偏移 / 摔倒翻滚
  root.add(body);

  const HIP_Y = 0.88, HIP_X = 0.18;
  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * HIP_X, HIP_Y, 0);

    const thigh = capsule(0.078, 0.34, MAT.pants);
    thigh.position.y = -0.18;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.40;
    hip.add(knee);

    const shin = capsule(0.054, 0.30, MAT.pants);
    shin.position.y = -0.16;
    knee.add(shin);

    const bootG = new THREE.Group();
    bootG.position.y = -0.40;
    knee.add(bootG);

    const bootM = mergeGeo([
      tGeo(new THREE.BoxGeometry(0.15, 0.17, 0.33), 0, -0.02, 0.035, 0),
      tGeo(new THREE.BoxGeometry(0.13, 0.10, 0.10), 0, -0.05, -0.18, 0),
    ], MAT.boot);
    const buckle = box(0.16, 0.03, 0.14, MAT.frame);
    buckle.position.set(0, 0.045, 0.02);
    bootG.add(bootM, buckle);

    // 滑雪板（可拆卸，摔倒时飞出）
    const ski = new THREE.Group();
    ski.position.y = -0.118;
    const deck = mergeGeo([
      tGeo(new THREE.BoxGeometry(0.105, 0.024, 1.72), 0, 0, 0.05, 0),
      tGeo(new THREE.BoxGeometry(0.105, 0.024, 0.34), 0, 0.055, -0.83, 0.42),
      tGeo(new THREE.BoxGeometry(0.105, 0.024, 0.16), 0, 0.03, 0.9, -0.3),
    ], MAT.skiTop);
    const base = box(0.108, 0.012, 1.74, MAT.skiBase);
    base.position.set(0, -0.018, 0.05);
    const binds = mergeGeo([
      tGeo(new THREE.BoxGeometry(0.088, 0.05, 0.13), 0, 0.04, -0.12, 0),
      tGeo(new THREE.BoxGeometry(0.088, 0.05, 0.13), 0, 0.04, 0.17, 0),
    ], MAT.frame);
    ski.add(deck, base, binds);
    bootG.add(ski);

    return { hip, knee, bootG, ski };
  }
  const legL = buildLeg(-1), legR = buildLeg(1);
  body.add(legL.hip, legR.hip);

  // 臀部
  const pelvis = sph(0.155, MAT.pants, 1.12, 0.78, 0.9);
  pelvis.position.y = HIP_Y + 0.05;
  const belt = box(0.27, 0.05, 0.2, MAT.jacketDark);
  belt.position.y = HIP_Y + 0.11;
  body.add(pelvis, belt);

  // 躯干
  const torso = new THREE.Group();
  torso.position.y = 1.00;
  body.add(torso);
  const chestLow = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.155, 0.30, 12), MAT.jacket);
  chestLow.position.y = 0.15;
  const chestTop = sph(0.172, MAT.jacket, 1, 0.82, 0.82);
  chestTop.position.y = 0.325;
  const zipper = box(0.026, 0.30, 0.012, MAT.jacketDark);
  zipper.position.set(0, 0.19, -0.158);
  zipper.rotation.x = 0.06;
  const pack = capsule(0.12, 0.14, MAT.pack, 10);
  pack.scale.set(1.04, 1, 0.68);
  pack.position.set(0, 0.22, 0.155);
  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.27, 10), MAT.bedroll);
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 0.415, 0.15);
  const shoulders = mergeGeo([
    tGeo(new THREE.SphereGeometry(0.078, 10, 8), -0.155, 0.36, 0, 0),
    tGeo(new THREE.SphereGeometry(0.078, 10, 8), 0.155, 0.36, 0, 0),
  ], MAT.jacketDark);
  const packBand = box(0.235, 0.024, 0.15, MAT.jacketDark);
  packBand.position.set(0, 0.19, 0.18);
  torso.add(packBand);
  torso.add(chestLow, chestTop, zipper, pack, bedroll, shoulders);

  // 头部
  const head = new THREE.Group();
  head.position.set(0, 0.47, 0.015);
  torso.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.09, 8), MAT.skin);
  neck.position.y = 0.015;
  const gaiter = sph(0.104, MAT.gaiter, 0.95, 0.82, 0.95);
  gaiter.position.y = 0.135;
  const face = sph(0.113, MAT.skin);
  face.position.set(0, 0.205, 0.008);
  const helmetM = mergeGeo([
    tGeo((function () { const s = new THREE.SphereGeometry(0.136, 14, 10); s.scale(1, 0.9, 1.06); return s; })(), 0, 0.245, 0.005, 0),
    tGeo(new THREE.BoxGeometry(0.19, 0.028, 0.07), 0, 0.195, -0.125, 0),
    tGeo(new THREE.BoxGeometry(0.03, 0.005, 0.24), 0.03, 0.372, 0, 0),
  ], MAT.helmet);
  head.add(neck, gaiter, face, helmetM);

  // 雪镜
  const goggles = new THREE.Group();
  goggles.position.set(0, 0.235, -0.082);
  const gFrame = box(0.215, 0.08, 0.06, MAT.frame);
  const lens = box(0.19, 0.052, 0.02, MAT.lens);
  lens.position.z = -0.028;
  goggles.add(gFrame, lens);
  head.add(goggles);

  // 手臂 + 雪杖
  function buildArm(side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.215, 0.40, 0);

    const upper = capsule(0.05, 0.26, MAT.jacket, 8);
    upper.position.y = -0.15;
    arm.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    arm.add(elbow);

    const fore = capsule(0.043, 0.24, MAT.jacketDark, 8);
    fore.position.y = -0.13;
    const mitt = sph(0.056, MAT.mitt);
    mitt.position.y = -0.285;
    elbow.add(fore, mitt);

    // 雪杖挂在手部
    const poleG = new THREE.Group();
    poleG.position.y = -0.30;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.92, 6), MAT.pole);
    shaft.position.y = -0.44;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.13, 7), MAT.frame);
    grip.position.y = -0.02;
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.03, 7), MAT.frame);
    basket.position.y = -0.78;
    poleG.add(shaft, grip, basket);
    elbow.add(poleG);

    return { arm, elbow, poleG };
  }
  const armL = buildArm(-1), armR = buildArm(1);
  torso.add(armL.arm, armR.arm);

  shadowAll(root);
  scene.add(root);

  // ---- 动画状态 ----
  const AN = {
    polePhase: 0,
    vibT: 0,
  };
  let crash = null;          // 摔倒运动状态
  const freeSkis = [];       // 飞出的雪板

  const tails = [new THREE.Vector3(), new THREE.Vector3()];
  const groundPoint = new THREE.Vector3();
  const sample = new THREE.Vector3();
  const legs = [legL, legR];
  function update(st, dt, time) {
    if (st.crashed) { updateCrash(dt); return; }
    root.position.set(st.x, st.y, st.z);
    const cs = Math.cos(st.heading), sn = Math.sin(st.heading);
    const tip = terrainHeight(st.x - sn * 0.82, st.z - cs * 0.82, seed);
    const tail = terrainHeight(st.x + sn * 0.82, st.z + cs * 0.82, seed);
    const right = terrainHeight(st.x + cs * HIP_X, st.z - sn * HIP_X, seed);
    const left = terrainHeight(st.x - cs * HIP_X, st.z + sn * HIP_X, seed);
    root.position.y = (left + right) * 0.5;
    root.rotation.set(Math.atan2(tip - tail, 1.64), st.heading,
      Math.atan2(right - left, 2 * HIP_X), 'YXZ');
    const c = U.clamp(0.44 + st.compression * 0.55 + st.tuck * 0.5, 0, 1.15);
    const thighPitch = 0.18 + c * 0.62;
    const kneePitch = 0.22 + c * 1.6;
    const bootPitch = kneePitch - thighPitch;
    // 腿部链路缩短量 = 髋部下坠量（保证雪板贴雪）
    const legReach = 0.40 * Math.cos(thighPitch) + 0.40 * Math.cos(kneePitch - thighPitch);
    body.position.y = -(0.80 - legReach);
    body.rotation.set(0, 0, 0);

    for (const leg of legs) {
      leg.hip.position.set(leg === legL ? -HIP_X : HIP_X, HIP_Y, 0);
      leg.hip.rotation.x = -thighPitch;
      leg.knee.rotation.x = kneePitch;
      leg.bootG.rotation.x = -bootPitch;
    }
    // 立刃：雪板随身体滚转
    const edge = st.lean * 0.55;
    legL.ski.rotation.z = edge;
    legR.ski.rotation.z = edge;
    legL.ski.rotation.y = -0.05;
    legR.ski.rotation.y = 0.05;

    body.position.x = -st.lean * 0.20;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      leg.ski.updateWorldMatrix(true, false);
      leg.ski.localToWorld(sample.set(0, -0.024, 0.05));
      // Correct both height and lateral offset in hip-parent space, keeping boots planted.
      groundPoint.copy(sample);
      groundPoint.x -= cs * body.position.x;
      groundPoint.z += sn * body.position.x;
      groundPoint.y = terrainHeight(groundPoint.x, groundPoint.z, seed) + 0.008;
      body.worldToLocal(groundPoint);
      body.worldToLocal(sample);
      leg.hip.position.add(groundPoint.sub(sample));
      leg.ski.updateWorldMatrix(true, false);
      leg.ski.localToWorld(tails[i].set(0, -0.018, 0.82));
      tails[i].y = terrainHeight(tails[i].x, tails[i].z, seed) + 0.016;
    }
    torso.rotation.z = st.lean * 0.82;
    // 躯干反弓（胸朝坡下、肩指向弯外）+ 前倾
    torso.rotation.y = st.steer * 0.4;
    torso.rotation.x = -(0.14 + st.tuck * 0.34 + c * 0.22);
    head.rotation.y = -st.steer * 0.3;
    head.rotation.x = -0.06 - st.tuck * 0.18;

    // 手臂：低速平衡展开 → 高速收拢抱杖
    const t = st.tuck;
    const spread = 0.70 - t * 0.39;
    armL.arm.rotation.z = -spread;
    armR.arm.rotation.z = spread;
    armL.arm.rotation.x = -(0.12 + t * 0.42);
    armR.arm.rotation.x = -(0.12 + t * 0.42);
    armL.elbow.rotation.x = 0.35 + t * 1.35;
    armR.elbow.rotation.x = 0.35 + t * 1.35;

    // 入弯内杖点杖（转向变化率触发）
    const turnRate = Math.abs(st.steerRate || 0);
    if (turnRate > 2.2 && AN.polePhase <= 0) AN.polePhase = 0.34;
    if (AN.polePhase > 0) AN.polePhase -= dt;
    const plant = AN.polePhase > 0 ? Math.sin((1 - AN.polePhase / 0.34) * Math.PI) : 0;
    const innerArm = st.steer > 0 ? armR : armL;   // 右转 → 内侧是右手
    innerArm.arm.rotation.x -= plant * 0.8;
    innerArm.elbow.rotation.x -= plant * 0.9;
    armR.poleG.rotation.x = -(0.8 + t * 0.35) - (st.steer > 0 ? plant * 0.7 : 0);
    armL.poleG.rotation.x = -(0.8 + t * 0.35) - (st.steer < 0 ? plant * 0.7 : 0);

    // 高速微颤
    AN.vibT += dt * (14 + st.speedN * 30);
    const vib = st.speedN * 0.006;
    body.rotation.z += Math.sin(AN.vibT * 2.7) * vib;
    body.rotation.x += Math.sin(AN.vibT * 1.9) * vib * 0.6;
  }

  // ---- 摔倒：翻滚 + 雪板飞脱 ----
  function detachSkis(vel) {
    for (const leg of [legL, legR]) {
      const ski = leg.ski;
      leg.bootG.updateMatrixWorld(true);
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
      ski.getWorldPosition(wp);
      ski.getWorldQuaternion(wq);
      leg.bootG.remove(ski);
      scene.add(ski);
      ski.position.copy(wp);
      ski.quaternion.copy(wq);
      freeSkis.push({
        obj: ski, leg,
        vel: new THREE.Vector3((Math.random() - 0.5) * 5 + vel.x * 0.6, 2.5 + Math.random() * 3.5, vel.z * 0.55 + (Math.random() - 0.5) * 3),
        ang: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 14),
      });
    }
  }

  function startCrash(vel) {
    crash = {
      vel: new THREE.Vector3(vel.x * 0.55, 3.2 + Math.random() * 1.5, vel.z * 0.5),
      ang: new THREE.Vector3(
        -4 - Math.random() * 6,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 8
      ),
    };
    detachSkis(vel);
  }

  const _up = new THREE.Vector3();
  function updateCrash(dt) {
    if (!crash) return;
    crash.vel.y -= 9.81 * dt;
    root.localToWorld(groundPoint.copy(body.position));
    groundPoint.addScaledVector(crash.vel, dt);
    const floor = terrainHeight(groundPoint.x, groundPoint.z, seed) + 0.25;
    body.rotation.x += crash.ang.x * dt;
    body.rotation.y += crash.ang.y * dt;
    body.rotation.z += crash.ang.z * dt;
    // 地面反弹衰减
    if (groundPoint.y < floor) {
      groundPoint.y = floor;
      crash.vel.y = Math.abs(crash.vel.y) * 0.25;
      crash.vel.x *= 0.82; crash.vel.z *= 0.82;
      crash.ang.multiplyScalar(0.86);
    }
    body.position.copy(root.worldToLocal(groundPoint));
    // 飞出的雪板
    for (const fs of freeSkis) {
      fs.vel.y -= 9.81 * dt;
      fs.obj.position.addScaledVector(fs.vel, dt);
      fs.obj.rotation.x += fs.ang.x * dt;
      fs.obj.rotation.y += fs.ang.y * dt;
      fs.obj.rotation.z += fs.ang.z * dt;
      const fy = terrainHeight(fs.obj.position.x, fs.obj.position.z, seed);
      if (fs.obj.position.y < fy + 0.03) {
        fs.obj.position.y = fy + 0.03;
        fs.vel.y = Math.abs(fs.vel.y) * 0.3;
        fs.vel.x *= 0.7; fs.vel.z *= 0.7;
        fs.ang.multiplyScalar(0.7);
      }
    }
  }

  function reset(newSeed = seed) {
    seed = newSeed;
    AN.polePhase = AN.vibT = 0;
    crash = null;
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    for (const fs of freeSkis) {
      scene.remove(fs.obj);
      fs.leg.bootG.add(fs.obj);
      fs.obj.position.set(0, -0.118, 0);
      fs.obj.rotation.set(0, 0, 0);
    }
    freeSkis.length = 0;
  }

  return { root, body, tails, update, startCrash, reset, MAT };
}
