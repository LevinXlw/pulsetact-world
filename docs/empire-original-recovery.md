# 帝国大厦：原始游戏场景恢复样片

本地入口：<http://127.0.0.1:5173/docs/empire-original-study.html>

后续扩展：以此建筑为中心的首批 9 分块街区见 [曼哈顿街区恢复说明](manhattan-map-recovery.md) 和 `/docs/manhattan-map-study.html`；以下统计仍对应原始单体样片。

本次从用户提供的《Marvel's Spider-Man Remastered》安装目录中恢复建筑构件及其场景矩阵。旧的 `/docs/empire-state-study.html` 手工搭建版保留。

## 实际交付

- 227 种原始模型、6,462 个原始静态实例；其中 3,518 个实例来自帝国大厦专用套件。
- 保留原始坐标、旋转、缩放，统一平移 `[-116, -1, -288]` 使建筑位于预览原点。没有重画立面或人工排列窗户。
- 包含共用墙饰、退台、屋顶、天线、观景台设施、地面店面及所在范围内的道具。
- 276 张去重贴图，基础颜色、法线与近似 PBR 材质。WebP quality 92，有损纹理压缩。
- 可旋转、缩放、平移，提供全貌、塔冠、立面、街角四个视角和日间/夕照切换。
- 自包含模型：`assets-source/nyc-local/empire-original/empire-original.glb`，37,119,860 字节。
- 预览构件库：`empire-kit.glb`，35,439,348 字节。预览使用 GPU 实例化；下载文件保留普通节点矩阵，便于检查与导入。

所有游戏派生文件位于被忽略的 `assets-source/nyc-local/`，页面为本地 Vite 研究入口；未加入生产发布入口。

## 恢复证据

在 705 个非空 ground/art 场景中检索到 3 个引用帝国大厦套件的分块。主要集中于：

`levels/i20_city/openarea/open_world/tile_l27/tile_l27_ground.zone`

资源 ID：`BAD2AB9A64DC6DC6`。

当前验证的静态记录布局：

| 数据 | 含义 |
| --- | --- |
| `6987F172` | 9,094 个静态记录在实例数据区中的字节偏移 |
| `C6A5905E` | 572 个模型引用：uint64 资源 ID 表，后接 uint32 名称偏移表 |
| `06ABCAB2` | 变长实例记录；+0 为 16 个 float32 的列主序变换矩阵 |
| 记录 +124 | 长度与标志；本样本长度 320、352 或 384 字节 |
| 记录 +272 | uint16 模型索引；其后的 uint16 为尚未复原的变体信息 |

按实例锚点 `x ∈ [54,178]、z ∈ [257,319]` 截取建筑范围，因此不是整个分块的全量场景。原始 `.zone`、命中清单、分段数据、每个构件的来源和每个实例的记录偏移均保存在本地，供追溯。

### 顶点量化修正

ALERT 的 `Vertex_I20` 对所有顶点固定除以 4096，但模型的 `Model Built / 283D0383` 记录另有实际量化步长和位置偏移。25 种构件需要进一步修正：18 种 ×2、3 种 ×4、3 种 ×8、1 种 ×16。

恢复公式：`真实局部坐标 = ALERT 输出坐标 × (量化步长 × 4096) + 模型位置偏移`。

独立的几何衔接检查：

- 4 米窗模块宽度恢复为 4 米。
- 16 米墙饰恢复为 16 米。
- 屋顶平面约 64 米宽，而不是未修正时的 8 米。
- 塔尖顶端与天线原点的高差约 0.00055 米。
- 天线顶部在重置后的地面之上约 441.30 米。这是游戏几何测量值，未强行改成现实建筑的标称高度。

275 个实例包含镜像变换。预览分别处理镜像几何的顶点、法线与三角形绕序，避免 GPU 实例化时反面消失。

## 当前边界

游戏的室内窗景、材质混合、逐实例材质覆盖、原始光照与后处理未恢复。窗玻璃采用明确的 PBR 近似，代替无法直接转换的室内 cubemap shader。天空和展示地面为预览布景。

选区中排除了 48 个游戏攀爬辅助对象、1 个当前 TOC 不包含的模型引用，以及 2 个此导出器不支持的蒙皮小道具（花盆植物、咖啡杯）。因此这是静态建筑恢复样片，不声称与完整游戏渲染逐像素一致。

本次仅验证了 `tile_l27` 这一建筑的静态实例记录，尚不能据此宣称所有街区、动态对象或整座曼哈顿都已恢复。

## 复现与验证

工具来自已安装的 ALERT 固定版本，适配脚本遵循其 GPL-3.0-or-later 许可。只读访问游戏文件；执行前后核对 TOC SHA256：

`58e571cf1e54e08b18db4e8effb3f964eded1ddaa3e4feebd72f88fbbc066da1`

```powershell
& 'C:\Python314\python.exe' scripts/recover-empire-scene.py "C:\Program Files (x86)\Steam\steamapps\common\Marvel's Spider-Man Remastered" --recover
node scripts/pack-empire-kit.mjs assets-source/nyc-local/empire-original models
& 'C:\Python314\python.exe' scripts/optimize-empire-library.py
& 'C:\Python314\python.exe' scripts/check-recovered-empire.py
npm.cmd run build
```

验证覆盖：原始实例矩阵一致性、关键构件尺寸与衔接、所有顶点有限性、全部三角形索引范围、GLB 缓冲区边界、纹理自包含与 WebP 编码。227 种模型合计 243,302 个独立三角形；实例化后约 209.6 万个三角形。

浏览器检查：四个取景预设、两种日照、390 × 844 布局，页面无加载错误。构建通过；现有 Three.js 大包提示仍存在。本次未做手机 GPU 帧率测试。
