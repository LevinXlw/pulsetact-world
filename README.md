# Pulsetact World

## 当前开发规范

所有后续开发遵守根目录 [AGENTS.md](AGENTS.md) 与 [项目开发规范：视觉还原](docs/development-standards.md)。2026-10-23 修订的核心标准是 **“做成和真实场景一样真实的3d模型”**：建筑几何、材质质感、光照反射、地形景观和近景细节均以实景为目标，不能仅以“形似”作为完成条件。局部尺寸可有合理误差，但不能降低真实感；与旧画风或质量约定冲突时，以当前真实还原要求为准。历史交付不自动满足新标准。

## 当前项目状态

2026-10-24，当前版本 **v0.2.0**（[更新记录](docs/releases/0.2.0.md)）。入口为 **校园世界单人探索**：Boston 的 MIT—查尔斯河—BU 连续步行区域，以及通过「校园旅行」切换的 UMD College Park、UPenn 与 University of Arizona（Tucson）。运行 `npm run dev -- --port 5186 --strictPort` 后访问 `/` 或 `/world/mit`。

所有应用页面需要登录。临时固定账号为 `tony`，随机密码按要求只硬编码在 `server/auth-credentials.mjs`；修改后需重启本地服务或重新发布 Worker。后端通过 HttpOnly / SameSite=Lax Cookie 维护 8 小时会话，刷新保持登录，退出会撤销会话并保留本机探索存档。本地 Node 服务使用进程内会话；Cloudflare 正式版使用持久化 Durable Object，并启用 Secure Cookie。修改固定密码会让旧的线上会话失效。这不提供云存档或学校身份认证。Vite 开发服务禁止浏览器读取 `server/`、`worker/`、配置临时包及 `.world-data/`。

当前入口不请求联机服务。WASD / 方向键行走、Shift 快走、拖动观察、滚轮缩放、E 互动、M 地图、J 手册、P 拍照；触屏设备显示方向按钮。角色与昵称保存在本机，探索、实验、位置、画质保存在 `pulsetact.world.solo.v1`，刷新后继续；清除站点数据会清除本机存档。照片直接下载到设备。单人浏览器验收：`node scripts/check-solo-playable.mjs`（预览服务端口 5186）。

此前联机样板的实现保留在 `WorldPage.tsx` 与 `server/`，历史范围见 [首个可玩片段说明](docs/world-first-playable.md)。`/api/world/*` 同样要求有效登录会话。学生认证、Harvard 新版区域和跨校连续城市仍在后续规划中。原版入口保留于 `/classic`，以下为原校园探索记录。
## Campus Explorer 历史说明

Cambridge · Harvard & MIT。独立制作的中文校园探索体验，基于需求文档 v1.0 实现本地 P0。使用可行走的程序化 3D 场景，无需 API Key、登录、后端、外部 GLB 或图片服务。

新增 **本地实景校园**：访问 `/real/mit` 或 `/real/harvard`。使用已下载的 Cambridge 官方建筑、地形和航拍图，不需要 Google Maps Key，也不请求外部地图服务。支持鸟瞰、角色漫游、基础建筑碰撞、地点收藏与进度、拍照、模拟活动。不支持 WebGL2 时显示本地航拍地图。数据转换与范围见 [本地实景说明](docs/local-campus.md)。原 Google 原型代码仍保留供参考，已不在应用路由中加载。

Killian Court 已加入本地立面、柱廊、草坪、步道和树木样板，可在 MIT 页面切换原始/增强模型。制作依据、复现脚本及近似范围见 [样板说明](docs/killian-sample.md)。

2026-09-15 新增主楼柱廊样板：门窗开口与进深、柱脚与柱头、石材与草坪更新。MIT 页面可选择「主楼门窗」「柱廊侧视」。查看 [四机位前后对照与行走录屏](docs/portico-v2-review.html)、[本轮验证记录](docs/portico-v2-delivery.md) 和 [后续设计方案](docs/mit-realism-design-v2.md)。

2026-09-20 完成 Cambridge 庭院第一轮：MIT 默认第一人称环境漫步，新增 3、4 号楼六面立体窗洞、低石边、自然分枝树群与统一午后光照。用 WASD / Shift 移动、拖动观察，机位和设置已收进菜单。查看 [本轮实机记录与复核命令](docs/cambridge-courtyard-first-pass.md)；完整城市范围仍按 [美术方向](docs/cambridge-art-direction.md) 分阶段推进。

## 运行

开发环境：Windows、Node.js 24.16.0、npm 11.13.0。

首次克隆时，将 `server/auth-credentials.example.mjs` 复制为 `server/auth-credentials.mjs`，在副本中设置随机密码后再启动、测试或部署。实际凭据文件不进入 Git，只由本地 Node 后端和 Cloudflare Worker 构建读取；已有开发／发布机器保留原文件即可，更新代码无需改密码。

```sh
npm ci
npm run dev
```

打开终端显示的地址（默认 http://127.0.0.1:5173）。

