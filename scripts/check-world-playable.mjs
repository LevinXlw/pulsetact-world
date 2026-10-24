import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';

// Run against the full local app (Vite plus its world API), not a static-only preview.
// Every mutation goes through a visible control. __worldScene is read only for
// movement/quality assertions; no state injection or direct API requests are used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'output', 'world-playable');
const baseURL = process.env.WORLD_BASE_URL || 'http://127.0.0.1:5186';
const runId = Date.now().toString(36).slice(-6);
const names = [`漫游A-${runId}`, `漫游B-${runId}`, `漫游C-${runId}`];
const report = {baseURL, startedAt: new Date().toISOString(), guests: names, checks: [], errors: [], expectedNetworkErrors: [], screenshots: []};
let offlineSimulation = false;
const contexts = [];
const pages = [];
let browser;

await mkdir(directory, {recursive: true});
const record = (name, details = {}) => {report.checks.push({name, ...details}); console.log(`PASS ${name}`);};
const screenshot = async (page, name) => {
  await page.screenshot({path: path.join(directory, name), fullPage: true});
  report.screenshots.push(name);
};
const scene = page => page.evaluate(() => window.__worldScene);
const closePanel = page => page.getByRole('button', {name: '关闭面板', exact: true}).click();
const dock = (page, name) => page.getByRole('navigation', {name: '世界菜单'}).getByRole('button', {name, exact: true});

async function guest(index, existingContext) {
  const context = existingContext || await browser.newContext({viewport: {width: 1440, height: 960}, deviceScaleFactor: 1});
  if (!existingContext) contexts.push(context);
  const page = await context.newPage(); pages.push(page);
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.errors.push({guest: index, type: 'pageerror', message: error.message}));
  page.on('console', message => {
    if (message.type() === 'error') {
      const entry = {guest: index, type: 'console', message: message.text().slice(0, 1500)};
      if (offlineSimulation && /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|FAILED)/.test(entry.message)) report.expectedNetworkErrors.push(entry);
      else report.errors.push(entry);
    }
  });
  await page.goto(baseURL, {waitUntil: 'domcontentloaded'});
  await expect(page.getByRole('button', {name: '以 Visitor 身份进入'})).toBeEnabled({timeout: 90_000});
  await page.getByLabel('旅途中，怎么称呼你？').fill(names[index]);
  await page.getByRole('button', {name: '以 Visitor 身份进入'}).click();
  await expect(page.locator('.pw-presence')).toHaveText(/\d+ 位漫游者在此/, {timeout: 30_000});
  await page.waitForFunction(() => Boolean(window.__worldScene), null, {timeout: 30_000});
  return page;
}

async function walkToWorkshop(page) {
  await page.bringToFront();
  const before = await scene(page);
  await page.locator('canvas').click({position: {x: 750, y: 560}});
  await page.keyboard.down('w'); await page.keyboard.down('d');
  try {await page.waitForFunction(() => window.__worldScene?.workshopDistance < 10, null, {timeout: 12_000});}
  finally {await page.keyboard.up('w'); await page.keyboard.up('d');}
  const after = await scene(page);
  expect(Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2])).toBeGreaterThan(5);
  await expect(page.getByRole('button', {name: /走进光学工坊/})).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByRole('button', {name: '加入庭院的共同实验'})).toBeVisible();
  await page.getByRole('button', {name: '加入庭院的共同实验'}).click();
  await expect(page.getByRole('dialog', {name: '光的接力', exact: true})).toBeVisible();
  return {before: before.position, after: after.position, workshopDistance: after.workshopDistance};
}

async function setMirror(page, label, target) {
  await page.bringToFront();
  const slider = page.getByRole('slider', {name: `镜面 ${label}`, exact: true});
  const current = Number(await slider.inputValue());
  if (current === target) return;
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error(`Mirror ${label} slider has no visible hit area`);
  // Click the native range track, then use its accessible precision buttons.
  await page.mouse.click(box.x + 8 + (box.width - 16) * ((target + 80) / 160), box.y + box.height / 2);
  await expect.poll(async () => Number(await slider.inputValue())).not.toBe(current);
  for (let step = 0; step < 16; step++) {
    const value = Number(await slider.inputValue());
    if (value === target) return;
    const clockwise = value < target;
    await page.getByRole('button', {name: `${clockwise ? '顺' : '逆'}时针转动镜面 ${label} 0.5 度`, exact: true}).click();
    await expect(slider).toHaveValue(String(value + (clockwise ? .5 : -.5)));
  }
  throw new Error(`Mirror ${label} did not reach ${target}° using its UI controls`);
}

async function expectChapter(page, title) {
  await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
}

