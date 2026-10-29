/**
 * Read-only Tripo MCP smoke check. Run: node scripts/check-tripo-mcp.mjs
 * Install tools separately (PowerShell; leaves game dependencies unchanged):
 * New-Item -ItemType Directory -Force assets-source/tools/tripo-mcp
 * Copy-Item scripts/tripo-mcp/package*.json assets-source/tools/tripo-mcp
 * npm.cmd ci --prefix assets-source/tools/tripo-mcp --ignore-scripts --no-audit --no-fund
 * Set HTTPS_PROXY/HTTP_PROXY for this process when the network needs a proxy.
 * Only initializes MCP, lists tools, and queries the account balance.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = join(root, 'assets-source', 'tools', 'tripo-mcp');
const cli = join(prefix, 'node_modules', 'tripo-cli', 'dist', 'cli.js');
const sdk = join(prefix, 'node_modules', '@modelcontextprotocol', 'sdk');
const tripoHome = join(homedir(), '.tripo');
const output = join(root, 'output', 'tripo-mcp-20261029');
const reportFile = join(output, 'smoke-result.json');
const expectedTools = ['tripo_balance', 'tripo_history', 'tripo_make', 'tripo_task_get', 'tripo_task_wait'];
const report = {
  timestamp: new Date().toISOString(),
  purpose: 'MCP connection and existing-account read-only validation',
  passed: false,
  node: process.version,
  command: process.execPath,
  args: [cli, 'mcp'],
  cwd: root,
  credentials: { source: 'stored_active_profile', presence: 'NOT_CHECKED' },
  stages: [],
  calls: [],
  paid_tasks_created: 0,
  uploads: 0,
  stderr_bytes: 0,
};

// Do not persist arbitrary exception or provider text: it can contain account
// data. Record a fixed category and numeric protocol code instead.
function classifyError(error) {
  const message = String(error?.message ?? error);
  if (/401|403|auth|api.?key|credential/i.test(message)) return 'authentication';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/network|fetch|ENOTFOUND|ECONN|EAI_AGAIN|DNS/i.test(message)) return 'network';
  if (/ENOENT|module|package/i.test(message)) return 'installation';
  return 'protocol_or_validation';
}

let client;
let stage = 'installation';
try {
  const packageJson = JSON.parse(await readFile(join(prefix, 'node_modules', 'tripo-cli', 'package.json'), 'utf8'));
  const sdkPackage = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.8.0', 'Unexpected CLI package version');
  assert.equal(sdkPackage.version, '1.32.2', 'Unexpected MCP SDK package version');
  report.packages = { 'tripo-cli': packageJson.version, '@modelcontextprotocol/sdk': sdkPackage.version };
  report.cli_sha256 = createHash('sha256').update(await readFile(cli)).digest('hex');
  report.lock_sha256 = createHash('sha256').update(await readFile(join(prefix, 'package-lock.json'))).digest('hex');
  const preservedLock = await readFile(join(root, 'scripts', 'tripo-mcp', 'package-lock.json'));
  assert.equal(report.lock_sha256, createHash('sha256').update(preservedLock).digest('hex'), 'Tool installation lock differs from the preserved lock');
  report.stages.push({ stage, passed: true });

  stage = 'credentials';
  const config = JSON.parse(await readFile(join(tripoHome, 'config.json'), 'utf8'));
  const activeProfile = config.profiles?.[config.active_profile || 'default'];
  assert.equal(typeof activeProfile?.api_key, 'string', 'Stored credential missing');
  assert.ok(activeProfile.api_key.length > 0, 'Stored credential empty');
  report.credentials.presence = 'PRESENT';
  report.credentials.region = ['ov', 'cn'].includes(activeProfile.region) ? activeProfile.region : 'ov';
  report.stages.push({ stage, passed: true });

  const { Client } = await import(pathToFileURL(join(sdk, 'dist', 'esm', 'client', 'index.js')).href);
  const { StdioClientTransport, getDefaultEnvironment } = await import(pathToFileURL(join(sdk, 'dist', 'esm', 'client', 'stdio.js')).href);
  const env = {
    ...getDefaultEnvironment(),
    TRIPO_HOME: tripoHome,
    TRIPO_ANALYTICS_ENABLED: '0',
    TRIPO_NO_UPDATE_CHECK: '1',
  };
  // Preserve network routing while excluding credential/account overrides.
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  report.environment = {
    proxy: env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy ? 'configured' : 'direct',
    credential_overrides: false,
    analytics: 'disabled_for_this_process',
    update_check: 'disabled_for_this_process',
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp'],
    cwd: root,
    env,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => { report.stderr_bytes += Buffer.byteLength(chunk); });
  client = new Client({ name: 'pulsetact-tripo-readonly-smoke', version: '1.0.0' });

  stage = 'initialize';
  await client.connect(transport, { timeout: 30_000 });
  const server = client.getServerVersion();
  assert.equal(server?.name, 'tripo-cli');
  assert.equal(server?.version, '0.8.0');
  report.server = { name: server.name, version: server.version };
  report.stages.push({ stage, passed: true });

  stage = 'tools/list';
  const listing = await client.listTools(undefined, { timeout: 15_000 });
  const toolNames = listing.tools.map(({ name }) => name).sort();
  assert.deepEqual(toolNames, expectedTools);
  report.tool_names = toolNames;
  report.stages.push({ stage, passed: true, count: toolNames.length });

  stage = 'tripo_balance';
  // The only tools/call request in this script. Never add make or upload calls.
  report.calls.push({ tool: 'tripo_balance', passed: false });
  const result = await client.callTool({ name: 'tripo_balance', arguments: {} }, undefined, { timeout: 55_000 });
  const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  if (result.isError) {
    const error = new Error('Balance query failed');
    error.category = classifyError(text);
    throw error;
  }
  const balance = JSON.parse(text);
  assert.ok(Number.isFinite(balance.balance), 'Balance response missing numeric balance');
  assert.ok(Number.isFinite(balance.frozen), 'Balance response missing numeric frozen balance');
  report.balance = { balance: balance.balance, frozen: balance.frozen };
  report.credentials.authenticated = true;
  report.calls[0].passed = true;
  report.stages.push({ stage, passed: true });
  report.passed = true;
} catch (error) {
  report.error = { stage, category: error.category ?? classifyError(error) };
  if (typeof error.code === 'number') report.error.protocol_code = error.code;
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
  await mkdir(output, { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ passed: report.passed, server: report.server, tools: report.tool_names, calls: report.calls, error: report.error, report: reportFile }));
}
