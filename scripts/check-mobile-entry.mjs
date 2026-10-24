import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium, webkit, expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base = process.argv.find(value => /^https?:\/\//.test(value)) ?? 'http://127.0.0.1:5186';
const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const local = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const directory = `output/mobile-entry/${local ? 'local' : 'production'}${engine === 'webkit' ? '-webkit' : ''}`;
const profileKey = 'pulsetact:world:profile:v1';
const saveKey = 'pulsetact.world.solo.v1';
const scenePattern = /\/data\/mobile\/boston\.glb(?:\?|$)/;
const desktopScenePattern = /\/(?:data\/killian\/detail\.glb|data\/campuses\/mit\/campus\.glb)(?:\.gz)?(?:\?|$)/;
await mkdir(directory, {recursive: true});
const report = {base, engine, startedAt: new Date().toISOString(), checks: [], errors: [], networkFailures: [], expectedFailures: [], observations: [], screenshots: [], desktopSceneRequests: []};
let browser, activePage;
const contexts = [];
const releasePending = [];
const record = (name, details = {}) => {report.checks.push({name, ...details}); console.log(`PASS ${name}`);};
const save = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
const profile = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), profileKey);
const startButton = page => page.getByRole('button', {name: /开始校园漫游|继续校园漫游/});
const dock = page => page.getByRole('navigation', {name: '世界菜单', exact: true});
async function shot(page, name) {
  await page.screenshot({path: `${directory}/${name}.png`});
  report.screenshots.push(`${name}.png`);
}
async function createPage(seed) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  contexts.push(context);
  await authenticateContext(context, base);
  if (seed) await context.addInitScript(({profileKey, saveKey, seed}) => {
    if (!localStorage.getItem(profileKey)) localStorage.setItem(profileKey, JSON.stringify(seed.profile));
    if (!localStorage.getItem(saveKey)) localStorage.setItem(saveKey, JSON.stringify(seed.progress));
    sessionStorage.setItem('pulsetact:world:entered', 'yes');
  }, {profileKey, saveKey, seed});
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(30_000);
  page.__modelRequests = [];
  page.on('request', request => {
    if (/\.glb(?:\.gz)?(?:\?|$)/.test(request.url())) page.__modelRequests.push(request.url());
    if (desktopScenePattern.test(request.url())) report.desktopSceneRequests.push(request.url());
  });
  page.on('pageerror', error => report.errors.push({message: error.message, stack: error.stack}));
  page.on('console', message => {
    if (message.type() === 'error' && /WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost/i.test(message.text())) report.errors.push({message: message.text()});
  });
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).pathname !== '/api/auth/session') report.networkFailures.push({url: response.url(), status: response.status()});
  });
  page.on('requestfailed', request => {
    const failure = {url: request.url(), error: request.failure()?.errorText ?? 'Unknown'};
    if (/ERR_ABORTED|cancelled|canceled|Load request cancelled/i.test(failure.error)) return;
    if (scenePattern.test(request.url()) && page.__expectedSceneFailure) report.expectedFailures.push(failure);
    else report.networkFailures.push(failure);
  });
  return {context, page};
}
async function ready(page) {
  await expect(dock(page)).toBeVisible({timeout: 180_000});
  await expect(page.getByRole('button', {name: '拍照下载', exact: true})).toBeEnabled();
  await expect(page.getByRole('navigation', {name: '移动方向', exact: true})).toBeVisible();
  await expect(page.locator('.pw-loading')).toHaveCount(0);
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
}

