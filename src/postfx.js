/* ================= postfx.js ================= */
// 自研后处理链（不依赖 three addons）：
// 场景(HDR) → 提亮(1/4) → 双向高斯模糊 → 合成(泛光+ACES色调映射+边缘平滑+暗角+颗粒)
'use strict';

function makePostFX(renderer, scene, camera) {
  const QUAD = new THREE.Scene();
  const QCAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const QGEO = new THREE.PlaneGeometry(2, 2);
  let quad = new THREE.Mesh(QGEO, null);
  quad.frustumCulled = false;
  QUAD.add(quad);

  let W = 2, H = 2;

  const gl = renderer.getContext();
  const halfFloat = renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
  let quality = 2;

  const mkRT = (w, h, opt) => new THREE.WebGLRenderTarget(
    Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)),
    Object.assign({
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: true, stencilBuffer: false,
    }, opt)
  );

  let rtScene, rtA, rtB;
  function alloc() {
    if (rtScene) rtScene.dispose();
    if (rtA) { rtA.dispose(); rtB.dispose(); rtA = rtB = null; }
    rtScene = mkRT(W, H, halfFloat ? { type: THREE.HalfFloatType } : {});
    if (quality < 2) return;
    rtA = mkRT(W / 4, H / 4, halfFloat ? { type: THREE.HalfFloatType, depthBuffer: false } : { depthBuffer: false });
    rtB = mkRT(W / 4, H / 4, halfFloat ? { type: THREE.HalfFloatType, depthBuffer: false } : { depthBuffer: false });
  }

  const VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  // ---- 提亮 ----
  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tD: { value: null }, uThresh: { value: 1.35 }, uKnee: { value: 0.75 },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tD; uniform float uThresh, uKnee;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tD, vUv).rgb;
        float br = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float f = smoothstep(uThresh, uThresh + uKnee, br);
        gl_FragColor = vec4(c * f, 1.0);
      }
    `,
  });

  // ---- 高斯模糊 ----
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tD: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tD; uniform vec2 uDir;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tD, vUv).rgb * 0.2270270270;
        c += texture2D(tD, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
        c += texture2D(tD, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
        c += texture2D(tD, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
        c += texture2D(tD, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });

  // ---- 合成：泛光 + ACES + 边缘平滑 + 暗角 + 颗粒 ----
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tD: { value: null }, tB: { value: null },
      uBloom: { value: 0.10 }, uExposure: { value: 1.10 },
      uRcp: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uGrain: { value: 0.003 }, uAA: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tD, tB;
      uniform float uBloom, uExposure, uTime, uGrain, uAA;
      uniform vec2 uRcp;
      varying vec2 vUv;

      vec3 acesFilm(vec3 x) {
        mat3 IN = mat3(
          0.59719, 0.07600, 0.02840,
          0.35458, 0.90834, 0.13383,
          0.04823, 0.01566, 0.83777
        );
        mat3 OUT = mat3(
           1.60475, -0.10208, -0.00327,
          -0.53108,  1.10813, -0.07276,
          -0.07367, -0.00605,  1.07602
        );
        vec3 v = IN * x;
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return clamp(OUT * (a / b), 0.0, 1.0);
      }
      vec3 toOut(vec3 hdr) {
        return pow(acesFilm(hdr * uExposure), vec3(1.0 / 2.2));
      }
      float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

      void main() {
        vec3 hdr = texture2D(tD, vUv).rgb;
        if (uAA > 0.5) {
          vec3 l = texture2D(tD, vUv - vec2(uRcp.x, 0.)).rgb;
          vec3 r = texture2D(tD, vUv + vec2(uRcp.x, 0.)).rgb;
          vec3 u = texture2D(tD, vUv + vec2(0., uRcp.y)).rgb;
          vec3 d = texture2D(tD, vUv - vec2(0., uRcp.y)).rgb;
          float edge = abs(lumaOf(l-r)) + abs(lumaOf(u-d));
          hdr = mix(hdr, (l+r+u+d)*0.25, 0.35*smoothstep(0.12, 0.55, edge));
        }
        if (uBloom > 0.0) hdr += texture2D(tB, vUv).rgb * uBloom;
        vec3 col = toOut(hdr);
        // 质感调色：柔和对比 + 饱和 + 冷暖分区（阴影偏蓝、高光偏暖）
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.20);
        float lu = lumaOf(col);
        col = mix(vec3(lu), col, 0.99);
        col += (1.0 - lu) * vec3(0.012, 0.022, 0.040);
        col *= mix(vec3(1.0), vec3(1.012, 1.005, 0.995), lu);
        // 暗角
        vec2 q = vUv - 0.5;
        float vig = 1.0 - 0.095 * smoothstep(0.35, 1.05, length(q) * 1.55);
        col *= vig;
        // 颗粒
        float g = fract(sin(dot(vUv * (1.0 + uTime * 0.001), vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  function setSize(w, h) {
    if (rtScene && W === w && H === h && !!rtA === (quality === 2)) return;
    W = w; H = h; alloc();
  }

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(QUAD, QCAM);
  }

  function render(time) {
    compMat.uniforms.uTime.value = time;
    compMat.uniforms.uRcp.value.set(1 / W, 1 / H);

    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    if (rtA) {
      brightMat.uniforms.tD.value = rtScene.texture;
      pass(brightMat, rtA);

      blurMat.uniforms.tD.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(1.35 / rtA.width, 0);
      pass(blurMat, rtB);
      blurMat.uniforms.tD.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, 1.35 / rtA.height);
      pass(blurMat, rtA);

    }
    compMat.uniforms.tD.value = rtScene.texture;
    compMat.uniforms.tB.value = rtA ? rtA.texture : null;
    compMat.uniforms.uBloom.value = rtA ? 0.12 : 0;
    compMat.uniforms.uAA.value = quality > 0 ? 1 : 0;
    pass(compMat, null);
  }

  function setQuality(q) { quality = q; }
  return { render, setSize, setQuality, get enabled() { return true; } };
}
