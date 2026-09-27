# Pulsetact Campus Explorer — Codex 开发文档 v1.0

> 首版主题：Cambridge · Harvard & MIT
>
> 文档日期：2026-09-11
>
> 本文是可执行的产品与工程规格。交给 Codex 后，按里程碑实现一个可玩的 Web 应用。当前交付范围为 P0；P1 是明确标注的后续扩展。

## 1. 项目目标与已确定方向

Pulsetact 希望长期构建一个模拟学生学习、升学和未来生活的应用。本次先实现其中的「虚拟校园探索」：用户以自己的虚拟角色进入校园，参观地点、与虚构人物交流、体验活动，并留下自己的探索记录。

用户已经确定：

- 前期优先做用户以自己身份探索学校与未来生活的体验。
- 第一批学校为美国马萨诸塞州 Cambridge 的 Harvard University 与 Massachusetts Institute of Technology（MIT）。
- 校园采用可交互的 3D 场景，具有类似生活模拟游戏的角色与空间感。
- 该功能属于 Pulsetact 产品体系，未来可以连接学生 profile 和升学规划。

本文补充的默认实施决策：桌面浏览器优先、单人游玩、中文界面配英文地点名、风格化 3D、区域地图切换校园、匿名本地存档。这些是让 Codex 可以直接开工的设计选择，不代表已有系统具备这些能力。

**首版目标体验：用户在约 15–25 分钟内，完成两所学校的初步探索，参加至少一次体验活动，收藏地点，并在探索手册中留下自己的兴趣与问题。** 时长是设计目标，需通过试玩验证。

## 2. 首版范围

### 2.1 P0：本次完整实现

| 模块 | 必须交付的内容 |
| --- | --- |
| 开始与角色 | 新建/继续探索；昵称、可跳过的年级与兴趣；简单角色外观选择 |
| Cambridge 区域地图 | Harvard 与 MIT 两个可进入的校园入口；显示各校探索进度 |
| Harvard 校园 | 一个户外 3D 场景、3 个重点地点、2 位人物、1 个示意室内空间 |
| MIT 校园 | 一个户外 3D 场景、3 个重点地点、2 位人物、1 个示意室内空间 |
| 角色控制 | 键盘移动、跟随镜头、碰撞、靠近后互动、回到入口 |
| 地点互动 | 信息卡、来源链接、收藏、到访状态 |
| 人物交流 | 4 位虚构人物的完整预设对话；每人至少 3 个话题 |
| 体验活动 | 每校 1 个可完成、可重玩的短活动，共 2 个 |
| 拍照 | 拍摄当前 3D 画面，保存到手册并下载 PNG |
| 探索手册 | 地点、收藏、照片、任务回顾、个人笔记、两校探索记录对照 |
| 存档与设置 | 本地保存、恢复、画质切换、重置、错误反馈 |
| 运行与交付 | 可启动、可构建、可试玩；README、内容来源与素材清单、关键流程验证 |

P0 无需外部模型文件、AI API Key、登录服务或数据库即可完整运行。人物交流明确使用预设话题；只有 P1 接入真实服务后才开放自由文本 AI 聊天。

### 2.2 P1：后续扩展，保留接口即可

- 有资料约束的 AI 自由对话与个性化导览。
- 高质量 Blender 模型替换、骨骼动画、更多室内场景。
- 接入 Pulsetact 的真实登录、profile、云端存档。
- 点击地面自动寻路、触屏移动、移动端完整体验。
- 更多学校、跨校主题探索路线、长期学生养成。

### 2.3 当前不做

完整 Boston/Cambridge 城市复刻、两校之间连续步行地图、多人联机、VR、录取概率模拟、申请提交、课业成长数值系统、NPC 自主日程、复杂经济系统、完整捏脸和房屋装修。

不得因为这些长期方向而提前引入相应服务和复杂框架。

## 3. 首次体验与核心循环

1. 用户进入欢迎页，点击「开始探索」。已有存档时同时显示「继续探索」。
2. 输入昵称或接受默认昵称，选择角色外观；可选填年级和兴趣，全流程可快速跳过。
3. 打开 Cambridge 区域地图，自由选择 Harvard 或 MIT；不锁定学校顺序。
4. 加载校园，角色出现在入口；首次展示简短移动与互动提示。
5. 自由走动，或开启「推荐路线」获得下一个目标方向提示。
6. 靠近地点按 E，查看介绍并收藏；靠近人物按 E，选择话题交流。
7. 从活动入口进入示意室内空间，完成短活动，记录自己的感受。
8. 回到校园，拍照并加入手册；可随时打开地图前往另一所学校。
9. 打开探索手册，查看两校的个人记录、填写待了解的问题。
10. 关闭或刷新后，能继续之前的探索。

**核心循环：走动 → 发现 → 交流或参与 → 收藏与记录 → 前往下一处。**

导览只提供建议，不强迫用户顺序完成。体验活动可跳过，也可在之后重玩。不得把「完成所有点位」设置为查看学校信息或切换学校的前提。

