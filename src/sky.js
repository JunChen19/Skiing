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
      uMid:    { value: new THREE.Color('#89b4cf').convertSRGBToLinear() },
      uHorizon:{ value: new THREE.Color('#dce7ec').convertSRGBToLinear() },
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
      map: cloudTex, transparent: true, opacity: 0.25, depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(m);
    const sc = 150 + rngC() * 220;
    s.scale.set(sc, sc * 0.23, 1);
    s.position.set((rngC() - 0.5) * 1300, 110 + rngC() * 130, -120 - rngC() * 950);
    s.renderOrder = -90;
    cloudGroup.add(s);
    clouds.push({ s, drift: 1.5 + rngC() * 2.5 });
  }

  // Folded ridges. The lower faces converge to the same haze as the piste.
  function ridgeRing(radius, peakHeight, seedOff, distant) {
    const count = 260, rows = 7;
    const positions = [], colors = [];
    const peaks = [], folds = [];
    const haze = scene.fog.color;
    const snow = new THREE.Color(distant ? '#e1ebf2' : '#fff1e5').convertSRGBToLinear();
    const rock = new THREE.Color(distant ? '#8ca7bf' : '#4b6683').convertSRGBToLinear();
    const color = new THREE.Color(), normal = new THREE.Vector3(), edge = new THREE.Vector3();
    const ridgeSeed = seed + seedOff;
    for (let i = 0; i < count; i++) {
      const a = 2 * Math.PI * i / count;
      const x = Math.cos(a), z = Math.sin(a);
      const massif = Math.abs(fbm(x * 3.1, z * 3.1, 3, ridgeSeed));
      const crag = Math.abs(fbm(x * 12, z * 12, 3, ridgeSeed + 19));
      peaks.push(peakHeight * (0.18 + massif * 1.2 + crag * 0.40));
      folds.push(vnoise2(x * 16, z * 16, ridgeSeed + 6));
    }
    function vertex(i, j) {
      const t = j / (rows - 1);
      const angle = i * 2 * Math.PI / count;
      const a = angle + (1 - t) * (0.13 * Math.sin(4 * angle) + (folds[i] - 0.5) * 0.055);
      const r = radius * (0.55 + 0.45 * t + (1 - t) * folds[i] * 0.24);
      return new THREE.Vector3(Math.cos(a) * r, U.lerp(-radius * 0.29, peaks[i], t) + Math.sin(t * Math.PI) * (folds[i] - 0.5) * peakHeight * 0.65, Math.sin(a) * r);
    }
    function face(a, b, c, t, tint) {
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize();
      const light = U.smoothstep(-0.22, 0.68, normal.x * 0.86 + normal.y * 0.60 + (tint - 0.5) * 0.55);
      color.copy(rock).lerp(snow, light * (0.42 + 0.58 * t));
      for (const v of [a, b, c]) {
        positions.push(v.x, v.y, v.z);
        const fade = (distant ? 0.32 : 0.15) + (distant ? 0.68 : 0.85) * U.smoothstep(peakHeight * 0.3, -radius * 0.12, v.y);
        colors.push(U.lerp(color.r, haze.r, fade), U.lerp(color.g, haze.g, fade), U.lerp(color.b, haze.b, fade));
      }
    }
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      for (let j = 0; j < rows - 1; j++) {
        const a = vertex(i, j), b = vertex(next, j), c = vertex(i, j + 1), d = vertex(next, j + 1);
        face(a, b, c, (j + 1) / (rows - 1), folds[i]);
        face(c, b, d, (j + 1) / (rows - 1), folds[next]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      vertexColors: true, side: THREE.DoubleSide, depthWrite: false,
      uniforms: { peak: { value: peakHeight }, relief: { value: distant ? 0.35 : 0.80 } },
      vertexShader: `
        varying vec3 vColor, vRock;
        void main() {
          vColor = color; vRock = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: `
        varying vec3 vColor, vRock;
        uniform float peak, relief;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(27.1, 91.7))) * 17831.43); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.-2.*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        void main() {
          float slope = vRock.x + vRock.z * 0.72 + 0.38*vRock.y;
          vec2 uv = vec2(slope * 0.055, vRock.y * 0.019);
          float seam = noise(uv) + 0.38*noise(uv*3.1);
          float detail = relief * smoothstep(-0.45, 0.2, vRock.y / peak);
          float rock = smoothstep(0.69, 0.99, seam) * (1.-0.55*smoothstep(0.4, 1.1, vRock.y/peak));
          vec3 col = mix(vColor, vColor * vec3(0.54,0.64,0.75), rock * detail);
          col += vec3(0.11,0.12,0.13) * (1.-smoothstep(0.42,0.66,seam))*detail;
          gl_FragColor = vec4(col,1.);
        }`,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = distant ? -96 : -95;
    mesh.frustumCulled = false;
    return mesh;
  }
  const ridge1 = ridgeRing(1220, 265, 401, true);
  const ridge2 = ridgeRing(780, 135, 807, false);
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
