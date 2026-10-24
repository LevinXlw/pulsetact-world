# Pulsetact World：MIT 首个可玩片段

2026-10-07。新版目标：以真实 Boston 大学城为舞台，采用《旷野之息》《王国之泪》启发的绘画感美术与第三人称探索，结合真人社交和 5–15 分钟互动小课。初始地域规划为 MIT、Harvard、BU。

2026-10-10 续作：完成访客身份与个人手册隔离、课堂断线保护、晚加入者的独立完成判定和双人浏览器验收。

**当前入口（2026-10-15）：** `/` 和 `/world/mit` 使用 `SoloWorldPage.tsx` 的单人旅程，默认不请求联机服务。地图可切换四个独立地域：Boston 大学城（MIT、查尔斯河与 BU）、University of Maryland, College Park（UMD）、University of Pennsylvania（UPenn）及 University of Arizona（Tucson）。地球总览显示六所学校、四个城市区域；Harvard 仍标为待开放。Boston 内可连续步行探索 BU 的 East、Central、West 与 South Campus，其余地域通过校园旅行切换。角色为白 T 与 Sakurada，每个地域的位置、三处 MIT 发现、个人光学实验、三十一处 Boston 河岸与 BU 到访及三十一处跨校到访（UMD 十九处、UPenn 三处、Arizona 九处）保存在本机。此前联机实现保留在源码中；下文历史联机交付不代表当前默认玩法。

## 正式域名部署（2026-10-16）

已发布至 https://world.pulsetact.ai ，Cloudflare Worker 为 `pulsetact-world`，当前版本 `2c1bc43a-1dd3-426f-ae23-49bafd876c0b`（BU 主校区建筑与街景校正、手机地标烘焙及高清回归）。自定义域名已绑定，HTTPS 首页返回 200。

线上使用 SQLite Durable Object 保存 8 小时登录会话及登录限流状态，支持跨 Worker 实例恢复和退出撤销；固定账号仍由 `server/auth-credentials.mjs` 提供，修改密码并重新发布后旧会话失效。Cookie 启用 HttpOnly、Secure、SameSite=Lax。校园模型、人物及天空文件在提供前也检查会话。

部署清单中的 94 个静态文件合计 133.46 MiB；手机与桌面按设备分别加载对应资源，并非同时下载所有文件。高清人物仅在主动选择高清后加载。原始大型 detail GLB 通过 gzip 内容保留同一访问地址，未使用的植被 GLB 不上传。本次发布为单人体验，历史多人 API 不在 Worker 上启用。存档仍保存在浏览器中，本地预览与正式域名分别保存。

Arizona 阶段自动验证覆盖 182 项测试：全套 181 项通过后补测 Arizona 建筑内存档恢复与 ENR2 开放中庭；生产构建通过。Arizona 本地与正式域名各 7 项浏览器流程通过，覆盖九个落脚点、地图搜索、步行后刷新恢复、跨校存档、低画质及手机布局，零页面、着色器与网络错误；地球总览原有 10 项流程回归通过。证据在 `output/arizona-campus/local/`、`output/arizona-campus/production/` 与 `output/globe-atlas/local/`。刷新检查在停止行走后等待完整的 3 秒自动保存周期，避免把移动中的旧快照与 pagehide 刷新的最新位置错误比较。

上一版 UMD 的 8 项浏览器流程在本地与正式域名均通过，涵盖 19 个落点、地图搜索、行走、到访/跨校进度保存、被新楼占据的旧位置恢复、低画质及手机布局，零页面、着色器与网络错误。报告与截图在 `output/maryland-full-campus/local/`、`output/maryland-full-campus/production/`。Boston 的长距离逐步导航测试明确使用 15 秒功能验证时限（与相邻几何测试一致），避免把 5 秒默认超时误当作性能断言。

上一版地球总览的 10 项浏览器流程在本地与正式域名均通过，包括鼠标/键盘/双指操作、五校选择、实际落点、跨校保存、关闭后恢复行走、加载失败重试和手机布局。报告与截图在 `output/globe-atlas/local/`、`output/globe-atlas/production/`。

上一版 BU 扩展已通过正式域名 8 项部署检查（匿名保护、错误密码、两个角色、三个地域、跨校到访、刷新保存、退出撤销和手机布局），报告在 `output/deployment/production/`。BU 的专项验证见下节，截图在 `output/bu-full-campus/production/`；Maryland 全部 19 个地点的独立检查保留在 `output/maryland-full-campus/production/`。

## BU 主校区建筑与街景校正（2026-10-16）

范围仍是 Charles River Campus 的 East、Central、West、South 四个分区，Fenway 和 Medical 尚未开放。继续采用 Boston City 建筑轮廓与 MassGIS / MassDOT 道路坐标；不同建筑按真实结构和官方参考单独处理，保留风格化材质。

- CDS 改为 115 英尺方形楼板、23 英尺错层模数、东侧五层裙房和青铜色遮阳构件，补充露台、退进入口和顶部轮廓。Marsh Plaza 增加花岗岩铺装分缝与低矮的 Free at Last 纪念雕塑；不把图纸或参考照片作为游戏贴图分发。
- Warren 保留共同底座上的三座塔楼，修复服务裙房被重复画成小塔楼的问题；Student Village II 按不同高度的塔楼、连接体和核心筒建模。West Campus 宿舍改为混凝土窗格与大片砖端墙，GSU/Mugar、法学院及沿街 brownstone 分别补充结构网格、退进玻璃、门廊、檐口和入口细节。
- 街道增加根据建筑面和真实人行道边缘推导的临街铺装。Brownstone 保留前庭，仅铺窄入口步道。Cummington、Hinsdale、Blandford Mall 保留沥青服务车道及独立人行道；Green Line 的 Amory / Babcock 使用约 68.6 米站台与 45.7 米雨棚，补充站台端部和西段自行车道隔离设施。
- 地图增加 Booth Theatre、Yawkey / Marciano、Rajen Kilachand Center 的独立到访点。Kilachand Center 与 Kilachand Hall 分开标识；CDS 的现代轮廓作为明确标注的原创地图要素补入旧 GIS 数据。
- 手机离线包加入 CDS、Questrom、Marsh、Castle 的建筑轮廓，以及简化的 Warren、Student Village、法学院和球场／Langsam Garage。手机运行时仍只解析焊接后的轻量 GLB，不调用桌面建筑构造器；保留先省电进入、手动开启高清的流程。

重建手机 Boston 包：`node scripts/prepare-mobile-campus.mjs boston`。实际几何验证：`node scripts/check-bu-campus.mjs`，手机用 `--mobile`；浏览器验证：`node scripts/check-bu-playable.mjs [URL]`，触屏模式用 `--mobile`。街景检查图由 `scripts/capture-bu-campus.mjs` 从实际运行时场景生成，保存在 `output/bu-full-campus/art/`。

最终手机 Boston 包为 20,200,980 字节（19.27 MiB）、512,625 三角形、116 个可见网格，不含位图纹理。读取模型及配套元数据时重新验证 ETag，防止发布后新道路数据与浏览器里缓存的旧碰撞模型混用。桌面完整分区建筑约 272.6 万三角形，相比上一版约减少 7.3%；这不是整个场景的总提交量或帧率保证。

216 项自动测试、类型检查与发布构建通过。桌面、手机各 30 个安全落点（29 个 BU 到访点加 BU Bridge 北端回归点）、58 条有向路线通过 104,665 次实际地面／碰撞采样，最大相邻步高差分别约 12.1 cm／10.5 cm。Langsam 上层球场的缓坡另通过 437 次采样，最大步高差约 6.0 cm。本地浏览器桌面 7 项、触屏 9 项 BU 流程通过，覆盖搜索、全部到访、键盘／方向键移动、存档及手机高清与省电重载；手机原有 18 项高清／跨校／恢复流程通过。手机首次进入采样峰值为 JS 75.71 MiB、缓冲 66.14 MiB，分别满足 128／96 MiB 的回归预算；不代表真实 iPhone 的进程或 GPU 内存上限。

