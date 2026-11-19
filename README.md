# 雪线 SNOWLINE · 无尽滑雪

手机触屏 3D 无尽滑雪游戏。单文件 `index.html` 内含阿尔卑斯实拍远景、地形、人物和渲染引擎。桌面入口提供手机版二维码与排行榜。

- **操控**　单指左右拖动或按住屏幕两侧转向。上划起跳，人物在 1.12 秒内完成前空翻。提前观察雪帽下露出的深色岩体，按屏幕提示越过，或沿雪道侧面绕行。
- **难度**　距离与有效滑行时间共同决定后续石阵的密度和尺寸，约 1,500 米、100 秒达到上限。已进入视野的石头固定在原位，暂停期间难度保持不变。
- **物理**：真实走刃（carve）模型——立刃转向、抓地/侧滑、坡度加速、空气阻力、刻雪泄速，所有横向移动都来自转向惯性
- **光影**　实拍雪峰与谷底薄雾衔接；雪面的风蚀纹、压雪纹和雪板轨迹随光照变化。近处雪杉有立体枝叶，远处切换为同一树模烘焙的交叉贴片。
- **路线**　前 300 米依次通过开阔坡、连续弯和林间分线。蓝旗标记宽线外缘，橙旗标记较窄的直线捷径。后续每 480 米构成一个路段，为高速转弯留出距离。
- **重试**　结算展示最近的分段用时；重试保留地形和障碍，完整分段可以与本次路线此前的最佳用时比较。「换一条路线」生成新种子。
- **排行榜**　GitHub Pages 使用 Supabase 保存和加载共享成绩。可选的本机服务使用 SQLite。

远景由 Tobi 87 拍摄于戈尔内格拉特。游戏将原图裁切、缩放、编码为 WebP，并在渲染时与天空和雾色混合。改编纹理沿用 CC BY-SA 3.0。[原作](https://commons.wikimedia.org/wiki/File:Panorama_vom_Gornergrat_-_Monte_Rosa-Liskamm-Castor-Pollux-Breithorn-Kl._Matterhorn.jpg) · [许可证](https://creativecommons.org/licenses/by-sa/3.0/)

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

## 本机自建排行榜

需要带 `node:sqlite` 的 Node.js（例如 Node.js 24）。服务在 Windows 上默认将成绩保存在
`%LOCALAPPDATA%\SnowlineLeaderboard\scores.sqlite`。备份时可先停止服务，再复制数据库目录。

```powershell
node build.js
node server/leaderboard.js
```

打开 [本机游戏](http://127.0.0.1:8715/)，这个入口会连接本机共享榜。关闭服务后再开启会继续使用同一份成绩。

Windows 可以在项目目录运行下列命令，注册任务计划并立即启动服务。请先关闭手动启动的实例。

```powershell
.\scripts\install-leaderboard-startup.ps1
```

默认在当前账户登录时启动。若需要停在 Windows 登录界面也能运行，用管理员 PowerShell 执行同一个脚本并带上
`-AtBoot`。使用不同管理员账户执行时，通过 `-RunAsUser` 和 `-DataDir` 指定原账户和数据库目录。
计划任务名为 `Snowline Leaderboard`。

### 接到 GitHub Pages

将固定的 HTTPS 地址转发到本机 `http://127.0.0.1:8715`，公开 `/api/scores` 和
`/api/health`。把完整的公网成绩接口填入 `src/config.js` 的 `LEADERBOARD_URL`，
执行 `node build.js` 后发布到 GitHub Pages。API 已允许 `https://junchen19.github.io` 跨域访问。

使用 ngrok 时，先按其控制台指引在本机执行 `ngrok config add-authtoken`。
以当前 Windows 账户运行下面的脚本，隧道也会在每次登录后启动。

```powershell
.\scripts\install-leaderboard-tunnel.ps1
```

脚本默认使用 `%LOCALAPPDATA%\SnowlineLeaderboard\tools\ngrok.exe`，其他安装位置可以用 `-NgrokPath` 指定。
隧道仅转发上述两个 API 路径。将控制台显示的固定 HTTPS 地址加上 `/api/scores` 后用于发布。
Windows 登录后，排行榜服务和隧道都在线时可读写共享榜，服务中断时游戏会保存本机记录。

## GitHub Pages 使用 Supabase 排行榜

Pages 上的游戏可以直接读写 Supabase。每局结算提交一次成绩，打开排行榜加载前 50 名。相同分数按提交时间排序。本机 SQLite 服务可以独立使用。

1. 在自己的 Supabase 项目 SQL Editor 中运行仓库的 `supabase-setup.sql`。脚本可重复执行，保留已有成绩。
2. 在项目的 Connect 面板复制 Project URL 和 Publishable key（`sb_publishable_…`）。旧项目的 anon public key 也适用。
3. 在 `src/config.js` 中填写 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`，并将 `LEADERBOARD_URL` 留空。
4. 运行 `node build.js`，将源码和生成的 `index.html` 推送到 Pages 分支。打开游戏的排行榜即可查看共享成绩。

项目须启用 Data API，并公开 `public.scores`。建表脚本通过 PostgreSQL 权限与行级安全策略允许访客读榜、添加成绩。分数来自玩家浏览器，数据库只检查昵称和分数范围。详情见 [Supabase 前端数据访问指南](https://supabase.com/docs/guides/database/secure-data)。

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
│   ├── sky.js            全景雪峰与远平面天空
│   ├── terrain.js        无限分块地形 + 雪面材质
│   ├── trees.js          实例化松树 + 行带生成 + 间隙保证
│   ├── rocks.js          随赛程生成的矮石、碰撞轮廓与接近提示
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
- 执行 `node --test test/steering.js test/jump.js test/rocks.js test/leaderboard.js` 可检查手机触控、前空翻时机、岩石碰撞、难度增长、高速避树及 Supabase 排行榜。
