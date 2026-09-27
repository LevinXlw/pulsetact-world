# Cambridge · Killian Court 实机第一轮

2026-09-19—20 · 美国 Cambridge, Massachusetts

入口：[进入 MIT 庭院](http://127.0.0.1:5173/real/mit)。本页记录设计确认后的应用改造；[原美术方向](cambridge-art-direction.md)中的 AI 图仍是概念参考。

## 本轮范围

沿现有测绘底座完善 MIT Killian Court：保留已完成的 10 号楼柱廊，细化 3、4 号楼面向庭院的墙面与窗洞、铺装边缘、树群和统一午后光照。Harvard、河岸和两校之间的城市连接不属于本轮新增细化范围。

默认以 1.65 米眼高、48° 垂直视野进入庭院。WASD 移动，Shift 快走，拖动观察；打开地点、机位或设置时暂停移动并清除按键。角色探索、对话、活动、照片和已有进度继续使用原功能。

## 实现记录

- 3、4 号楼六面共 312 个窗洞，玻璃后退约 32 cm，并有独立窗框、石侧壁与更深的背板。依据同一 GIS 平面精确移除旧覆盖面，避免把窗框贴在封闭墙上。铺装旁补低石边与细分缝。
- 树群沿用既有位置，以分枝树干、带透明轮廓的叶簇和距离分级替换旧三角叶片。首排重点树保留更多近景细节；风、叶片和阴影采用同一变形。树叶不进入行走碰撞，树干使用简化碰撞体。
- 树群在反射捕获前完成构建，玻璃包含完整庭院环境。运行时不再请求旧的 `vegetation.glb.gz`，减少约 8.55 MB 的压缩资产请求。旧文件保留作回退与资产校验。
- 天空、日光、补光、雾和曝光来自统一光照配置。透明叶片不进入不能识别叶片透明度的 AO 法线替代绘制，避免叶片四边形形成黑块。
- 草坪采用米制尺度的色差和较窄枯边，覆盖入口近景；石材保留浅色块面、微小差异及窗台下的接触层次。机位和设置收进菜单，主要画面留给校园。
- 模型、纹理与实例资源在离开场景时去重释放。省电档减少树叶和阴影，保留相同地面与碰撞范围。

## 复核与边界

最终检查：55 项程序测试、5 项浏览器 E2E、生产构建全部通过。六个近景机位及省电档均保存截图；八节点键盘闭环包含上台阶、上平台、转身退回、经过西侧树荫和返回入口，未发现运行错误。浏览器验证还包括故事对话、地点收藏、拍照、MIT/Harvard 切换、390px 布局和 WebGL 不可用时的航拍兜底。

[当前实机画面](screenshots/cambridge-first-pass/after-live.png) · [3 号楼近景](screenshots/cambridge-first-pass/hero-building3.png) · [完整庭院行走录像](screenshots/cambridge-first-pass/courtyard-walk.webm) · [相机、路线与性能短测记录](screenshots/cambridge-first-pass/walk-report.json)

基线保护检查：原柱廊的墙、柱、门窗、台阶等 20 组几何属性、81 棵树位置及旧植被文件与备份一致。新窗洞无遮挡、石边连续贴合铺装的射线测试已加入常规测试。

建筑外壳与地形来自现有 GIS；窗洞尺度、石材表面、树形、树位和铺装边缘包含视觉近似。没有新增室内、摄影测量或现场树木测绘，不把本轮称为整座 Cambridge 的完成复原。

检查截图与记录位于 `docs/screenshots/cambridge-first-pass/`。程序测试和短路线检查不等于设计中提出的 1920×1080、指定 GPU、连续十分钟性能验收；该预算必须另行实测。

代码与资产改造前副本保存在 `docs/implementation-baseline/`。

## 可重复检查

```powershell
npm.cmd test
npm.cmd run build
$env:PW_DISABLE_TS_ESM='1'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run test:e2e -- tests/e2e/local-campus.spec.ts --reporter=line
node scripts/check-cambridge-first-pass.mjs
```

本机 Node 24 下，现有 Playwright 1.52 的旧 TypeScript ESM 加载器会停在测试发现阶段；上面的环境变量使用 Node 自带 TypeScript 加载能力，已验证可以运行测试。应用依赖版本未变。

短测使用本机 RTX 5090、Headless Chrome 153、1440×900、DPR 1。报告记录的是五秒 `requestAnimationFrame` 间隔，不是独立 GPU 耗时，也不能推断普通电脑或手机帧率。首屏资源仍未达到设计中的 20 MB 目标。