正式域名同步通过桌面 7 项、触屏 9 项 BU 检查与 18 项手机高清回归，无页面、着色器或意外网络错误。证据分别在 `output/bu-full-campus/production/`、`production-mobile/` 与 `output/mobile-hd/production/`。这些是桌面 Chrome 与触屏模拟验证，真实 iPhone Safari 仍需实机验收。

建筑比例和立面构件依据官方照片、项目图纸与结构资料进行原创建模；铺装、家具与树位仍包含推断，并非逐门逐树测绘。Booth、Yawkey 和 Kilachand Center 的来源轮廓仍属有出处的近似体量。BU 的地面仍由建筑基底高程插值，并非完整裸地 LiDAR 地形。Brookline 方向的周边城市街区、河对岸环境建筑、逐户前院、室内、实时交通与实时施工状态尚未完整实现。依据与简化范围分别记录于 `assets-source/charles-bu/landmark-realism-2026.json`、`district-realism-2026.json`、`street-realism-2026.json`。

## 手机进入后切换高清材质（2026-10-16）

进入校园后，右上角「设置」可选择「切换高清材质」，也可「切回省电」。手机每次重新打开页面仍从省电模式开始；其他标签页同步探索存档时不会替本页开启高清。切换保留位置、镜头、校园、角色与探索进度，不重建 Canvas 或校园几何。下载过程中可立即返回省电；高清人物下载失败自动回退，渲染中断仍通过省电重试恢复。

- 环境高清层使用现有轻量网格上的世界坐标材质，增加石缝、砖缝、铺装、草地色差、木纹、玻璃反光等。四校园的高清材质按来源材质缓存复用，不新增贴图、几何、碰撞或渲染通道。切回省电恢复原材质，切校园释放材质缓存。
- 白 T / Sakurada 高清人物位于 `public/assets/characters/mobile-hd/`：脸部最高 1024px、衣服与头发最高 512px，小型眼睛/眉毛/嘴部叠层保持 256px。GLB 分别为 3.331 / 5.127 MiB，解码 RGBA 加完整 mipmap 估算为 13.0 / 14.917 MiB。几何、骨骼、变形与五组动画保持原数据；这两项贴图预算不代表进程或 GPU 总内存。
- 高清 DPR 最高 1.5，省电 DPR 1；手机两档都关闭动态阴影、抗锯齿与保留绘制缓冲，始终使用轻量校园。该功能提升材质与清晰度，不恢复桌面完整建筑与植被细节。
- 高清人物最后一个使用者退出时释放专属贴图、ImageBitmap 和几何源；轻量人物继续复用小缓存。已开始的高清解码无法被 Fetch 中止，取消后再次开启会复用同一任务；无人使用的迟到结果立即释放。解码超时后的重试也不会启动重叠解码。

重建人物：`scripts/prepare-mobile-characters.py --profile hd`；验证入口：`node scripts/check-mobile-hd.mjs [URL]`，截图与报告在 `output/mobile-hd/`。资源生命周期另外通过延迟解码模拟，覆盖取消后重开、解码超时、迟到结果与恰好一次释放。

本地与正式域名各 18 项高清流程通过，涵盖首次安全进入、下载与解码中取消、三轮画质切换、有效 585×1266 PNG、高清下载故障自动回退、Sakurada 重试、四校园旅行、模拟 context-loss 后省电重试、刷新后省电进入；无页面、着色器或意外网络错误。正式域名三轮降级后的缓冲为 60.24 / 60.14 / 60.14 MiB，无逐轮增长；完整流程分别采样的峰值为 JS 72.05 MiB、缓冲 160.32 MiB，不可相加作为进程内存，也不包含全部 GPU 分配。末尾显式 GC 仅作诊断，不参与通过条件。另有 203 项自动测试、本地手机原有 10 项入口恢复检查、桌面完整场景与键盘行走、类型检查及发布构建通过。以上使用桌面 Chrome 触屏模拟，真实 iPhone Safari 尚未验收。

## 手机场景内存修正（2026-10-16，上一阶段）

用户在 iPhone Safari 上遇到整个页面的「重复出现问题」崩溃提示。上一版入口恢复解决了按钮与加载提示，却没有消除场景的大量分配：旧省电模式仍会解码完整 MIT / Killian 模型，再构造桌面校园、植被和地面三角形索引，最后才隐藏细节。

- 触屏设备在起名页不创建 WebGL Canvas、不下载校园或人物；点击进入、收起键盘后才启动。旧会话的自动进入标记不再触发手机重载后立即重建场景，昵称及探索进度仍恢复。
- 手机固定使用独立的离线轻量校园 GLB。原始桌面构造器通过动态模块隔离，手机不请求完整 MIT 与 Killian 模型。Boston 保留河岸、桥面与 BU 轮廓；UMD / Arizona 保留道路、建筑轮廓及地形高程，立面和植被使用简化表示。地面索引改为紧凑数值缓冲，其他三校使用高程网格。UMD / Arizona 各 6,000 个实际表面采样通过：裸地与物理高度误差小于 0.5mm，简化铺装的最大偏差分别约 6.12cm / 5.85cm；这是有界近似，非逐点完全重合。
- 最终手机校园使用专用 GLB 解析器，顶点、法线与索引直接引用同一下载缓冲，避免通用解析器逐段复制。解析器验证文件格式、数据边界和索引，兼容归一化 Int16 法线；换校时清空碰撞及几何引用，释放旧资源。
- 堆快照另外确认连续换校的独立泄漏：每次重建 Canvas，缓存的人物几何会通过 dispose 监听器保留旧 renderer 的七份 morph-target 纹理缓冲，合计约 7.14 MiB；每轮四次换校增长约 28.57 MiB。现改为换校只替换 CampusWorld、保留 Canvas，并对共享人物几何计数，在最后一个人物实例离开时释放 GPU / morph 缓存，同时保留可供下次上传的原始顶点。错误重试、人物预览退出等真正重建画布的流程也使用这套清理。
- 两个人物保留原骨骼与五组动画，手机贴图缩为脸部最多 512 像素、其他最多 256 像素。Canvas 固定 DPR 1、关闭抗锯齿和保留绘制缓冲；拍照时立即绘制一帧再导出，保证照片有效。地球总览手机纹理缩为 1024×512 与 512×512，关闭后释放资源。
- 手机容器使用稳定视口高度，减少 Safari 地址栏变化带来的画布重建。下载失败和模拟 WebGL 中断仍可重试，昵称、角色、照片与学习进度保留。

Chrome 390×844 触屏模拟同条件启动测量：JavaScript 已使用堆峰值从 519.47 MiB 降至 74.61 MiB；底层数组缓冲峰值从 901.18 MiB 降至 60.27 MiB，分别下降约 86% 和 93%。这两项是分别采样得到的峰值，不能相加作为进程总内存，也不包含全部 GPU / 浏览器内存。报告见 `output/mobile-budget/local-baseline/` 与 `output/mobile-budget/local/`；`node scripts/check-mobile-budget.mjs --assert` 同时检查不加载旧模型以及 128 MiB 堆、96 MiB 缓冲的启动预算。

本地 10 项手机入口、慢加载、故障恢复、角色切换、有效 PNG 下载检查通过；全套 203 项自动测试通过，包含新增的 4 项地面射线对照与 17 项零复制解析检查。桌面完整 MIT / Killian 资源、标准渲染配置及键盘行走回归通过。验证采用 Chrome 触屏模拟，当前没有真实 iPhone Safari 验收结果，不将合成 context-loss 事件或桌面内存采样视为真实设备稳定性保证。