## 4. 页面、路由与状态

| 路由 | 页面职责 |
| --- | --- |
| `/` | 欢迎、新建、继续 |
| `/onboarding` | 轻量角色与兴趣设置 |
| `/map` | Cambridge 示意区域地图 |
| `/campus/harvard` | Harvard 场景容器 |
| `/campus/mit` | MIT 场景容器 |
| `/journal` | 探索手册 |

室内活动是校园容器内的子场景，不必建立独立公共路由。未知校园 ID 显示可恢复的错误页并提供返回地图按钮。直接访问校园且没有 profile 时，以匿名默认角色进入，避免深链接失效。

将「所在场景」和「打开的面板」分开建模：

- 场景：`outdoor | interior`，室内附带 `activityId`。
- 主面板：`none | poi | dialogue | activity | settings | photo | journal`。
- 加载状态：`idle | loading | ready | error`。

同一时刻只打开一个主面板。打开面板时释放游戏输入并暂停角色运动。关闭后恢复角色控制；从人物面板开始活动是显式状态转换，不能叠两个可交互弹窗。

切换校园采用：记录安全位置 → 加载目标场景 → 目标就绪后更新当前校园。加载失败可重试或返回原校园/地图，不能永久停在遮罩上。

## 5. 世界与校园内容

### 5.1 Cambridge 区域地图

使用轻量 SVG/HTML 示意地图，画出简化的 Charles River、Cambridge 与 Boston 区域背景，以及两个学校标记。保留 Harvard 在 MIT 西北侧、两校在 Cambridge 一侧的基本空间关系，明确显示「区域示意图」。

点击学校，显示名称、简短介绍、个人探索进度和「进入校园」。地图不计算现实路程、交通时间，不调用付费地图 API，不依赖第三方地图截图。

### 5.2 Harvard 场景

空间主题为 Harvard Yard。建筑采用辨识度明确的体块、立面节奏和环境组合，保留开放草地、步道、树木与红砖建筑氛围。

| ID | 地点 | 画面与互动要求 |
| --- | --- | --- |
| `harvard-yard` | Harvard Yard | 开放庭院与步道；入口附近设置欢迎互动点，介绍探索方法 |
| `harvard-widener` | Widener Library 外观 | 正立面、柱廊与台阶轮廓；信息卡与推荐拍照点 |
| `harvard-memorial` | Memorial Church 外观 | 教堂与塔楼轮廓；信息卡、校园空间观察问题 |

地图是艺术化压缩，具体位置与外观在制作时对照官方地图、官方照片核验；不把模型中的比例和可达区域当作现实导航资料。

设置 2 位虚构学生人物：

- `harvard-maya`：愿意聊课程探索、参加讨论、兴趣变化；表达具体个人观点。
- `harvard-leo`：愿意聊项目合作、校园日常、如何选择活动。

每位人物提供 3 个话题，每个话题至少有一轮后续选择。文字具体、简短，通常每条回复 1–3 句；人物不得代表学校发言或自称真实在校生。

### 5.3 MIT 场景

空间主题为 Killian Court 与 Great Dome，并通过一个入口连接 Infinite Corridor 的短段室内场景。校园外观具有明确穹顶、柱廊、开阔庭院和步道。

| ID | 地点 | 画面与互动要求 |
| --- | --- | --- |
| `mit-killian` | Killian Court | 可行走庭院；欢迎信息和观察任务 |
| `mit-dome` | Great Dome 外观 | 场景核心地标；穹顶轮廓、拍照点与信息卡 |
| `mit-corridor` | Infinite Corridor 短段 | 从户外入口进入示意室内空间；信息点及项目活动入口 |

设置 2 位虚构学生人物：

- `mit-alex`：愿意聊动手项目、团队分工、反复修改方案。
- `mit-sam`：愿意聊艺术与技术、学习节奏、课外兴趣。

两校人物都应有多元兴趣，不用「Harvard 只讨论、MIT 只动手」定义学校。下述活动是 Pulsetact 创作的体验内容，不是对学校实际课程的概括。

### 5.4 室内空间

Harvard 使用一个虚构的讨论室；MIT 使用一个与短段走廊相连的虚构项目空间。可共用基础房间组件，通过家具、配色、海报与互动配置形成区别。

进入时显示「Pulsetact 模拟体验空间」。不声称完整还原真实教室、实验室内部或现实访客权限。活动结束后回到室内入口，出门回到预设户外安全位置。

## 6. 两个体验活动：直接可实现的内容规格

### 6.1 Harvard：AI 应该怎样帮助学生选课？

- ID：`harvard-course-discussion`。
- 建议时长：3–5 分钟。
- 场景：示意讨论室，圆桌、白板、人物。
- 目标：让用户体验观点选择、接收新信息与修改判断。

活动流程：

