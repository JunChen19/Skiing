/* ================= postfx.js ================= */
// 自研后处理链（不依赖 three addons）：
// 场景(HDR) → 提亮(1/4) → 双向高斯模糊 → 合成(泛光+ACES色调映射+FXAA+暗角+颗粒)
'use strict';

function makePostFX(renderer, scene, camera) {
  const QUAD = new THREE.Scene();
  const QCAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const QGEO = new THREE.PlaneGeometry(2, 2);
  let quad = new THREE.Mesh(QGEO, null);
  quad.frustumCulled = false;
  QUAD.add(quad);

  let enabled = true;
  let W = 2, H = 2;

  const halfFloat = (function () {
    try {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
      rt.dispose();
      return true;
    } catch (e) { return false; }
  })();

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
    if (rtScene) { rtScene.dispose(); rtA.dispose(); rtB.dispose(); }
    rtScene = mkRT(W, H, halfFloat ? { type: THREE.HalfFloatType } : {});
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

  // ---- 合成：泛光 + ACES + FXAA + 暗角 + 颗粒 ----
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tD: { value: null }, tB: { value: null },
      uBloom: { value: 0.55 }, uExposure: { value: 1.0 },
      uRcp: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uGrain: { value: 0.014 },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tD, tB;
      uniform float uBloom, uExposure, uTime, uGrain;
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

      // FXAA（console 版）
      vec3 fxaa(sampler2D tex, vec2 uv) {
        vec3 m  = toOut(texture2D(tex, uv).rgb + texture2D(tB, uv).rgb * uBloom);
        vec3 nw = toOut(texture2D(tex, uv + vec2(-1.0, -1.0) * uRcp).rgb);
        vec3 ne = toOut(texture2D(tex, uv + vec2( 1.0, -1.0) * uRcp).rgb);
        vec3 sw = toOut(texture2D(tex, uv + vec2(-1.0,  1.0) * uRcp).rgb);
        vec3 se = toOut(texture2D(tex, uv + vec2( 1.0,  1.0) * uRcp).rgb);
        float lm = lumaOf(m), lnw = lumaOf(nw), lne = lumaOf(ne), lsw = lumaOf(sw), lse = lumaOf(se);
        float lMin = min(lm, min(min(lnw, lne), min(lsw, lse)));
        float lMax = max(lm, max(max(lnw, lne), max(lsw, lse)));
        if (lMax - lMin < 0.06 * lMax + 0.02) return m;
        vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
        float rcpReduce = 1.0 / (8.0 * (abs(dir.x) + abs(dir.y)) + 0.0001);
        dir = normalize(dir + vec2(0.0001)) * min(abs(dir.x), abs(dir.y)) * rcpReduce * uRcp * 8.0;
        vec3 a = toOut(texture2D(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb);
        vec3 b = toOut(texture2D(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 c = a + b;
        vec3 d = toOut(texture2D(tex, uv + dir * -0.5).rgb);
        vec3 e = toOut(texture2D(tex, uv + dir *  0.5).rgb);
        c = (c + d + e) * 0.25;
        float lc = lumaOf(c);
        if (lc < lMin || lc > lMax) return m;
        return c;
      }

      void main() {
        vec3 col = fxaa(tD, vUv);
        // 质感调色：柔和对比 + 饱和 + 冷暖分区（阴影偏蓝、高光偏暖）
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.20);
        float lu = lumaOf(col);
        col = mix(vec3(lu), col, 1.07);
        col += (1.0 - lu) * vec3(0.012, 0.022, 0.040);
        col *= mix(vec3(1.0), vec3(1.035, 1.010, 0.965), lu);
        // 暗角
        vec2 q = vUv - 0.5;
        float vig = 1.0 - 0.34 * smoothstep(0.35, 1.05, length(q) * 1.55);
        col *= vig;
        // 颗粒
        float g = fract(sin(dot(vUv * (1.0 + uTime * 0.001), vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  function setSize(w, h) { W = w; H = h; alloc(); }

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(QUAD, QCAM);
  }

  function render(time) {
    if (!enabled || !rtScene) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    compMat.uniforms.uTime.value = time;
    compMat.uniforms.uRcp.value.set(1 / W, 1 / H);

    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    brightMat.uniforms.tD.value = rtScene.texture;
    pass(brightMat, rtA);

    blurMat.uniforms.tD.value = rtA.texture;
    blurMat.uniforms.uDir.value.set(1.35 / rtA.width, 0);
    pass(blurMat, rtB);
    blurMat.uniforms.tD.value = rtB.texture;
    blurMat.uniforms.uDir.value.set(0, 1.35 / rtA.height);
    pass(blurMat, rtA);

    compMat.uniforms.tD.value = rtScene.texture;
    compMat.uniforms.tB.value = rtA.texture;
    pass(compMat, null);
  }

  function setEnabled(on) { enabled = on; }

  alloc();
  return { render, setSize, setEnabled, get enabled() { return enabled; } };
}
