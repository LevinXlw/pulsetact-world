# Pulsetact Campus Explorer

Cambridge · Harvard & MIT。独立制作的中文校园探索体验，基于需求文档 v1.0 实现本地 P0。使用可行走的程序化 3D 场景，无需 API Key、登录、后端、外部 GLB 或图片服务。

新增 **本地实景校园**：访问 `/real/mit` 或 `/real/harvard`。使用已下载的 Cambridge 官方建筑、地形和航拍图，不需要 Google Maps Key，也不请求外部地图服务。支持鸟瞰、角色漫游、基础建筑碰撞、地点收藏与进度、拍照、模拟活动。不支持 WebGL2 时显示本地航拍地图。数据转换与范围见 [本地实景说明](docs/local-campus.md)。原 Google 原型代码仍保留供参考，已不在应用路由中加载。

Killian Court 已加入本地立面、柱廊、草坪、步道和树木样板，可在 MIT 页面切换原始/增强模型。制作依据、复现脚本及近似范围见 [样板说明](docs/killian-sample.md)。

2026-09-15 新增主楼柱廊样板：门窗开口与进深、柱脚与柱头、石材与草坪更新。MIT 页面可选择「主楼门窗」「柱廊侧视」。查看 [四机位前后对照与行走录屏](docs/portico-v2-review.html)、[本轮验证记录](docs/portico-v2-delivery.md) 和 [后续设计方案](docs/mit-realism-design-v2.md)。

2026-09-20 完成 Cambridge 庭院第一轮：MIT 默认第一人称环境漫步，新增 3、4 号楼六面立体窗洞、低石边、自然分枝树群与统一午后光照。用 WASD / Shift 移动、拖动观察，机位和设置已收进菜单。查看 [本轮实机记录与复核命令](docs/cambridge-courtyard-first-pass.md)；完整城市范围仍按 [美术方向](docs/cambridge-art-direction.md) 分阶段推进。

## 运行

开发环境：Windows、Node.js 24.16.0、npm 11.13.0。

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

## 静态部署

`npm run build` 输出 `dist/`。任意静态托管服务需将未知应用路径回退到 `index.html`（包括 `/campus/mit`、`/journal`），资源文件正常返回文件本身。此交付未发布到线上，也不依赖部署账号。

详细验证和限制见 `docs/acceptance.md`；学校事实见 `docs/content-sources.md`；自制资源见 `docs/asset-manifest.json`。