try {
  browser = engine === 'webkit'
    ? await webkit.launch({headless: true})
    : await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});

  // Mobile must not create WebGL or fetch models while the name form is open.
  // Hold the small baked scene after submission to exercise delayed loading.
  const {context, page} = await createPage();
  let releaseScene;
  const sceneGate = new Promise(resolve => {releaseScene = resolve;});
  releasePending.push(releaseScene);
  let heldRequests = 0;
  await context.route(scenePattern, async route => {
    heldRequests++;
    await sceneGate;
    await route.continue().catch(() => {});
  });
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  const input = page.getByLabel('旅途中，怎么称呼你？', {exact: true});
  await expect(input).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(heldRequests).toBe(0);
  expect(page.__modelRequests).toEqual([]);
  report.observations.push({name: 'name form before model allocation', canvasCount: 0, modelRequests: []});
  await input.fill('手机漫游者');
  await expect(startButton(page)).toBeEnabled({timeout: 3000});
  await expect(page.locator('.solo-entry-loading[role="status"]')).toBeVisible();
  await expect.poll(async () => (await save(page))?.quality).toBe('low');
  await shot(page, '01-named-before-campus-ready');
  record('fresh touch name form allocates no canvas or models, accepts a Chinese nickname and defaults to low quality');

  // A reduced visual viewport approximates the space left by a phone keyboard.
  // It does not claim to emulate Safari's native keyboard itself.
  await page.setViewportSize({width: 390, height: 480});
  await input.focus();
  await startButton(page).scrollIntoViewIfNeeded();
  await expect(startButton(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await shot(page, '02-reduced-height-form');
  expect(page.__modelRequests).toEqual([]);
  await startButton(page).tap();
  await expect.poll(() => heldRequests, {timeout: 30_000}).toBeGreaterThan(0);
  await expect(page.locator('.pw-intro')).toHaveCount(0);
  await expect(page.locator('.pw-loading[role="status"]')).toBeVisible();
  await expect(dock(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: '移动方向', exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('pulsetact:world:entered'))).toBe('yes');
  expect((await profile(page)).nickname).toBe('手机漫游者');
  record('reduced-height touch form submits and shows loading instead of premature gameplay controls');
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator('.pw-loading').getByRole('button', {name: '以省电模式重试', exact: true})).toBeVisible({timeout: 25_000});
  await shot(page, '03-slow-campus-loading');
  record('a delayed campus exposes a visible low-quality retry action');
  releaseScene();
  await ready(page);
  await shot(page, '04-entered-after-download');
  expect((await profile(page)).nickname).toBe('手机漫游者');
  record('finishing the delayed download enters the world with the submitted nickname');
  await context.close();

  const seeded = {
    profile: {nickname: '保留我的旅程', color: '#778a64', characterId: 'pixiv'},
    progress: {version: 1, campus: 'boston', campusPositions: {}, visited: ['axis'], visitedPlaces: ['bu-questrom'], campusVisits: ['umd-library'], photos: 2, quality: 'standard', trackedId: 'dome', photoSpots: [], lesson: {stage: 1, mirrorA: -45, mirrorB: 0, prediction: null}},
  };
  const recovery = await createPage(seeded);
  let failScene = true, failedRequests = 0;
  recovery.page.__expectedSceneFailure = true;
  await recovery.context.route(scenePattern, route => {
    if (failScene) {failedRequests++; return route.abort('failed');}
    return route.continue();
  });
  await recovery.page.goto(base, {waitUntil: 'domcontentloaded'});
  await expect(recovery.page.getByLabel('旅途中，怎么称呼你？', {exact: true})).toHaveValue(seeded.profile.nickname);
  await expect(recovery.page.locator('canvas')).toHaveCount(0);
  expect(recovery.page.__modelRequests).toEqual([]);
  expect(failedRequests).toBe(0);
  await expect.poll(async () => (await save(recovery.page))?.quality).toBe('low');
  record('a returning phone ignores entered-session auto-resume, preserves the name and lowers saved standard quality before allocation');
  await startButton(recovery.page).tap();
  const error = recovery.page.locator('.pw-scene-error[role="alert"]');
  await expect(error).toBeVisible({timeout: 60_000});
  expect(failedRequests).toBeGreaterThan(0);
  await expect(error.getByRole('button', {name: '以省电模式重试', exact: true})).toBeVisible();
  await expect(dock(recovery.page)).toHaveCount(0);
  expect((await save(recovery.page)).quality).toBe('low');
  await shot(recovery.page, '05-download-failure');
  record('a failed mobile scene download shows an actionable error without loading the full desktop scene');
  failScene = false;
  await error.getByRole('button', {name: '以省电模式重试', exact: true}).tap();
  await ready(recovery.page);
  const restored = await save(recovery.page);
  expect((await profile(recovery.page)).nickname).toBe(seeded.profile.nickname);
  expect(restored.visited).toEqual(seeded.progress.visited);
  expect(restored.visitedPlaces).toEqual(seeded.progress.visitedPlaces);
  expect(restored.campusVisits).toEqual(seeded.progress.campusVisits);
  expect(restored.photos).toBe(seeded.progress.photos);
  expect(restored.lesson.stage).toBe(1);
  expect(restored.quality).toBe('low');
  await shot(recovery.page, '06-recovered-with-progress');
  record('low-quality retry recovers the scene without losing nickname, visits, photos or lesson progress');

  await recovery.page.getByRole('button', {name: '校园身份', exact: true}).tap();
  const profilePanel = recovery.page.getByRole('dialog', {name: '这次旅程中的你', exact: true});
  await expect(profilePanel).toBeVisible();
  await profilePanel.getByRole('button', {name: '选择 Sakurada', exact: true}).tap();
  await profilePanel.getByRole('button', {name: '关闭面板', exact: true}).tap();
  await ready(recovery.page);
  await expect.poll(async () => (await profile(recovery.page)).characterId).toBe('sakurada');
  if (local) await recovery.page.waitForFunction(() => window.__worldScene?.character === 'sakurada' && window.__worldScene.characterReady);
  await shot(recovery.page, '07-sakurada-ready');
  record('switching to Sakurada loads the selected avatar and restores playable controls');

  const downloadPromise = recovery.page.waitForEvent('download');
  await recovery.page.getByRole('button', {name: '拍照下载', exact: true}).tap();
  const download = await downloadPromise;
  const photoPath = `${directory}/08-mobile-camera.png`;
  await download.saveAs(photoPath);
  const photoBytes = await readFile(photoPath);
  expect([...photoBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(photoBytes.byteLength).toBeGreaterThan(20_000);
  const photoPixels = await recovery.page.evaluate(async dataUrl => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const colors = new Set(); let opaque = 0, sum = 0, squareSum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      colors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
      if (pixels[index + 3] > 240) opaque++;
      const light = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      sum += light; squareSum += light * light;
    }
    const count = pixels.length / 4, mean = sum / count;
    return {width: image.naturalWidth, height: image.naturalHeight, distinctColors: colors.size,
      opaqueFraction: opaque / count, standardDeviation: Math.sqrt(squareSum / count - mean * mean)};
  }, `data:image/png;base64,${photoBytes.toString('base64')}`);
  expect(photoPixels.width).toBeGreaterThanOrEqual(300);
  expect(photoPixels.height).toBeGreaterThanOrEqual(500);
  expect(photoPixels.distinctColors).toBeGreaterThan(20);
  expect(photoPixels.opaqueFraction).toBeGreaterThan(.95);
  expect(photoPixels.standardDeviation).toBeGreaterThan(8);
  await expect.poll(async () => (await save(recovery.page)).photos).toBe(seeded.progress.photos + 1);
  record('mobile camera exports a populated PNG with varied opaque pixels after immediate rendering', {bytes: photoBytes.byteLength, ...photoPixels});

  // Dispatch the browser event without deliberately exhausting or losing the
  // GPU context. This verifies the app's recovery path, not physical GPU failure.
  const contextLoss = await recovery.page.locator('.pw-scene canvas').evaluate(canvas => {
    const event = new Event('webglcontextlost', {cancelable: true});
    canvas.dispatchEvent(event);
    return {kind: 'synthetic webglcontextlost event', defaultPrevented: event.defaultPrevented};
  });
  report.observations.push(contextLoss);
  expect(contextLoss.defaultPrevented).toBe(true);
  await expect(error).toBeVisible();
  await expect(error).toContainText('画面渲染已中断');
  await expect(dock(recovery.page)).toHaveCount(0);
  await shot(recovery.page, '09-context-loss-alert');
  await error.getByRole('button', {name: '以省电模式重试', exact: true}).tap();
  await ready(recovery.page);
  const afterContextLoss = await save(recovery.page);
  expect((await profile(recovery.page)).nickname).toBe(seeded.profile.nickname);
  expect((await profile(recovery.page)).characterId).toBe('sakurada');
  expect(afterContextLoss.visited).toEqual(seeded.progress.visited);
  expect(afterContextLoss.visitedPlaces).toEqual(seeded.progress.visitedPlaces);
  expect(afterContextLoss.campusVisits).toEqual(seeded.progress.campusVisits);
  expect(afterContextLoss.photos).toBe(seeded.progress.photos + 1);
  expect(afterContextLoss.lesson.stage).toBe(1);
  if (local) await recovery.page.waitForFunction(() => window.__worldScene?.character === 'sakurada' && window.__worldScene.characterReady);
  await shot(recovery.page, '10-context-loss-recovered');
  record('synthetic WebGL context-loss event exposes retry and restores selected character and saved progress', {simulation: 'DOM event; no physical GPU loss induced'});
  expect(report.errors).toEqual([]);
  expect(report.networkFailures).toEqual([]);
  expect(report.desktopSceneRequests).toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack ?? String(error);
  console.error(error);
  process.exitCode = 1;
  if (activePage && !activePage.isClosed()) await shot(activePage, 'failure').catch(() => {});
} finally {
  releasePending.forEach(release => release());
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/browser-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, checks: report.checks, errors: report.errors, networkFailures: report.networkFailures, expectedFailures: report.expectedFailures, error: report.error}));
}
