import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CityTextureDetail } from './manhattan-texture-detail';
import { createAtmosphere, type TimeOfDay } from './empire-atmosphere';
import { buildCityBatches, CityAssetStore, readCityIndex, tilesForRange, type CityIndex, type Progress } from './manhattan-stream';

const host = document.querySelector<HTMLDivElement>('#stage')!, status = document.querySelector('#status-text')!;
const errorText = document.querySelector('#error')!, retry = document.querySelector<HTMLButtonElement>('#retry')!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
renderer.toneMapping = T.AgXToneMapping; host.appendChild(renderer.domElement);
const scene = new T.Scene(), camera = new T.PerspectiveCamera(40, host.clientWidth / host.clientHeight, .5, 6500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 8; controls.maxDistance = 2300; controls.maxPolarAngle = Math.PI * .495;
const atmosphere = createAtmosphere(renderer, scene);
const ground = new T.Mesh(new T.PlaneGeometry(18000,18000), new T.MeshStandardMaterial({color:'#8f9c92',roughness:1}));
ground.rotation.x = -Math.PI/2; ground.position.y = -1.1; ground.receiveShadow = true; scene.add(ground);
scene.traverse(object => {
  if (object instanceof T.DirectionalLight) {
    Object.assign(object.shadow.camera, { left:-370, right:370, top:390, bottom:-390 });
    object.shadow.mapSize.set(2048,2048); object.shadow.camera.updateProjectionMatrix();
  }
});
let index: CityIndex, store: CityAssetStore, batches: ReturnType<typeof buildCityBatches> | undefined;
let range = 5, view = 'district', time: TimeOfDay = 'day', generation = 0, selectedTile = 'l27';
let desired: string[] = [], visible: string[] = [], loading = true;
let highQuality = true, lastTextureUpdate = -2000;
let composer: EffectComposer | undefined, ao: GTAOPass | undefined;
const textureDetail = new CityTextureDetail(Math.min(8,renderer.capabilities.getMaxAnisotropy()), (message,count,stats) => {
  const output=document.querySelector<HTMLElement>('#quality-status')!;
  output.textContent=message; output.dataset.activeTextures=String(count);
  output.dataset.gpuBytes=String(stats?.bytes??0); output.dataset.maxDimension=String(stats?.maxDimension??0);
});
const textureFrustum=new T.Frustum(), textureProjection=new T.Matrix4();
textureDetail.init().catch(() => { document.querySelector('#quality-status')!.textContent='高清资源暂不可用，使用标准贴图'; });
const tileStates = new Map<string, Progress>();

function setQuality(detail: boolean) {
  highQuality=detail; textureDetail.setEnabled(detail); lastTextureUpdate=-2000;
  document.querySelectorAll<HTMLButtonElement>('button[data-quality]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.quality==='detail')===detail)));
  renderer.shadowMap.needsUpdate=true;
}

function renderDetail() {
  if (!composer) {
    const target=new T.WebGLRenderTarget(host.clientWidth,host.clientHeight,{type:T.HalfFloatType,samples:2});
    composer=new EffectComposer(renderer,target); composer.addPass(new RenderPass(scene,camera));
    ao=new GTAOPass(scene,camera,host.clientWidth,host.clientHeight);
    ao.updateGtaoMaterial({radius:1.1,thickness:1.2,distanceExponent:2,samples:8,screenSpaceRadius:false});
    ao.updatePdMaterial({radius:3,samples:8}); ao.blendIntensity=.3;
    composer.addPass(ao); composer.addPass(new OutputPass());
  }
  composer.render();
}

function updateShadow(near: boolean) {
  const radius=near ? 115 : 370, size=near ? 4096 : 2048;
  const target=near ? controls.target.clone() : new T.Vector3(0,160,0);
  target.x=Math.round(target.x/8)*8; target.y=Math.round(target.y/8)*8; target.z=Math.round(target.z/8)*8;
  scene.traverse(object => {
    if (!(object instanceof T.DirectionalLight)) return;
    const changed=object.target.position.distanceToSquared(target)>1 || object.shadow.camera.right!==radius;
    if (!changed) return;
    object.position.add(target.clone().sub(object.target.position)); object.target.position.copy(target);
    Object.assign(object.shadow.camera,{left:-radius,right:radius,top:radius*1.1,bottom:-radius*1.1});
    object.shadow.camera.updateProjectionMatrix();
    if (object.shadow.mapSize.x!==size) { object.shadow.map?.dispose(); object.shadow.map=null; object.shadow.mapSize.set(size,size); }
    renderer.shadowMap.needsUpdate=true;
  });
}

function setTime(next: TimeOfDay) {
  time = next; atmosphere.setTime(time); renderer.toneMappingExposure = time === 'day' ? 1.35 : 1.25;
  scene.traverse(object => { if (object instanceof T.HemisphereLight) object.intensity = time === 'day' ? 1.7 : 1.3; });
  (scene.fog as T.FogExp2).density = .00018; renderer.shadowMap.needsUpdate = true;
  document.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.light === time)));
}
function setView(next: string, tileId = selectedTile) {
  view = next; selectedTile = tileId;
  controls.maxPolarAngle = view === 'street' ? Math.PI * .8 : Math.PI * .495;
  const tile = index?.tiles.find(t => t.id === tileId);
  const focus = tile && tileId !== 'l27' ? new T.Vector3(tile.center[0]-index.origin[0],35,tile.center[2]-index.origin[2]) : new T.Vector3(0,155,0);
  camera.fov = view === 'street' ? 65 : view === 'landmark' ? 33 : 40;
  if (view === 'landmark') { selectedTile = 'l27'; controls.target.set(0,215,0); camera.position.set(550,360,840); }
  else if (view === 'aerial') { controls.target.set(-52,100,32); camera.position.set(-10,900,360); }
  else if (view === 'street') {
    const x = tile ? tile.center[0]-index.origin[0] : -52, z = tile ? tile.center[2]-index.origin[2] : 32;
    controls.target.set(x+35,38,z-38); camera.position.set(x-6,4,z+12);
  } else if (view === 'facade') {
    selectedTile='l27'; camera.fov=40; controls.target.set(0,210,15); camera.position.set(43,218,85);
  } else {
    controls.target.copy(focus); const scale = camera.aspect < .85 ? 1.55 : 1;
    camera.position.copy(focus).add(new T.Vector3(550,410,650).multiplyScalar(tileId === 'l27' ? scale : scale*.57));
  }
  if (view === 'aerial' && camera.aspect < .85) camera.position.sub(controls.target).multiplyScalar(1.7).add(controls.target);
  camera.updateProjectionMatrix(); controls.update();
  lastTextureUpdate=-2000;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  updateUi();
}

