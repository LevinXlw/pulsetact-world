# Cambridge 校园原始数据

来源：City of Cambridge GIS 官方 3D Data Download Map。
下载日期：2026-09-12。原始 ZIP 保留，不是 Google Maps 数据，不需要 Google Maps Key。

## 目录与覆盖

- `harvard/E3/`：Harvard Yard、Widener Library、Memorial Church 所在的 E-3 分块及周边。
- `mit/F4/`、`mit/G4/`：MIT 主校园的相邻分块，覆盖 Killian Court / Great Dome 附近和西侧建筑区域。
- `metadata/`：官方地图配置、完整分块边界、下载计划、逐文件来源/体积/SHA-256 清单和 ZIP 校验结果。

这是按官方网格下载的区域数据，包含校园之外的周边建筑，尚未裁剪为校界，也未转换为 GLB 或接入应用。

## 每个分块的四类文件

| 文件名特征 | 内容 |
| --- | --- |
| `2023_Bulding_Models_OBJ.zip` | 建筑与桥梁的 OBJ 模型集合。保留官方文件名里的 Bulding 拼写。 |
| `2018_TerrainMesh_OBJ.zip` | 地形网格 OBJ 及其附属文件。 |
| `2025_OrthoPhoto_JPG.zip` | 2025 年正射航拍 JPG，官方说明来源为 Nearmap。 |
| `2025_GISGroundplan_JPG.zip` | 2025 年地面平面图 JPG。 |

官方建筑说明页标题已更新为 2025，但当前官方互动下载地图实际指向 2023 ZIP。本目录按下载地图链接保存原始文件，不将其改名冒称 2025。具体每个包的内容以 ZIP 内的元数据为准。

## 坐标说明

官方说明使用 NAD83 Massachusetts Mainland State Plane（英尺），高程为 NAVD88（英尺）。模型坐标存在偏移，官方列出 X=731100、Y=2902900 MA State Plane feet。分块名对应约 5000 英尺网格。导入前须核对包内说明、轴向、偏移和单位，不能直接按米加载。详细分块几何保存在 `metadata/tile-grid.geojson`。

## 使用权记录：不能将本目录当成已确认可商用素材

官方 3D Data 页面将这些下载描述为免费、开放数据；建筑页面也将其称为开放模型集合。但是网站通用 Disclaimer 的 “Commercial Use Prohibited” 段要求商用复制、下载或再发布取得市政府书面同意。下载索引对应 ArcGIS item 的 `licenseInfo` 和 `accessInformation` 为空，没有明确解决这一冲突。2025 航拍影像另注明来源为 Nearmap。

本次按请求保存官方公开下载的原始包及来源，供本地查看与评估；没有为这些文件赋予 MIT、CC0 或其他未声明的许可。商用发布、分发模型或纹理前仍需核对包内说明和取得明确适用授权。未联系市政府或替用户接受额外协议。

## 官方来源

- 总入口：https://www.cambridgema.gov/gis/3d/3ddata
- 下载地图：https://www.cambridgema.gov/gis/3d/3ddata/3ddatadownloadmap
- 建筑说明：https://www.cambridgema.gov/gis/3d/3ddata/buildngmodelobj
- 地形说明：https://www.cambridgema.gov/gis/3d/3ddata/terrainobj
- 航拍说明：https://www.cambridgema.gov/gis/3d/3ddata/orthojpg
- 平面图说明：https://www.cambridgema.gov/gis/3d/3ddata/groundplanjpg
- 网站使用说明：https://www.cambridgema.gov/disclaimer

下载脚本：项目根目录 `scripts/download-cambridge-data.mjs`。读取保存的官方索引模板，只选择 E3、F4、G4；每次最多三个并行下载，保留 SHA-256 校验值。原始包不放入 `public/`，不会自动包含在网页发布资源中。
