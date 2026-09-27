# 帝国大厦 · 写实方向第二版

更新日期：2026-09-18。

本地预览：[帝国大厦](http://127.0.0.1:5173/docs/empire-state-study.html)。需要 Vite 服务。V1 源码和原截图保留在 `assets-source/checkpoints/empire-v1/`。

## 本次改变

重做了第一版中均匀收缩的退台和单一窗墙，按实景参考调整建筑体量与立面组织。主体采用浅灰米色石材、成对竖向窗带、铝制窗间板、窗框、窗台及细石缝；窗玻璃有四种窗帘状态和细微颜色差异。

保留本地游戏提取的入口、栏杆、金属塔尖和天线，主体改为程序化重建。屋面增加女儿墙与设备，塔尖补上金属横向接缝。建筑总高约 443.2 米，窗格数 6,716 是本模型的近似结果，不是实物精确窗数。

观察方式改为城市远景、塔冠、立面细节、街角仰望四种。增加日间、夕照和蓝调三种光照，天空环境反射、远景雾、接触阴影和塔冠照明。页面改成全屏场景，手机保留视角、光照和导出入口。

周边 2,550 个建筑体量用于表现曼哈顿街区尺度，加入窗墙、屋顶设备、水塔、道路、车辆和路灯。**这些邻楼和道路是示意生成，不是帝国大厦周边真实地理数据。**

## 参考与精度

- [帝国大厦官方资料](https://www.esbnyc.com/about/facts-figures)：总高和观景台高度。
- [官网实景照片](https://www.esbnyc.com/sites/default/files/2020-01/ESB%20Day.jpg)：立面色彩、窗带、塔冠和街区观感对照。照片只用于建模参考，不作为网页背景或贴图。
- [纽约地标保护委员会报告](https://s-media.nyc.gov/agencies/lpc/lp/2000.pdf)：五层基座，以及第 21、25、30、72、81、85 层的退台关系。

横向尺寸、各层绝对高度与细节位置依照片和资料近似校准，未恢复游戏原始场景变换，也不是测绘、摄影测量或逐层施工图模型。相机、材质、程序天空与灯光属于实时呈现近似。

## 文件与运行

- `src/experiments/empire-state-model.ts`：楼体、窗墙、构件组装。
- `src/experiments/empire-materials.ts`：石材、玻璃和街区立面纹理。
- `src/experiments/empire-city.ts`：周边示意街区。
- `src/experiments/empire-atmosphere.ts`：天空、环境反射和自然光。
- `src/experiments/empire-state-study.ts`：预览交互、接触阴影、模型导出。
- `docs/empire-state-study.html`：本地样片页面。

```powershell
npm.cmd run dev -- --port 5173 --strictPort
```

在另一终端验证并通过页面保存最新 GLB：

```powershell
node scripts/check-empire-state.mjs
npm.cmd run build
```

原游戏资源导出管线和固定工具版本见 [NYC 素材验证记录](nyc-local-asset-study.md)。此轮重建直接使用已有本地构件库，没有修改或再次写入游戏目录。

## 导出

`assets-source/nyc-local/empire/empire-state-demo.glb` 是当前建筑导出文件，自带石材、玻璃与入口所需图片。它只包含建筑本体和日间材质；程序天空、动态窗灯、后期阴影、周边街区与灯光不在建筑 GLB 中。

长度单位为米，Y 轴向上。大量重复几何通过 `EXT_mesh_gpu_instancing` 保留，导入软件需支持该扩展。程序纹理已经嵌入，使用时无需外部 HTTP 资源。

素材仍保存在 `.gitignore` 排除的 `assets-source/nyc-local/` 内。当前生产构建不复制这些游戏素材或本地样片页面。

## 验证记录

最新机器报告：`assets-source/nyc-local/empire/review/browser-check.json`；同目录有四种视角、夕照、蓝调和手机截图。

- Chrome 加载、四视角切换、三种光照和 GLB 下载验证。
- 8 个高度区段的四面射线检查，共 32 处。
- GLB 顶点属性数量、图片内嵌检查；重新加载后对照建筑高度和实例数量。
- 桌面 1440×1050、手机 390×844 视觉检查，手机无横向溢出。
- 浏览器无 JavaScript 或控制台错误，无外部 HTTP 请求。
- TypeScript 和生产构建检查；保留项目既有的 Three.js 分包体积提示。

这些检查验证功能与文件完整性，不代表与实物的测量误差验证或移动设备帧率基准测试。