最终正式域名的 10 项入口检查、20 项旅行／恢复检查通过，无页面或意外网络错误。旅行连续三轮，每轮 Boston → UMD → UPenn → Arizona → Boston，逐次验证真实触屏行走、同一 Canvas 持续使用、存档保留，之后额外执行三次合成 context-loss 与重试。每轮回到 Boston 时的缓冲分别为 43.89 / 43.93 / 43.89 MiB，没有逐轮增长；全部旅行及重试自然运行的峰值为 68.70 MiB JS、92.51 MiB 缓冲。本地修复后堆快照中七种人物 morph 缓冲均只剩一份，修复前每种九份。末尾显式 GC 仅供诊断，不计入成功条件或上述自然运行峰值；正式站点末尾缓冲为 GC 前 43.98、GC 后 43.88 MiB。脚本 `scripts/check-mobile-travel.mjs [URL] --loops=3 --retries=3`，报告 `output/mobile-travel/local/` 与 `output/mobile-travel/production/`。

可重建资源：`scripts/prepare-mobile-mit.mjs`、`scripts/prepare-mobile-campus.mjs`、`scripts/prepare-mobile-characters.py`。MIT 中间文件放在 `assets-source/mobile/`；发布目录只包含最终校园、地形网格、人物与来源说明。手机建模细节降低是当前稳定性取舍，桌面场景继续使用完整资源。

## 移动端入口恢复（2026-10-16，上一阶段）

此前起名表单的提交按钮等待整个校园及人物加载后才启用，加载状态又被入口卡片遮挡，手机慢加载时表现为按钮一直灰色。本轮允许先提交昵称，收起输入键盘并进入明确的加载页面；实际场景就绪前仍暂停移动并隐藏游玩操作。

- 本阶段首次使用触屏设备默认省电画质，已有画质选择保留；后续内存修正已将手机统一切换到轻量模式。昵称输入字号为 16px，并提供软键盘前往提示。
- 加载 15 秒后出现省电重试入口，90 秒未完成显示可恢复错误；人物下载及解析单独设 60 秒截止时间，失败缓存会移除。
- 下载失败、场景异常或 WebGL context loss 会显示错误与重试。重试重建场景、降低画质，保留昵称、角色、位置和探索记录。
- 本地与正式域名各 8 项手机触屏流程通过，覆盖中文昵称提交、缩短视口、慢加载、下载失败、保留存档重试、Sakurada 切换和模拟渲染中断恢复；无页面、着色器或意外网络错误。另有 24 项存档/落点测试及生产构建通过。脚本 `node scripts/check-mobile-entry.mjs [baseUrl]`，证据 `output/mobile-entry/local/` 与 `output/mobile-entry/production/`。缩短视口和 context loss 使用模拟，未验证真实 iPhone 键盘或物理 GPU 故障；当前环境 WebKit 安装未完成。

## University of Arizona · Tucson 主校区（2026-10-15）

地图 → 地球总览 → Arizona →「进入 Arizona 校园」，或地图 → 校园旅行 → Arizona。九处到访为 Old Main、University Mall、Student Union、Main Library、Bear Down、Eller McClelland Hall、ENR2、Arizona Stadium、Arizona State Museum。地图有五个分区、真实楼体轮廓搜索、步行指引和快速旅行；原有校园的记录与位置继续保留。

- 官方 PDC Enterprise GIS 的 226 个建筑编号转为 319 个建筑构件，保留凹口、多翼和庭院孔洞。7,037 个官方道路、步道与景观面使用同一东/南米制投影，没有独立缩放或移动楼中心；地下 ILC 不挤出到 Mall 上方。
- USGS 3DEP 192×192 单波段浮点高程提供 36,864 个约 9m 间距样本，原始范围 728.785–753.557m。地面、铺路与碰撞共用 8m 三角网格，楼基边缘窄范围平滑，未放大高差。
- Old Main 独立十字主体、突出入口塔、环廊和台阶；Eller 采用南侧开放庭院和玻璃入口；ENR2 五个曲线翼楼保留可步行峡谷与上层连廊。其他建筑按真实轮廓生成立面，停车楼、McKale 和体育场另作结构处理。
- 增加棕榈、mesquite、palo verde、saguaro、agave；外围沙漠地面与北侧山影为艺术背景。地图增加美国西南部焦点；画面采用暖色地面反光。
- 修复角色在场景替换/开发热更新时，旧动画实例已释放却仍被更新的问题；释放现在幂等，动画不再访问已移出缓存的 action。

几何验收：30,028 个采样、664 段双向路线、9 个落点、72 对目的地组合全部通过，最大步进高差 0.1655m。报告 `output/arizona-campus/geometry-report.json`；单独检查命令 `node scripts/check-arizona-campus.mjs`。浏览器检查为 `node scripts/check-arizona-playable.mjs [baseUrl]`；模型实拍为 `node scripts/capture-arizona-campus.mjs`，图在 `output/arizona-campus/art-review/`。

可从保存的官方数据重建：`python scripts/prepare-arizona-terrain.py`，再 `node scripts/prepare-arizona-campus.mjs`。来源与参考照片在 `assets-source/arizona/geography-references.json`、`landmark-references.json`。高程由 `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage` 导出，参数为 bbox `-110.961,32.223,-110.942,32.239`、bboxSR/imageSR `4326`、size `192,192`、adjustAspectRatio `false`、format `tiff`、pixelType `F32`、renderingRule `{"rasterFunction":"None"}`。GeoTIFF 与导出范围元数据都保存在来源目录。

边界：本轮范围为 Tucson 主校区核心与 Speedway 北侧 Eller，不包含医疗校区及异地校区。实际位置与地形有数据依据；建筑层高、立面、树木位置及远山仍是风格化估计，未达到逐楼 BIM 或路缘台阶测绘精度。参考照片不作为运行时纹理发布。

## UMD 商学院与工程区校正（2026-10-15）

本轮修复此前“仅拉开楼中心、没有同比例转换楼体”的布局问题：17 栋既有建筑改为与道路、DEM 完全相同的横向坐标变换，取消两区的贪心平移，保留凹角与内院。IDEA Factory 与 Zupnik 使用 UMD 2026 年施工地图内置 GEO viewport 和矢量轮廓补齐；IDEA 的主楼、露台与连桥拆分，Zupnik 从错误的 Clark 北侧位置移回工程区南侧。转换沿用现有游戏坐标，仍非全校 1:1 测绘模型。

- 两区增加 19,890 个 Maryland iMAP 裸地 DEM 样本，局部共用地形网格由 12.5 细化为 6.25 世界米，建筑地基按实际轮廓处理；Van Munching 南侧凹口保留约 1.56m 坡差。道路与草地共用同一高度场，区域边缘贴回旧网格。
- Van Munching 使用独立模型，包含分段楼高、浅石材首层与腰带、内凹窗、玻璃楼梯间、金属山墙采光顶、开放西院及 Mayer Mall 钟塔。
- Martin、Kim、Clark、IDEA 分别细化双石门厅、圆厅白柱、连续窗带/遮阳栅、彩色玻璃/白色体量；IDEA 露台和二层短桥保留桥下步行，不作为地面采样。
- Mowatt 停车楼随真实轮廓放大，维持开放停车层。路面按凹形建筑多边形裁剪，地图也显示实际轮廓及内院。导航绕开修正后的楼体，旧存档若落入本轮修正建筑，会恢复到安全落脚点；开放院落和 SECU 球场中的正常存档保持原位。

可重建：`node scripts/prepare-maryland-full-layout.mjs`（末尾自动运行 `refine-maryland-districts.mjs`），然后运行 `node scripts/prepare-maryland-roads.mjs`。地形补丁准备脚本为 `scripts/prepare-maryland-district-terrain.mjs`。来源、照片参考与定位精度见 `assets-source/maryland/district-alignment.json`、`business-detail-references.json`、`engineering-sources.json` 与 `engineering-current-footprints.json`。参考照片只保留在开发源目录，未作为运行时纹理发布。

