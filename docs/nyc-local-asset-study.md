# 蜘蛛侠 NYC 本地素材验证

验证日期：2026-09-17。

## 结果

已从用户安装的 Steam《Marvel's Spider-Man Remastered》只读解析资源索引，并成功导出 3 种褐石住宅构件及主要颜色、法线贴图。Three.js 本地样片可以旋转、缩放与切换构件。

预览：启动 Vite 后访问 http://127.0.0.1:5173/docs/nyc-asset-study.html 。

2026-09-18 新增完整楼体试验：[帝国大厦样片与交付记录](empire-state-delivery.md)，使用同一解析管线提取的帝国大厦构件手动拼装。

当前成果是**建筑构件解析与立面拼装验证**。组合立面用一块入口和四块窗墙手动拼成，未提取完整楼体、街区位置、碰撞数据或原游戏光照。不能把它描述为已经还原纽约街区。

## 安装与索引

- 程序版本：4.0630.0.0；Steam build：23986256。
- 游戏大小：70,825,441,975 字节，Steam 安装清单记录。
- TOC 记录：771,677；去重资源 ID：627,016，包含未安装语言的索引记录。
- 匹配名称：213,423；基础 span 中命名模型：38,298。
- 建筑关键词候选：5,810，包含构件、室内、道具等，**不是 5,810 栋建筑**，也不是完整建筑资源总数。
- 当前安装 34 个 `g00s*` 主资源包。TOC 另含其他语言包引用，不能假定所有索引记录都能从当前安装读取。
- TOC SHA-256：`58e571cf1e54e08b18db4e8effb3f964eded1ddaa3e4feebd72f88fbbc066da1`。运行前后比对一致。

## 已导出的样本

| 构件 | 原始资源 ID | LOD0 三角形 | GLB 字节 |
|---|---|---:|---:|
| 8×4 米入口 | BC5237AE61AE4906 | 2,615 | 6,802,352 |
| 4×4 米窗墙 | 9B91E4530DE43867 | 486 | 6,547,296 |
| 8×4 米墙面 | A1A090560BEBB5EA | 184 | 5,108,200 |

导出位置：`assets-source/nyc-local/sample/`；详细源路径、贴图引用、解码格式与近似材质信息见该目录的 `manifest.json`。GLB 自带贴图，三份文件间仍有重复贴图。颜色图上限 1024，法线图上限 512；尚未实施跨构件去重或 KTX2 压缩。

游戏采用专有多层材质图。样片只重建基础颜色与法线，木漆使用已读取的颜色参数近似，窗面使用深色表面近似；窗内、玻璃反射、程序污渍、颜色混合、部分贴图数组与原始着色器未还原。导出无异常不代表全部材质特性已支持。

## 重现

解析器：[Tkachov/ALERT](https://github.com/Tkachov/ALERT)，固定验证提交 `bc90ed9b53fbcaa3b7acf94b36f00e77eab0dacb`，位于 `assets-source/tools/ALERT/`，保留其 GPLv3 许可证。名称表来自 [Overstrike MT/v1.4.1](https://github.com/Tkachov/Overstrike/releases/tag/MT/v1.4.1) 的 `hashes.zip`，仅使用其中普通 PC 游戏名称表。

适配脚本采用 GPL-3.0-or-later；该代码许可不授予游戏美术资源的使用权。解析工具、Python 依赖和导出素材均保存在项目内独立目录。

```powershell
python scripts/inspect-spiderman-assets.py "C:\Program Files (x86)\Steam\steamapps\common\Marvel's Spider-Man Remastered"
python scripts/export-spiderman-sample.py "C:\Program Files (x86)\Steam\steamapps\common\Marvel's Spider-Man Remastered"
npm.cmd run dev -- --port 5173 --strictPort
node scripts/check-nyc-asset-study.mjs
```

Python 依赖装在 `assets-source/tools/python-libs/`：lz4 4.4.5、pygltflib 1.16.5、Pillow 12.3.0。只读打开游戏资源文件，所有输出均写入项目。未启动 Mod 管理器或覆盖游戏资源包。

## 验证与交付边界

- 三个 GLB 在浏览器加载成功；组合立面、入口、窗墙视图切换通过。
- 1440×1000 和 390×844 截图已人工检查；手机布局无横向溢出。
- 浏览器 JavaScript/控制台错误为 0；外部网络请求为 0。
- TypeScript 检查和 `npm run build` 通过，保留既有 Three.js 大包提示。
- 素材在 `.gitignore` 中排除，并存于 `public/` 外；当前生产构建不复制这些素材或样片页面。
- 检查报告、实际截图在 `assets-source/nyc-local/review/`。

下一阶段可基于已解析的建筑套件补齐侧墙、转角和屋顶，做一栋完整的手动拼装楼体；若要恢复游戏原街区，需要继续解析场景实例及变换数据。公开发布素材前需另行确认相应授权。
