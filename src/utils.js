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

// Integrate the smooth change in grade. Its derivative stays bounded at any distance.
const START_GRADE = Math.tan(U.deg(CFG.SLOPE_MIN_DEG));
const GRADE_CHANGE = Math.tan(U.deg(CFG.SLOPE_MAX_DEG)) - START_GRADE;
function terrainHeight(x, z, seed) {
  const distance = Math.max(0, -z);
  const t = Math.min(1, distance / CFG.DIFF_DIST);
  const integral = CFG.DIFF_DIST * t * t * t * (1 - t * 0.5) + Math.max(0, distance - CFG.DIFF_DIST);
  let h = z * START_GRADE - GRADE_CHANGE * integral;
  h += fbm(x * 0.012, z * 0.012, 3, seed) * 2.8;
  h += fbm(x * 0.045 + 31.7, z * 0.034, 2, seed + 7) * 0.48;
  // 走廊边缘的风唇
  const a = Math.abs(x);
  if (a > 34) {
    h += U.smoothstep(34, 42, a) * (vnoise2(x * 0.15, z * 0.06, seed + 91) * 1.6);
  }
  // 两岸雪堤 / 岩壁（越往外越陡，形成天然谷道；坡度放缓避免大面积投影）
  if (a > CFG.BANK_START) {
    const t = a - CFG.BANK_START;
    const rock = 0.5 + 0.5 * fbm(x * 0.045, z * 0.045, 3, seed + 13);
    const shoulder = x > 0 ? 0.48 : 0.12;
    const fold = 0.75 + 0.25 * Math.cos(z * 0.017 + (seed % 19));
    h += t * shoulder * fold * (0.55 + rock) + U.smoothstep(0, 28, t) * rock * 3.5;
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

// Each 300 m sector joins the next at x=0 with level tangents.
// The last bend has a narrow, straight inside line and a wider outside arc.
const COURSE_LENGTH = 300;
// Stretch later sectors to keep their turn radius reachable at terminal speed.
const LONG_SECTOR = 480;
function sectorAt(distance) {
  return distance < COURSE_LENGTH ? 0 : 1 + Math.floor((distance - COURSE_LENGTH) / LONG_SECTOR);
}
function sectorDistance(sector, local) {
  return sector === 0 ? local : COURSE_LENGTH + (sector - 1) * LONG_SECTOR + local * LONG_SECTOR / COURSE_LENGTH;
}
const COURSE_KNOTS = [0, 30, 74, 131, 184, 222, 261, 300];
const COURSE_OFFSETS = [0, 0, 12, -12, 11, 0, 15, 0];
function courseAt(distance, seed, out) {
  const d = Math.max(0, distance);
  const sector = sectorAt(d);
  const local = (d - sectorDistance(sector, 0)) * (sector ? COURSE_LENGTH / LONG_SECTOR : 1);
  const variation = hash2i(sector, 51, seed);
  const scale = (variation < 0.5 ? -1 : 1) * (0.82 + 0.18 * Math.abs(2 * variation - 1));
  let i = 0;
  while (local >= COURSE_KNOTS[i + 1]) i++;
  const phase = (local - COURSE_KNOTS[i]) / (COURSE_KNOTS[i + 1] - COURSE_KNOTS[i]);
  const t = (1 - Math.cos(phase * Math.PI)) * 0.5;
  out.x = scale * U.lerp(COURSE_OFFSETS[i], COURSE_OFFSETS[i + 1], t);
  out.width = U.lerp(6.8, 4.2, difficultyAt(-d));
  out.shortcut = local >= 222;
  return out;
}