边界：建筑层高、立面细节和景观为依据官方照片/平面图的视觉重建，未达到测绘 BIM 精度。新增两楼的 PDF 定位误差估计约 3m；仍沿用历史 GIS 快照的道路资料，尚未逐条还原当前所有人行道、路缘石与施工变化。Zupnik 的 2026 年秋官方状态为主体接近完成、景观收尾，预计 2027 年春入住；本场景只提供室外探索。

验证：`scripts/check-maryland-campus.mjs` 对 150,931 个采样点、910 个双向路径段、342 组地点间旅程检查通过，最大单步高差 0.282m。`scripts/capture-maryland-fidelity.mjs --districts` 输出七个实时 WebGL 近景/鸟瞰，位于 `output/maryland-districts/`。专项测试覆盖轮廓与源数据一致、道路裁剪、精细地形接缝、内院开放、独立立面、停车楼与旧存档恢复。

## 地球校园总览（2026-10-15）

入口：地图 → 地球总览。交互球体支持拖动旋转、滚轮/双指缩放、方向键和加减键；「全球」「美国东北部」与「美国西南部」提供可恢复的视角。全球展示六所学校，Boston 的三所学校使用聚合点，UMD、UPenn 与 Arizona 分别标注；区域视角按 Boston、Philadelphia、College Park、Tucson 展开。Boston 的 MIT、Harvard 与 BU 在侧栏区域图中独立标注和选择。

- 校园位置采用 WGS84 经纬度，显示城市、坐标、相对当前学校的直线距离和主校区区域示意。轮廓是按官方地图整理的概览范围，不是地籍边界或已实现的可玩范围。
- MIT 与 BU 共用 Boston 世界，但进入按钮分别落在 Killian Court 与 Marsh Plaza；UMD 与 UPenn 复用各自保存的位置。Harvard 目前仅显示地理位置与核心校区示意，主世界入口标为待开放。
- 球体采用自托管的 Natural Earth 1:50m 公共域陆地数据；东北部使用单独的 2048 像素地理纹理，避免全球贴图放大后的低清晰度。该底图用于区域分布，不包含街道、河流或建筑。
- 打开地图后暂停背景校园的绘制，地球仅在操作、视角过渡和尺寸变化时绘制。关闭总览释放独立 WebGL 资源，恢复原场景行走。地球资源加载失败时仍保留学校选择和旅行，并可重试。

实现：`GlobeAtlas.tsx`、`CampusGlobe.tsx`、`CampusRegionInset.tsx`、`campus-atlas-data.ts` 和 `globe-geography.ts`。地理来源、轮廓制作依据、公共域许可与下载校验记录保存在 `assets-source/world-atlas/`；`node scripts/prepare-world-atlas.mjs --local` 可从保存的官方源快照重建运行时数据。

复核：`tests/globe-geography.test.ts` 检查球面坐标与 Three 原生 UV 一致性、东北部相对方位、真实距离范围和相机边界；`scripts/check-globe-atlas.mjs [URL]` 检查旋转缩放、学校选择、跨校园落点、旧进度、暂停恢复及手机布局。截图与报告位于 `output/globe-atlas/local/` 和 `output/globe-atlas/production/`。

## BU 查尔斯河主校区扩展（2026-10-15）

本轮范围为 East、Central、West 与 South Campus；Fenway 和 Medical Campus 按用户要求后续制作。主校区采用与 MIT 共用的米制坐标，沿 Commonwealth Avenue、Bay State Road、Cummington Mall 和南侧住宅街区展开，保留连续过河步行。

数据包含 458 个建筑组件、451 个独立 City GIS 轮廓；其中 277 个组件属于 BU 产权或明确确认的 BU 设施，181 个属于周边街景，不能将组件数量表述为独立的 BU 楼栋数。East Campus 延伸至 Danielsen Hall 和 Beacon Street 相邻校舍；现代 GIS 缺失建筑的三个补充包络明确标注估算。

- 建筑底图来自 City of Boston GIS，真实多边形轮廓保留凹角和内院，周边建筑与 BU 所属设施分开记录。Warren、法学院、Student Village、Agganis、FitRec、学院街墙和 brownstones 使用不同的体量与立面处理；门窗具有凹进、窗框、窗台、檐口和屋顶层次。
- 路网采用 MassGIS / MassDOT 中心线，包含两幅 Commonwealth Avenue、绿线轨道与站点、真实支路和 Mass Pike 下切交通走廊。BU Bridge 中间被数据源命名为匝道的真实桥段也纳入，转角桥面和分叉护栏通过步行碰撞检查。
- 河流西部弯曲岸线采用 MassGIS 水系数据。地形使用保留的建筑基底高程插值，路面和地面共用三角网格；旧校园核心及河边接桥保留原标高并平滑衔接。
- 运动设施包含 Nickerson 的球场、看台和宿舍群，New Balance Field 下方的 Langsam 开放停车层，以及垒球场。Langsam 坡道可实际步行抵达屋顶球场；现有地面查询优先取最高层，停车库下层仅可见，尚未实现上下两层同时自由行走。
- 地图支持四个校园分区、建筑名与地址搜索、建筑定位、附近快速前往和步行导航。旧 Boston 存档继续保留；如旧坐标落入本轮新增建筑，恢复时自动移至附近安全落点，不清除到访、照片或课程进度。

入口：地图 → 河岸与 BU → 选择分区或搜索建筑。各到访点可快速前往，抵达后按 E 记录。原 MIT 光学工坊、UMD 与 UPenn 的单人进度继续使用原存档。

复核工具：`scripts/check-bu-campus.mjs` 检查真实地面、碰撞及导航，`scripts/check-bu-playable.mjs [URL]` 检查浏览器游玩、搜索、旧存档迁移、到访保存与手机布局，`scripts/capture-bu-campus.mjs` 从运行时几何生成鸟瞰和街道视角。报告保存在 `output/bu-full-campus/`。

本地验收：154 项自动测试与生产构建通过；26 个用户到访点和 1 个桥北测试点、52 条双向路线通过 94,418 次真实几何采样，最大步进高差 0.121 米。`scripts/check-bu-langsam.mjs` 另外检查坡道与球场的 437 个采样点，零失败，最大台阶 0.060 米。本地 7 项浏览器流程通过，包含全部 26 个 BU 地点、旧 Warren 塔楼内部存档恢复、搜索、步行、刷新保存和手机地图，零页面及着色器错误。

线上验收：最终发布版本 `25735575-51c9-43f8-aa82-80505d122520` 的同一套 7 项 BU 浏览器流程全部通过，26 个地点均完成到访与刷新保存，页面及着色器错误为零。建筑内院在地图和存档安全判断中保留空洞。实机画面与结果见 `output/bu-full-campus/production/report.json`；构建体积警告仍提示部分校园数据分块较大，浏览器通过不代表全设备帧率保证。

精度边界：GIS 含历史测绘数据；楼高优先采用逐轮廓高度，避免把同一地块的最高值复制给所有裙楼。现代新增建筑的补充包络、窗门划分、树位和家具仍是参考图制作的近似。地形不是裸地 LiDAR 测量，建筑内部尚未实现。它是有真实路网与建筑轮廓依据的风格化户外校园，不代表逐栋建筑、室内或《王国之泪》同等级画面已完整复刻。

