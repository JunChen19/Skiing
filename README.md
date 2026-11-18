# 雪线 SNOWLINE · 无尽滑雪

网页版 3D 无尽滑雪游戏。单文件 `index.html`，零外部依赖、零图片/模型/音频文件——
地形、天空、树木、人物、光影、粒子、音效**全部由代码实时计算生成**。

- **操控**：桌面移动鼠标、手机按住屏幕左右滑动（也支持 ←→ / A D 键）
- **物理**：真实走刃（carve）模型——立刃转向、抓地/侧滑、坡度加速、空气阻力、刻雪泄速，所有横向移动都来自转向惯性
- **光影**：PBR 材质 + 实时级联阴影 + 雪面闪光着色器 + 自研泛光/ACES 色调映射/FXAA 后处理链
- **无尽地图**：噪声分块无限生成，坡度与树障密度随滑行距离递增
- **排行榜**：默认本机记录；配置 Supabase 后全球所有玩家共享

## 本地运行

直接双击 `index.html` 即可（单文件，无需服务器）。
如需本地起服务（例如改代码后调试）：

```bash
cd ski
npx serve .        # 或 python -m http.server
```

## 部署到 GitHub Pages

1. 新建公开仓库（例如 `ski`），把本目录内容推上去
2. 仓库 Settings → Pages → Source 选 `main` 分支 / root
3. 稍等片刻，访问 `https://<用户名>.github.io/ski/`

## 开启全球共享排行榜（可选，约 5 分钟）

游戏开箱即用，排行榜默认存 localStorage（仅本机可见）。
要让**所有玩家共享**一个排行榜，接上 Supabase 免费版：

1. 用 GitHub 账号注册 [supabase.com](https://supabase.com)（免费套餐够用，无需绑卡）
2. New Project 建一个项目（区域选离玩家近的，如 Singapore / Tokyo）
3. 左侧 SQL Editor → 粘贴 `supabase-setup.sql` 全部内容 → Run（建表 + 行级安全策略，成绩只增不改）
4. Settings → API → 复制 **Project URL** 和 **anon public** key
5. 打开 `index.html`，找到顶部这段，填入两 个值：

```js
window.SKI_CONFIG = {
  SUPABASE_URL: '',        // ← 粘贴 Project URL
  SUPABASE_ANON_KEY: '',   // ← 粘贴 anon public key
};
```

保存重新推送即生效，排行榜右上角会显示「☁ 全球共享」。

> **关于 anon key 的安全性**：它和 GITHUB_TOKEN 那类特权密钥不同，Supabase 的
> anon key 本来就是设计成放进前端代码公开暴露的——所有能做的事都被数据库的
> 行级安全策略锁死为「读排行榜 + 插入一条成绩」，既改不了别人的记录，也碰不到
> 数据库里的其他任何东西。放心提交到公开仓库。

## 修改 / 重新构建

源码在 `src/`（按模块拆分），改完执行：

```bash
node build.js
```

会把 `vendor/three.min.js`（three.js r128，已内置）和全部模块内联成新的单文件
`index.html`。常用调参集中在 `src/config.js`（坡度、难度曲线、物理手感、粒子量等）。

## 目录结构

```
ski/
├── index.html            ← 游戏本体（构建产物，单文件直接可玩）
├── build.js              ← 构建脚本（node build.js）
├── supabase-setup.sql    ← 全球排行榜建表 SQL
├── vendor/three.min.js   ← three.js r128
├── src/                  ← 源码模块
│   ├── config.js         云端配置 + 全部调参
│   ├── utils.js          噪声 / 地形高度场（唯一真值函数）
│   ├── sky.js            渐变穹顶 / 太阳 / 云 / 远山
│   ├── terrain.js        无限分块地形 + 雪面材质
│   ├── trees.js          实例化松树 + 行带生成 + 间隙保证
│   ├── skier.js          程序化人物（关节层级 + 物理驱动动画）
│   ├── physics.js        走刃物理 + 输入
│   ├── particles.js      雪雾喷溅 / 空中飘雪
│   ├── postfx.js         泛光 + ACES + FXAA + 暗角
│   ├── audio.js          WebAudio 程序化音效
│   ├── leaderboard.js    本地 / 云端双模式排行榜
│   ├── ui.js             界面逻辑
│   ├── main.js           装配 + 主循环
│   └── style.css         界面样式
└── test/smoke.js         headless 逻辑冒烟测试（node test/smoke.js）
```

## 技术说明

- **光照**：浏览器里无法实时真·光追，采用电影感方案逼近——HDR 线性渲染 →
  提亮泛光 → ACES 色调映射；太阳低角度暖光 + 长投影 + 半球天光，雪面注入
  逐格闪光（sparkle）与冷调菲涅尔
- **性能**：实例化树木、地形网格池循环复用、阴影贴图跟随并对齐纹素、
  帧率低于 42fps 自动逐级降质（分辨率/阴影/泛光），手机可玩
