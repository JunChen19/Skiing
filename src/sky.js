/* ================= sky.js ================= */
// 程序化天空：渐变穹顶 + 太阳 + 云朵 sprite + 远山剪影环
'use strict';

function makeSky(scene, seed) {
  // 太阳在侧后方（摄像机一侧偏左、略高）——雪面顺光更亮，树影拉向前方
  const sunDir = new THREE.Vector3(-0.34, 0.52, 0.78).normalize();

  // ---- 穹顶 ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir },
      uZenith: { value: new THREE.Color('#1d4b7e').convertSRGBToLinear() },
      uMid:    { value: new THREE.Color('#6d94b8').convertSRGBToLinear() },
      uHorizon:{ value: new THREE.Color('#eccda4').convertSRGBToLinear() },
      uSunCol: { value: new THREE.Color('#fff3d6').convertSRGBToLinear() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir, uZenith, uMid, uHorizon, uSunCol;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float t = dir.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.00, 0.16, t));
        col = mix(col, uZenith, smoothstep(0.12, 0.55, t));
        // 地平线下沉入暖霾
        col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.12, t));

        float d = max(dot(dir, uSunDir), 0.0);
        // 太阳盘面（HDR，喂给泛光）
        float disc = smoothstep(0.99935, 0.99965, d);
        // 双层光晕
        float glow = pow(d, 220.0) * 0.9 + pow(d, 9.0) * 0.22;
        col += uSunCol * (disc * 5.0 + glow);

        // 太阳方位的地平线暖化
        vec3 ha = normalize(vec3(dir.x, 0.0, dir.z));
        vec3 sa = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
        float warm = pow(max(dot(ha, sa), 0.0), 3.0);
        col += uSunCol * 0.14 * warm * smoothstep(0.30, 0.0, abs(t));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 20), skyMat);
  skyMesh.renderOrder = -100;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  // ---- 云朵（运行时 canvas 生成，无图片文件）----
  function cloudTexture() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    const rng = mulberry32(seed + 777);
    for (let i = 0; i < 26; i++) {
      const x = 40 + rng() * 176, y = 55 + rng() * 40;
      const r = 14 + rng() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,250,242,0.55)');
      gr.addColorStop(1, 'rgba(255,250,242,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }
  const cloudTex = cloudTexture();
  const clouds = [];
  const cloudGroup = new THREE.Group();
  scene.add(cloudGroup);
  const rngC = mulberry32(seed + 31);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(m);
    const sc = 150 + rngC() * 220;
    s.scale.set(sc, sc * 0.42, 1);
    s.position.set((rngC() - 0.5) * 1300, 110 + rngC() * 130, -120 - rngC() * 950);
    s.renderOrder = -90;
    cloudGroup.add(s);
    clouds.push({ s, drift: 1.5 + rngC() * 2.5 });
  }

  // ---- 远山剪影环（两层，暖霾色）----
  function ridgeRing(radius, baseH, amp, color, seedOff) {
    const N = 160;
    const pos = new Float32Array(N * 2 * 3);
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const h0 = baseH + Math.abs(fbm(Math.cos(a0) * 3.1, Math.sin(a0) * 3.1, 4, seed + seedOff)) * amp + Math.abs(fbm(Math.cos(a0) * 9.7, Math.sin(a0) * 9.7, 3, seed + seedOff + 9)) * amp * 0.3;
      const h1 = baseH + Math.abs(fbm(Math.cos(a1) * 3.1, Math.sin(a1) * 3.1, 4, seed + seedOff)) * amp + Math.abs(fbm(Math.cos(a1) * 9.7, Math.sin(a1) * 9.7, 3, seed + seedOff + 9)) * amp * 0.3;
      const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
      const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
      const o = i * 6;
      pos[o + 0] = x0; pos[o + 1] = h0; pos[o + 2] = z0;
      pos[o + 3] = x0; pos[o + 4] = -60; pos[o + 5] = z0;
      pos[o + 6] = x1; pos[o + 7] = h1; pos[o + 8] = z1;
      pos[o + 9] = x1; pos[o + 10] = -60; pos[o + 11] = z1;
      // 两点一条带，退化三角形避免索引翻面
      idx.push(o / 3, o / 3 + 1, o / 3 + 2, o / 3 + 2, o / 3 + 1, o / 3 + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).convertSRGBToLinear(),
      side: THREE.DoubleSide, fog: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -95;
    mesh.frustumCulled = false;
    return mesh;
  }
  const ridge1 = ridgeRing(1050, 55, 190, '#c3ab8e', 401);
  const ridge2 = ridgeRing(760, 40, 130, '#ad9980', 807);
  scene.add(ridge1, ridge2);

  return {
    sunDir,
    update(camera, dt, playerZ) {
      skyMesh.position.copy(camera.position);
      ridge1.position.set(camera.position.x, camera.position.y, camera.position.z);
      ridge2.position.set(camera.position.x, camera.position.y, camera.position.z);
      // 云随相机推进回收
      for (const c of clouds) {
        c.s.position.x += c.drift * dt;
        const rel = c.s.position.z - playerZ;
        if (rel > 60) {
          c.s.position.z = playerZ - 800 - Math.random() * 500;
          c.s.position.x = (Math.random() - 0.5) * 1300;
        }
      }
    },
  };
}