function updateUi() {
  if (!index) return;
  document.querySelector('#tile-count')!.textContent = `${visible.length} / ${index.tiles.length}`;
  document.querySelector('#measure')!.textContent = `${(batches?.stats.instances ?? 0).toLocaleString()} 个场景实例`;
  document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === range)));
  document.querySelectorAll<HTMLButtonElement>('[data-tile]').forEach(b => {
    const id = b.dataset.tile!;
    b.dataset.state = desired.includes(id) ? tileStates.get(id)?.state ?? 'idle' : 'idle';
    b.setAttribute('aria-pressed', String(selectedTile === id));
    b.title = `${id.toUpperCase()} · ${visible.includes(id) ? '已显示' : store.tiles.has(id) ? '已缓存' : '点击查看'}`;
  });
}
function progress(event: Progress) {
  tileStates.set(event.tile, event);
  if (desired.includes(event.tile) && event.state === 'loading') {
    status.textContent = `加载街区 ${event.tile.toUpperCase()}${event.total ? ` · ${event.loaded}/${event.total} 种构件` : '…'}`;
  }
  updateUi();
}

async function rebuild(token: number) {
  const nextVisible = desired.filter(id => store.tiles.has(id));
  if (nextVisible.join() === visible.join() && batches) return;
  status.textContent = '正在组合街区…';
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  if (token !== generation) return;
  const next = buildCityBatches(store, nextVisible);
  next.updateDetails(camera.position,highQuality); scene.add(next.group);
  if (batches) { scene.remove(batches.group); batches.dispose(); }
  batches = next; visible = nextVisible; renderer.shadowMap.needsUpdate = true;
  updateUi();
}
async function selectRange(next: number) {
  if (!index) return;
  const token = ++generation; range = next; loading = true; retry.hidden = true; errorText.textContent = '';
  desired = tilesForRange(index, range).map(t => t.id); updateUi();
  try {
    await rebuild(token);
    for (const id of desired) {
      if (token !== generation) return;
      await store.loadTile(index.tiles.find(t => t.id === id)!);
      if (token !== generation) return;
      await rebuild(token);
    }
    if (token !== generation) return;
    store.trim(visible); loading = false;
    status.textContent = `● ${visible.length} 个街区已就绪 · 可继续扩大范围`;
  } catch (error) {
    if (token !== generation) return;
    loading = false; retry.hidden = false; errorText.textContent = String(error);
    status.textContent = '部分街区未能载入，已加载区域可继续浏览';
    console.error(error);
  }
}

