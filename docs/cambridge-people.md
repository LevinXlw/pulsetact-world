# Cambridge 人物样板

MIT 精细场景使用 Renderpeople 的两个人物扫描：Nathan Animated 003 Walking 和 Sophia Animated 003 Idling。默认环境漫步中，Nathan 沿庭院南侧横向石路行走，Sophia 在中央步道边等候；“机位 → 人物近景”可观察扫描细节。角色探索沿用原任务位置、交谈逻辑和存档，MIT 精细场景的人物改为这两具扫描模型。Harvard 和艺术化校园保留原人物。

## 来源和使用范围

- 下载：Renderpeople [官方免费素材页](https://renderpeople.com/free-3d-people/)中的 Animated People / FBX，文件 `renderpeople_free_animated_people_FBX.zip`，下载于 2026-10-05。
- 本次实际取得的是官网素材包，适用 [Renderpeople 条款](https://renderpeople.com/general-terms-and-conditions/)，不是通过 Sketchfab 下载取得的素材包。官网允许实时渲染；条款 4.3(b) 对使模型可被第三方轻易提取的分发方式有限制。本次供本地评估，未发布上线；公开部署前须落实适合网页交付的授权。
- 作者在 Sketchfab 也发布了同名 [Nathan](https://sketchfab.com/3d-models/nathan-animated-003-walking-3d-man-143a2b1ea5eb4385ae90a73657aca3bc) 和 [Sophia](https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf)，其公开 API 标注 CC BY 4.0。该记录作为备选取得渠道的证据，不把官网包自动重标为 CC BY。
- 原始压缩包、FBX、8K 贴图和转换工具存放在忽略提交的 `assets-source/people/`、`assets-source/tools/`。网页资源的作者、链接、修改记录和 SHA-256 记录在 `public/assets/people/sources.json`。

## 处理和运行

使用 Blender 4.5 LTS 后台运行 `scripts/convert-campus-people.py`，将 FBX 转成自包含 GLB。贴图缩小到网页可用尺寸，保留真实肤色、服装和法线细节。源文件中的 mask01、mask02 是衣物分区，不能当作透明贴图。

行走动作去除水平根位移后，由场景以对应原始步幅的速度移动。路线始终处于石路范围内，每帧从现有地形碰撞层采样脚下高度。每个人拥有独立骨骼和动画播放器，共享只读材质、几何体和贴图。模型只从本地加载，每个页面生命周期各下载一次。

打开菜单或对话时暂停路线与动作；切换为减少动态时保留站立姿势。人物加载失败不触发整个校园降级。角色探索中的快走使用加速的行走动画，尚未加入独立跑步、转身或口型动作。当前是两个人物的视觉和性能样板，尚未扩展为校园人群。

## 验收

- `npm test -- tests/campus-people.test.ts`：完整路线的铺装范围、速度、朝向、转弯和循环连续性。
- `node scripts/check-campus-people.mjs`：独立浏览器验证人物加载、行走、待机、暂停恢复、省电模式、近景、角色对话、动作切换、缓存和局部失败。
- `npm run build`：TypeScript 与生产构建。
- 截图和检查结果：`docs/screenshots/campus-people/`。

已验证：60 项单元测试通过；人物专项浏览器检查的 10 项场景全部通过。两个模型合计 8.46 MB，约 3.8 万三角形，分别包含 88 根骨骼。截图记录的是本机开发环境的实际渲染。
