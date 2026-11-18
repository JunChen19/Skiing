/* ================= config.js ================= */
// 云端排行榜配置（Supabase，可选）：
// 留空 = 本地排行榜（localStorage，仅本机可见）。
// 配置后 = 全部玩家共享全球排行榜。anon key 是设计为公开的密钥，权限被数据库策略锁死，可以安全出现在前端代码里。
// 详细步骤见 README.md。
window.SKI_CONFIG = {
  SUPABASE_URL: '',        // 例如 'https://abcd1234.supabase.co'
  SUPABASE_ANON_KEY: '',   // 项目 Settings → API 里的 anon public key
};

// 引擎调参（同一构建作用域内的全局常量）
const CFG = {
  // 地形
  CHUNK_LEN: 60,          // 单块地形沿坡长 (m)
  CHUNK_SEG: 48,          // 网格分段
  CHUNKS_BEHIND: 2,
  CHUNKS_AHEAD: 7,         // 前方视野 ~420m，雾在 420m 收尾（减 2 块 = 省 18% 地形开销）
  CORRIDOR: 40,           // 可滑走廊半宽 (m)
  BANK_START: 42,         // 两侧开始起堤的位置
  SLOPE_MIN_DEG: 9.5,      // 起始坡度
  SLOPE_MAX_DEG: 15,       // 满难度坡度
  DIFF_DIST: 3500,         // 难度拉满所需滑行距离 (m)

  // 物理
  G: 9.81,
  START_SPEED: 7,          // 初速 m/s
  MAX_SPEED: 36,           // ~130 km/h
  DRAG_AIR: 0.0016,        // 空气阻力 ~ v²
  FRICTION: 0.021,         // 雪面摩擦（走刃直线）
  SLIP_FRICTION: 0.085,    // 侧滑额外摩擦（转弯泄速，也是玩家的刹车手段）
  TURN_RATE: 3.2,          // 低速最大转向角速度 rad/s
  TURN_SPEED_DAMP: 0.026,  // 转向随速度衰减（高速转弯半径变大，但保持可躲树）
  GRIP: 6.5,               // 速度方向贴合雪板朝向的速率（抓地）
  STEER_SMOOTH: 12,        // 输入平滑
  STEER_EXP: 1.2,          // 摇杆曲线（中心更细腻）
  EDGE_LAT: 0.42,         // 立刃产生的侧向引导加速度因子

  // 障碍
  TREE_ROW_M: 9,          // 行带基础间距 (m)，实际随难度收窄
  TREE_GAP_START: 12,     // 初始可通过间隙宽 (m)
  TREE_GAP_END: 5.6,      // 满时间隙宽
  TREE_DENSITY_START: 0.30,
  TREE_DENSITY_END: 0.94,
  TREE_COLL_R: 0.62,      // 树干碰撞半径（含人体余量）

  // 摄像机
  CAM_BACK: 8.6,
  CAM_UP: 3.3,
  CAM_AHEAD: 6.5,
  CAM_FOV_BASE: 62,
  CAM_FOV_SPEED: 0.09,

  // 粒子
  SPRAY_MAX: 560,
  DRIFT_MAX: 320,

  // 其他
  NEAR_MISS: 1.35,        // 擦树判定距离 (m)
  SLOWMO: 0.24,           // 撞树慢镜头倍率
  CRASH_TIME: 1.9,        // 慢镜头时长 (s)
  BEST_KEY: 'snowline_best',
  NAME_KEY: 'snowline_name',
  MUTE_KEY: 'snowline_mute',
  BOARD_KEY: 'snowline_board',
};
