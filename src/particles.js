/* ================= particles.js ================= */
// 雪雾喷溅（雪板尾迹）+ 空中飘雪，全部 CPU 模拟 + 自定义点着色器
'use strict';

function makeParticles(scene) {
  const softVS = `
    attribute float aSize;
    attribute float aAlpha;
    varying float vA;
    void main() {
      vA = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (170.0 / max(1.0, -mv.z));
      gl_Position = projectionMatrix * mv;
    }`;
  const softFS = `
    uniform vec3 uTint;
    varying float vA;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float a = smoothstep(0.5, 0.1, length(d)) * vA;
      if (a < 0.012) discard;
      gl_FragColor = vec4(uTint, a);
    }`;

  function makePoints(max, tint, opacity) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3);
    const size = new Float32Array(max);
    const alpha = new Float32Array(max);
    for (let i = 0; i < max; i++) { pos[i * 3 + 1] = -9999; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(tint).convertSRGBToLinear() } },
      vertexShader: softVS, fragmentShader: softFS,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { geo, pos, size, alpha, pts, mat, max };
  }

  // ---- 雪雾喷溅 ----
  const spray = makePoints(CFG.SPRAY_MAX, '#fff6ea', 1);
  const sVel = new Float32Array(CFG.SPRAY_MAX * 3);
  const sLife = new Float32Array(CFG.SPRAY_MAX);
  const sLifeMax = new Float32Array(CFG.SPRAY_MAX);
  let sHead = 0;

  function emitSpray(x, y, z, backX, backZ, sideX, sideZ, power, speed) {
    const n = Math.min(14, Math.ceil(power * 12));
    for (let j = 0; j < n; j++) {
      const i = sHead; sHead = (sHead + 1) % CFG.SPRAY_MAX;
      const sc = 0.4 + Math.random() * 0.9;
      sVel[i * 3]     = (backX * (0.8 + Math.random() * 1.6) + sideX * sc * 2.2) * (0.5 + power);
      sVel[i * 3 + 1] = (1.1 + Math.random() * 2.6) * (0.45 + power * 0.8);
      sVel[i * 3 + 2] = (backZ * (0.8 + Math.random() * 1.6) + sideZ * sc * 2.2) * (0.5 + power);
      spray.pos[i * 3] = x + (Math.random() - 0.5) * 0.25;
      spray.pos[i * 3 + 1] = y + 0.06;
      spray.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.25;
      sLifeMax[i] = 0.35 + Math.random() * 0.5;
      sLife[i] = sLifeMax[i];
      spray.size[i] = (0.28 + Math.random() * 0.5) * (0.7 + power * 0.7);
    }
  }

  function emitBurst(x, y, z, power) {
    for (let j = 0; j < 90; j++) {
      const i = sHead; sHead = (sHead + 1) % CFG.SPRAY_MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      sVel[i * 3] = Math.cos(a) * r * 4.5 * power;
      sVel[i * 3 + 1] = (1.5 + Math.random() * 4.0) * power;
      sVel[i * 3 + 2] = Math.sin(a) * r * 4.5 * power;
      spray.pos[i * 3] = x; spray.pos[i * 3 + 1] = y + 0.3; spray.pos[i * 3 + 2] = z;
      sLifeMax[i] = 0.6 + Math.random() * 0.7;
      sLife[i] = sLifeMax[i];
      spray.size[i] = 0.35 + Math.random() * 0.75;
    }
  }

  function updateSpray(dt) {
    const g = 9.8 * 0.55;
    for (let i = 0; i < CFG.SPRAY_MAX; i++) {
      if (sLife[i] <= 0) { spray.alpha[i] = 0; continue; }
      sLife[i] -= dt;
      sVel[i * 3 + 1] -= g * dt;
      sVel[i * 3] *= (1 - 1.6 * dt); sVel[i * 3 + 2] *= (1 - 1.6 * dt);
      spray.pos[i * 3] += sVel[i * 3] * dt;
      spray.pos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
      spray.pos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
      const t = sLife[i] / sLifeMax[i];
      spray.alpha[i] = Math.min(1, t * 1.8) * 0.85;
    }
    spray.geo.attributes.position.needsUpdate = true;
    spray.geo.attributes.aSize.needsUpdate = true;
    spray.geo.attributes.aAlpha.needsUpdate = true;
  }

  // ---- 空中飘雪 ----
  const drift = makePoints(CFG.DRIFT_MAX, '#e8f1fb', 1);
  const dMeta = [];
  const BOX = { x: 70, y: 44, z: 80 };
  function resetDrift(cx, cy, cz) {
    sLife.fill(0);
    sHead = 0;
    for (let i = 0; i < CFG.DRIFT_MAX; i++) {
      drift.pos[i * 3] = cx + (Math.random() - 0.5) * BOX.x * 2;
      drift.pos[i * 3 + 1] = cy + (Math.random() - 0.5) * BOX.y;
      drift.pos[i * 3 + 2] = cz + (Math.random() - 0.5) * BOX.z * 2;
      drift.size[i] = 0.10 + Math.random() * 0.16;
      drift.alpha[i] = 0.22 + Math.random() * 0.3;
      dMeta[i] = { f: 0.7 + Math.random() * 1.2, ph: Math.random() * 6.28 };
    }
  }
  let driftTime = 0;
  function updateDrift(dt, cam) {
    driftTime += dt;
    for (let i = 0; i < CFG.DRIFT_MAX; i++) {
      const m = dMeta[i];
      drift.pos[i * 3 + 1] -= m.f * dt;
      drift.pos[i * 3] += Math.sin(driftTime * 0.7 + m.ph) * 0.5 * dt;
      // 盒子包裹回绕
      if (drift.pos[i * 3 + 1] < cam.y - BOX.y * 0.45) {
        drift.pos[i * 3 + 1] = cam.y + BOX.y * 0.55;
        drift.pos[i * 3] = cam.x + (Math.random() - 0.5) * BOX.x * 2;
        drift.pos[i * 3 + 2] = cam.z + (Math.random() - 0.5) * BOX.z * 2;
      }
      wrapAxis(i, 0, cam.x, BOX.x);
      wrapAxis(i, 2, cam.z, BOX.z);
    }
    drift.geo.attributes.position.needsUpdate = true;
  }
  function wrapAxis(i, o, c, half) {
    const d = drift.pos[i * 3 + o] - c;
    if (d > half) drift.pos[i * 3 + o] -= half * 2;
    else if (d < -half) drift.pos[i * 3 + o] += half * 2;
  }

  return {
    emitSpray, emitBurst, updateSpray, updateDrift, resetDrift,
    sprayPoints: spray.pts,
    driftPoints: drift.pts,
  };
}

