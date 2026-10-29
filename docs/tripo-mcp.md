# Tripo MCP 接入

2026-10-29 接入官方 `tripo-cli@0.8.0` 内置的 stdio MCP。它属于离线资产制作工具；适用 [开发规范第 12 节](development-standards.md#12-tripo-的项目使用规则)，生成候选仍需记录来源、授权、清理母版并接受实景与实际运行验收。

## 安装与入口

工具安装在被 Git 忽略的 `assets-source/tools/tripo-mcp/`。版本清单和依赖锁保存在 `scripts/tripo-mcp/`，不加入游戏运行时依赖。重建安装环境（仓库根目录、PowerShell）：

```powershell
New-Item -ItemType Directory -Force assets-source/tools/tripo-mcp
Copy-Item scripts/tripo-mcp/package*.json assets-source/tools/tripo-mcp
npm.cmd ci --prefix assets-source/tools/tripo-mcp --ignore-scripts --no-audit --no-fund
```

固定版本为 `tripo-cli@0.8.0` 和验收客户端 `@modelcontextprotocol/sdk@1.32.2`。CLI 要求 Node.js 20 以上，本机使用 Node.js 24.16.0。服务器入口：

```text
C:/Program Files/nodejs/node.exe
C:/Users/xieli/Desktop/projects/pulsetact-world/assets-source/tools/tripo-mcp/node_modules/tripo-cli/dist/cli.js mcp
```

官方文档将 `tripo mcp` 列为内置命令。npm 包声明的源码仓库为 `vast-enterprise/Tripo-API-CLI`，本次公开访问返回 404，因此直接检查官方发布包内的实现，并核验 npm SHA512 完整性。旧 `uvx tripo-mcp` 是另一个依赖 Blender 插件的 alpha 集成，不是本次安装入口。[Tripo CLI 文档](https://developers.tripo3d.ai/en/docs/cli)、[旧 MCP 仓库](https://github.com/Tripo-Developer/tripo-mcp)。

## Codex 配置与认证

本机用户级 Codex 配置已注册并启用 `mcp_servers.tripo`，工作目录为仓库根目录，启动超时 30 秒，工具超时 900 秒。使用上面的绝对 Node/CLI 路径，并设置 `TRIPO_HOME` 指向现有用户 `.tripo` 目录。密钥由其活动账户资料读取，未复制到仓库或 Codex MCP 配置。

该账户区域为 `ov`。本机直接访问余额接口失败；通过既有 Windows 本地代理 `http://127.0.0.1:15236` 设置 `HTTPS_PROXY` 与 `HTTP_PROXY` 后验证通过。CLI 会使用这些环境变量，不需要额外 Node 代理参数。仅该 MCP 子进程关闭匿名使用分析和版本更新检查。代理地址属于本机环境，其他电脑应使用自身网络配置。[Codex MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

## 验证结果与复查

运行 `node scripts/check-tripo-mcp.mjs`。若当前终端未继承本机代理，可仅为该终端设置：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:15236'
$env:HTTP_PROXY='http://127.0.0.1:15236'
node scripts/check-tripo-mcp.mjs
```

2026-10-29 使用官方 MCP SDK 验证通过：初始化、工具列表、`tripo_balance` 只读调用。服务返回以下五个工具：

| 工具 | 用途 |
| --- | --- |
| `tripo_make` | 提交生成或处理任务并下载结果；会消耗额度 |
| `tripo_task_get` | 查询已有任务 |
| `tripo_task_wait` | 等待已有任务，可下载结果 |
| `tripo_balance` | 查询余额 |
| `tripo_history` | 读取本地任务记录 |

脚本只调用 `tripo_balance`，没有生成任务或上传文件；日志不保存密钥、账户名或任意原始错误文本。详细本机结果在 `output/tripo-mcp-20261029/smoke-result.json`，不含余额金额的持久记录在 `assets-source/tooling/tripo-mcp-20261029.json`。`tripo_make` 的 MCP 参数没有 `dry_run`；后续生成应按具体资产任务规划和记录。

用户级配置启用和独立协议验收均已完成。当前已开启对话的工具目录尚未重新加载；需重载 MCP 或开启新对话后，确认 Tripo 工具出现在该对话中。该接入结果不代表任何新模型已生成或通过视觉验收。
