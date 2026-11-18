/* ================= terrain.js ================= */
// 无限分块雪原：
//   · 非均匀网格——走廊内 ~0.9m/格（精细），两侧堤外 ~3m/格（省资源）
//   · 法线用网格高度差分计算（块边界用解析差分保证无缝）
//   · 生成任务按行切片、分帧推进（update(ms) 预算制），彻底消除重建卡顿
//   · 材质注入雪面闪光 + 微细法线扰动 + 冷调菲涅尔
'use strict';

const terrainTimeUniform = { value: 0 };

function makeTerrain(scene, seed) {
  const W_HALF = 88;
  const W_SEG = 88, Z_SEG = 64, L = CFG.CHUNK_LEN;
  const COLS = W_SEG + 1, ROWS = Z_SEG + 1;

  // 列坐标：|t|^1.55 幂分布，中心密两端疏
  const colX = new Float32Array(COLS);
  for (let ix = 0; ix < COLS; ix++) {
    const t = -1 + (2 * ix) / W_SEG;
    colX[ix] = Math.sign(t) * Math.pow(Math.abs(t), 1.55) * W_HALF;
  }

  // ---- 材质 ----
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = terrainTimeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vWP;',
        'uniform float uTime;',
        'float sphHash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }',
      ].join('\n'))
      .replace('#include <dithering_fragment>', [
        '{',
        '  vec3 cell = floor(vWP * 6.0);',
        // 微细法线扰动：雪面颗粒起伏感
        '  vec3 mj = vec3(sphHash(cell + 7.1), sphHash(cell + 8.3), sphHash(cell + 9.7)) - 0.5;',
        '  normal = normalize(normal + mj * 0.10);',
        // 闪光晶粒
        '  float tw = sphHash(cell + floor(uTime * 3.0) * 0.37);',
        '  if (tw > 0.9958) {',
        '    vec3 vd = normalize(cameraPosition - vWP);',
        '    vec3 jitterN = normalize(normal + vec3(sphHash(cell + 1.7) - 0.5, sphHash(cell + 2.3) - 0.5, sphHash(cell + 3.1) - 0.5) * 0.3);',
        '    float glint = pow(max(dot(vd, jitterN), 0.0), 26.0);',
        '    gl_FragColor.rgb += vec3(1.5, 1.38, 1.15) * glint * 1.35;',
        '  }',
        '  vec3 vd2 = normalize(cameraPosition - vWP);',
        '  float fres = pow(1.0 - max(dot(vd2, normal), 0.0), 3.0);',
        '  gl_FragColor.rgb += vec3(0.35, 0.5, 0.75) * fres * 0.10;',
        '}',
        '#include <dithering_fragment>',
      ].join('\n'));
  };

  // ---- 颜色表（线性）----
  const COL_SNOW = new THREE.Color('#f4f7fb').convertSRGBToLinear();
  const COL_SNOW_BLUE = new THREE.Color('#c9dcee').convertSRGBToLinear();
  const COL_ROCK = new THREE.Color('#8d857b').convertSRGBToLinear();
  const COL_ROCK_DARK = new THREE.Color('#6e675f').convertSRGBToLinear();
  const tmpCol = new THREE.Color();
  const nrm = new THREE.Vector3();

  // ---- 网格池 + 构建队列 ----
  const chunks = new Map();   // k -> {mesh, k}（已完成）
  const pool = [];
  const buildQueue = [];      // 待处理任务
  let activeJob = null;       // 在途任务（独占 scratchH，不被排序打断）
  const scratchH = new Float32Array(COLS * ROWS);

  function newChunkMesh() {
    const geo = new THREE.BufferGeometry();
    const verts = COLS * ROWS;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    const idx = [];
    for (let iz = 0; iz < Z_SEG; iz++) {
      for (let ix = 0; ix < W_SEG; ix++) {
        const a = iz * COLS + ix;
        const b = a + 1;
        const c = a + COLS;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);   // 从上方看逆时针，法线朝上
      }
    }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;      // 构建完成前不渲染
    scene.add(mesh);
    return { mesh, k: -1 };
  }

  function rangeFor(playerZ) {
    const pk = Math.max(0, Math.floor(-playerZ / L));
    return [Math.max(0, pk - CFG.CHUNKS_BEHIND), pk + CFG.CHUNKS_AHEAD];
  }

  function ensure(playerZ) {
    const [kLo, kHi] = rangeFor(playerZ);
    const pk = Math.max(0, Math.floor(-playerZ / L));
    for (const [k, c] of chunks) {
      if (k < kLo || k > kHi) {
        chunks.delete(k);
        c.mesh.visible = false;
        pool.push(c);
      }
    }
    for (let k = kLo; k <= kHi; k++) {
      if (chunks.has(k) || (activeJob && activeJob.k === k) || buildQueue.some((j) => j.k === k)) continue;
      const c = pool.pop() || newChunkMesh();
      c.mesh.visible = false;
      buildQueue.push({ c, k, phase: 0, iz: 0 });
    }
    buildQueue.sort((a, b) => Math.abs(a.k - pk) - Math.abs(b.k - pk)); // 近处优先
  }

  function stepOneRow(job) {   // 返回 true 表示该块完成
    if (job.phase === 0) {
      const pos = job.c.mesh.geometry.attributes.position;
      const zTop = -job.k * L;
      const iz = job.iz;
      const z = zTop - (iz / Z_SEG) * L;
      const base = iz * COLS;
      for (let ix = 0; ix < COLS; ix++) {
        const h = terrainHeight(colX[ix], z, seed);
        scratchH[base + ix] = h;
        pos.setXYZ(base + ix, colX[ix], h, z);
      }
      job.iz++;
      if (job.iz >= ROWS) { job.phase = 1; job.iz = 0; }
      return false;
    }
    writeNormalColorRow(job, job.iz);
    job.iz++;
    return job.iz >= ROWS;
  }

  function writeNormalColorRow(job, iz) {
    const geo = job.c.mesh.geometry;
    const nor = geo.attributes.normal;
    const col = geo.attributes.color;
    const zTop = -job.k * L;
    const z = zTop - (iz / Z_SEG) * L;
    const base = iz * COLS;
    const zUp = zTop - ((iz - 1) / Z_SEG) * L;
    const zDn = zTop - ((iz + 1) / Z_SEG) * L;
    for (let ix = 0; ix < COLS; ix++) {
      let nx, ny, nzD;
      if (iz === 0 || iz === Z_SEG || ix === 0 || ix === W_SEG) {
        // 边界：解析差分，与相邻块严格一致
        terrainNormalAt(colX[ix], z, seed, nrm);
        nx = nrm.x; ny = nrm.y; nzD = nrm.z;
      } else {
        const hL = scratchH[base + ix - 1], hR = scratchH[base + ix + 1];
        const hU = scratchH[base + ix - COLS], hD = scratchH[base + ix + COLS];
        const dx = (hR - hL) / (colX[ix + 1] - colX[ix - 1]);
        const dz = (hD - hU) / (zDn - zUp);
        const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        nx = -dx * inv; ny = inv; nzD = -dz * inv;
      }
      nor.setXYZ(base + ix, nx, ny, nzD);
      // 颜色
      const x = colX[ix];
      const scoured = 0.5 + 0.5 * fbm(x * 0.11, z * 0.11, 2, seed + 3);
      tmpCol.copy(COL_SNOW).lerp(COL_SNOW_BLUE, scoured * 0.4);
      const rockMix = U.smoothstep(0.8, 0.6, ny) * (0.55 + 0.45 * fbm(x * 0.13 + 5, z * 0.13, 2, seed + 17));
      if (rockMix > 0.001) {
        tmpCol.lerp(COL_ROCK, rockMix).lerp(COL_ROCK_DARK, rockMix * 0.4);
      }
      const sheen = 0.94 + 0.06 * fbm(x * 0.02, z * 0.05, 2, seed + 29);
      col.setXYZ(base + ix, tmpCol.r * sheen, tmpCol.g * sheen, tmpCol.b * sheen);
    }
  }

  function finishJob(job) {
    const g = job.c.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.computeBoundingSphere();
    job.c.k = job.k;
    job.c.mesh.visible = true;
    chunks.set(job.k, job.c);
  }

  // 每帧调用：按时间预算（ms）推进构建，不卡帧。
  // 在途任务单独持有，队列可随时重排序/清理而不破坏共享 scratch。
  function update(budgetMs) {
    const deadline = performance.now() + budgetMs;
    while ((activeJob || buildQueue.length) && performance.now() < deadline) {
      if (!activeJob) activeJob = buildQueue.shift();
      while (performance.now() < deadline) {
        if (stepOneRow(activeJob)) {
          finishJob(activeJob);
          activeJob = null;
          break;
        }
      }
    }
  }

  function reset(newSeed) {
    seed = newSeed;
    buildQueue.length = 0;
    if (activeJob) { pool.push(activeJob.c); activeJob = null; }
    for (const c of chunks.values()) { c.mesh.visible = false; pool.push(c); }
    chunks.clear();
    ensure(0);
  }

  return {
    ensure,
    update,
    reset,
    mat,
    rangeFor,
    get pending() { return buildQueue.length + (activeJob ? 1 : 0); },
  };
}
