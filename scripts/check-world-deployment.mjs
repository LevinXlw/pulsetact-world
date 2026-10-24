import {mkdir, writeFile} from 'node:fs/promises';
import {setDefaultResultOrder} from 'node:dns';
import {chromium, expect} from '@playwright/test';
import {FIXED_ACCOUNT} from '../server/auth-credentials.mjs';

// This workstation has no working IPv6 egress; keep API checks on its working IPv4 route.
setDefaultResultOrder('ipv4first');

const base = new URL(process.env.WORLD_VERIFY_URL || process.argv[2] || 'https://world.pulsetact.ai');
if (base.username || base.password) throw new Error('Use WORLD_VERIFY_URL without embedded credentials.');
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
const directory = `output/deployment/${local ? 'local' : 'production'}`;
const url = path => new URL(path, base).href;
const redact = value => String(value).replaceAll(FIXED_ACCOUNT.password, '[redacted]');
const report = {base: base.origin, startedAt: new Date().toISOString(), checks: [], errors: [], networkFailures: [], assets: {}, views: []};
await mkdir(directory, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
const context = await browser.newContext({viewport: {width: 1440, height: 960}, ignoreHTTPSErrors: local});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(redact(error.message)));
page.on('response', response => {
  const path = new URL(response.url()).pathname;
  const status = response.status();
  if (path.startsWith('/data/') || path.startsWith('/assets/')) {
    report.assets[path] ??= [];
    if (!report.assets[path].includes(status)) report.assets[path].push(status);
  }
  const expectedUnauthorized = status === 401 && ['/api/auth/session', '/api/auth/login'].includes(path);
  if (status >= 400 && !expectedUnauthorized) report.networkFailures.push({path, status});
});
page.on('requestfailed', request => {
  const error = request.failure()?.errorText || 'Unknown request failure';
  // Campus remounts and navigation intentionally cancel in-flight fetches.
  if (!error.includes('ERR_ABORTED')) report.networkFailures.push({path: new URL(request.url()).pathname, error: redact(error)});
});
const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const loginButton = () => page.getByRole('button', {name: '登录', exact: true});
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('pulsetact.world.solo.v1') || 'null'));
const menu = name => page.getByRole('navigation', {name: '世界菜单'}).getByRole('button', {name, exact: true});

async function login() {
  await page.getByLabel('账号', {exact: true}).fill(FIXED_ACCOUNT.username);
  await page.getByLabel('密码', {exact: true}).fill(FIXED_ACCOUNT.password);
  await loginButton().click();
  await expect(loginButton()).toHaveCount(0);
}

async function ready(campus) {
  const label = {boston: 'MIT', umd: 'UNIVERSITY OF MARYLAND', upenn: 'UNIVERSITY OF PENNSYLVANIA'}[campus];
  await expect(page.locator('.pw-location')).toContainText(label, {timeout: 120000});
  await expect(page.locator('.pw-scene canvas')).toBeVisible({timeout: 120000});
  await expect(page.locator('.pw-loading')).toHaveCount(0, {timeout: 120000});
  await expect(page.getByRole('button', {name: '拍照下载', exact: true})).toBeEnabled({timeout: 120000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await expect.poll(async () => (await save())?.campus, {timeout: 15000}).toBe(campus);
}

async function capture(name) {
  await page.waitForTimeout(600);
  const canvas = page.locator('.pw-scene canvas');
  const pixels = await canvas.evaluate(async source => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sample = document.createElement('canvas'); sample.width = 64; sample.height = 48;
    const drawing = sample.getContext('2d'); drawing.drawImage(source, 0, 0, 64, 48);
    const data = drawing.getImageData(0, 0, 64, 48).data;
    const colors = new Set(); let opaque = 0, darkest = 255, lightest = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 240) opaque++;
      colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
      darkest = Math.min(darkest, light); lightest = Math.max(lightest, light);
    }
    return {width: source.width, height: source.height, opaqueRatio: opaque / (64 * 48), colors: colors.size, range: lightest - darkest};
  });
  expect(pixels.width, 'Rendered canvas has width').toBeGreaterThan(300);
  expect(pixels.height, 'Rendered canvas has height').toBeGreaterThan(300);
  expect(pixels.opaqueRatio, 'Canvas is not transparent').toBeGreaterThan(.9);
  expect(pixels.colors, 'Canvas contains a rendered scene, not a solid background').toBeGreaterThan(12);
  expect(pixels.range, 'Canvas contains visible geometry and lighting').toBeGreaterThan(30);
  await page.screenshot({path: `${directory}/${name}.png`});
  await canvas.screenshot({path: `${directory}/${name}-scene.png`});
  report.views.push({name, ...pixels});
}

async function changeCampus(campus, label) {
  await menu('地图').click();
  await page.getByRole('button', {name: '校园旅行', exact: true}).click();
  await page.getByRole('button', {name: `前往 ${label}`, exact: true}).click();
  await ready(campus);
}

async function assertSession() {
  const response = await context.request.get(url('/api/auth/session'));
  expect(response.status()).toBe(200);
  expect((await response.json()).user.username).toBe(FIXED_ACCOUNT.username);
  const cookie = (await context.cookies()).find(item => item.name === 'pulsetact_session');
  expect(Boolean(cookie), 'Session cookie exists').toBe(true);
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Lax');
  if (base.protocol === 'https:') expect(cookie.secure).toBe(true);
  expect(await page.evaluate(() => document.cookie.includes('pulsetact_session'))).toBe(false);
  expect(await page.evaluate(secret => JSON.stringify(localStorage).includes(secret), FIXED_ACCOUNT.password)).toBe(false);
  return cookie;
}

