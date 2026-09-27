import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = 'assets-source/nyc-local/review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.goto('http://127.0.0.1:5173/docs/nyc-asset-study.html');
  await page.waitForFunction(() => window.__nycStudy?.ready, null, { timeout: 60000 });
  const views = [];
  for (const view of ['facade', 'entrance', 'window']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.waitForTimeout(600);
    assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${output}/${view}.png` });
    views.push(await page.evaluate(() => window.__nycStudy));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-view="facade"]').click();
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(url => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:5173/')).length, 0);
  const report = { passed: true, views, errors, externalRequests: 0, mobileOverflow: false };
  await writeFile(`${output}/browser-check.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
