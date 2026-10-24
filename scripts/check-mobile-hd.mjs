import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base = process.argv.find(arg => /^https?:\/\//.test(arg)) ?? 'http://127.0.0.1:5186';
const local = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const directory = `output/mobile-hd/${local ? 'local' : 'production'}`;
const profileKey = 'pulsetact:world:profile:v1';
const saveKey = 'pulsetact.world.solo.v1';
const hdPattern = /\/assets\/characters\/mobile-hd\/(pixiv|sakurada)\.glb(?:\?|$)/;
const desktopPattern = /\/(?:data\/(?:killian\/detail|campuses\/mit\/campus)|assets\/characters\/(?:pixiv|sakurada))\.glb(?:\.gz)?(?:\?|$)/;
const retainedKeys = ['visited', 'visitedPlaces', 'campusVisits', 'photos', 'lesson'];
const report = {base, startedAt: new Date().toISOString(), checks: [], errors: [], networkFailures: [], expectedFailures: [], requests: [], memory: [], checkpoints: [], screenshots: []};
const mb = bytes => Number((bytes / 1048576).toFixed(2));
let browser, context, page, cdp, stage = 'entry', stop = false, sampling, expectedHDfailure = false;
const releasePending = [];
const started = Date.now();
const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
const profile = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), profileKey);
const dock = () => page.getByRole('navigation', {name: '世界菜单', exact: true});
const check = (name, details = {}) => {report.checks.push({name, ...details}); console.log(`PASS ${name}`);};
const hdRequests = () => report.requests.filter(url => hdPattern.test(url));

async function memory(label = stage) {
  const usage = await cdp.send('Runtime.getHeapUsage');
  const sample = {stage: label, elapsedMs: Date.now() - started, usedMiB: mb(usage.usedSize), backingMiB: mb(usage.backingStorageSize ?? 0), embedderMiB: mb(usage.embedderHeapUsedSize ?? 0)};
  report.memory.push(sample); return sample;
}
async function shot(name) {
  await page.screenshot({path: `${directory}/${name}.png`}); report.screenshots.push(`${name}.png`);
}
async function ready(campus = 'boston', quality = 'low') {
  await expect(dock()).toBeVisible({timeout: 180_000});
  await expect(page.getByRole('button', {name: '拍照下载', exact: true})).toBeEnabled();
  await expect(page.getByRole('navigation', {name: '移动方向', exact: true})).toBeVisible();
  await expect(page.locator('.pw-loading')).toHaveCount(0);
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await expect.poll(async () => ({campus: (await saved()).campus, quality: (await saved()).quality})).toEqual({campus, quality});
  if (local) await page.waitForFunction(({campus, quality}) => window.__worldScene?.campusId === campus && window.__worldScene?.quality === quality && window.__worldScene?.characterReady, {campus, quality});
}
async function stableCanvas() {
  await expect(page.locator('.pw-scene canvas')).toHaveCount(1);
  await expect(page.locator('.pw-scene canvas'), 'material changes and travel preserve the WebGL renderer').toHaveAttribute('data-test-hd-canvas', 'stable');
}
async function chooseQuality(quality, {wait = true, campus = 'boston'} = {}) {
  stage = quality === 'standard' ? 'hd-loading' : 'low-loading';
  await page.getByRole('button', {name: '设置', exact: true}).tap();
  const action = page.getByRole('button', {name: quality === 'standard' ? '切换高清材质' : '切回省电', exact: true});
  await expect(action).toBeEnabled();
  if (!report.screenshots.includes(`settings-${quality}.png`)) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    await expect(action).toBeInViewport(); await shot(`settings-${quality}`);
  }
  await action.tap();
  // The mobile toggle normally closes settings; allow a persistent panel too.
  const close = page.getByRole('button', {name: '关闭面板', exact: true});
  if (await close.isVisible()) await close.tap();
  if (wait) {await ready(campus, quality); await stableCanvas(); stage = `${campus}-${quality}`;}
}
async function checkpoint(name) {
  await page.waitForTimeout(1500);
  const value = {name, saved: await saved(), memory: await memory(name), scene: local ? await page.evaluate(() => window.__worldScene ?? null) : null,
    canvas: await page.locator('.pw-scene canvas').evaluate(canvas => ({width: canvas.width, height: canvas.height}))};
  report.checkpoints.push(value); return value;
}
async function retained(expected) {
  const current = await saved();
  for (const key of retainedKeys) expect(current[key], `preserve ${key}`).toEqual(expected[key]);
}
async function chooseCharacter(id, quality = 'low') {
  await page.getByRole('button', {name: '校园身份', exact: true}).tap();
  const panel = page.getByRole('dialog', {name: '这次旅程中的你', exact: true});
  await panel.getByRole('button', {name: `选择 ${id === 'sakurada' ? 'Sakurada' : '白 T'}`, exact: true}).tap();
  const close = panel.getByRole('button', {name: '关闭面板', exact: true});
  if (await close.isVisible()) await close.tap();
  await ready('boston', quality); await expect.poll(async () => (await profile()).characterId).toBe(id);
}
async function travel(short, campus) {
  stage = `globe-to-${campus}`;
  await dock().getByRole('button', {name: '地图', exact: true}).tap();
  await page.getByRole('button', {name: '地球总览', exact: true}).tap();
  await expect(page.getByTestId('campus-globe-stage')).toHaveAttribute('data-ready', 'true', {timeout: 60000});
  await page.getByRole('button', {name: `查看 ${short} 的地理位置`, exact: true}).tap();
  await page.getByRole('button', {name: `进入 ${short} 校园`, exact: true}).tap();
  stage = `${campus}-hd-loading`; await ready(campus, 'standard'); await stableCanvas();
  await expect(page.getByTestId('campus-globe')).toHaveCount(0); stage = `${campus}-hd`;
}
async function photo() {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: '拍照下载', exact: true}).tap();
  const download = await downloading, path = `${directory}/03-hd-photo.png`;
  await download.saveAs(path); const bytes = await readFile(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.byteLength).toBeGreaterThan(20_000);
  const pixels = await page.evaluate(async url => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 64, 64);
    const data = context.getImageData(0, 0, 64, 64).data, colors = new Set(); let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {colors.add(`${data[i] >> 4}:${data[i + 1] >> 4}:${data[i + 2] >> 4}`); if (data[i + 3] > 240) opaque++;}
    return {width: image.naturalWidth, height: image.naturalHeight, distinctColors: colors.size, opaqueFraction: opaque / (data.length / 4)};
  }, `data:image/png;base64,${bytes.toString('base64')}`);
  expect(pixels.width).toBeGreaterThanOrEqual(580); expect(pixels.height).toBeGreaterThanOrEqual(1000);
  expect(pixels.distinctColors).toBeGreaterThan(20); expect(pixels.opaqueFraction).toBeGreaterThan(.95);
  return {bytes: bytes.byteLength, ...pixels};
}

