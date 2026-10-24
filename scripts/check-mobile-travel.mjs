import {mkdir, writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {chromium, expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base = process.argv.find(arg => /^https?:\/\//.test(arg)) ?? 'http://127.0.0.1:5186';
const local = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const directory = `output/mobile-travel/${local ? 'local' : 'production'}`;
const saveKey = 'pulsetact.world.solo.v1';
const loopCount = Number(process.argv.find(arg => /^--loops=/.test(arg))?.split('=')[1] ?? 3);
if (!Number.isInteger(loopCount) || loopCount < 1 || loopCount > 8) throw new Error('--loops must be an integer from 1 to 8');
const report = {base, startedAt: new Date().toISOString(), checks: [], errors: [], networkFailures: [], resources: [], memory: [], campuses: [], retries: []};
const requests = new Map();
const pendingRequestSizes = new Set();
const mb = value => Number((value / 1048576).toFixed(2));
let browser, context, page, cdp, stage = 'entry', loop = 0, stop = false, sampling;
const started = Date.now();
const check = name => {report.checks.push(name); console.log(`PASS ${name}`);};
const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
const debug = () => page.evaluate(() => window.__worldScene ?? null);
async function memory(label = stage) {
  const heap = await cdp.send('Runtime.getHeapUsage');
  const value = {stage: label, loop, elapsedMs: Date.now() - started, usedMiB: mb(heap.usedSize), backingMiB: mb(heap.backingStorageSize ?? 0), embedderMiB: mb(heap.embedderHeapUsedSize ?? 0)};
  report.memory.push(value); return value;
}
async function ready(campus) {
  await expect(page.getByRole('navigation', {name: '世界菜单', exact: true})).toBeVisible({timeout: 180000});
  await expect(page.getByRole('button', {name: '拍照下载', exact: true})).toBeEnabled();
  await expect(page.getByRole('navigation', {name: '移动方向', exact: true})).toBeVisible();
  await expect(page.locator('.pw-loading')).toHaveCount(0);
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await expect.poll(async () => (await saved()).campus).toBe(campus);
  if (local) await page.waitForFunction(campus => window.__worldScene?.campusId === campus && window.__worldScene?.characterReady, campus);
}
async function globe() {
  stage = 'globe';
  await page.getByRole('navigation', {name: '世界菜单', exact: true}).getByRole('button', {name: '地图', exact: true}).tap();
  await page.getByRole('button', {name: '地球总览', exact: true}).tap();
  await expect(page.getByTestId('campus-globe-stage')).toHaveAttribute('data-ready', 'true', {timeout: 60000});
  await expect(page.getByTestId('campus-globe')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await memory('globe-visible');
}
async function travel(short, campus) {
  await globe();
  await page.getByRole('button', {name: `查看 ${short} 的地理位置`, exact: true}).tap();
  await page.getByRole('button', {name: `进入 ${short} 校园`, exact: true}).tap();
  stage = `${campus}-loading`;
  await ready(campus); stage = campus;
  await expect(page.getByTestId('campus-globe')).toHaveCount(0);
  await expect(page.locator('.pw-scene canvas')).toHaveCount(1);
  await expect(page.locator('.pw-scene canvas'), 'campus travel must preserve the same canvas and renderer').toHaveAttribute('data-test-travel-canvas', 'stable');
}
async function walk(campus, index) {
  const before = local ? (await debug()).position : (await saved()).position;
  const button = page.getByRole('navigation', {name: '移动方向', exact: true}).getByRole('button', {name: '向后', exact: true});
  const box = await button.boundingBox(); expect(box).not.toBeNull();
  const positions = [];
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1}]});
  for (let step = 0; step < 8; step++) {
    await page.waitForTimeout(200);
    if (local) positions.push((await debug()).position);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await page.waitForTimeout(3300);
  const after = local ? (await debug()).position : (await saved()).position;
  const zIndex = local ? 2 : 1;
  const distance = Math.hypot(after[0] - before[0], after[zIndex] - before[zIndex]);
  expect(distance, `${campus}: physical touch hold moves the character`).toBeGreaterThan(1);
  expect(distance).toBeLessThan(20);
  let heightRange = null, largestStep = null;
  if (local) {
    positions.unshift(before); positions.push(after);
    expect(positions.every(position => position.length === 3 && position.every(Number.isFinite))).toBe(true);
    const heights = positions.map(position => position[1]);
    heightRange = Math.max(...heights) - Math.min(...heights);
    largestStep = Math.max(...heights.slice(1).map((height, i) => Math.abs(height - heights[i])));
    expect(heightRange, `${campus}: no large fall on the short arrival walk`).toBeLessThan(3);
    expect(largestStep, `${campus}: continuous terrain height`).toBeLessThan(1);
  }
  await page.screenshot({path: `${directory}/${index}-${campus}.png`});
  const data = {campus, loop, before, after, distance, heightRange, largestStep, memory: await memory(`${campus}-after-walk`), scene: await debug()};
  report.campuses.push(data); check(`${campus}: touch walking moves ${distance.toFixed(2)}m${local ? ' with continuous finite terrain height' : ' and persists its position'}`);
}
await mkdir(directory, {recursive: true});
try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  await authenticateContext(context, base);
  await context.addInitScript(() => {
    performance.setResourceTimingBufferSize(2000);
    localStorage.setItem('pulsetact:world:profile:v1', JSON.stringify({nickname: '手机校园旅行', color: '#778a64', characterId: 'pixiv'}));
    if (!localStorage.getItem('pulsetact.world.solo.v1')) localStorage.setItem('pulsetact.world.solo.v1', JSON.stringify({version: 1, campus: 'boston', position: [53.5, 52.5], campusPositions: {}, visited: ['axis'], visitedPlaces: ['bu-questrom'], campusVisits: ['umd-library'], photoSpots: [], photos: 2, quality: 'standard', trackedId: 'axis', lesson: {stage: 1, mirrorA: -45, mirrorB: 0, prediction: null}}));
    sessionStorage.setItem('pulsetact:world:entered', 'yes');
  });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('request', request => {if (!/\/api\/auth\//.test(request.url())) requests.set(request, {url: request.url(), type: request.resourceType()});});
  page.on('requestfinished', request => {
    const item = requests.get(request); if (!item) return;
    const pending = request.sizes().then(sizes => {item.bytes = sizes.responseBodySize;}).catch(() => {}).finally(() => pendingRequestSizes.delete(pending));
    pendingRequestSizes.add(pending);
  });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('crash', () => report.errors.push('Browser page crashed'));
  page.on('requestfailed', request => {const error = request.failure()?.errorText ?? 'Unknown'; if (!/ERR_ABORTED|cancelled|canceled/i.test(error)) report.networkFailures.push({url: request.url(), error});});
  page.on('response', response => {if (response.status() >= 400 && !/\/api\/auth\//.test(response.url())) report.networkFailures.push({url: response.url(), status: response.status()});});
  // A second Network inspector preserves fetched payloads and can contaminate
  // ArrayBuffer measurements. Playwright counters require no extra body cache.
  cdp = await context.newCDPSession(page);
  report.networkCollection = 'Playwright request/finished events only; no explicit CDP Network.enable';
  sampling = (async () => {while (!stop) {await memory().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500));}})();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await expect(page.getByLabel('旅途中，怎么称呼你？', {exact: true})).toHaveValue('手机校园旅行');
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', {name: /开始校园漫游|继续校园漫游/}).tap();
  await ready('boston'); stage = 'boston';
  await page.locator('.pw-scene canvas').evaluate(canvas => {canvas.dataset.testTravelCanvas = 'stable';});
  await walk('boston', '01');
  await globe(); await page.screenshot({path: `${directory}/02-globe.png`});
  await page.getByRole('button', {name: '关闭面板', exact: true}).tap();
  await ready('boston'); await expect(page.getByTestId('campus-globe')).toHaveCount(0);
  check('touch globe opens and closes without leaving a second canvas');
  for (loop = 1; loop <= loopCount; loop++) {
    for (const [i, [short, campus]] of [['UMD', 'umd'], ['UPenn', 'upenn'], ['Arizona', 'arizona'], ['MIT', 'boston']].entries()) {
      await travel(short, campus); await walk(campus, `loop-${loop}-${i + 1}`);
    }
    console.log(`Completed campus loop ${loop}/${loopCount}`);
  }
  loop = loopCount;
  const retained = await saved();
  expect(retained.visited).toEqual(['axis']); expect(retained.visitedPlaces).toEqual(['bu-questrom']);
  expect(retained.campusVisits).toEqual(['umd-library']); expect(retained.photos).toBe(2); expect(retained.lesson.stage).toBe(1);
  expect(retained.quality).toBe('low');
  for (const campus of ['umd', 'upenn', 'arizona']) expect(retained.campusPositions[campus].every(Number.isFinite)).toBe(true);
  check('all four campuses retain travel checkpoints, discoveries, photos and lesson progress');
  for (let retry = 1; retry <= 3; retry++) {
    stage = `context-retry-${retry}`;
    const canvas = page.locator('.pw-scene canvas');
    const prevented = await canvas.evaluate(canvas => {
      const event = new Event('webglcontextlost', {cancelable: true}); canvas.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    const error = page.locator('.pw-scene-error[role="alert"]'); await expect(error).toBeVisible();
    await expect(error).toContainText('画面渲染已中断');
    await error.getByRole('button', {name: '以省电模式重试', exact: true}).tap();
    await ready('boston'); await page.waitForTimeout(600);
    const restored = await saved();
    for (const key of ['visited', 'visitedPlaces', 'campusVisits', 'photos', 'lesson', 'quality']) expect(restored[key]).toEqual(retained[key]);
    const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('pulsetact:world:profile:v1')));
    expect(profile.nickname).toBe('手机校园旅行'); expect(profile.characterId).toBe('pixiv');
    report.retries.push({retry, memory: await memory(`context-retry-${retry}-ready`)});
    await page.screenshot({path: `${directory}/retry-${retry}.png`});
    check(`synthetic context-loss retry ${retry} restores the selected avatar and retained progress`);
  }
  const desktopModels = [...requests.values()].filter(item => /\/data\/(?:killian\/detail|campuses\/mit\/campus)\.glb/.test(item.url));
  expect(desktopModels).toEqual([]);
  for (const campus of ['boston', 'umd', 'upenn', 'arizona']) expect([...requests.values()].some(item => item.url.includes(`/data/mobile/${campus}.glb`))).toBe(true);
  check('all campus travel uses baked mobile models without desktop scene downloads');
  report.modelSizes = await page.evaluate(() => performance.getEntriesByType('resource').filter(item => /\/data\/mobile\/[^/]+\.glb(?:\?|$)/.test(item.name)).map(item => ({url: item.name, decodedBytes: item.decodedBodySize, transferredBytes: item.transferSize})));
  // Let browser scheduling run naturally throughout all loops. A final forced
  // GC is diagnostic only and is excluded from the success/budget assertions.
  stage = 'final-idle'; await page.waitForTimeout(5000);
  report.beforeDiagnosticGC = await memory('before-diagnostic-gc');
  stop = true; await sampling;
  report.observedPeak = {usedMiB: Math.max(...report.memory.map(item => item.usedMiB)), backingMiB: Math.max(...report.memory.map(item => item.backingMiB))};
  await cdp.send('HeapProfiler.collectGarbage');
  report.afterDiagnosticGC = await memory('after-diagnostic-gc');
  if (process.argv.includes('--heap')) {
    const path = `${directory}/after-travel.heapsnapshot`, stream = createWriteStream(path);
    const chunk = ({chunk}) => stream.write(chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', chunk);
    await cdp.send('HeapProfiler.takeHeapSnapshot', {reportProgress: false});
    cdp.off('HeapProfiler.addHeapSnapshotChunk', chunk);
    await new Promise((resolve, reject) => {stream.on('error', reject); stream.end(resolve);});
    report.heapSnapshot = path; console.log(`Saved heap snapshot ${path}`);
  }
  expect(report.modelSizes.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...report.modelSizes.map(item => item.decodedBytes)), 'largest decoded mobile campus model').toBeLessThan(25 * 1048576);
  expect(report.observedPeak.usedMiB, 'three-loop JS heap regression budget; not an iOS limit').toBeLessThan(128);
  expect(report.observedPeak.backingMiB, 'three-loop backing-store regression budget before diagnostic GC').toBeLessThan(256);
  check(`all ${loopCount} travel loops remain below 128MiB JS / 256MiB backing-store regression budgets before diagnostic GC; each model is below 25MiB`);
  expect(report.errors).toEqual([]); expect(report.networkFailures).toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({path: `${directory}/failure.png`}).catch(() => {});
} finally {
  stop = true; await sampling;
  await Promise.allSettled(pendingRequestSizes);
  report.resources = [...requests.values()].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const naturalSamples = report.memory.filter(value => value.stage !== 'after-diagnostic-gc');
  report.memorySummary = {peakUsedMiB: Math.max(0, ...naturalSamples.map(value => value.usedMiB)), peakBackingMiB: Math.max(0, ...naturalSamples.map(value => value.backingMiB)),
    loops: Array.from({length: loopCount}, (_, index) => {const samples = naturalSamples.filter(value => value.loop === index + 1); return {loop: index + 1, peakUsedMiB: Math.max(0, ...samples.map(value => value.usedMiB)), peakBackingMiB: Math.max(0, ...samples.map(value => value.backingMiB)), returnedToBoston: report.campuses.find(value => value.loop === index + 1 && value.campus === 'boston')?.memory};}),
    checkpoints: report.campuses.map(({campus, memory}) => ({campus, ...memory})), retries: report.retries, beforeDiagnosticGC: report.beforeDiagnosticGC, afterDiagnosticGC: report.afterDiagnosticGC,
    note: 'No explicit CDP Network.enable or forced GC during travel loops. Final explicit GC is diagnostic only, excluded from success budgets. Touch Chromium samples do not prove iPhone WebContent process stability.'};
  report.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close();
  console.log(JSON.stringify({status: report.status, checks: report.checks, memorySummary: report.memorySummary, errors: report.errors, networkFailures: report.networkFailures, error: report.error}, null, 2));
}