```sh
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

浏览器测试要求开发服务已启动。默认使用本机 Microsoft Edge，可用 `PLAYWRIGHT_CHANNEL=chrome` 选择 Chrome。本机 Node 24 运行现有 Playwright 1.52 时需设置 `PW_DISABLE_TS_ESM=1`，避免旧加载器停在测试发现阶段。PowerShell 完整命令见 [实机验证说明](docs/cambridge-courtyard-first-pass.md#可重复检查)。

## 操作

- WASD / 方向键：相对镜头移动；E：与附近目标互动。
- 右键拖动：旋转镜头；滚轮：缩放。
- M：区域地图；J：探索手册；P：拍照；Esc：关闭面板 / 打开设置。
- 点击侧栏或场景里的远处目标会给出靠近提示，近处可直接互动。
- 开启主面板或输入文字时停止角色移动。活动可暂停并继续；照片最多 20 张。
- 新建会在明确确认后替换原记录。设置可下载 JSON 备份、回入口、重置视角、切换画质或清除本应用数据。

## 版本与架构

React / React DOM 19.0.0；R3F 9.1.2；Three.js 0.176.0；Vite 6.3.5；TypeScript 5.8.3；Zustand 5.0.5；Zod 3.25.49；React Router 7.6.2；Vitest 3.2.1；Playwright 1.52.0。React 19 与 R3F 9 主版本配对已对照 R3F 官方说明。精确传递依赖在 package-lock.json 中。

`.npmrc` 使用 legacy-peer-deps，避免纯浏览器项目解析 R3F 的可选 React Native / Expo 依赖；实际浏览器依赖配对通过构建与试玩验证。按需求使用 Vite，而不是网站技能默认的服务端 starter。未引入 drei、物理引擎、数据库或不必要的服务端。

- `src/content/`：校园事实、来源与 4 位虚构人物的 12 组话题，各有 2 个后续选择。
- `src/world/`：程序化建筑、角色、移动、镜头、碰撞、当前帧截图。
- `src/features/`：两个确定性活动与手册。
- `src/services/`：存档验证、IndexedDB 照片、预留 provider 和 profile 候选边界。
- `src/state/`：Zustand、500 ms 保存防抖、多标签页更新保护。
- `src/domain.ts`：不依赖渲染器的运动、视线、预算与计分规则。

存档 key：`pulsetact:campus-explorer:save:v1`。照片库：`pulsetact-campus-photos`。数据仅在本机；清理浏览器站点数据会删除记录。损坏存档保留原文并停止覆盖，用户可先下载备份后恢复默认值。其他标签页修改时暂停写入并提示重载。

## 范围

P0：双校园 / 每校 3 个地点 + 2 人物 + 1 活动；角色设置、区域地图、移动与碰撞、收藏、发现与已了解状态、6 项去重进度、室内模拟活动、笔记 CRUD、两校对照、真实截图与照片管理、本地存档、画质与错误提示。

P1：真实 AI 对话、登录和云存档、Blender / GLB、复杂动画、手机触屏与自动寻路。只保留类型和候选数据边界，不声称接通服务。

校园布局为艺术化压缩，非现实导航和建筑测绘。人物与活动为 Pulsetact 原创，非学校真实课程或学生陈述。素材与学校事实来源分开记录。

## 运行构建产物

`npm run build` 输出 `dist/`，再运行 `npm start` 使用同一套登录后端和静态资源服务（默认 `http://127.0.0.1:4173`，支持 `HOST` / `PORT`）。`npm run dev` 与 `vite preview` 也接入同一登录服务。启用账号登录后，不能仅托管 `dist/` 而省略后端。Node 服务通过 HTTPS 反向代理部署时设置 `AUTH_SECURE_COOKIE=1`。

## Cloudflare 正式部署

正式地址：https://world.pulsetact.ai 。Worker 为 `pulsetact-world`，自定义域名、静态资源及 `AUTH_STORE` SQLite Durable Object 绑定由 `wrangler.jsonc` 管理。线上提供当前单人体验，历史多人服务不在这个 Worker 中运行。

```sh
npm run deploy:cloudflare
node scripts/check-release-bu.mjs
```

本地预览发布包：先 `npm run build:cloudflare`，再 `npm run preview:cloudflare`。预览使用本地证书。正式发布后的 `check-release-bu.mjs` 完整验证 HTTPS 证书，并检查登录、真实地图跳转、手机高清、实际加载资源与本地发布目录的 SHA-256 一致性；可用 `WORLD_EXPECTED_VERSION` 指定 Wrangler 输出的部署 UUID。旧 `check-world-deployment.mjs` 保留为历史脚本，其中资源断言针对旧校园加载方式，不作为 v0.2.0 的发布门槛。重建 `dist-cloud/` 前先停止预览，避免 Windows 目录锁定。

发布包保留运行需要的模型、来源说明和授权文件；剔除未使用的植被文件以及超过单文件大小限制的原始 detail GLB，后者由 Worker 使用 gzip 原件提供同一 URL。`/data/` 和人物、天空资源要求登录。发布清单和浏览器报告在 `output/deployment/`。探索进度仍属于浏览器和域名，本地预览的存档不会自动迁移到正式域名。

详细验证和限制见 `docs/acceptance.md`；学校事实见 `docs/content-sources.md`；自制资源见 `docs/asset-manifest.json`。
