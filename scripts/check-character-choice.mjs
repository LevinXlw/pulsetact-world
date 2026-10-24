import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';

// Exercise the full Vite + world API app through public controls. The DEV scene
// report is read only: it describes models that have actually been instantiated.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'output', 'character-choice');
const baseURL = (process.env.WORLD_BASE_URL || 'http://127.0.0.1:5186').replace(/\/$/, '');
const suffix = Date.now().toString(36).slice(-6);
const report = {baseURL, startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [], failedResponses: []};
const contexts = [];
let browser;

await mkdir(directory, {recursive: true});
const record = (name, details = {}) => {report.checks.push({name, ...details}); console.log(`PASS ${name}`);};
const scene = page => page.evaluate(() => window.__worldScene);
const choices = page => page.getByRole('group', {name: '选择校园形象', exact: true});
const choice = (page, id) => choices(page).getByRole('button', {name: `选择 ${id === 'pixiv' ? '白 T' : 'Sakurada'}`, exact: true});
const enterButton = page => page.getByRole('button', {name: '以 Visitor 身份进入'});

async function newPage(label, viewport = {width: 1440, height: 960}) {
  const context = await browser.newContext({viewport, deviceScaleFactor: 1});
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => report.errors.push({page: label, type: 'pageerror', message: error.message}));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({page: label, type: 'console', message: message.text().slice(0, 1500)});
  });
  page.on('response', response => {
    if (response.status() >= 400) report.failedResponses.push({page: label, status: response.status(), url: response.url()});
  });
  return page;
}

async function screenshot(page, name) {
  await page.screenshot({path: path.join(directory, name), fullPage: true});
  report.screenshots.push(name);
}

async function expectOwnCharacter(page, id, playerId) {
  await page.bringToFront();
  await page.waitForFunction(({id, playerId}) => {
    const current = window.__worldScene;
    return current?.characterReady === true && current.character === id
      && (!playerId || current.selfId === playerId)
      && current.renderedCharacters?.some(avatar => avatar.playerId === current.selfId && avatar.characterId === id);
  }, {id, playerId}, {timeout: 90_000});
  return scene(page);
}

async function expectRenderedPlayers(page, expected) {
  await page.bringToFront();
  await page.waitForFunction(expected => {
    const rendered = window.__worldScene?.renderedCharacters;
    return expected.every(({playerId, characterId}) => rendered?.some(avatar => avatar.playerId === playerId && avatar.characterId === characterId));
  }, expected, {timeout: 45_000});
  return (await scene(page)).renderedCharacters;
}