async function logout() {
  const before = await save();
  const cookie = await assertSession();
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: '退出登录', exact: true}).click();
  await expect(loginButton()).toBeVisible();
  expect((await context.request.get(url('/api/auth/session'))).status()).toBe(401);
  expect((await context.request.get(url('/api/auth/session'), {headers: {Cookie: `${cookie.name}=${cookie.value}`}})).status()).toBe(401);
  expect((await context.cookies()).some(item => item.name === 'pulsetact_session')).toBe(false);
  expect((await save()).campus).toBe(before.campus);
  expect((await save()).campusVisits).toEqual(before.campusVisits);
}

try {
  expect((await context.request.get(url('/api/auth/session'))).status()).toBe(401);
  expect((await context.request.get(url('/data/campuses/mit/campus.glb'))).status()).toBe(401);
  for (const path of ['/server/auth-credentials.mjs', '/server/auth-credentials.mjs?raw', '/server/auth-service.mjs']) {
    const response = await context.request.get(url(path));
    expect(response.status(), `Backend file blocked: ${path}`).toBe(404);
    expect((await response.text()).includes(FIXED_ACCOUNT.password)).toBe(false);
  }
  await page.goto(url('/'), {waitUntil: 'domcontentloaded'});
  await expect(loginButton()).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.screenshot({path: `${directory}/01-login-desktop.png`, fullPage: true});
  check('unauthenticated session and campus assets are protected; backend source is unavailable');

  await page.getByLabel('密码', {exact: true}).fill('deployment-invalid-password');
  await loginButton().click();
  await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
  check('wrong credentials show a recoverable login error');

  await login();
  const enter = page.getByRole('button', {name: /开始校园漫游|继续校园漫游/});
  await expect(enter).toBeEnabled({timeout: 120000});
  await assertSession();
  await page.getByLabel('旅途中，怎么称呼你？', {exact: true}).fill('Tony');
  await enter.click();
  await ready('boston');
  await capture('02-boston');
  for (const path of ['/data/campuses/mit/campus.glb', '/data/killian/detail.glb.gz', '/data/killian/detail-manifest.json', '/assets/characters/pixiv/character.glb', '/assets/environment/mit-painted-sky-v1.png']) {
    await expect.poll(() => report.assets[path] || [], {timeout: 20000, message: `Runtime asset delivered: ${path}`}).toContain(200);
  }
  const raw = await context.request.head(url('/data/killian/detail.glb'));
  expect(raw.status()).toBe(200);
  expect(raw.headers()['content-encoding']).toBe('gzip');
  check('login establishes protected session; Boston, white-T character and compressed scene assets render');

  await page.getByRole('button', {name: '校园身份', exact: true}).click();
  const characterResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/assets/characters/sakurada/sakurada.glb', {timeout: 60000});
  await page.getByRole('button', {name: '选择 Sakurada', exact: true}).click();
  const loaded = await characterResponse;
  expect(loaded.status()).toBe(200); await loaded.finished();
  await page.getByRole('button', {name: '关闭面板', exact: true}).click();
  await capture('03-sakurada');
  check('alternate Sakurada character model is delivered and selectable');

  await changeCampus('umd', 'UMD');
  await capture('04-maryland');
  await page.keyboard.press('e');
  await page.getByRole('button', {name: '记录这次到访', exact: true}).click();
  await expect.poll(async () => (await save()).campusVisits).toContain('umd-library');
  await changeCampus('upenn', 'UPenn');
  await capture('05-penn');
  await page.keyboard.press('e');
  await page.getByRole('button', {name: '记录这次到访', exact: true}).click();
  await expect.poll(async () => (await save()).campusVisits).toContain('penn-green');
  check('campus travel loads Maryland and Penn scenes and records their arrival stamps');

  const savedBeforeReload = await save();
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready('upenn');
  await assertSession();
  expect((await save()).campusVisits).toEqual(savedBeforeReload.campusVisits);
  expect((await save()).campusPositions.umd).toEqual(savedBeforeReload.campusPositions.umd);
  check('refresh preserves authenticated session, Penn campus and Maryland/Penn visit records');

  await logout();
  check('logout revokes the session even when the old cookie is replayed, and preserves exploration');
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await page.screenshot({path: `${directory}/06-login-mobile.png`, fullPage: true});
  await login();
  await ready('upenn');
  await menu('地图').click();
  await page.getByRole('button', {name: '校园旅行', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await expect(page.getByRole('button', {name: '关闭面板', exact: true})).toBeInViewport();
  await expect(page.getByRole('button', {name: '前往 UMD', exact: true})).toBeVisible();
  await page.screenshot({path: `${directory}/07-mobile-campus-travel.png`});
  await page.getByRole('button', {name: '关闭面板', exact: true}).click();
  await capture('08-mobile-penn');
  await logout();
  check('mobile login, restored Penn scene and campus travel fit the viewport; final logout succeeds');
  expect(report.errors).toEqual([]);
  expect(report.networkFailures).toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = redact(error.message);
  console.error(report.failure); process.exitCode = 1;
  await page.screenshot({path: `${directory}/failure.png`, fullPage: true}).catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, checks: report.checks.length, errors: report.errors, networkFailures: report.networkFailures, report: `${directory}/report.json`}));
  await browser.close();
}
