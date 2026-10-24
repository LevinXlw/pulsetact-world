import {mkdir, writeFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Desktop Chromium with a touch viewport measures allocation regressions. It
// does not reproduce the iOS WebContent process limit or prove iPhone stability.
const base = process.argv.find(value => /^https?:\/\//.test(value)) ?? 'http://127.0.0.1:5186';
const assertBudget = process.argv.includes('--assert');
const collectGarbage = process.argv.includes('--gc');
const baseline = process.argv.includes('--baseline') || !assertBudget;
const local = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const directory = `output/mobile-budget/${local ? 'local' : 'production'}${baseline ? '-baseline' : ''}`;
const report = {base, baseline, assertBudget, collectGarbage, startedAt: new Date().toISOString(),
  note: 'Touch Chromium allocation measurement, not an iPhone process-crash test', samples: [], errors: [], resources: [], checks: []};
const MiB = value => Number((value / 1024 / 1024).toFixed(2));
let browser, context, page, cdp, stop = false, sampler;
let stage = 'navigation';
const network = new Map();
async function sample(label = stage) {
  try {
    const heap = await cdp.send('Runtime.getHeapUsage');
    report.samples.push({stage: label, elapsedMs: Date.now() - started,
      usedMiB: MiB(heap.usedSize), totalMiB: MiB(heap.totalSize),
      embedderMiB: MiB(heap.embedderHeapUsedSize ?? 0), backingMiB: MiB(heap.backingStorageSize ?? 0)});
  } catch (error) { if (!stop) report.errors.push({kind: 'heap-sample', message: error.message}); }
}
const started = Date.now();
await mkdir(directory, {recursive: true});
try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  await authenticateContext(context, base);
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => report.errors.push({kind: 'pageerror', message: error.message}));
  page.on('crash', () => report.errors.push({kind: 'crash', message: 'Browser page crashed'}));
  cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  cdp.on('Network.requestWillBeSent', event => {
    if (!/\/api\/auth\//.test(event.request.url)) network.set(event.requestId, {url: event.request.url, type: event.type});
  });
  cdp.on('Network.responseReceived', event => {
    const item = network.get(event.requestId);
    if (item) Object.assign(item, {status: event.response.status, mimeType: event.response.mimeType});
  });
  cdp.on('Network.loadingFinished', event => {
    const item = network.get(event.requestId);
    if (item) item.encodedDataLength = event.encodedDataLength;
  });
  sampler = (async () => { while (!stop) { await sample(); await new Promise(resolve => setTimeout(resolve, 250)); } })();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await expect(page.getByLabel('旅途中，怎么称呼你？', {exact: true})).toBeVisible();
  report.inputCapabilities = await page.evaluate(() => ({coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints, dpr: devicePixelRatio}));
  await sample('entry-visible');
  await page.getByLabel('旅途中，怎么称呼你？', {exact: true}).fill('手机内存检查');
  const button = page.getByRole('button', {name: /开始校园漫游|继续校园漫游/});
  await expect(button).toBeEnabled();
  stage = 'world-loading';
  await button.tap();
  await expect(page.getByRole('navigation', {name: '世界菜单', exact: true})).toBeVisible({timeout: 180_000});
  await expect(page.getByRole('navigation', {name: '移动方向', exact: true})).toBeVisible();
  await expect(page.locator('.pw-loading')).toHaveCount(0, {timeout: 180_000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  stage = 'ready';
  await sample('first-ready');
  await page.waitForTimeout(5000);
  await sample('ready-settled');
  report.scene = await page.evaluate(() => window.__worldScene ?? null);
  report.performance = (await cdp.send('Performance.getMetrics')).metrics.filter(metric => /JSHeapUsedSize|JSHeapTotalSize|Nodes|Documents|Frames/.test(metric.name));
  if (collectGarbage) {
    await cdp.send('HeapProfiler.collectGarbage');
    await sample('after-explicit-gc');
  }
  await page.screenshot({path: `${directory}/ready.png`});
  report.checks.push('fresh touch profile can enter and shows movement controls');
  const heavy = [...network.values()].filter(item => /\/(?:data\/killian\/detail\.glb|data\/campuses\/mit\/campus\.glb)/.test(item.url));
  report.heavyCampusDownloads = heavy.map(item => ({url: item.url, bytes: item.encodedDataLength ?? 0}));
  report.peak = Object.fromEntries(['usedMiB', 'totalMiB', 'embedderMiB', 'backingMiB'].map(key => [key, Math.max(0, ...report.samples.map(sample => sample[key]))]));
  if (assertBudget) {
    expect(heavy, 'mobile startup must not download the desktop MIT/detail models').toEqual([]);
    expect(report.peak.usedMiB, 'mobile JS heap regression budget, not an iOS process limit').toBeLessThan(128);
    expect(report.peak.backingMiB, 'mobile ArrayBuffer backing-store regression budget').toBeLessThan(96);
    expect(report.errors).toEqual([]);
    report.checks.push('no desktop MIT/detail GLBs; observed JS heap <128 MiB and ArrayBuffer backing <96 MiB');
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({path: `${directory}/failure.png`}).catch(() => {});
} finally {
  stop = true; await sampler;
  report.resources = [...network.values()].sort((a, b) => (b.encodedDataLength ?? 0) - (a.encodedDataLength ?? 0));
  report.transferredMiB = MiB(report.resources.reduce((sum, item) => sum + (item.encodedDataLength ?? 0), 0));
  report.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close();
  console.log(JSON.stringify({status: report.status, directory, peak: report.peak, transferredMiB: report.transferredMiB, checks: report.checks, errors: report.errors, error: report.error}, null, 2));
}
