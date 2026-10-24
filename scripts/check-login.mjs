import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { FIXED_ACCOUNT } from '../server/auth-credentials.mjs';

const base = 'http://127.0.0.1:5186';
const directory = 'output/login';
await mkdir(directory, { recursive: true });
const report = { checks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => report.errors.push(error.message));
const loginButton = target => target.getByRole('button', { name: '登录', exact: true });
const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
async function login(target) {
  await target.getByLabel('账号', { exact: true }).fill(FIXED_ACCOUNT.username);
  await target.getByLabel('密码', { exact: true }).fill(FIXED_ACCOUNT.password);
  await loginButton(target).click();
  await expect(loginButton(target)).toHaveCount(0);
}

try {
  // Preserve a realistic existing single-player save through login and logout.
  await context.addInitScript(() => {
    if (localStorage.getItem('pulsetact.world.solo.v1')) return;
    localStorage.setItem('pulsetact.world.solo.v1', JSON.stringify({ version: 1, campus: 'umd', visited: ['axis'], campusVisits: ['umd-library'], photos: 3, quality: 'low', position: [-108, 14], trackedId: 'umd-library' }));
  });
  await page.goto(`${base}/characters`, { waitUntil: 'domcontentloaded' });
  await expect(loginButton(page)).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  expect((await context.request.get(`${base}/api/world/health`)).status()).toBe(401);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await expect(loginButton(page)).toBeVisible();
  await page.screenshot({ path: `${directory}/01-login-desktop.png`, fullPage: true });
  check('direct routes and world APIs require login; no game mounts before authentication');

  await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
  await loginButton(page).click();
  await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
  await expect(page.getByLabel('密码', { exact: true })).toBeEnabled();
  check('wrong password shows a recoverable error');

  await login(page);
  const enter = page.getByRole('button', { name: /开始校园漫游|继续校园漫游/ });
  await expect(enter).toBeEnabled({ timeout: 90000 });
  const session = await context.request.get(`${base}/api/auth/session`);
  expect((await session.json()).user.username).toBe('tony');
  const cookie = (await context.cookies()).find(item => item.name === 'pulsetact_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('pulsetact_session');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(FIXED_ACCOUNT.password);
  check('real form login establishes HttpOnly session without storing password in browser storage');

  await page.getByLabel('旅途中，怎么称呼你？', { exact: true }).fill('Tony');
  await enter.click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.waitForFunction(() => window.__worldScene?.campusId === 'umd' && window.__worldScene.characterReady, null, { timeout: 90000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__worldScene?.campusId === 'umd' && window.__worldScene.characterReady, null, { timeout: 90000 });
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
  expect(saved.visited).toEqual(['axis']);
  expect(saved.campusVisits).toEqual(['umd-library']);
  expect(saved.photos).toBe(3);
  check('refresh restores login, active campus and existing exploration progress');

  const other = await context.newPage();
  await other.goto(`${base}/journal`, { waitUntil: 'domcontentloaded' });
  await expect(other.getByRole('heading', { name: '我的探索手册' })).toBeVisible();
  await page.bringToFront();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(loginButton(page)).toBeVisible();
  await expect(loginButton(other)).toBeVisible();
  expect((await context.request.get(`${base}/api/auth/session`)).status()).toBe(401);
  expect((await context.request.get(`${base}/api/world/health`)).status()).toBe(401);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')))).visited).toEqual(['axis']);
  await other.close();
  check('logout revokes backend session, updates other tabs and preserves local save');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(loginButton(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${directory}/02-login-mobile.png`, fullPage: true });
  await login(page);
  await page.waitForFunction(() => window.__worldScene?.campusId === 'umd' && window.__worldScene.characterReady, null, { timeout: 90000 });
  check('mobile login fits viewport and supports signing back in');

  for (const path of ['/server/auth-credentials.mjs', '/server/auth-credentials.mjs?raw', `/@fs/${resolve('server/auth-credentials.mjs').replaceAll('\\', '/')}`, '/server/auth-service.mjs']) {
    const response = await context.request.get(`${base}${path}`);
    expect([403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain(FIXED_ACCOUNT.password);
  }
  const files = await readdir('dist', { recursive: true });
  for (const file of files.filter(file => /\.(?:js|mjs|html|map)$/.test(file))) {
    expect(await readFile(resolve('dist', file), 'utf8'), `No credentials in ${file}`).not.toContain(FIXED_ACCOUNT.password);
  }
  check('backend password is blocked from development HTTP access and absent from client build');
  expect(report.errors).toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.message;
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