// Fixed-size strips following the two grounded tails. Each contact fades in place.
function makeTracks(scene) {
  const capacity = 420;
  const positions = new Float32Array(capacity * 12 * 3);
  const born = new Float32Array(capacity * 12);
  const geo = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const stamps = new THREE.BufferAttribute(born, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', position);
  geo.setAttribute('born', stamps);
  const across = new Float32Array(capacity * 12);
  for (let i = 0; i < across.length; i += 6) across.set([-1, 1, -1, -1, 1, 1], i);
  geo.setAttribute('across', new THREE.BufferAttribute(across, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: terrainTimeUniform },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `
      attribute float born, across;
      uniform float time;
      varying float fade, edge;
      void main() {
        edge = across;
        fade = 1. - smoothstep(1., 5., time - born);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      varying float fade, edge;
      void main() {
        float cut = 1. - smoothstep(0.05, 0.84, abs(edge + 0.22));
        float lip = 1. - smoothstep(0., 0.32, abs(edge - 0.57));
        vec3 tint = mix(vec3(0.30,0.42,0.53), vec3(1.12,1.15,1.18), lip);
        gl_FragColor = vec4(tint, fade * (0.24 * cut + 0.29 * lip));
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let cursor = 0, count = 0, started = false;
  const prev = [new THREE.Vector3(), new THREE.Vector3()];
  function reset() {
    count = cursor = 0; started = false;
    geo.setDrawRange(0, 0);
  }
  function put(index, point, dx, dz, stamp) {
    position.setXYZ(index, point.x + dx, point.y + 0.015, point.z + dz);
    born[index] = stamp;
  }
  function append(tails, heading, now) {
    if (started && prev[0].distanceToSquared(tails[0]) < 0.09) return;
    if (started) {
        const dx = Math.cos(heading) * 0.074, dz = -Math.sin(heading) * 0.074;
      let v = cursor * 12;
      for (let i = 0; i < 2; i++) {
        const a = prev[i], b = tails[i];
        put(v++, a, -dx, -dz, now);
        put(v++, a, dx, dz, now);
        put(v++, b, -dx, -dz, now);
        put(v++, b, -dx, -dz, now);
        put(v++, a, dx, dz, now);
        put(v++, b, dx, dz, now);
      }
      position.needsUpdate = stamps.needsUpdate = true;
      cursor = (cursor + 1) % capacity;
      count = Math.min(capacity, count + 1);
      geo.setDrawRange(0, count * 12);
    }
    prev[0].copy(tails[0]); prev[1].copy(tails[1]); started = true;
  }
  reset();
    return { append, reset, breakLine() { started = false; } };
}