async function start() {
  index = await readCityIndex(); store = new CityAssetStore(index, progress);
  const grid = document.querySelector('#tile-grid')!;
  const sorted = [...index.tiles].sort((a,b) => a.center[2]-b.center[2] || a.center[0]-b.center[0]);
  for (const tile of sorted) {
    const button = document.createElement('button'); button.className = 'tile'; button.dataset.tile = tile.id;
    button.dataset.landmark = String(tile.id === index.centerTile); button.textContent = tile.id.toUpperCase();
    button.setAttribute('aria-label', `查看街区 ${tile.id.toUpperCase()}`); button.setAttribute('aria-pressed', String(tile.id === selectedTile));
    button.addEventListener('click', () => {
      setView('district', tile.id);
      if (!desired.includes(tile.id)) void selectRange(9);
    }); grid.appendChild(button);
  }
  await selectRange(range);
}
setTime(time); setView(view);
start().catch(error => { errorText.textContent = String(error); status.textContent = '街区索引加载失败'; retry.hidden = false; loading = false; console.error(error); });
retry.addEventListener('click', () => { if (index) void selectRange(range); else void start(); });
document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(b => b.addEventListener('click', () => { void selectRange(Number(b.dataset.range)); }));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view!)));
document.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => b.addEventListener('click', () => setTime(b.dataset.light as TimeOfDay)));
document.querySelectorAll<HTMLButtonElement>('button[data-quality]').forEach(b => b.addEventListener('click', () => setQuality(b.dataset.quality==='detail')));
document.querySelector('#detail-view')!.addEventListener('click',()=>setView('facade'));
addEventListener('pagehide',()=>textureDetail.setEnabled(false));
addEventListener('resize', () => {
  camera.aspect = host.clientWidth/host.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth,host.clientHeight); composer?.setSize(host.clientWidth,host.clientHeight); setView(view);
});
let lastDetails = 0, frameCount = 0, measurementStart = performance.now();
renderer.setAnimationLoop(now => {
  controls.update(); camera.position.y = Math.max(2, camera.position.y); atmosphere.sky.position.copy(camera.position);
  const near=highQuality && camera.position.distanceTo(controls.target)<260;
  if (batches && now-lastDetails > 400) { if (batches.updateDetails(camera.position,highQuality)) renderer.shadowMap.needsUpdate = true; updateShadow(near); lastDetails = now; }
  if (batches && now-lastTextureUpdate>1200) {
    camera.updateMatrixWorld(); textureProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse); textureFrustum.setFromProjectionMatrix(textureProjection);
    textureDetail.update(highQuality ? batches.nearTextures(camera.position,textureFrustum) : []); lastTextureUpdate=now;
  }
  renderer.info.reset();
  if (near) renderDetail(); else renderer.render(scene,camera);
  frameCount++;
  if (now-measurementStart > 1500) {
    const perf = document.querySelector<HTMLOutputElement>('#performance')!;
    perf.textContent = `${Math.round(frameCount*1000/(now-measurementStart))} FPS · ${visible.length} 块已显示`;
    perf.dataset.calls = String(renderer.info.render.calls); perf.dataset.triangles = String(renderer.info.render.triangles);
    perf.dataset.loading = String(loading); perf.dataset.instances = String(batches?.stats.instances ?? 0);
    perf.dataset.batches = String(batches?.stats.batches ?? 0);
    perf.dataset.quality=highQuality ? 'detail' : 'standard'; perf.dataset.contactShadows=String(near);
    frameCount = 0; measurementStart = now;
  }
});
