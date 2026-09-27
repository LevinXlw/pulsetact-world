# MIT 真实场景实验

入口：`/real/mit`。当前阶段是 Google Photorealistic 3D Tiles 接入验证，不代表已经实测 MIT 覆盖、近景清晰度、角色落地或真实碰撞。

## 配置

1. 在 Google Cloud 项目启用计费和 **Map Tiles API**。
2. 建立供浏览器使用的 API Key，API 限制仅允许 Map Tiles API。
3. 配置 HTTP referrer 限制，例如本地 `http://127.0.0.1:5173/*`。如果使用 localhost，再添加 `http://localhost:5173/*`。正式部署仅添加自己的域名。
4. 复制 `.env.example` 到 `.env.local`，填写 `VITE_GOOGLE_MAPS_API_KEY`。不要提交 `.env.local`，不要填写 Google 服务账号 JSON 或私钥。
5. 重启 `npm run dev`。进入 `/real/mit`，点击「加载 MIT 真实场景」。

`VITE_` 变量是浏览器公开配置，会出现在构建结果和网络请求中。安全边界是 Google API 与网站来源限制，不是隐藏前端 Key。项目不在日志或界面打印 Key，也不将 Key 写进探索存档。

打开页面不会自动调用 Google。只有明确点击加载后才创建渲染器。切换三种观察模式复用同一瓦片会话；点击停止、离开页面、出错时卸载并释放渲染器。重试会产生新的根请求。请自行配置 Google 配额和预算提醒；应用没有代替 Cloud 的硬性费用上限。

## 验证流程

- 使用支持 WebGL2 的 Chrome / Edge；当前 Codex 内置浏览器曾显示 WebGL 不可用，不能据此判断地图服务失败。
- 先使用校园俯瞰，检查 MIT 区域是否有三维瓦片、建筑是否能辨认。
- 使用建筑近景，观察细节加载是否清晰，以及目标建筑是否在取景范围；当前观察锚点是近似坐标。
- 角色校准模式使用项目独立定义的平面，WASD 移动，范围限于局部 24 × 36 米；高度偏移可调。它不是从 Google 网格提取的地形或碰撞面。
- 高度基准是初始椭球高假设，尚未测量。角色可能悬空或被地图覆盖，在完成合法独立地面数据的校准前不宣称真实步行。
- 鼠标右键旋转，滚轮缩放。侧栏打开地点资料时暂停角色移动；资料不计为角色到访，收藏与已有手册共用。
- 没有 Key、没有 WebGL2、403 / 429、网络失败或 35 秒未出现可见瓦片都有恢复入口。部分瓦片失败采用整体停止再手动重试的保守实现。

## 内容边界

只通过 Google 官方 Map Tiles API 实时显示影像。不抓取、离线打包、导出、描摹或分析瓦片生成其他模型；不对 Google 网格做角色地形提取。署名从当前可见瓦片元数据实时汇总，作为纯文本显示，并清楚区分独立制作的角色。

Google 模式暂不提供截图、照片保存与导出；原有自制模拟场景的照片功能仍独立存在。人物对话与室内活动通过返回模拟校园继续。真实模式的位置不写入原来压缩校园的角色坐标，避免跨坐标系统破坏存档。

## 依赖和本地资源

新增 `3d-tiles-renderer@0.4.24`，使用其 Three.js 接口、GoogleCloudAuthPlugin、ReorientationPlugin、GLTFExtensionsPlugin。已检查声明支持 React 19 / R3F 9 / Three >=0.167，与项目配对一致。

Draco 解码器从锁定的 `three@0.176.0/examples/jsm/libs/draco/gltf` 复制到 `public/decoders/draco/`，约 763 KB 未压缩，Apache-2.0。它们是通用开源解码器，**不是 Google 地图影像**。真实模式按需加载；普通模拟校园不请求解码器。

## 官方依据（2026-09-12 核验）

- https://developers.google.com/maps/documentation/tile/3d-tiles-overview
- https://developers.google.com/maps/documentation/tile/policies
- https://developers.google.com/maps/documentation/tile/usage-and-billing
- https://github.com/NASA-AMMOS/3DTilesRendererJS

地图覆盖、实际吞吐与计費验证需要配置项目 Key 后继续，本次没有凭据，未发起真实 Google 瓦片请求。