1. 情境：一名学生正在选择新学期课程，成绩、兴趣和时间之间存在取舍。
2. 选择优先考虑：探索兴趣 / 学习基础 / 时间负担。三项没有统一正确答案。
3. 人物根据选择回应，并补充信息：「学生也希望留时间参与一个团队项目」。
4. 用户选择保留判断或调整优先项，并从几个理由中选择一个，也可选填一句解释。
5. 展示其初始选择、最终选择和理由，邀请选择感受：喜欢交流观点 / 喜欢比较信息 / 还不确定。
6. 点击「记入手册」，写入完成记录与用户明确选择的感受。

实现为有限状态的互动故事，P0 不需要模型判分。任何有效分支都能完成；中途退出保存到最近一步，重进可继续或重新开始。

### 6.2 MIT：设计一个校园学习空间

- ID：`mit-study-space`。
- 建议时长：3–5 分钟。
- 场景：示意项目空间、可更新的桌面模型或布置预览。
- 目标：体验有限资源下的设计与调整。

虚构预算为 10 点，以下每项最多选 1 次：

| 配置 ID | 配置 | 花费 | 安静指数 | 协作指数 |
| --- | --- | ---: | ---: | ---: |
| `quiet-desks` | 独立学习桌组 | 4 | +3 | 0 |
| `discussion-table` | 讨论桌 | 4 | 0 | +3 |
| `acoustic-screen` | 隔音屏风 | 3 | +2 | 0 |
| `whiteboard` | 白板 | 2 | 0 | +2 |
| `shared-power` | 共享电源点 | 1 | +1 | +1 |

初始指标均为 0，按选中项累加。花费超过 10 时禁止提交并显示超出点数；不把已经选择的项自动删除。

步骤：

1. 选择设计目标：偏安静 / 偏协作 / 兼顾两者。
2. 点击家具卡添加或移除，场景预览与预算即时变化。P0 用离散预设位置，不做自由拖拽。
3. 提交第一版：至少选择 1 项且花费不超过 10。
4. 展示模拟使用者反馈，允许保留或调整一次方案。反馈引用当前配置与指标，不能凭空出现未选择家具。
5. 保存最终方案，选择自己更享受：设计布局 / 处理约束 / 考虑使用者 / 还不确定。

若展示目标达成标记，规则固定：偏安静需安静指数 ≥ 4；偏协作需协作指数 ≥ 4；兼顾需两项均 ≥ 3。未达到目标也可以完成活动并反思；指标是游戏内规则，不是建筑或教育评估标准。

两项活动只形成体验记录，不改变录取概率、学术能力分数或专业适配结论。重玩保存最近一次结果与完成次数，学校进度只记一次。

## 7. 控制、镜头与交互

### 7.1 桌面控制

| 输入 | 行为 |
| --- | --- |
| WASD / 方向键 | 相对镜头方向移动 |
| E | 与当前高亮目标互动 |
| 鼠标点击附近目标 | 与 E 相同；远处目标只选中并提示靠近 |
| 鼠标右键拖动 | 水平旋转镜头，限制俯仰范围 |
| 滚轮 | 在允许范围内缩放 |
| M | 打开区域地图 |
| J | 打开探索手册 |
| P | 打开拍照模式 |
| Esc | 关闭最上层面板；无面板时打开设置 |

HUD 显示当前校园、导览目标、地图/手册/拍照/设置按钮及简短操作提示。输入框聚焦、弹窗开启、标签页失焦时禁用角色快捷键，清空按键状态，防止角色持续移动。

### 7.2 相机与移动默认参数

- 俯视倾斜的第三人称透视镜头，始终能看到角色及周围路径。
- 默认距离约 10–14 个世界单位，俯角约 40–55°；距离范围约 6–20，最终按场景调节。
- 角色速度初始为 3.5 世界单位/秒；对角移动归一化，不能更快。
- 位移与帧时间关联，长帧限制 dt 并拆为子步，防止穿过墙体。
- 相机目标平滑跟随，切换学校时重置；提供「重置视角」。
- P0 地面平坦；台阶可作为外观，不要求真实上下台阶或跳跃。
- 角色使用简单碰撞圆柱/胶囊的平面投影，建筑用矩形阻挡区；可沿墙滑动。
- 场景设置可行走边界；越界或异常位置自动回到最近安全点。
- 固定机位与建筑布局优先保证可见性；必要时淡出遮挡角色的前景屋顶/墙体。

第一版不引入完整物理模拟。碰撞、可行走范围、互动距离使用独立配置，替换视觉模型不能悄悄改变规则。

### 7.3 互动选择

在约 2.5 个世界单位内检查可互动对象；优先选择距离近且朝向合理的目标，显示名称与「E 互动」。以配置覆盖特殊目标的距离。

墙后目标不可直接触发：检查交互视线或同一可达区域。多个目标重叠时稳定排序，避免每帧闪烁。地标使用位于步道上的独立互动锚点，不能要求玩家贴近建筑中心。

POI 的「发现」由玩家进入发现区域触发；「已了解」由主动打开信息卡触发。只进入学校不能自动把所有地点记为到访。

## 8. 界面与美术要求