try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  const a = await guest(0), b = await guest(1);
  await dock(a, '相遇').click();
  await expect(a.locator('.pw-person').filter({has: a.getByText(names[1], {exact: true})}).first()).toBeVisible();
  await closePanel(a);
  record('two independent guests enter and see real presence', {a: (await scene(a)).players, b: (await scene(b)).players});
  await screenshot(a, '01-campus-two-guests.png');

  await dock(a, '聊天').click(); await dock(b, '聊天').click();
  const greeting = `你好 ${names[1]}，一起去光学工坊？`;
  await a.getByRole('textbox', {name: '聊天消息'}).fill(greeting);
  await a.getByRole('button', {name: '发送消息', exact: true}).click();
  await expect(b.getByRole('log').getByText(greeting, {exact: true})).toBeVisible();
  const reply = `好呀，${names[0]}！`;
  await b.getByRole('textbox', {name: '聊天消息'}).fill(reply);
  await b.getByRole('button', {name: '发送消息', exact: true}).click();
  await expect(a.getByRole('log').getByText(reply, {exact: true})).toBeVisible();
  await screenshot(b, '02-chat-received.png');
  record('bidirectional public chat sent and received through UI');
  await a.getByRole('button', {name: '关闭聊天', exact: true}).click();
  await b.getByRole('button', {name: '关闭聊天', exact: true}).click();

  await dock(a, '相遇').click();
  const friendRowA = a.locator('.pw-person').filter({has: a.getByText(names[1], {exact: true})}).first();
  await friendRowA.getByRole('button', {name: '加好友', exact: true}).click();
  await expect(friendRowA.getByRole('button', {name: '已邀请', exact: true})).toBeVisible();
  await dock(b, '相遇').click();
  const incoming = b.locator('.pw-list').filter({has: b.getByRole('heading', {name: '新的朋友邀请', exact: true})});
  await incoming.locator('.pw-person').filter({has: b.getByText(names[0], {exact: true})}).getByRole('button', {name: '接受', exact: true}).click();
  await expect(friendRowA.getByText('好友', {exact: true})).toBeVisible();
  await expect(b.locator('.pw-person').filter({has: b.getByText(names[0], {exact: true})}).first().getByText('好友', {exact: true})).toBeVisible();
  await screenshot(a, '03-friends-accepted.png');
  record('friend request accepted and reflected in both guest views');
  await closePanel(a); await closePanel(b);

  const movementA = await walkToWorkshop(a), movementB = await walkToWorkshop(b);
  await expect(a.locator('.pw-lesson-banner')).toHaveText(/共同实验 · [2-4] 人在工坊/);
  await expect(b.locator('.pw-lesson-banner')).toHaveText(/共同实验 · [2-4] 人在工坊/);
  record('both guests walk with WASD and join by pressing E', {movementA, movementB});
  // A previously completed shared room is restarted using its public control.
  const restart = a.getByRole('button', {name: /为大家开启下一轮实验|再做一次实验|开始新的实验/});
  if (await restart.isVisible()) await restart.click();
  await expectChapter(a, '让光，拐一个弯'); await expectChapter(b, '让光，拐一个弯');

  await setMirror(a, 'A', -45);
  await expect(b.getByRole('slider', {name: '镜面 A', exact: true})).toHaveValue('-45');
  await expect(b.getByText('接收环亮起来了', {exact: true})).toBeVisible();
  await screenshot(b, '04-shared-first-reflection.png');
  await a.getByRole('button', {name: '继续探索', exact: true}).click();
  await expectChapter(a, '发现光的约定'); await expectChapter(b, '发现光的约定');
  record('mirror change and first stage synchronize across browsers');

  await b.getByRole('button', {name: '两角相等', exact: true}).click();
  await expect(a.getByRole('button', {name: '两角相等', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await b.getByRole('button', {name: '继续探索', exact: true}).click();
  await expectChapter(a, '一起把光送到远方'); await expectChapter(b, '一起把光送到远方');
  offlineSimulation = true;
  await contexts[1].setOffline(true);
  await expect(b.locator('.pw-lesson-banner')).toContainText('操作暂时暂停', {timeout: 40_000});
  await expect(b.getByRole('slider', {name: '镜面 A', exact: true})).toBeDisabled();
  await expect(b.getByRole('button', {name: '记录这次发现', exact: true})).toBeDisabled();
  const reconnectButton = b.getByRole('button', {name: '重新连接', exact: true});
  // Reconnection is an ordinary, keyboard-accessible action inside the dialog.
  await b.getByRole('button', {name: '离开光学工坊', exact: true}).focus();
  await b.keyboard.press('Tab');
  await expect(reconnectButton).toBeFocused();
  await contexts[1].setOffline(false);
  if (await reconnectButton.isVisible()) await reconnectButton.press('Enter');
  await expect(b.locator('.pw-lesson-banner')).toContainText('共同实验', {timeout: 30_000});
  await expect(b.getByRole('slider', {name: '镜面 A', exact: true})).toBeEnabled();
  offlineSimulation = false;
  record('disconnection disables shared controls; reconnect restores lesson membership');
  await setMirror(a, 'A', -45);
  await expect(b.getByRole('slider', {name: '镜面 A', exact: true})).toHaveValue('-45');
  await setMirror(b, 'B', -45);
  await expect(a.getByRole('slider', {name: '镜面 B', exact: true})).toHaveValue('-45');
  await expect(a.getByText('接收环亮起来了', {exact: true})).toBeVisible();
  await screenshot(a, '05-two-mirror-cooperation.png');
  await a.getByRole('button', {name: '记录这次发现', exact: true}).click();
  await expectChapter(a, '光抵达了，你也找到了规律。');
  await expectChapter(b, '光抵达了，你也找到了规律。');
  await screenshot(b, '06-shared-completion.png');
  record('both guests control separate mirrors and complete all three stages');

  await a.getByRole('button', {name: '把发现带回庭院', exact: true}).click();
  await b.getByRole('button', {name: '把发现带回庭院', exact: true}).click();
  for (const page of [a, b]) {
    await dock(page, '手册').click();
    await expect(page.getByText('光的路径 · 已完成', {exact: true})).toBeVisible();
    await closePanel(page);
  }
  record('completed learning record appears in both journals');

  // Same browser storage, new tab/identity: A's local stamp must not become C's.
  const c = await guest(2, contexts[0]);
  await dock(c, '手册').click();
  await expect(c.getByText('光的路径 · 已完成', {exact: true})).toHaveCount(0);
  await closePanel(c);
  await walkToWorkshop(c);
  await expectChapter(c, '新的发现，从你这一轮开始。');
  await expect(c.getByRole('button', {name: '把发现带回庭院', exact: true})).toHaveCount(0);
  await c.getByRole('button', {name: '离开光学工坊', exact: true}).click();
  await dock(c, '手册').click();
  await expect(c.getByText('光的路径 · 已完成', {exact: true})).toHaveCount(0);
  await closePanel(c);
  await c.getByRole('button', {name: /走进光学工坊/}).click();
  await c.getByRole('button', {name: '加入庭院的共同实验'}).click();
  await c.getByRole('button', {name: '开始新的实验', exact: true}).click();
  await expectChapter(c, '让光，拐一个弯');
  await screenshot(c, '09-late-visitor-new-experiment.png');
  record('late visitor cannot claim an earlier completion and can start a fresh experiment');
  await c.getByRole('button', {name: '离开光学工坊', exact: true}).click();
  await c.close();
  await a.reload({waitUntil:'domcontentloaded'});
  await expect(a.locator('.pw-profile')).toContainText(names[0]);
  await expect(a.locator('.pw-presence')).toHaveText(/\d+ 位漫游者在此/);
  await dock(a, '手册').click();
  await expect(a.getByText('光的路径 · 已完成', {exact: true})).toBeVisible();
  await closePanel(a);
  record('same-browser new visitor has no inherited stamp; original visitor restores name and journal');

  const photo = a.waitForEvent('download');
  await a.getByRole('button', {name: '拍照下载', exact: true}).click();
  const download = await photo;
  await download.saveAs(path.join(directory, '10-campus-photo.png'));
  expect(await download.failure()).toBeNull();
  record('photo download captures the actual 3D canvas');

  await a.getByRole('button', {name: '设置', exact: true}).click();
  await a.getByRole('button', {name: '标准', exact: true}).click();
  await expect(a.getByRole('button', {name: '省电', exact: true})).toBeVisible();
  await a.waitForFunction(() => window.__worldScene?.quality === 'low');
  await a.getByRole('button', {name: '回到入口', exact: true}).click();
  await expect.poll(async () => {
    const state = await scene(a); return Math.hypot(state.position[0] - 53.5, state.position[2] - 52.5);
  // The entrance now spreads visitors along the path to avoid overlapping bodies.
  }).toBeLessThan(5.5);
  const entrance = await scene(a);
  const entranceYaw = Math.atan2(53.5 - 12.904, 52.5 + 34.579);
  expect(Math.abs((entrance.position[0] - 53.5) * Math.sin(entranceYaw) + (entrance.position[2] - 52.5) * Math.cos(entranceYaw))).toBeLessThan(.1);
  expect(entrance.walking).toBe(false);
  await screenshot(a, '07-low-quality-home.png');
  record('low-quality setting and reset-to-entrance work through UI');

  // Reuse the same live session at a narrow viewport, preserving its real state.
  await a.setViewportSize({width: 390, height: 844});
  await expect(a.getByRole('navigation', {name: '移动方向'})).toBeVisible();
  const beforeMobile = await scene(a);
  const forward = a.getByRole('button', {name: '向前', exact: true});
  const button = await forward.boundingBox();
  if (!button) throw new Error('Mobile forward control is not visible');
  await a.mouse.move(button.x + button.width / 2, button.y + button.height / 2); await a.mouse.down();
  try {
    await a.waitForFunction(start => {
      const p = window.__worldScene?.position;
      return p && Math.hypot(p[0] - start[0], p[2] - start[2]) > 1;
    }, beforeMobile.position, {timeout: 8000});
  } finally {await a.mouse.up();}
  await screenshot(a, '08-mobile-campus.png');
  const overflow = await a.evaluate(() => ({viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth}));
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  record('mobile layout fits and directional pad moves the real avatar', {viewport: {width: 390, height: 844}, overflow});
  expect(report.errors, 'Browser page and console errors').toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  await Promise.allSettled(pages.map((page, index) => screenshot(page, `failure-guest-${index + 1}.png`)));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser?.close();
  console.log(`World playability report: ${path.join(directory, 'report.json')}`);
}
