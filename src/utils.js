/* ================= utils.js ================= */
// 数学 / 噪声 / 地形高度场（全游戏共享的唯一“真值”函数）
'use strict';

const U = {
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  smoothstep(a, b, t) {
    t = U.clamp((t - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  },
  // 帧率无关的指数平滑
  damp(cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  },
  sat(v) { return U.clamp(v, 0, 1); },
  deg(d) { return d * Math.PI / 180; },
};

// 确定性 2D 整数哈希 → [0,1)
function hash2i(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// 平滑值噪声 [0,1]
function vnoise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  return U.lerp(U.lerp(a, b, ux), U.lerp(c, d, ux), uz);
}

// 分形噪声 [-1,1]
function fbm(x, z, oct, seed, lac, gain) {
  lac = lac || 2.03; gain = gain || 0.5;
  let sum = 0, amp = 1, norm = 0, fx = x, fz = z;
  for (let i = 0; i < oct; i++) {
    sum += amp * (vnoise2(fx, fz, seed + i * 101) * 2 - 1);
    norm += amp;
    amp *= gain; fx *= lac; fz *= lac;
  }
  return sum / norm;
}

// mulberry32 PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 地形难度与坡度 ----
// 玩家从 z=0 向 -Z 滑行，滑行距离 = -z
function difficultyAt(z) {
  return U.smoothstep(0, 1, U.clamp(-z / CFG.DIFF_DIST, 0, 1));
}

// 坡度（度），随难度增加 + 低频起伏 ±22%
function slopeDegAt(z, seed) {
  const d = difficultyAt(z);
  const deg = U.lerp(CFG.SLOPE_MIN_DEG, CFG.SLOPE_MAX_DEG, d);
  const wig = (vnoise2(z * 0.0031, 0.37, seed + 55) - 0.5) * 0.45;
  return deg * (1 + wig);
}

// ---- 唯一权威地形高度函数（网格 / 物理 / 树木摆放全用它）----
function terrainHeight(x, z, seed) {
  const grade = Math.tan(U.deg(slopeDegAt(z, seed)));
  let h = z * grade;

  // 大起伏（滚落线雪包）：幅度/频率调校为保证整体持续下坡，
  // 噪声最大斜率(~amp*freq*3)须小于基础坡度，避免出现平坡/上坡刹车段
  h -= fbm(x * 0.012, z * 0.012, 4, seed) * 5.2;
  // 中细节
  h += fbm(x * 0.05 + 31.7, z * 0.05, 3, seed + 7) * 1.5;
  // 走廊边缘的风唇
  const a = Math.abs(x);
  if (a > 34) {
    h += U.smoothstep(34, 42, a) * (vnoise2(x * 0.15, z * 0.06, seed + 91) * 1.6);
  }
  // 两岸雪堤 / 岩壁（越往外越陡，形成天然谷道；坡度放缓避免大面积投影）
  if (a > CFG.BANK_START) {
    const t = a - CFG.BANK_START;
    const rock = 0.5 + 0.5 * fbm(x * 0.045, z * 0.045, 3, seed + 13);
    h += t * t * 0.036 + t * rock * 0.5;
  }
  return h;
}

// 地形法线（解析有限差分，跨块无缝）
const _tn = { hx: 0, hz: 0 };
function terrainNormalAt(x, z, seed, out) {
  const e = 0.35;
  const dx = (terrainHeight(x + e, z, seed) - terrainHeight(x - e, z, seed)) / (2 * e);
  const dz = (terrainHeight(x, z + e, seed) - terrainHeight(x, z - e, seed)) / (2 * e);
  out = out || new THREE.Vector3();
  return out.set(-dx, 1, -dz).normalize();
}