整体风格：温暖、清晰、有校园生活感的风格化低多边形 3D。保留地标形态，场景有步道、草地、树木、长椅和少量动态细节。

- 3D 画面为主；信息卡和工具面板用 React DOM 叠加，文字不要全部做成 3D 纹理。
- 默认中文，学校与地标保留英文名称；文案集中管理，预留国际化键。
- 使用 Pulsetact 自己的标识；学校名称作为地点信息展示。
- 欢迎页放能代表实际应用的场景预览或实时简化场景。
- Harvard 与 MIT 要有不同建筑轮廓与空间组织，不能只替换颜色和名称。
- 人物至少有头部、身体、四肢和朝向；实现 idle/walk 状态的轻量动画。
- P0 角色设置可提供 3 套衣服色、3 种肤色和 2 种发型，无需真实姓名、照片或复杂捏脸。
- 重点地标不能仅用一个默认立方体代替。可使用程序化柱廊、屋顶、穹顶、塔楼、门窗体块构建辨识度。
- 当前版本可以不做环境音；不自动播放音频。

桌面目标布局为 1280×720 及以上。较小屏幕可以阅读地图和手册，3D 入口显示推荐桌面体验的信息；P0 不承诺完整手机操控。DOM 面板支持键盘焦点、可见焦点样式、Esc 关闭及关闭后焦点恢复。提供减少动态效果选项。

## 9. 3D 资产策略与 Blender 接口

### 9.1 P0：程序化风格化模型

用可复用 Three.js/R3F 组件搭建建筑、树木、路灯、长椅与角色。资产来源完全可控，没有外部模型时也能呈现完整场景。

为每类建筑拆出独立组件，例如 `ColumnedFacade`、`DomeBuilding`、`BrickAcademicBuilding`、`ChurchTower`。校园文件只组合组件和放置互动锚点。

### 9.2 P1：Blender → GLB → Web 场景