await mkdir(directory, {recursive: true});
try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  await authenticateContext(context, base);
  await context.addInitScript(() => {
    performance.setResourceTimingBufferSize(2000);
    if (!localStorage.getItem('pulsetact:world:profile:v1')) localStorage.setItem('pulsetact:world:profile:v1', JSON.stringify({nickname: '手机高清漫游', color: '#778a64', characterId: 'pixiv'}));
    if (!localStorage.getItem('pulsetact.world.solo.v1')) localStorage.setItem('pulsetact.world.solo.v1', JSON.stringify({version: 1, campus: 'boston', position: [53.5, 52.5], campusPositions: {}, visited: ['axis'], visitedPlaces: ['bu-questrom'], campusVisits: ['umd-library'], photoSpots: [], photos: 2, quality: 'standard', trackedId: 'axis', lesson: {stage: 1, mirrorA: -45, mirrorB: 0, prediction: null}}));
    sessionStorage.setItem('pulsetact:world:entered', 'yes');
  });
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  page.on('request', request => report.requests.push(request.url()));
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('crash', () => report.errors.push('Browser page crashed'));
  page.on('console', message => {if (message.type() === 'error' && /WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost/i.test(message.text())) report.errors.push(message.text());});
  page.on('response', response => {if (response.status() >= 400 && !/\/api\/auth\//.test(response.url())) report.networkFailures.push({url: response.url(), status: response.status()});});
  page.on('requestfailed', request => {
    const error = request.failure()?.errorText ?? 'Unknown'; if (/ERR_ABORTED|cancelled|canceled/i.test(error)) return;
    const failure = {url: request.url(), error};
    if (expectedHDfailure && hdPattern.test(request.url())) report.expectedFailures.push(failure); else report.networkFailures.push(failure);
  });
  cdp = await context.newCDPSession(page);
  sampling = (async () => {while (!stop) {await memory().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500));}})();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await expect(page.getByLabel('旅途中，怎么称呼你？', {exact: true})).toHaveValue('手机高清漫游');
  await expect(page.locator('canvas')).toHaveCount(0); expect(hdRequests()).toEqual([]);
  await expect.poll(async () => (await saved()).quality).toBe('low');
  await page.getByRole('button', {name: /开始校园漫游|继续校园漫游/}).tap();
  await ready(); await page.waitForTimeout(3500);
  await page.locator('.pw-scene canvas').evaluate(canvas => {canvas.dataset.testHdCanvas = 'stable';});
  const before = await checkpoint('initial-low');
  expect(hdRequests()).toEqual([]); expect(before.canvas.width).toBe(390);
  await shot('01-low-materials');
  check('phone starts in low quality without requesting HD assets, even with a saved standard setting');

  let held = 0, releaseHD;
  const gate = new Promise(resolve => {releaseHD = resolve;}); releasePending.push(releaseHD);
  const pixivPattern = /\/assets\/characters\/mobile-hd\/pixiv\.glb(?:\?|$)/;
  await context.route(pixivPattern, async route => {held++; await gate; await route.continue().catch(() => {});});
  // Keep image decoding pending after download. Cancelling and immediately
  // requesting HD again must reuse that decode, not allocate a second copy.
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    window.__mobileHDDecodeGate = {calls: 0, release() {window.createImageBitmap = original; release();}};
    window.createImageBitmap = async function (...args) {
      window.__mobileHDDecodeGate.calls++;
      await gate;
      return original.apply(window, args);
    };
  });
  await chooseQuality('standard', {wait: false});
  await expect.poll(() => held).toBeGreaterThan(0);
  await expect(page.locator('.pw-loading')).toBeVisible();
  await expect(page.getByRole('button', {name: '返回省电模式', exact: true})).toBeVisible();
  await stableCanvas(); await shot('02-hd-loading');
  check('requesting HD displays a loading state with an immediate return-to-low action and retains the canvas');
  releaseHD();
  await page.waitForFunction(() => window.__mobileHDDecodeGate.calls > 0, undefined, {timeout: 60_000});
  const pendingDecodeCalls = await page.evaluate(() => window.__mobileHDDecodeGate.calls);
  await page.getByRole('button', {name: '返回省电模式', exact: true}).tap();
  await ready('boston', 'low'); await stableCanvas();
  const requestsDuringDecode = hdRequests().length;
  await chooseQuality('standard', {wait: false});
  await expect(page.getByRole('button', {name: '返回省电模式', exact: true})).toBeVisible();
  await page.waitForTimeout(700);
  expect(hdRequests().length, 're-enabling HD must reuse its pending decode').toBe(requestsDuringDecode);
  expect(held).toBe(1);
  await page.evaluate(() => window.__mobileHDDecodeGate.release());
  await ready('boston', 'standard'); await context.unroute(pixivPattern);
  check('cancelling and re-enabling HD during image decode reuses one download and decode', {pendingDecodeCalls, downloads: held});
  const hd = await checkpoint('first-hd');
  await retained(before.saved); await stableCanvas();
  const afterPosition = (await saved()).position;
  expect(Math.hypot(afterPosition[0] - before.saved.position[0], afterPosition[1] - before.saved.position[1])).toBeLessThan(.05);
  expect(hd.canvas.width).toBeGreaterThan(before.canvas.width);
  if (local) expect(hd.scene.geometryCount).toBe(before.scene.geometryCount);
  await shot('03-hd-materials');
  check('HD material transition preserves position and progress and increases resolution without changing the renderer');
  const photoResult = await photo();
  await expect.poll(async () => (await saved()).photos).toBe(before.saved.photos + 1);
  check('HD photography downloads a populated high-resolution PNG', photoResult);
  const expectedProgress = {...before.saved, photos: before.saved.photos + 1};
  await chooseQuality('low'); await checkpoint('before-toggle-cycles');
  for (let cycle = 1; cycle <= 3; cycle++) {
    await chooseQuality('standard'); await checkpoint(`cycle-${cycle}-hd`);
    await chooseQuality('low'); await checkpoint(`cycle-${cycle}-low`);
    await retained(expectedProgress);
    check(`HD/low toggle cycle ${cycle} completes with the same canvas and saved progress`);
  }

  await chooseCharacter('sakurada');
  let failures = 0; expectedHDfailure = true;
  const sakuradaPattern = /\/assets\/characters\/mobile-hd\/sakurada\.glb(?:\?|$)/;
  await context.route(sakuradaPattern, route => {failures++; return route.abort('failed');});
  await chooseQuality('standard', {wait: false});
  await expect.poll(() => failures).toBeGreaterThan(0);
  await ready('boston', 'low'); await stableCanvas(); await retained(expectedProgress);
  await expect(page.locator('.pw-toast')).toBeVisible();
  const fallbackNotice = await page.locator('.pw-toast').textContent();
  await shot('04-hd-failure-fallback');
  await context.unroute(sakuradaPattern); expectedHDfailure = false;
  check('failed HD avatar download automatically falls back to a playable low scene', {failureCount: failures, notice: fallbackNotice});
  await chooseQuality('standard'); await checkpoint('sakurada-hd'); await shot('05-sakurada-hd');
  expect((await profile()).characterId).toBe('sakurada');
  check('Sakurada can retry HD successfully after a failed download');

  for (const [short, campus] of [['UMD', 'umd'], ['UPenn', 'upenn'], ['Arizona', 'arizona'], ['MIT', 'boston']]) {
    await travel(short, campus); await checkpoint(`${campus}-hd-travel`); await retained(expectedProgress);
    await shot(`06-${campus}-hd`);
    check(`${short} travel retains HD materials, character, progress and the existing canvas`);
  }
  expect(report.requests.filter(url => desktopPattern.test(url))).toEqual([]);
  for (const campus of ['boston', 'umd', 'upenn', 'arizona']) expect(report.requests.some(url => url.includes(`/data/mobile/${campus}.glb`))).toBe(true);
  check('all four HD campuses still use bounded mobile geometry with no desktop models');

  stage = 'context-loss';
  const prevented = await page.locator('.pw-scene canvas').evaluate(canvas => {const event = new Event('webglcontextlost', {cancelable: true}); canvas.dispatchEvent(event); return event.defaultPrevented;});
  expect(prevented).toBe(true);
  const error = page.locator('.pw-scene-error[role="alert"]');
  await expect(error).toBeVisible(); await expect(error).toContainText('画面渲染已中断');
  const requestsBeforeRetry = hdRequests().length;
  await error.getByRole('button', {name: '以省电模式重试', exact: true}).tap();
  await ready('boston', 'low'); await retained(expectedProgress);
  expect((await profile()).characterId).toBe('sakurada'); expect(hdRequests().length).toBe(requestsBeforeRetry);
  await page.locator('.pw-scene canvas').evaluate(canvas => {canvas.dataset.testHdCanvas = 'stable';});
  await checkpoint('context-loss-low-recovery');
  check('synthetic context-loss retry returns from HD to low while preserving character and progress', {simulation: 'DOM event only; no physical GPU loss induced'});

  await chooseQuality('standard');
  const beforeReload = hdRequests().length;
  stage = 'reload'; await page.reload({waitUntil: 'domcontentloaded'});
  await expect(page.getByLabel('旅途中，怎么称呼你？', {exact: true})).toHaveValue('手机高清漫游');
  await expect(page.locator('canvas')).toHaveCount(0); await expect.poll(async () => (await saved()).quality).toBe('low');
  expect(hdRequests().length).toBe(beforeReload);
  await page.getByRole('button', {name: /开始校园漫游|继续校园漫游/}).tap();
  await ready('boston', 'low'); await retained(expectedProgress); expect(hdRequests().length).toBe(beforeReload);
  await checkpoint('reloaded-low'); await shot('07-reloaded-low');
  check('reload preserves the journey but requires explicit entry and restarts in low without fetching HD assets');

  stage = 'final-idle'; await page.waitForTimeout(3500);
  report.beforeDiagnosticGC = await memory('before-diagnostic-gc');
  stop = true; await sampling;
  report.observedPeak = {usedMiB: Math.max(...report.memory.map(value => value.usedMiB)), backingMiB: Math.max(...report.memory.map(value => value.backingMiB))};
  await cdp.send('HeapProfiler.collectGarbage'); report.afterDiagnosticGC = await memory('after-diagnostic-gc');
  expect(report.observedPeak.usedMiB, 'HD switching JS regression budget, not an iOS memory limit').toBeLessThan(160);
  expect(report.observedPeak.backingMiB, 'HD switching backing-store regression budget before diagnostic GC').toBeLessThan(256);
  expect(report.errors).toEqual([]); expect(report.networkFailures).toEqual([]);
  check('HD toggle and travel stay below bounded Chromium regression budgets without shader or page errors', report.observedPeak);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1;
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
} finally {
  releasePending.forEach(release => release()); stop = true; await sampling;
  report.memorySummary = {observedPeak: report.observedPeak, checkpoints: report.checkpoints.map(({name, memory}) => ({name, ...memory})), beforeDiagnosticGC: report.beforeDiagnosticGC, afterDiagnosticGC: report.afterDiagnosticGC,
    note: 'No extra CDP Network.enable, retained response bodies, or forced GC during toggling/travel. Final forced GC is diagnostic only. Touch Chromium is not physical iPhone Safari validation.'};
  report.finishedAt = new Date().toISOString(); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close();
  console.log(JSON.stringify({status: report.status, checks: report.checks, memorySummary: report.memorySummary, errors: report.errors, networkFailures: report.networkFailures, error: report.error}, null, 2));
}
