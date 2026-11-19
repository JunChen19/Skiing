/* ================= skier.js ================= */
// 程序化滑雪者：几何体拼装 + 关节层级，
// 倾斜/下蹲/反弓/挥杖全部由物理状态驱动，零外部模型文件
'use strict';

function buildSkier(scene, seed) {
  // ---- 材质 ----
  const MAT = {
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
    mitt: new THREE.MeshStandardMaterial({ color: new THREE.Color('#292d30').convertSRGBToLinear(), roughness: 0.78 }),
    skiBase: new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a').convertSRGBToLinear(), roughness: 0.5 }),
    pole: new THREE.MeshStandardMaterial({ color: new THREE.Color('#16181c').convertSRGBToLinear(), roughness: 0.4, metalness: 0.5 }),
  };

  // 合并同材质几何体 → 单次绘制调用（人物从 ~64 mesh 降到 ~37）
  function mergeGeo(geos, mat) {
    let vc = 0, ic = 0;
    for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
    const colors = mat.vertexColors ? new Float32Array(vc * 3) : null;
    const idx = new Uint32Array(ic);
    let vo = 0, io = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      if (colors) colors.set(g.attributes.color.array, vo * 3);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io++] = gi[i] + vo;
      vo += g.attributes.position.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return new THREE.Mesh(geo, mat);
  }
  function tGeo(g, x, y, z, rx) {
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return g;
  }
  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }
  function sph(r, mat, sx, sy, sz) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    if (sx) m.scale.set(sx, sy, sz);
    return m;
  }
  // Fit the garment to the moving joint using elliptical cross sections.
  // Panel colours, seams and small folds are baked once into the same mesh.
  function garment(rings, material, sides, panel) {
    const pos = [], colors = [], indices = [];
    const paint = new THREE.Color();
    for (let row = 0; row < rings.length; row++) {
      const [y, width, depth, z = 0] = rings[row];
      for (let i = 0; i < sides; i++) {
        const angle = i * Math.PI * 2 / sides;
        const x = Math.sin(angle), back = Math.cos(angle);
        const fold = 1 + 0.033 * Math.sin(5 * angle + row * 0.85);
        pos.push(x * width * fold, y, z + back * depth * fold);
        paint.set(panel(row, x, back)).convertSRGBToLinear();
        colors.push(paint.r, paint.g, paint.b);
        if (row + 1 === rings.length) continue;
        const a = row * sides + i, b = row * sides + (i + 1) % sides;
        indices.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }
  const fabric = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  function shadowAll(root) {
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }

  // ---- 关节层级 ----
  const root = new THREE.Group();          // 位于雪面，rotation.y = 航向
  const body = new THREE.Group();          // 下蹲偏移 / 摔倒翻滚
  root.add(body);

  const HIP_Y = 0.88, HIP_X = 0.145;
  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * HIP_X, HIP_Y, 0);

    const thigh = garment([
      [-0.44, 0.057, 0.06], [-0.36, 0.082, 0.09], [-0.32, 0.075, 0.082],
      [-0.22, 0.096, 0.103], [-0.10, 0.103, 0.112], [0.035, 0.086, 0.088],
    ], fabric, 14, (r,x) => Math.abs(x) > 0.85 ? '#303d48' : r === 2 ? '#283442' : '#404e5b');
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.40;
    hip.add(knee);

    const shin = garment([
      [-0.36, 0.075, 0.077], [-0.34, 0.085, 0.089], [-0.27, 0.081, 0.083],
      [-0.21, 0.074, 0.076], [-0.12, 0.084, 0.090], [-0.04, 0.078, 0.087], [0.04, 0.065, 0.069],
    ], fabric, 14, (r,x) => r < 2 || Math.abs(x) > 0.90 ? '#202d35' : '#42505e');
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
    const deck = skiDeck();
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
  function skiDeck() {
    const stations = [
      [-0.99,0.012,0.107], [-0.96,0.046,0.079], [-0.89,0.071,0.046],
      [-0.74,0.068,0.016], [-0.47,0.057,0.011], [-0.39,0.054,0.011],
      [-0.31,0.051,0.012], [0.0,0.049,0.019], [0.38,0.053,0.013],
      [0.53,0.061,0.011], [0.59,0.061,0.011], [0.84,0.062,0.013],
      [0.91,0.059,0.025], [0.94,0.05,0.034],
    ];
    const vertices = [], colors = [], indices = [];
    const paint = new THREE.Color();
    for (const [i, [z, width, y]] of stations.entries()) {
      paint.set(i < 3 || i === 5 || i > 9 ? '#27333b' : i === 9 ? '#e6dac4' : '#dc582d').convertSRGBToLinear();
      for (const x of [-width, width]) {
        vertices.push(x,y,z);
        colors.push(paint.r,paint.g,paint.b);
      }
      if (i) { const n = i * 2; indices.push(n-2, n, n-1, n, n+1, n-1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, deckFinish);
  }
  const deckFinish = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32 });
  const legL = buildLeg(-1), legR = buildLeg(1);
  body.add(legL.hip, legR.hip);

  // 臀部
  const pelvis = sph(0.155, MAT.pants, 1.34, 0.94, 0.96);
  pelvis.position.y = HIP_Y + 0.05;
  const belt = box(0.27, 0.05, 0.2, MAT.jacketDark);
  belt.position.y = HIP_Y + 0.11;
  body.add(pelvis, belt);

  // 躯干
  const torso = new THREE.Group();
  torso.position.y = 1.00;
  body.add(torso);
  const chest = garment([
    [-0.096,0.168,0.12], [-0.076,0.199,0.151], [0.018,0.203,0.154],
    [0.056,0.18,0.14], [0.135,0.189,0.14], [0.20,0.194,0.145],
    [0.29,0.223,0.158], [0.37,0.223,0.148], [0.415,0.188,0.125],
    [0.44,0.127,0.11], [0.462,0.089,0.084],
  ], fabric, 24, (r,x) => r === 0 ? '#613728' : r > 7 ? '#8b422c' :
    Math.abs(x) > 0.86 ? '#ad4b2d' : r === 3 ? '#c95a31' : '#e77b43');
  const zipper = box(0.026, 0.30, 0.012, MAT.jacketDark);
  zipper.position.set(0, 0.19, -0.158);
  zipper.rotation.x = 0.06;
  const pack = garment([
    [-0.006,0.016,0.026], [0.018,0.108,0.076], [0.062,0.129,0.094],
    [0.086,0.131,0.089], [0.10,0.132,0.093], [0.227,0.148,0.103],
    [0.245,0.146,0.096], [0.26,0.146,0.099], [0.34,0.136,0.091],
    [0.363,0.134,0.088], [0.394,0.118,0.075], [0.415,0.018,0.018],
  ], fabric, 24, (r,x,back) => r === 3 || r === 6 ? '#363c38' :
    r <= 2 || back < 0.38 ? '#353f41' : r === 9 ? '#b1a488' :
    Math.abs(x) > 0.66 ? '#645e4d' : '#8b826c');
  pack.position.set(0, 0.011, 0.137);
  const hood = sph(0.13, MAT.jacketDark, 1.04, 0.7, 0.82);
  hood.position.set(0, 0.415, 0.055);
  torso.add(chest, zipper, pack, hood);
  for (const side of [-1, 1]) {
    const shoulderStrap = sph(0.1, MAT.pack, 0.27, 1.38, 0.83);
    shoulderStrap.position.set(side * 0.125, 0.35, 0.104);
    shoulderStrap.rotation.z = -side * 0.28;
    const cord = box(0.012, 0.17, 0.011, MAT.gaiter);
    cord.position.set(side * 0.041, 0.19, 0.238);
    cord.rotation.z = -side * 0.62;
    torso.add(shoulderStrap, cord);
  }

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
  const strap = garment([
    [0.202,0.132,0.141], [0.209,0.138,0.146], [0.235,0.139,0.147], [0.24,0.135,0.143],
  ], fabric, 24, (r,x) => r === 0 || Math.abs(x) > 0.94 ? '#606561' : '#292e31');
  head.add(strap);

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

    const upper = garment([
      [-0.325,0.053,0.053], [-0.27,0.066,0.075], [-0.215,0.068,0.073],
      [-0.12,0.078,0.083], [-0.07,0.083,0.085], [0.002,0.073,0.085], [0.036,0.028,0.041],
    ], fabric, 14, (r) => r > 3 ? '#9a4a32' : '#e37943');
    arm.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    arm.add(elbow);

    const fore = garment([
      [-0.269,0.049,0.047], [-0.24,0.059,0.056], [-0.18,0.061,0.062],
      [-0.12,0.064,0.062], [-0.065,0.067,0.067], [0.023,0.059,0.06],
    ], fabric, 14, (r) => r < 2 ? '#384043' : '#ce663c');
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

  // Rigid parts attached to one bone can share a draw call. Keep the ski
  // soles separate for ground contact, and preserve reflective surfaces.
  function batchClothing(bone) {
    for (const child of bone.children.slice()) if (child.isGroup) batchClothing(child);
    const parts = bone.children.filter(child => child.isMesh &&
      child.material.roughness >= 0.5 && !child.material.metalness && child.material !== MAT.skiBase);
    if (parts.length < 2) return;
    const geometries = parts.map(part => {
      part.updateMatrix();
      const geo = part.geometry.applyMatrix4(part.matrix);
      if (!geo.attributes.color) {
        const colors = new Float32Array(geo.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) part.material.color.toArray(colors, i);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      bone.remove(part);
      return geo;
    });
    bone.add(mergeGeo(geometries, fabric));
  }
  batchClothing(root);
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
    const flipTuck = Math.sin((st.jumpPhase || 0) * Math.PI);
    const c = U.clamp(0.44 + st.compression * 0.55 + st.tuck * 0.5 + flipTuck * 0.75, 0, 1.35);
    const thighPitch = 0.18 + c * 0.62;
    const kneePitch = 0.22 + c * 1.6;
    const bootPitch = kneePitch - thighPitch;
    // 腿部链路缩短量 = 髋部下坠量（保证雪板贴雪）
    const legReach = 0.40 * Math.cos(thighPitch) + 0.40 * Math.cos(kneePitch - thighPitch);
    body.position.y = -(0.80 - legReach);
    body.rotation.set(0, 0, 0);

    for (const leg of legs) {
      leg.hip.position.set(leg === legL ? -HIP_X : HIP_X, HIP_Y, 0);
      leg.hip.rotation.x = thighPitch;
      leg.knee.rotation.x = -kneePitch;
      leg.bootG.rotation.x = bootPitch;
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
    const spread = 0.50 - t * 0.22 - flipTuck * 0.18;
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
    if (st.jumpHeight > 0) {
      for (const leg of legs) {
        leg.hip.rotation.x += flipTuck * 0.72;
        leg.knee.rotation.x -= flipTuck * 0.34;
      }
      for (const arm of [armL, armR]) {
        arm.arm.rotation.x += flipTuck * 0.64;
        arm.elbow.rotation.x += flipTuck * 0.58;
      }
      // Rotate the complete rig around the hips after solving its ground pose.
      root.position.y += st.jumpHeight;
      root.translateY(0.72);
      root.rotateX(-2 * Math.PI * U.smoothstep(0, 1, st.jumpPhase));
      root.translateY(-0.72);
    }
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