Blender 负责模型与资产制作，Web 应用负责移动、相机、状态、交互和对话。glTF/GLB 是可用的交换格式；相关导入导出由 Blender glTF 项目维护。[官方项目说明](https://github.com/KhronosGroup/glTF-Blender-IO)

资产约定：

- 浏览器世界采用 Y-up，地面为 XZ 平面；1 单位约为 1 米的美术标尺，不代表校园地理测绘精度。
- Blender 导出时处理轴向转换，模型落地后验证朝向、缩放、法线及材质。
- 模型原点位于地面中心；应用变换，避免隐藏比例问题。
- 导出 `.glb`，优先使用简单兼容材质；程序材质需烘焙为纹理或简化。
- 单体建筑、家具、角色独立导出；不要把两所学校全部塞入同一大文件。
- 碰撞区、入口、POI、NPC 出生点保存在 TypeScript 内容配置中，不依赖任意 mesh 名称猜测。
- 初始纹理通常 512–1024 像素；只有确实需要的主地标使用更高分辨率。
- 角色骨骼动画接入时统一 `Idle`、`Walk` 命名，或提供动画映射配置。
- 模型加载失败时回退到对应程序化模型，并提供非阻塞提示。

`asset-manifest.json` 记录 ID、路径、来源、作者、使用许可、修改情况、大小与备用组件。公开可浏览的照片或模型不能直接视为可再分发素材；使用自制或许可明确的素材。校园事实来源与素材许可分开记录。

## 10. 技术架构

### 10.1 默认技术栈

| 层 | 默认选择 | 职责 |
| --- | --- | --- |
| 应用 | React + TypeScript + Vite | 页面、构建、类型检查 |
| 3D | Three.js + React Three Fiber | 场景、渲染、相机、模型 |
| 辅助组件 | `@react-three/drei`，按需使用 | 已验证可用的辅助能力 |
| 路由 | React Router | 页面与深链接 |
| 状态 | Zustand | 玩家、进度、设置、面板状态 |
| 样式 | CSS Modules + CSS variables | DOM 界面、设计变量 |
| 结构化存档 | localStorage | profile、进度、笔记与设置 |
| 照片 | IndexedDB | Blob 与照片元数据 |
| 数据校验 | Zod 或同等轻量校验 | 内容配置、存档与 API 边界 |
| 验证 | Vitest + Playwright | 关键纯逻辑、核心浏览器流程 |

React Three Fiber 是 Three.js 的 React renderer，需匹配 React 主版本。实施时确认依赖兼容，提交 lockfile，并在 README 记录实际 Node 与依赖版本，不要盲目安装所有包的 latest。[R3F 官方仓库](https://github.com/pmndrs/react-three-fiber)、[Vite 官方指南](https://vite.dev/guide/)

若已有 Pulsetact 仓库，先读取其说明、路由、依赖与设计变量，优先复用兼容的现有能力。本文未提供现有仓库或后端协议，不能假定已接通；若仓库为空，按上表建立独立应用。

P0 是静态前端应用，后端不是启动依赖。上线环境需要支持 SPA 路由回退到 `index.html`；部署平台按实际项目选择，本文件不预设已有托管账号。

### 10.2 模块边界

- `world`：移动、相机、碰撞、场景切换、互动目标选择。
- `content`：学校、场景布局、地点、人物、对话、活动和来源。
- `features`：角色设置、地图、信息卡、对话、活动、照片、手册。
- `services`：存档、照片、对话 provider、未来 profile bridge。
- `state`：可序列化业务状态，避免保存 Three.js 实例。

帧循环中的位置和旋转用 ref 或运行时对象更新；不要每帧把全部坐标写入 React 状态、全局持久化或 localStorage。向 HUD 同步低频信息，事件发生时再更新业务状态。

### 10.3 建议目录

```text
src/
  app/                 # 路由、错误边界、应用初始化
  components/ui/       # 按钮、对话框、抽屉、提示
  features/
    onboarding/
    map/
    dialogue/
    activities/
    journal/
    photo/
  world/
    CampusCanvas.tsx
    CampusScene.tsx
    PlayerController.tsx
    FollowCamera.tsx
    InteractionSystem.tsx
    CollisionWorld.ts
    buildings/
    props/
    characters/
  content/
    campuses/
      harvard.ts
      mit.ts
    dialogues/
    activities/
    sources.ts
    schemas.ts
  services/
    saveRepository.ts
    photoRepository.ts
    dialogueProvider.ts
    profileBridge.ts
  state/
  types/
  styles/
public/
  assets/
docs/
  asset-manifest.json
  content-sources.md
  acceptance.md
```

以上是模块划分建议，可按已有工程调整。不得把全部场景、文案、存档与对话写在同一个组件里。

## 11. 核心数据契约

以下类型定义业务边界，可按实现补充字段，但保持内容数据与渲染代码分离。

```ts
type CampusId = 'harvard' | 'mit';
type Vec3 = [number, number, number];
type InterestTag =
  | 'technology' | 'humanities' | 'arts'
  | 'science' | 'business' | 'undecided';

interface ExplorerProfile {
  id: string; // 本地随机 ID，不是假造的 Pulsetact 用户 ID
  nickname: string;
  grade?: string;
  interests: InterestTag[];
  avatar: { outfit: string; skin: string; hair: string };
  createdAt: string;
}

interface SourceRecord {
  id: string;
  title: string;
  url: string;
  publisher: string;
  checkedAt: string; // 只有实际核验过才能填写
}

interface PointOfInterest {
  id: string;
  campusId: CampusId;
  nameZh: string;
  nameEn: string;
  sceneId: string;
  interactionAnchor: Vec3;
  discoveryRadius: number;
  interactionRadius: number;
  summary: string;
  facts: Array<{ text: string; sourceIds: string[] }>;
  reflectionPrompt?: string;
  photoPose?: { position: Vec3; target: Vec3 };
}

interface DialogueNode {
  id: string;
  text: string;
  sourceIds?: string[]; // 学校事实需要来源，虚构个人观点无须假造来源
  choices: Array<{
    id: string;
    label: string;
    nextNodeId?: string;
    action?: { type: 'start_activity'; activityId: string };
  }>;
}

interface NpcDefinition {
  id: string;
  campusId: CampusId;
  name: string;
  fictional: true;
  position: Vec3;
  persona: string;
  rootNodeId: string;
  dialogueNodes: DialogueNode[];
}

interface CampusDefinition {
  id: CampusId;
  nameZh: string;
  nameEn: string;
  contentVersion: number;
  spawn: { position: Vec3; yaw: number };
  pois: PointOfInterest[];
  npcs: NpcDefinition[];
  activityIds: string[];
  recommendedRoute: string[]; // 有序 POI ID，非自动寻路路径
  sceneConfig: {
    theme: string;
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    blockers: Array<{ id: string; x: number; z: number; w: number; d: number }>;
  };
}

interface CampusProgress {
  enteredAt?: string;
  discoveredPoiIds: string[];
  openedPoiIds: string[];
  talkedNpcIds: string[];
  completedActivityIds: string[];
  lastSafeOutdoorPose?: { position: Vec3; yaw: number };
}

interface ActivityRecord {
  id: string;
  campusId: CampusId;
  activityId: string;
  status: 'in_progress' | 'completed';
  stepId: string;
  answers: Record<string, string | string[] | number>;
  completionCount: number;
  explicitlySelectedInterests: string[];
  updatedAt: string;
}

interface JournalNote {
  id: string;
  campusId: CampusId;
  relatedId?: string;
  text: string;
  updatedAt: string;
}

interface PhotoRecord {
  id: string;
  campusId: CampusId;
  poiId?: string;
  blob: Blob; // 仅保存在 IndexedDB
  createdAt: string;
}

interface SaveDataV1 {
  schemaVersion: 1;
  profile: ExplorerProfile;
  currentCampusId?: CampusId;
  progress: Record<CampusId, CampusProgress>;
  favorites: string[]; // 全局唯一 POI ID
  activities: ActivityRecord[];
  notes: JournalNote[];
  settings: {
    quality: 'low' | 'medium';
    reducedMotion: boolean;
  };
  updatedAt: string;
}
```

所有 ID 稳定且唯一。内容加载时检查重复 ID、无效 route/POI/NPC/activity 引用、对话死链与不可达结束节点。关键结构变化提升 schemaVersion 并提供迁移或恢复行为。

### 11.1 进度规则

每校主进度由 3 个已打开地点、2 位已完成至少一个话题的人物、1 个完成活动组成，共 6 项。进度显示为 `已体验 x/6`，两校合计 `x/12`。

仅发现地点不计入主进度；进入人物菜单但未完成话题不计数。收藏、拍照和笔记是自由行为，不作为完成门槛。重复互动不重复加分。界面可同时显示地点的「发现/已了解」状态。

## 12. 对话与未来 AI 接入

### 12.1 P0：完整预设对话

以 JSON/TypeScript 对话树实现，每位人物至少 3 个话题，可返回话题列表、结束对话或进入对应活动。首次交流显示轻量标记「虚构学生角色」。

不出现无效的自由输入框，不展示正在连接 AI 的假状态。核心任务完成由确定性活动规则控制，对话只能提出启动活动的动作。

### 12.2 P1：provider 接口

为未来接入留一个独立边界，不在 P0 构建不必要的服务端：

```ts
interface DialogueRequest {
  campusId: CampusId;
  npcId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  context: { interests: InterestTag[]; selectedPoiId?: string };
}

interface DialogueResponse {
  text: string;
  sourceIds: string[];
  suggestedReplies: string[];
  action?: { type: 'suggest_activity'; activityId: string };
  mode: 'live' | 'fallback';
}

interface DialogueProvider {
  reply(input: DialogueRequest, signal?: AbortSignal): Promise<DialogueResponse>;
}
```

未来服务端可以提供 `POST /api/dialogue`，但接口是拟定契约，不表示现有 Pulsetact 后端已经实现。

接入时的必要行为：

- 服务端读取 API Key，客户端构建产物不能含密钥；模型名通过服务端环境配置。
- 服务端用经过验证的 campusId/npcId 选择角色与知识资料，不能信任客户端自带 system prompt 或资料正文。
- 校园事实来自有来源的内容库；资料不足时明确不确定，并提供官方页面。
- 人物个人观点保持虚构身份；不编造现实课程安排、开放权限、费用或录取结果。
- 对话输入、输出均做长度与结构校验；回复作为文本渲染，不执行模型生成代码或任意 HTML。
- 单轮先按 800 字输入、最近 10 条历史、20 秒超时设计；服务端限流可配置。
- 请求失败显示简短提示并提供预设话题；对话请求不能阻塞地图、存档或场景运动。
- 用户关闭对话/切换校园时取消请求；过期响应不得写入新人物的对话。
- 返回 action 仅能引用当前校园允许的活动；执行前经过客户端白名单校验和用户主动选择。
- AI 不直接修改进度、profile、成绩或手册记录。

## 13. 探索手册、照片与 Pulsetact 连接

### 13.1 手册页面

包含「概览、学校、照片、笔记」四类内容。学校详情显示已了解地点、人物话题、活动结果、收藏与待了解问题。

两校对照使用个人记录表：去过哪些地点、参加过什么活动、自己收藏了什么、还有什么问题。不能自动输出学校优劣排名、录取率或用户匹配分。

笔记支持新建、编辑、删除，单条最多 1000 字。输入按普通文本处理，保存结果有明确反馈。用户可以只浏览而不填写。

### 13.2 拍照

- 打开拍照模式后隐藏 HUD，暂停角色位移，允许调整镜头并重置到地标推荐机位。
- 捕获真实当前 3D 画面，包括角色与场景；不能用预设图片冒充用户截图。
- 使用渲染帧捕获或离屏 render target 的方式生成 PNG Blob，避免长期打开高成本缓冲保留配置。
- 默认输出最长边 1600 像素，保持画面比例；右下角可加地点名与 Pulsetact 字样。
- 照片保存至 IndexedDB；Object URL 只用于展示，用完释放，不作为永久存档地址。
- 支持查看、删除、下载。最多保留 20 张，单张目标不超过 3 MB；超限时请用户删除旧照片，不自动覆盖。
- 截图或存储失败时显示具体可恢复提示，不增加成功照片计数；若已生成 Blob，可提供直接下载。
- 只加载自有/同源或正确 CORS 配置的画面资产，避免截图时 canvas 被污染。

### 13.3 未来 profile bridge

P0 实现一个只返回候选数据的本地适配器，未来可由真实 API 替换：候选数据仅包含用户明确选择的兴趣、明确收藏的学校、明确写下的问题，并带上来源活动/笔记 ID。

不得根据停留时间、移动路径或点击次数直接修改专业匹配分。未来同步前让用户看到具体内容并主动选择保存；P0 不显示「已同步到 Pulsetact」的假状态。

## 14. 保存、恢复与异常处理

- 结构化存档 key：`pulsetact:campus-explorer:save:v1`；照片使用独立 IndexedDB 数据库。
- 收藏、完成对话、完成任务和笔记修改后触发防抖保存，默认约 500 ms。
- 角色安全位置每约 5 秒节流记录一次，切换学校时额外保存；不依赖关闭标签页时才能保存。
- 刷新后优先恢复上次校园的安全户外位置；室内活动的草稿仍可从入口继续，避免恢复在未加载的房间。
- 加载存档时校验版本、字段、内容 ID 和位置边界；无效引用忽略或迁移，不导致白屏。
- 解析失败时保留原始坏存档供下载，提示恢复默认状态；不静默覆盖用户全部记录。
- 存储不可用或额度不足时允许当前会话继续，提示进度可能无法保留；不反复弹窗。
- 重置有明确确认操作，并清除本应用的结构化数据和照片；不得清空同域其他应用存储。
- 多标签页检测到外部更新时提示重新载入，暂停本页自动写入，避免互相覆盖。
- 场景与模型加载提供重试、返回地图；WebGL 不可用时仍可访问手册和内容列表，并说明 3D 当前不可用。

## 15. 性能目标与资源生命周期

以下是工程预算与测试目标，不是已验证的运行承诺。以指定的桌面测试环境实测并记录浏览器、CPU/GPU、分辨率和画质。

| 项目 | 初始目标 |
| --- | --- |
| 默认画质 | medium，DPR 上限 1.5 |
| 流畅度 | 普通办公笔记本 1280×720 下争取稳定 30 FPS；更强设备争取 60 FPS |
| 首校园资源 | 首次可玩所需压缩传输资源争取 ≤ 12 MB，单独统计 JS 与场景资源 |
| 冷启动 | 20 Mbps 模拟网络下，进入首个校园争取 ≤ 8 秒 |
| 当前场景三角形 | 初始控制在约 150k 以内，按实际性能调整 |
| draw calls | 初始控制在约 150 以内 |
| 同时加载 | 仅当前校园及必要共享资源 |

低画质降低阴影、DPR、装饰密度；不删掉互动目标和主地标。树木等重复对象考虑实例化；静态几何与材质复用。

切换校园时正确卸载事件监听、动画循环、临时纹理和独占几何；共享资源按引用关系管理，不能误释放另一处仍使用的材质。照片预览释放 Object URL。

页面后台暂停持续更新，恢复后限制首帧 dt。不要在开发过程中为追求复杂光影加入大量后处理。

## 16. 内容与资料规则

校园事实和虚构体验分开存储。POI 事实逐条关联 SourceRecord；人物剧情和活动标注为 Pulsetact 创作。更改文案无需修改渲染组件。

首版可以基于以下官方入口核验：

| 来源 | 用途 |
| --- | --- |
| [Harvard Campus Tours](https://www.harvard.edu/visit/tours/) | Harvard Yard 导览范围与官方访校资料 |
| [Harvard Maps and Directions](https://www.harvard.edu/visit/maps-directions/) | 制作时核验建筑位置与空间关系 |
| [Harvard Widener Library](https://library.harvard.edu/libraries/widener) | 制作时核验图书馆事实与外观参考 |
| [Harvard Memorial Church](https://memorialchurch.harvard.edu/) | 制作时核验教堂信息与外观参考 |
| [MIT Visit](https://www.mit.edu/visitmit/) | Killian Court、Great Dome、Infinite Corridor 等参观资料 |
| [MIT Campus Map](https://whereis.mit.edu/) | 地标位置核验 |

文档前期已查阅 Harvard 导览、MIT Visit 和 MIT Campus Map；其余链接是实施阶段的官方核验入口，不能未经阅读就填入 checkedAt。实际内容以开发时成功读取并核验的页面为准。

P0 以稳定校园信息为主，不加入需要持续更新的申请截止日期、招生政策、学费、活动日程和现实参观开放时间。官方链接可供用户继续了解。应用欢迎页与关于页标明「Pulsetact 独立制作的校园探索体验」，不能暗示学校官方授权或背书。

## 17. 开发顺序与每阶段交付

### M1：一个校园的可玩骨架

建立工程、路由、内容类型和状态；先搭 MIT 的可识别庭院与穹顶体块，加入角色、镜头、碰撞、一个 POI、一位人物和信息卡。

验收：能进入场景、走到目标、互动并返回，角色不会穿过主要建筑，画面有校园空间感。此阶段不追求全部美术细节。

### M2：跑通单校完整循环

实现 MIT 的 3 个地点、2 位人物、室内项目活动、手册、收藏与本地存档。完成学校 6 项进度规则。

验收：从欢迎页到完成活动和刷新恢复的完整流程可玩，不依赖外部 API。

### M3：加入 Harvard 与区域地图

基于共用系统增加 Harvard 内容、独有建筑组件、讨论活动，以及两校切换和个人记录对照。

验收：两校的画面与内容具有区别，来回切换保留各自进度；共同系统通过内容配置复用。

### M4：照片、视觉完善与发布准备

完成真实截图、照片管理、画质选项、加载失败恢复、输入焦点、资源清理和核心流程验证。补齐说明、来源及资产清单。

验收：达到第 18 节 P0 标准，提供实际界面截图与验证结果。若有模型、API 或部署环境限制，清楚列出；核心本地版本仍必须可启动。

M1–M4 均属于本次 P0。Codex 应连续推进，不在每个阶段结束时停下来等待普通实现选择的确认。若发现需求之间确有冲突，先完成不受影响的内容，再针对冲突提问。

## 18. 验收标准与验证方式

### 18.1 必须通过的功能场景

1. 无存档、无 API Key、无外部 GLB 的新环境中，可以启动并进入任一校园。
2. 新建和继续都可用；跳过 profile 不影响校园探索。
3. 两个校园各有 3 个有效地点、2 位可对话人物和 1 个完整活动。
4. WASD、方向键、镜头、碰撞、E 互动可用；远处或墙后目标不能直接触发。
5. 在对话、笔记输入、设置面板中按 WASD/E，不移动角色或触发其他活动。
6. 两项活动所有有效分支可完成；中途退出后可继续；MIT 超预算不可提交。
7. 地点、人物和活动正确去重，每校最多 6 项主进度。
8. 收藏、笔记和进度刷新后保留；切换学校后恢复各自记录。
9. 拍照输出当前场景的非空 PNG，角色可见，手册可查看，刷新后仍在，下载与删除有效。
10. 照片达到上限、存储失败、模型加载失败时有可恢复反馈。
11. 连续切换校园 10 次无重复输入监听、重复触发或持续增长的场景对象。
12. 直接打开校园 URL、未知 URL、损坏存档、WebGL 不可用时都不会无说明白屏。
13. 学校事实有来源，虚构人物与示意室内有标记，未接通功能没有假成功状态。
14. 构建、类型检查与关键测试通过；未实际运行的测试不得写成通过。

### 18.2 自动化验证只覆盖高价值风险

- 单元测试：移动方向归一化与碰撞边界、任务预算/指标规则、进度去重、存档校验与迁移。
- 内容验证：ID 唯一、引用存在、对话路径可结束、两校各具备规定内容。
- 浏览器测试：新建 → 入校 → 互动 → 收藏 → 活动完成 → 刷新恢复；再覆盖切换学校与拍照保存。

3D 浏览器自动化可能受软件渲染性能影响。可提供仅开发/测试构建启用的状态检查入口帮助断言，但测试仍需覆盖真实输入与可见交互，不能把直接写入成功状态当成游玩验证。

### 18.3 人工视觉与交互检查

检查 Harvard、MIT、室内活动、对话面板、地图、手册和照片至少各一张截图。确认地标有辨识度、角色不被遮挡、UI 不截断、文字可读、互动提示不重叠。

性能记录采用固定环境和相同路径，分别记录两个校园画质、FPS、资源体积及首次加载。若未达预算，列出实测差距与瓶颈，不用空泛的「已优化」代替证据。

## 19. 最终工程交付物

- 完整源码、内容数据和素材；lockfile；必要环境变量示例，不含真实密钥。
- README：项目说明、实际运行环境、安装/启动/构建命令、操作方式、P0/P1 范围。
- `docs/content-sources.md`：逐地点事实、来源及核验日期。
- `docs/asset-manifest.json`：资产来源、许可及备用方案。
- `docs/acceptance.md`：已完成项、实际验证命令、截图位置、性能结果、已知限制。
- 若资产由脚本生成，提交生成脚本及产物；不能只有当前机器能找到的临时绝对路径。
- 按选定包管理器提供等价的 `dev`、`build`、`typecheck`、`test`、`test:e2e` 脚本。

如果没有后端或部署账号，交付可本地运行和可构建的 P0，并说明部署需要的 SPA 配置。不要为此虚构线上地址或宣称已接入 Pulsetact。

## 20. 给 Codex 的执行指令

请依据本文直接实施 P0。先检查现有仓库说明与依赖，复用兼容的结构；空仓库按默认技术栈初始化。记录实际采用的版本和合理偏离。

优先做出有角色、有校园空间、有互动反馈的可玩场景，按 M1–M4 连续完成两校探索闭环。程序化建筑需要体现各校地标轮廓；没有 Blender 或外部 GLB 不能阻塞开发。没有 AI Key 时使用完整预设对话，不产生失效输入框。

将校园布局与内容做成配置，把移动、相机、碰撞、互动、手册和存档做成可复用系统。不要把首版做成只有学校卡片的展示网站，也不要在 P0 加入长期养成、录取预测和多人系统。

完成后交付工程、运行步骤、实际验证结果、主要画面截图和已知限制。所有按钮必须有行为或明确状态，所有「已保存」「已完成」必须对应真实状态变化。

**最终体验标准：学生能用自己的角色逛 Harvard 和 MIT，了解几个地点，与人物交流，参与一次活动，并带走属于自己的探索记录。**