来源：[BU 官方地图](https://maps.bu.edu/?id=647)、[Boston 建筑 GIS](https://gis.boston.gov/arcgis/rest/services/Assessing/DOIT_buildings/MapServer/2)、[MassDOT 道路](https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/MassDOTRoads_gdb/FeatureServer/0)、[MassGIS 水系](https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Water_Features/FeatureServer/8)。原始下载、筛选索引和来源清单在 `assets-source/charles-bu/`，参考照片和图纸没有作为运行时贴图分发。

## 临时固定账号登录（2026-10-15）

所有应用路由在挂载游戏前校验后端会话。账号为 `tony`，随机密码按要求暂存于后端 `server/auth-credentials.mjs`，不写入前端包或浏览器存储。登录后使用 8 小时 HttpOnly / SameSite=Lax Cookie；刷新保持会话，服务重启需重新登录。游戏设置与角色选择页底部提供退出入口，退出撤销会话并同步其他标签页，保留本机存档。

开发服务、构建预览和 `npm start` 使用相同的登录中间件；世界 API 也要求有效会话。开发 HTTP 访问后端源码、配置临时包与世界存储目录被禁止。登录支持输入校验、错误反馈、失败次数限制与来源校验；学生身份认证和云存档仍未接入。

验证：108 项自动测试（含 9 项后端登录测试）、生产构建、7 项登录浏览器检查以及原有 11 项单人游玩检查全部通过。登录截图与报告在 `output/login/`；浏览器复核命令为 `node scripts/check-login.mjs`。单人、跨校和 Playwright E2E 检查已加入实际后端登录步骤，不绕过页面校验。

## MIT 环境美术第一轮（2026-10-13）

- 保留真实庭院几何、树位、碰撞与单人路线。树冠采用不规则内核与贴合外壳的叶簇；草叶改为弯曲几何，按 16 米单元分批，在 38 米淡出后停止绘制远处单元。
- 重新校准太阳方向、环境补光、阴影跟随和薄雾。暖色石材搭配深灰蓝窗面，减少重复接缝；近处草坪保留柔和笔触和大块色差。
- 使用内置 `image_gen` 生成原创手绘天空，映射到连续三维天空球并缓慢漂移。资源为 `public/assets/environment/mit-painted-sky-v1.png`，完整生成提示词和来源记录在同目录 `sky-source.json`；未使用任天堂图片作为游戏资源。贴图加载失败时保留程序天空，资源卸载时释放纹理。
- 实际游玩截图位于 `output/world-art-pass/before/` 与 `after/`；`output/world-art-pass/comparison.html` 提供三个机位的滑动对比。入口坐标相同，树下路径约有 0.2 米行走偏差。
- 1600×900 入口标准画质：绘制三角形 959,458 → 843,602，绘制调用 69 → 81。此项说明提交几何减少，不代表全设备帧率提升。
- 校验：87 项单元/服务测试、生产构建及三个机位浏览器渲染检查通过。单人浏览器脚本覆盖完整探索、下载留影、个人实验、刷新恢复、多标签页与触屏；增加场景确认恢复位置后才允许写回存档的保护。

这一轮仍是 MIT 单一区域的美术样板；建筑定制细节、树种差异、地表层次与环境叙事密度仍未达到完整商业开放世界的制作水平。

## MIT 环境美术第二轮（2026-10-14）

- 保留真实树位与碰撞代理，改为错落分叉和弯曲主枝，加入偏心、倾斜和下垂的冠团。沿冠团表面积分配原有叶片预算，采用均匀螺旋分布减小随机空洞；近景冠芯退到叶簇内部，远景保留完整体量。
- 继续聚焦单人近景：树根泥土复制实际草地三角面，柔和磨损按五块草坪的准确边界逐像素计算；近处少量落叶与三叶草，随距离淡出并停止提交。不会覆盖道路或增加移动障碍。
- 重建六张原有长椅，修正木条方向、靠背和框架；四脚分别采样铺装高度。主路径两侧各增加一张，西侧放置闭合笔记本。这八处家具位置属于美术布置，原有六处也并非实测家具清单；校园建筑和庭院坐标来源保持不变。
- 八张长椅提供实际碰撞，五个合并可见网格共 25,188 个三角形。省电模式关闭家具阴影并减少近景小植被；退出场景会释放实例缓冲。
- 对比页：`output/world-art-pass/second-comparison.html`。前三个机位与上一轮比较，另有路径休息点、长椅近景；全部为运行时场景截图。
- 验证：生产构建、87 项自动测试、11 项单人浏览器检查通过，覆盖探索、有效穹顶留影、三段个人实验、三次刷新恢复、旧标签页同步、画质切换与三种触屏视口。五个美术机位无页面或着色器错误；长椅前持续按 W 保持在碰撞盒正面，额外 800 毫秒位移仅约 0.019 米。
- 标准画质 1600×900 入口提交几何由上一轮 843,602 增至 876,244 个三角形，绘制调用 81 → 84，叶片卡片预算不变。此项是当前机位的提交量，不代表设备帧率保证。树形与地表更完整，但建筑细节、整体光影和远景制作仍有明显提升空间。

## 查尔斯河与 Boston University 扩展（2026-10-14）

- 同一场景内连接 Killian Court、MIT 河畔、约 655 米 Harvard Bridge、南岸步道、跨 Storrow Drive 人行桥和 BU Beach。BU 位于 MIT 西南方向；主步行线约 2.5 公里，保留地理尺度。
- 新增连续水面、运动水纹、岸墙、桥面与栏杆、树列和静态帆船。复用现有手绘天空与植被材质，延长远景可见距离，能够从桥上辨认对岸 BU。
- BU 首批为户外区域：草坪、Marsh Chapel / Marsh Plaza、CAS / STH 沿街建筑、Duan Family Center for Computing & Data Sciences、Castle 和部分 Bay State Road 街景。建筑由程序生成，参照地图及官方建筑资料组织位置和体量；屋顶、窗格、树位属于风格化简化，并非完整测绘复原。
- 地图新增「河岸与 BU」：四处地点可标记步行路线或快速前往。走近按 E 记录到访，在手册中查看。导航使用同一条桥梁与步道路线，并从教堂侧面绕行至 Marsh Plaza。
- 兼容 v1 本机存档，河岸 `visitedPlaces` 与原 MIT 三项任务分别保存。传送位置由场景确认后写入存档，BU 位置与到访记录可在刷新后恢复。
- 验证脚本：`node scripts/check-river-route.mjs` 对实际基础 GLB、新增地面、栏杆、建筑及树干碰撞进行双向检查；主路线 20,118 个采样点通过，BU 内部两段绕行也双向通过。`node scripts/check-river-playable.mjs` 的 7 项浏览器检查通过，包含实际按键走过北桥头与 BU 人行桥全部折返、四处到访、刷新恢复、省电模式和手机地图。94 项自动测试与生产构建通过；源码冻结后重新执行 `node scripts/check-solo-playable.mjs`，原有 11 项单人检查全部通过。
- 实际运行截图及浏览器报告：`output/charles-bu/`；修正屋顶接缝和固定面板关闭按钮后的最终画面位于 `output/charles-bu/final/`（使用 `node scripts/check-river-playable.mjs --capture-only` 生成，不重复长距离坡道行走）；地面与碰撞报告：`output/river-route-report.json`。几何采样不等同于全设备帧率测试。

本轮开放散步、拍照和到访记录；河面帆船是景物，尚无游泳、划船或 BU 室内课程。新增区域的街道密度与地表细节仍比 MIT 样板简化。

地理依据包括 [BU 校园地图](https://www.bumc.bu.edu/citylab/files/2023/06/BU-Charles-River-Campus-Map.pdf)、[Marsh Chapel 地址与方向](https://www.bu.edu/chapel/about/directions-contact/)、[BU Beach 介绍](https://www.bu.edu/articles/2017/a-day-at-the-bu-beach/) 和 [数据科学中心建筑资料](https://www.bu.edu/articles/2022/new-skyline-for-boston-new-landmark-for-bu/)。完整建筑来源及简化范围记录在 `assets-source/charles-bu/bu-landmarks.json`；河岸与步行路线为手工简化参考，没有导入 OSM 测绘数据。

## BU 建筑、河岸与 Questrom 完善（2026-10-15）

- 建筑近景增加窗洞暗部、凸出的窗框和窗台、石材分层与檐口阴影。CAS、STH、Castle 和 Bay State Road 窄排屋保留各自体量；窄排屋每层至少有两扇窗。Marsh Chapel 的山墙与屋顶衔接，减少近距离观察时的开缝。
- 新增 Questrom School of Business 的 Rafik B. Hariri Building 户外模型，地址为 595 Commonwealth Avenue。红砖体量逐层退台，配合浅色石材基座、横向饰带、入口玻璃竖窗、雨棚和代码生成的文字标识。地标身份、地理锚点、参考照片与高度证据记录在 `assets-source/charles-bu/bu-landmarks.json`；建筑尺寸、窗格和立面仍为参照资料制作的风格化近似，不是测绘复原。
- Commonwealth Avenue 增加连续人行道、路面、中央轨道景物及过街标线，将 Marsh Plaza、数据科学中心与 Questrom 门前广场串联。BU Beach 草坪增加贴合实际草地顶面的细草，避开铺装并沿用近景分块裁剪；上限 7,000 簇，省电模式减少密度。
- 河岸补充岸墙厚度、湿石基脚与少量护岸石；Harvard Bridge 和 BU 人行桥增加桥侧厚度和结构层次，沿桥与步道补充灯具。这些细节衔接既有可行走路线，河面仍作为观景区域。
- 天空继续使用已有原创手绘资源。通过重叠混合贴图两端、连续纹理采样和顶部颜色融合，修复转动镜头与云层漂移时的纵向接缝、细条纹和天顶收束痕迹；贴图加载失败时仍有程序天空。
- 河岸手册增加第五处「Questrom 商学院」。地图可标记经教堂侧道及校园街道的步行路线，也可快速前往商学院门前；走近按 E 记录到访。原有四处印记、MIT 三项发现和 v1 本机存档继续兼容，新增位置与第五处印记在刷新后恢复。长地图面板的标题与关闭按钮固定在顶部，手机上也可随时关闭。
- 当前开放的是户外散步、观察建筑、拍照和到访记录。商学院与其他 BU 建筑没有室内游玩或课程；轨道、街道及帆船是环境景物，没有驾驶、乘车或交通模拟。

本轮验证：95 项自动测试与生产构建通过；`node scripts/check-river-route.mjs` 的主路线双向 20,118 个采样点、BU 校园绕行与街道路线双向检查通过。`node scripts/check-river-playable.mjs --capture-only` 完成 6 项浏览器检查，覆盖河岸快速前往及记录、桥面短程行走、Questrom 门前行走及第五处印记、刷新恢复、BU 省电画面和手机地图；该模式不重复长距离桥坡与人行桥全程行走。`node scripts/check-sky-seams.mjs` 的 15 个天空视角与漂移检查通过，无页面或着色器错误。

源码冻结后，`node scripts/check-solo-playable.mjs` 的原有 11 项单人检查也全部通过，覆盖三项发现、有效拍照、完整光学小课、刷新恢复、多标签页存档保护、画质设置和三种触屏视口；无页面错误、无联机服务请求，报告位于 `output/solo-playable/report.json`。

最终运行截图和浏览器报告位于 `output/questrom-modeling/final/`，包括河岸、BU 草坪、Marsh Plaza、Questrom 标准与省电画面及手机地图。天空接缝检查画面和报告位于 `output/sky-seam-fix/`；地面与碰撞报告仍为 `output/river-route-report.json`。以上是当前场景的功能、几何与渲染检查，不代表全设备帧率保证。

## Maryland 地形、STAMP 坡路与停车楼（2026-10-15）

修正上一轮把整个校园压成平地、停车楼沿用普通教学楼立面的根本问题。本轮使用 Maryland iMAP 的 Prince George’s County 2020—2021 bare-earth LiDAR：11,235 个网格样点与 8 个地标点，米制单位另经 USGS EPQS 核对。地面恢复西高东低与 STAMP 周边山坡，运行时只减去 14 米本地基准，没有夸大垂直高差。原始数据、查询参数、单位核验和范围说明保存在 `assets-source/maryland/terrain-references.json` 与 `umd-terrain-samples.json`。

所有地面、道路、人行道和路缘共享 12.5 米三角高程网；不同细分的几何也严格同面，避免草地穿过道路。建筑、喷泉和运动场使用水平平台与渐变过渡，建筑立面、铭牌和碰撞保持同一基脚高度。五座停车楼的平台对齐高程网格，避免边缘草地进入开放楼层。地面高度查询复用实际三角形索引；相机遮挡仍检查真实几何。

STAMP 周边恢复 Campus Drive 上坡、Union Lane 与 Fieldhouse Drive 衔接，补充连续车道、路缘、人行道、路口降低段、斑马线、排水口、路灯、长椅及树池；地图道路同步显示。新增 22 块沿街近景草地。所有路树先排除车道与铺装，树冠加入比例与色差，附近各分区的树冠会投影。修复原有草根判断把坡面草清空的问题，阴影中心也随玩家海拔变化。

Union Lane、Regents Drive、Stadium Drive、Terrapin Trail、Mowatt Lane 五座停车楼改成独立开敞结构：真实楼层空隙、混凝土楼板、柱网、砖栏板、内部坡道、顶层车位线、入口标识及铺地。Stadium Drive 保留弧形官方轮廓。楼层高度、细节和坡道位置按官方照片与当前游戏尺度制作，尚未开放楼内步行或驾驶。

验证：141 项自动测试通过，包括道路与草地不同细分的高度一致性、坡面草根、五座停车楼的射线开口与水平楼板检查。19 个落点、342 条导航组合与 139,853 次地面／通行采样全部通过，0.65 米步长的最大高差约 0.282 米。静态建筑与地面约 145 万三角形（不含角色、树叶和草叶）；地形去掉不影响轮廓的内部细分后减少约 62 万三角形。实景检查图在 `output/maryland-fidelity/`。额外用真实键盘从 Campus Drive 东端沿人行道行走约 267 游戏米，到 STAMP 附近累计上升约 11.25 米，全程没有卡住、穿地或浏览器错误；报告与前后截图在 `output/maryland-fidelity/hill-walk/`。

复核命令：`node scripts/check-maryland-campus.mjs`、`node scripts/check-maryland-architecture.mjs`、`node scripts/check-maryland-hill-playable.mjs` 与 `node scripts/capture-maryland-fidelity.mjs`。校方坡路与邻接依据：[STAMP 路线](https://stamp.umd.edu/visit/directions-parking)、[Union Lane 路线](https://fellercenter.umd.edu/directions/union)。停车楼照片与建筑身份来源记录于 `assets-source/maryland/parking-references.json`。

范围仍是对现有游戏布局的修正：校园平面坐标保留上一轮的缩放、拉伸与局部移位，不能声称 1:1 实景复原；LiDAR 不是实时施工数据。普通教学楼与宿舍的立面仍有程序化重复，地表细节、树木精度和整体光影仍未达到《王国之泪》的完成度。本轮先纠正地形和建筑类型，让后续逐栋精修建立在正确地面关系上。

## Maryland 主校园扩展（2026-10-15，上一阶段）

本轮从中央六个地标扩展到 College Park 主校园的 11 个分区：中央校园、西部艺术与设计、体育场与校友区、北部住宿、北部运动场、科学与校园农场、工程与计算机、南部住宿、商学院与南部入口、东部校园入口、Leonardtown。新增 150 个建筑／设施模型，其中 143 个采用 Maryland iMAP 中 UMD Facilities 的建筑轮廓，另外 7 个参照官方校园地图补建。连同原来 10 个建筑及附属体量，地图显示 160 个轮廓标记。

新增到访点包括 Hornbake、Clarice、SECU、Eppley、北部宿舍、XFINITY、科学区、Iribe、Clark、South Hill、Van Munching、Rossborough 与 Leonardtown。全部 19 个地点支持步行导航、快速前往、到访记录和单人存档恢复。地图提供分区缩放、楼名搜索、建筑定位和附近落脚点；手机总览显示分区标签，避免所有楼名重叠。原六个到访点的位置不变，旧存档继续有效。

建筑保留经简化的轮廓，加入实际凹窗、窗台、门框、檐口和屋顶。Iribe 使用沿轮廓的六层幕墙与退台屋顶花园，XFINITY 使用封闭拱顶和高窗，SECU 补齐看台、新闻席、记分牌和球门。碰撞跟随新建筑的轮廓，U／L 形开放院落可以走入。另有十处开放空间，包括 Ludwig 跑道、棒垒球场、曲棍球场、校园农场和西部高尔夫景观。

道路与停车区采用官方铺装轮廓：866 个校园内来源要素，裁剪为 10,307 个凸多边形，避开建筑、旧中央广场与球场。它们作为静态环境，不包含车辆或交通模拟。步行指引使用 192 条新增步道和原有路线形成的连通网络；该网络为游戏玩法重新连接，并非官方实时可通行道路。树位避开建筑、路线、运动场和铺装。

几何按空间与材质合并，远处保留建筑主体、玻璃、屋顶及树冠，减少细窗框、树叶和枝条提交；导航缓存每个目的地的反向最短路径。地面采样索引兼容全部铺装，修复共享三角形边界的浮点误差。草地与薄层道路、球场标线采用一致深度层次，避免远景三角形闪烁和地面互相遮盖。

验证：130 项自动测试通过；实际几何包含 19 个安全落点、342 条地点间导航组合、802 条有方向的步道段，139,853 次地面与通行采样无失败，最大相邻步高差 0.055 米。静态模型约 69.4 万三角形，不含角色、树叶与草叶。桌面到访视角提交量因视野差异约 14.6–117.7 万三角形；这些是本机渲染统计，不代表全设备帧率承诺。

复核：`node scripts/check-maryland-campus.mjs`；`node scripts/check-maryland-playable.mjs [URL]`。实机截图和报告在 `output/maryland-full-campus/local/`、`production/`；从同一运行时模型渲染的俯瞰检查图位于 `overview/`，由 `scripts/capture-maryland-overview.mjs` 生成。

来源：[UMD 建筑轮廓](https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/2)、[UMD 道路](https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/0)、[UMD 停车场](https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/1)、[校方校园地图](https://umdconf.umd.edu/drupal/current_map.pdf)。下载快照和署名保存在 `assets-source/maryland/`；两份 `prepare-maryland-*.mjs` 脚本可重建数据层。

范围是主校园的风格化户外版本。建筑间距、立面、楼高、地形和家具经过游戏化调整；旧版中央场景保留原坐标，因此不是 1:1 测绘复原。GIS 图层包含历史数据，不能当作实时施工或开放情况。尚未包含室内、Discovery District、远端研究园和校外研究生住宅。

## Maryland 中央校园扩建与建筑细化（2026-10-15，上一阶段）

UMD 的到访点从三处扩为六处：保留 McKeldin 图书馆、McKeldin Mall、Miller 行政楼，增加西北侧 STAMP 学生中心、东北侧 Reckord Armory 和南侧 Memorial Chapel。校园地图显示连接各区域的步道网络，指引按步道最短路径计算；快速前往后镜头朝向对应地标。旧版三处 UMD 到访记录、各地落脚点、Boston 与 UPenn 的探索进度继续保留。

原有六座主体及背景建筑采用有实际窗洞的墙体、凹进的门窗、分层窗台与檐口、加厚山花和细化柱头。新增建筑分别使用学生中心的层叠体量、Armory 的高窗和纪念教堂的尖塔轮廓，配套庭院、步道与近景家具。几何按材质合并，植被沿用统一批量渲染与省电模式。Maryland 使用单独的晨光方向，让图书馆朝东立面的门廊和窗洞层次可见。

范围仍是按官方地图邻接关系制作的风格化中央校园户外区域；新区域距离为游玩压缩，不代表整所大学、测绘精度或可进入室内。建筑参考记录见 `assets-source/maryland/`。检查入口为 `node scripts/check-maryland-campus.mjs`（实际地形和碰撞）与 `node scripts/check-maryland-playable.mjs [URL]`（浏览器游玩、到访、存档、手机布局）；证据保存在 `output/maryland-campus/`。

最终验证：30 条地点间路线和 6 个落点通过 27,725 次实际几何采样，步道最大高差 4.2 cm；原有主体门窗与柱廊另外通过射线深度检查。建筑和景观静态几何约 31.2 万三角形、30 个材质批次（不含植被、角色和铭牌）。本地与正式域名均通过 6 项浏览器检查，零页面错误与资源异常。草地落点改用临时地面空间索引，在本机相同数据的 Node 测试中由 20.6 秒降至约 0.16 秒，生成数量一致；这项数字是草地生成阶段耗时，不代表整个页面的加载时间。

## UMD、UPenn 校园旅行与 BU 近景完善（2026-10-15，扩建前）

- 地图新增「校园旅行」，在 Boston、UMD College Park 和 UPenn 之间切换。每个地域有自己的可行走范围、地标、地图和位置记录；返回时继续上次的漫游。远距离校园通过场景切换访问，Boston 的 MIT—查尔斯河—BU 路线保持连续步行。
- UMD 以 McKeldin Mall 为核心：长草坪与 ODK 狭长分层水池连接两端建筑，McKeldin Library 采用红砖立面、六柱柱廊与三角山花，Miller 行政楼采用四柱门廊、两翼与前庭台阶。图书馆前的 Testudo 使用原创简化龟形雕塑；周边教学楼以红砖体量和窗门细节构成背景。三个到访点为 McKeldin 图书馆、McKeldin Mall 和 Miller 行政楼。
- UPenn 以 College Green 为核心：南侧 College Hall 使用绿色石材、暖色窗套、尖拱与层叠山墙；东侧 Fisher Fine Arts Library 使用红砖、石砌圆拱、入口台阶及圆形塔楼。Van Pelt、Meyerson 与 Cohen Hall 为简化周边体量，树荫、砖石步道、长椅和灯具组织户外路线。三个到访点为 College Hall、College Green 和 Fisher Fine Arts Library。
- 两所新校园可独自行走、观察建筑、拍照下载，并在到访点按 E 记录印记；地图可标记路线或快速前往。新增 `campusVisits` 保存六处跨校到访，`campusPositions` 分别保存三个地域的位置。继续使用原 v1 存档键，旧存档默认迁移到 Boston，保留原 MIT 三项发现、光学实验进度与五处河岸记录。
- BU 继续完善近景：Questrom 的窗洞改为实际凹入的立面开口与深色窗内侧，窗框和饰带避开完整窗洞，减少贴片感与饰带穿窗；Castle 增加屋檐、烟囱、斜角凸窗、山花与窗门层次。仍然只表现建筑外观，没有新增室内房间或课程。
- 新校园的建筑与景观均为原创程序几何，参考官方地图和建筑照片制作。UMD 的依据、局部坐标与简化范围记录在 `assets-source/maryland/campus-references.json`，UPenn 记录在 `assets-source/penn/landmarks.json`；BU 沿用 `assets-source/charles-bu/bu-landmarks.json`。参考照片与建筑图纸未作为运行时纹理或模型分发。

这些地域是可游玩的风格化核心户外场景，不是完整全校或室内复原。UMD 与 UPenn 使用各自的局部米制坐标；地形、建筑间距、立面尺寸、树位和家具经过简化，不表示测绘精度，也不模拟校园开放时间或实时服务。

最终验证：99 项自动测试与生产构建通过；UMD 1,744 个几何采样点与 UPenn 6,358 个几何采样点通过地面、边界及碰撞检查。12 项跨校浏览器检查和原有 11 项单人检查全部通过，覆盖跨校切换、分别恢复位置、旧存档与多标签页同步、拍照与到访记录、返回 MIT 光学工坊的安全落点，以及手机布局和移动操作。两套浏览器流程均无页面错误、无联机服务请求。

本轮运行截图与跨校浏览器报告位于 `output/campus-travel/`，包含 BU 近景、校园旅行地图、UMD 三处地标、UPenn 三处地标、拍照、省电画面及手机地图。几何采样与浏览器流程检查不等同于全设备性能保证。

## 历史交付：联机原型

入口 `/` 或 `/world/mit`。原校园入口保留为 `/classic`，原实景 MIT / Harvard 路由仍可访问。

- MIT Killian Court 可行走样板：复用原始校园坐标与建筑几何，重新组织材质、植被、天空、日光与背包学生角色。WASD、Shift、拖动看向、滚轮缩放；移动端提供方向键。
- Visitor 匿名身份与服装颜色；通过同一服务的 HTTP / SSE 同步真实访客位置、朝向和聊天。当前只实现一个 MIT 房间，容量上限 16 为服务配置，尚不代表高负载性能已验收。
- 好友邀请、接受/忽略、在线状态、本地屏蔽消息与提交举报。学生认证在界面明确标示尚未开放。
- 光学工坊：观察单镜反射、判断入射/反射角关系、双镜协作。共享模型计算射线和接收器命中；服务端校验进度，不能直接跳到完成。
- 单人随身练习与现场共同实验。工坊在出生点附近约 18 米处，走近至 12 米按 E；共享工坊最多 4 位参与者。实验时同步各参与者对镜面的操作。
- 完成印记、探索手册与当前 3D 画面的 PNG 下载。
- 世界地图表达三校规划；Harvard 可前往原有实景样板，BU 与连续跨校街区未制作。

## 运行

```powershell
npm ci
npm run dev -- --port 5186 --strictPort
```

打开 `http://127.0.0.1:5186/`，填写昵称进入。独立浏览器标签页可作为两位访客验证位置、聊天、好友与共同实验。每个标签页持有独立的匿名凭据；同一浏览器会记住最近活跃的访客，重复标签页通过 BroadcastChannel 避免同时占用同一身份。

```powershell
npm run build
npm start
```

构建服务默认 `http://127.0.0.1:4173`，同一进程提供 `dist/`、SPA 路由及 `/api/world/*`。可用 `PORT`、`HOST`、`WORLD_STORAGE_PATH` 配置。静态托管本身不会提供真人联机；必须同时运行这段服务。此次未公开部署。

## 数据与恢复

- 个人昵称与服装跟随当前访客凭据恢复。练习印记和下载照片计数按服务端访客 ID 分别保存在浏览器 localStorage，独立访客不会继承别人的手册。初次连接服务之前的离线练习仅在当前页面保留；连接建立后按访客身份保存后续记录。屏蔽列表保存在当前浏览器。
- 匿名访客凭据在 sessionStorage，并有 localStorage 回访凭据。当前不支持跨设备登录、密码找回或学校认证。
- 好友、待处理邀请、共同实验完成记录与举报保存在 `.world-data/`；此目录被 Git 忽略。开发按端口隔离为 `dev-<port>.json`，预览为 `preview-<port>.json`，独立构建服务默认 `world.json`。不同实例应使用不同文件。
- 服务端只保存访客凭据哈希，不将凭据放入共享事件或聊天。聊天只在当前服务进程内保留有限历史；玩家位置与正在进行的实验属于房间临时状态。
- 网络断开时保留个人漫游；共同实验暂停操作，重连后尝试恢复参与。清除浏览器凭据后无法恢复对应匿名身份。
- 屏蔽影响本机显示；举报写入服务端记录，尚无人工审核后台。公开运营需要补齐正式账号、认证、审核与运维系统。

## 工程边界

新增功能集中于 `src/features/world/` 与 `server/`。原 `real-campus` 场景与已有未提交改动保留。

| 模块 | 职责 |
| --- | --- |
| `WorldPage.tsx` / `world.css` | 访客入口、世界 HUD、地图、好友、聊天、手册与设置 |
| `WorldScene.tsx` / `scene-assets.ts` / `scene-actors.tsx` | 真实建筑重用、风格化渲染、移动碰撞、头像与远端玩家 |
| `painterly-vegetation.ts` / `painterly-surfaces.ts` / `painterly-sky.ts` | 叶簇和草地、米制石材与窗格、连续天空云层 |
| `painted-student.tsx` | 独立骨骼动画、服装配色与随身体运动的背包 |
| `world-network.ts` | 匿名访客连接、SSE 事件、重连与移动更新 |
| `OpticsWorkshop.tsx` / `optics-model.mjs` | 小课界面、射线反射、命中判定与受约束进度 |
| `server/world-server.mjs` | 位置、消息、好友、课堂状态与存档 |
| `server/serve-world.mjs` | 构建后本地运行入口 |

初步美术为可运行样板，尚未达到概念图的树木、人物、地面与光影精度。当前无跳跃、攀爬、滑翔、语音、完整室内、正式课程或 24 小时在线服务。上述内容不可通过界面标签冒充已实现。

2026-10-11 视觉重做：以概念图的庭院机位重新调整人物尺寸与镜头，替换球状树冠、稀疏草叶、胶囊人物和椭球云朵。树叶为带透明轮廓的独立叶簇；草根落在原有草坪三角形上，铺路保持清晰。建筑使用世界坐标米制石缝、铺石和窗格。人物沿用仓库已有 Nathan 骨骼模型，保留行走/站立动画，添加服装配色与背包；来源与本地评估边界见 `public/assets/people/ATTRIBUTION.md`。玩家入口沿路径错开，避免身体和姓名标签重叠。省电模式减少草叶与树叶密度、关闭动态阴影。

视觉检查执行 `node scripts/capture-world-art.mjs`，输出 `output/world-art/courtyard.png` 与 `report.json`；设置 `WORLD_ART_WALK=1` 可同时验证键盘移动并截取行走状态。截图是实时 3D 场景，未使用概念图作为背景。概念图的定制人物、完整环境美术与绘画细节仍是后续质量目标。

校园建筑底座仍沿用现有 Cambridge / CyberCity 数据使用边界，参见 `assets-source/cambridge-gis/README.md`。本地评估与公开商业再分发不同；后续公开发布需要落实可发布资产方案。

## 验证

- `npm run typecheck`
- `npm test`：包括反射规律/进度校验、两个真实服务客户端、好友持久化、容量、来源与输入验证。
- `npm run build`
- 浏览器：访客进入、行走与碰撞、个人课完整流程、两个访客聊天/好友、工坊共享状态、移动端布局、拍照与重载。

2026-10-10 验收：78 项单元/服务集成测试通过，TypeScript 与生产构建通过。浏览器回归使用 Chrome、1440×960 桌面和 390×844 移动视口，通过 13 项流程检查，未捕获非预期页面/控制台错误。主动断网期间的预期网络错误单独记录。

2026-10-11 视觉重做后的回归：上述 78 项测试与 13 项浏览器流程再次通过。入口检查同步为沿入口路径避开其他玩家的站位范围，并验证停止移动；不再要求所有玩家占据同一个坐标。1600×900 实机截图另外检查了新材质与人物着色，无页面或着色器错误。性能采样仅代表本机 Chrome 当前场景，不作为设备性能保证。

可复现浏览器检查：先运行上述开发服务，再执行 `node scripts/check-world-playable.mjs`；可通过 `WORLD_BASE_URL` 指向另一端口。脚本以真实界面操作完成聊天、好友接受、WASD 行走、E 加入工坊、分别调整两面镜子、断线禁用/键盘重连、完成记录、同浏览器独立访客隔离、回访、拍照下载、省电切换与移动端行走。

报告：[`output/world-playable/report.json`](../output/world-playable/report.json)。画面：[`庭院`](../output/world-playable/01-campus-two-guests.png)、[`双人光学实验`](../output/world-playable/05-two-mirror-cooperation.png)、[`手机布局`](../output/world-playable/08-mobile-campus.png)。

这些是功能与布局检查，不是 16 人负载测试或全设备帧率承诺；概念图与容量上限也不作为性能证据。