async function enter(page, name, id) {
  await expect(enterButton(page)).toBeEnabled({timeout: 90_000});
  await choice(page, id).click();
  await expect(choice(page, id)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', {name: '旅途中，怎么称呼你？', exact: true}).fill(name);
  await enterButton(page).click();
  await expect(page.locator('.pw-presence')).toHaveText(/\d+ 位漫游者在此/, {timeout: 30_000});
  const state = await expectOwnCharacter(page, id);
  expect(state.selfId).toBeTruthy();
  expect(state.selfId).not.toBe('preview');
  return state;
}

try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: [
    '--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ]});
  const a = await newPage('Sakurada visitor');
  await a.goto(`${baseURL}/characters`, {waitUntil: 'domcontentloaded'});
  await a.getByRole('button', {name: /Sakurada/}).click();
  await expect(a.getByText('实时 3D 预览', {exact: true})).toBeVisible({timeout: 90_000});
  const useCharacter = a.getByRole('link', {name: '使用这个角色', exact: true});
  const selectionHref = await useCharacter.getAttribute('href');
  expect(selectionHref).toMatch(/\?character=sakurada(?:&|$)/);
  await useCharacter.click();
  await expect(choice(a, 'sakurada')).toHaveAttribute('aria-pressed', 'true');
  await expectOwnCharacter(a, 'sakurada');
  await a.reload({waitUntil: 'domcontentloaded'});
  await expect(choice(a, 'sakurada')).toHaveAttribute('aria-pressed', 'true');
  await expectOwnCharacter(a, 'sakurada');
  record('preview link selects Sakurada and survives entry-page refresh', {selectionHref, resultingURL: a.url()});
  await screenshot(a, '01-sakurada-entry.png');

  const first = await enter(a, `少年-${suffix}`, 'sakurada');
  const firstId = first.selfId;
  record('Sakurada is the instantiated local character after entering', {selfId: firstId, avatars: first.renderedCharacters});
  await a.locator('canvas').click({position: {x: 740, y: 480}});
  const before = (await scene(a)).position;
  await a.keyboard.down('Shift');
  await a.keyboard.down('w');
  let running;
  try {
    await a.waitForFunction(playerId => window.__worldScene?.renderedCharacters?.some(avatar => avatar.playerId === playerId && avatar.characterId === 'sakurada' && avatar.motion === 'Run'), firstId, {timeout: 15_000});
    await a.waitForTimeout(650);
    running = await scene(a);
    await screenshot(a, '02-sakurada-running.png');
  } finally {
    await a.keyboard.up('w');
    await a.keyboard.up('Shift');
  }
  const movementMetres = Math.hypot(running.position[0] - before[0], running.position[2] - before[2]);
  expect(movementMetres).toBeGreaterThan(.3);
  await a.waitForFunction(playerId => window.__worldScene?.renderedCharacters?.some(avatar => avatar.playerId === playerId && avatar.motion === 'Idle'), firstId);
  record('Shift + W plays actual Sakurada Run and moves through campus', {movementMetres, avatars: running.renderedCharacters});

  await a.reload({waitUntil: 'domcontentloaded'});
  await expect(a.locator('.pw-presence')).toHaveText(/\d+ 位漫游者在此/, {timeout: 90_000});
  const restored = await expectOwnCharacter(a, 'sakurada', firstId);
  await expect(enterButton(a)).toHaveCount(0);
  record('joined visitor refresh restores identity and Sakurada', {selfId: restored.selfId, avatars: restored.renderedCharacters});

  const b = await newPage('White T visitor');
  await b.goto(baseURL, {waitUntil: 'domcontentloaded'});
  const second = await enter(b, `白T-${suffix}`, 'pixiv');
  expect(second.selfId).not.toBe(firstId);
  const pair = [{playerId: firstId, characterId: 'sakurada'}, {playerId: second.selfId, characterId: 'pixiv'}];
  const fromA = await expectRenderedPlayers(a, pair);
  const fromB = await expectRenderedPlayers(b, pair);
  record('independent visitors see both selected models in each client', {fromA, fromB});
  await screenshot(b, '03-two-different-characters.png');

  await a.bringToFront();
  await a.getByRole('button', {name: '校园身份', exact: true}).click();
  await expect(choice(a, 'sakurada')).toHaveAttribute('aria-pressed', 'true');
  await choice(a, 'pixiv').click();
  await expect(choice(a, 'pixiv')).toHaveAttribute('aria-pressed', 'true');
  await expectOwnCharacter(a, 'pixiv', firstId);
  await screenshot(a, '04-profile-change.png');
  await a.getByRole('button', {name: '关闭面板', exact: true}).click();
  const changedPair = pair.map(avatar => ({...avatar, characterId: 'pixiv'}));
  const changedRemote = await expectRenderedPlayers(b, changedPair);
  record('profile change replaces own and remote rendered models', {fromRemote: changedRemote});

  await a.reload({waitUntil: 'domcontentloaded'});
  await expectOwnCharacter(a, 'pixiv', firstId);
  await expectRenderedPlayers(b, changedPair);
  record('later profile selection survives refresh after preview-link selection');
  // Release both campus canvases before checking another device size.
  await a.context().close();
  await b.context().close();

  const old = await newPage('Legacy visitor');
  // This is the sole storage fixture: simulate a saved profile from before the
  // character field existed. No world or network state is injected.
  await old.context().addInitScript(() => {
    localStorage.setItem('pulsetact:world:profile:v1', JSON.stringify({nickname: '旧版访客', color: '#648e85'}));
  });
  await old.goto(baseURL, {waitUntil: 'domcontentloaded'});
  await expect(old.getByRole('textbox', {name: '旅途中，怎么称呼你？', exact: true})).toHaveValue('旧版访客');
  await expect(choice(old, 'pixiv')).toHaveAttribute('aria-pressed', 'true');
  const legacy = await expectOwnCharacter(old, 'pixiv');
  record('legacy saved profile without character defaults to actual White T model', {avatars: legacy.renderedCharacters});
  await old.context().close();

  const mobile = await newPage('Mobile entry', {width: 390, height: 844});
  await mobile.goto(baseURL, {waitUntil: 'domcontentloaded'});
  await expect(enterButton(mobile)).toBeEnabled({timeout: 90_000});
  await choice(mobile, 'sakurada').click();
  await expect(choice(mobile, 'sakurada')).toHaveAttribute('aria-pressed', 'true');
  await expectOwnCharacter(mobile, 'sakurada');
  const layout = await mobile.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="选择校园形象"]');
    const bounds = group?.getBoundingClientRect();
    return {width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, group: bounds && {left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom}};
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.group).toBeTruthy();
  expect(layout.group.left).toBeGreaterThanOrEqual(0);
  expect(layout.group.right).toBeLessThanOrEqual(layout.width);
  await expect(enterButton(mobile)).toBeInViewport();
  await screenshot(mobile, '05-mobile-character-selection.png');
  record('390 × 844 entry allows character choice without horizontal overflow', {layout});

  expect(report.errors).toEqual([]);
  expect(report.failedResponses).toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack || String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser?.close();
  console.log(JSON.stringify(report));
}
