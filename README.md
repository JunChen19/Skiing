# 雪线 SNOWLINE · 无尽滑雪

网页版 3D 无尽滑雪游戏。单文件 `index.html`，零外部依赖、零图片/模型/音频文件——
地形、天空、树木、人物、光影、粒子、音效**全部由代码实时计算生成**。

- **操控**：桌面移动鼠标、手机按住屏幕左右滑动（也支持 ←→ / A D 键）
- **物理**：真实走刃（carve）模型——立刃转向、抓地/侧滑、坡度加速、空气阻力、刻雪泄速，所有横向移动都来自转向惯性
- **光影**　雪松挂雪、折叠山脊、近景投影、板下接触阴影，三档画质共用 ACES 输出。
- **路线**　前 300 米依次通过开阔坡、连续弯和林间分线。蓝旗标记宽线外缘，橙旗标记较窄的直线捷径。后续每 480 米构成一个路段，为高速转弯留出距离。
- **重试**　结算展示最近的分段用时；重试保留地形和障碍，完整分段可以与本次路线此前的最佳用时比较。「换一条路线」生成新种子。
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
│   ├── postfx.js         分档泛光 + ACES + 边缘平滑
│   ├── audio.js          WebAudio 程序化音效
│   ├── leaderboard.js    本地 / 云端双模式排行榜
│   ├── ui.js             界面逻辑
│   ├── main.js           装配 + 主循环
│   └── style.css         界面样式
└── test/smoke.js         headless 逻辑冒烟测试（node test/smoke.js）
```

## 技术说明

- 滑行使用 120 Hz 固定物理步和渲染插值。画质调节依据真实帧间隔，暂停期间停止模拟。
- 地形网格按行分帧构建。树木分批实例化，仅近处树木投射实时阴影。中档关闭泛光并降低阴影分辨率，低档保留雪板接触阴影和统一调色。
- 执行 `node test/smoke.js` 可检查物理、板底接地、远距离坡度、实例颜色和多种子下两条路线的可通过性。
