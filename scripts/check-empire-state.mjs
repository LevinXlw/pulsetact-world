import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = 'assets-source/nyc-local/empire/review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.goto('http://127.0.0.1:5173/docs/empire-state-study.html');
  await page.waitForFunction(() => window.__empireStudy?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const initial = await page.evaluate(() => window.__empireStudy);
  assert.ok(Math.abs(initial.stats.height - 443.2) < .02, `tip height ${initial.stats.height}`);
  assert.ok(initial.stats.facadeCells > 3000);
  const facadeChecks = await page.evaluate(() => {
    const hits = [];
    for (const y of [12, 36, 60, 80, 180, 280, 296, 312]) for (const [origin, direction] of [[[10, y, 100], [0, 0, -1]], [[10, y, -100], [0, 0, 1]], [[200, y, 0], [-1, 0, 0]], [[-200, y, 0], [1, 0, 0]]]) {
      hits.push({ y, origin, hit: window.__empireInspect(origin, direction)[0] });
    }
    return hits;
  });
  assert.ok(facadeChecks.every(check => check.hit), 'All four sides of every setback tier must exist');
  for (const view of ['overview', 'crown', 'facade', 'street']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${output}/${view}.png` });
    assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('[data-view="overview"]').click();
  await page.locator('[data-light="golden"]').click();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__empireStudy.time), 'golden');
  await page.screenshot({ path: `${output}/golden.png` });
  await page.locator('[data-light="night"]').click();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__empireStudy.night), true);
  await page.screenshot({ path: `${output}/night.png` });
  await page.locator('[data-light="day"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  await download.saveAs('assets-source/nyc-local/empire/empire-state-demo.glb');
  const binary = await readFile('assets-source/nyc-local/empire/empire-state-demo.glb');
  assert.equal(binary.readUInt32LE(0), 0x46546c67);
  assert.equal(binary.readUInt32LE(8), binary.length);
  const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
  assert.ok(gltf.extensionsUsed.includes('EXT_mesh_gpu_instancing'));
  assert.ok(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    assert.ok(!('_INSTANCEGLOW' in primitive.attributes));
    for (const accessor of Object.values(primitive.attributes)) {
      assert.equal(gltf.accessors[accessor].count, gltf.accessors[primitive.attributes.POSITION].count, 'Exported vertex attribute counts must match');
    }
  }
  const reimport = await page.evaluate(async () => {
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { Box3 } = await import('/node_modules/three/build/three.module.js');
    const loaded = await new GLTFLoader().loadAsync('/assets-source/nyc-local/empire/empire-state-demo.glb');
    const bounds = new Box3().setFromObject(loaded.scene);
    let instances = 0;
    loaded.scene.traverse(object => { if (object.isInstancedMesh) instances += object.count; });
    return { height: bounds.max.y, instances };
  });
  assert.ok(Math.abs(reimport.height - initial.stats.height) < .02);
  assert.equal(reimport.instances, initial.stats.instancedPrimitives);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(url => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:5173/')).length, 0);
  const report = { passed: true, initial, facadeChecks, export: { bytes: binary.length, embeddedImages: gltf.images.length, reimport }, errors, externalRequests: 0, mobileOverflow: false };
  await writeFile(`${output}/browser-check.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, initial, facadeChecks: facadeChecks.length, export: report.export, errors }, null, 2));
} finally { await browser.close(); }
