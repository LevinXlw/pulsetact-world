# Blender MCP 工作流

生效日期：2026-10-25。按用户要求，后续日常 Blender 场景检查、建模和材质迭代优先通过 MCP 进行；可复现的批量构建、烘焙及导出仍可使用 bpy 脚本。Three.js 继续负责游戏运行时。

## 当前安装

- Blender：项目本机工具目录 `assets-source/tools/blender-4.5.9-windows-x64/blender.exe`，4.5.9 LTS。
- 社区服务：[MCP for Blender](https://github.com/ahujasid/mcp-for-blender)，PyPI `mcp-for-blender==2.2.4`；不是 Blender Foundation 官方插件。
- 独立 Python 3.12 环境：`assets-source/tools/blender-mcp-env/`。依赖版本固定在 `scripts/blender-mcp/requirements.lock.txt`。
- Add-on：Blender 4.5 用户插件目录的 `blender_mcp.py`，已启用；该包内 add-on 自报版本 1.8、协议 15，与服务端兼容。
- Codex：用户级 `mcp_servers.blender`，stdio，使用独立环境 Python 的 `-m blender_mcp.server`。不依赖 PATH 中的 uv，也不依赖临时联网下载。
- Blender socket：仅 `127.0.0.1:9876`；本轮实际检查监听地址与 Blender 进程一致。
- `DISABLE_TELEMETRY=true`，插件遥测偏好关闭；`BLENDER_MCP_SAFE_MODE=1`；`PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`。
- 未启用 Tripo、其他生成服务或资产库。后续使用这些服务时按项目生成资产规范执行。

本地工具目录被 Git 忽略，不能把它当成其他开发机已经安装。用户级 Codex 配置中的绝对路径属于当前机器；不要复制为其他机器的固定路径。

## 日常操作

1. 启动项目使用的 Blender，可打开要编辑的母版，也可用 `scripts/blender-mcp/start-blender-mcp.ps1 -BlendFile <母版.blend>`。脚本后台启动；端口占用时不再开第二个实例。需要直接观察 UI 时手动打开上述 Blender。
2. 新增 MCP 配置后完整退出并重新打开 Codex，让新会话加载工具。Blender 独立进程可保持运行。若未自动连接，在 Blender 的 N 侧栏找到 MCP for Blender 并检查 Start MCP Server。
3. 首先调用 `get_addon_status`、`get_scene_info`，确认文件、场景、对象、连接和版本。多实例时不要假设连接的是最前面的窗口。
4. 编辑前保存母版或工作副本。用 `execute_blender_code` 分步修形/材质，及时通过 `get_scene_info` 与 `look` 的多角度图检查。
5. 导出 GLB，记录版本和 hash；在 Three.js 实际游戏场景继续完成实景对照、碰撞/可行走和性能检查。

MCP 仍通过 bpy 修改 Blender，但操作经 MCP 协议进入持续运行的 Blender，能够观察并迭代当前场景。连接方式本身不会提高模型真实度，也不替代 G0–G4。

## 本轮实测证据

实际运行 `scripts/check-blender-mcp.py`，完成 MCP SDK 的 initialize、list_tools、call_tool，收到 9 个工具；不是仅检测端口或直接调用 socket。

- 获取插件与场景状态成功。
- 在独立测试场景创建 `Pulsetact_MCP_Probe`，设置尺寸、倒角和 PBR 材质成功。
- MCP 返回正面与斜视截图，人工检查可见倒角和绿色材质。
- 通过 MCP 保存 `.blend`、导出 GLB；验证 GLB 结构、408 个 position 顶点记录、Metallic 0.65、Roughness 0.28。
- 测试客户端已正常退出，Blender 服务保持可用。
- 测试结果：`output/blender-mcp-smoke/result.json`；截图、母版、GLB 同目录。该目录是忽略的本地测试产物，不是校园视觉验收记录。
- 持久安装与测试摘要见 `assets-source/tooling/blender-mcp-20261025.json`。

当前会话完成了真实 MCP 协议验证，但会话工具目录尚未加载 blender 工具；重启 Codex 后仍需用原生工具再次确认场景。不能把 SDK 测试写成“当前聊天已直接挂载工具”。

## 复现安装与测试

在仓库根目录：

1. 用 Python 3.12 创建 `assets-source/tools/blender-mcp-env` venv，再以该环境 Python 执行 `-m pip install -r scripts/blender-mcp/requirements.lock.txt`。
2. 环境设置 `DISABLE_TELEMETRY=true`、`PYTHONUTF8=1` 后，运行该环境 `mcp-for-blender.exe install-addon --addons-dir <Blender4.5用户scripts/addons目录>`。仅安装指定版本目录，不用自动配置多个客户端的 setup。
3. 运行 Blender `--background --python scripts/blender-mcp/enable-addon.py`。该脚本仅启用插件、关闭遥测、保存偏好；如已有偏好文件会保留一次性备份，不覆盖启动场景。
4. 运行 `codex mcp add blender`，用多个 `--env` 传入上述环境项和 `BLENDER_HOST=127.0.0.1`、`BLENDER_PORT=9876`，`--` 后给当前机器独立环境 Python 的绝对路径及 `-m blender_mcp.server`。已有同名配置时先检查，避免无意覆盖。
5. 启动独立、未保存、无用户工作的 Blender 实例。用独立环境 Python 执行 `scripts/check-blender-mcp.py`。测试会创建新场景、写测试母版/GLB；已保存文件或已存在同名测试对象时拒绝运行，不在生产母版上跑测试。

Windows 某些终端默认编码会令安装器打印箭头时报 UnicodeEncodeError；先检查插件文件及 hash，再决定是否重跑，不能仅据退出码推断未安装。

配置原理参考 [Codex MCP 文档](https://developers.openai.com/codex/mcp)。
