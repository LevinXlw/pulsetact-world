import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildEmpireState } from './empire-state-model';
import { buildCity } from './empire-city';
import { createAtmosphere, type TimeOfDay } from './empire-atmosphere';

const host = document.querySelector<HTMLDivElement>('#stage')!, status = document.querySelector('#status')!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.toneMapping = T.AgXToneMapping;
renderer.info.autoReset = false; host.appendChild(renderer.domElement);
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(32, host.clientWidth / host.clientHeight, .5, 6500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 12; controls.maxDistance = 1900; controls.maxPolarAngle = Math.PI * .93;
const city = buildCity(); scene.add(city.group);
const atmosphere = createAtmosphere(renderer, scene);
const crownLights: T.SpotLight[] = [];
for (const [x, z] of [[0, 25], [0, -25], [28, 0], [-28, 0]]) {
  const light = new T.SpotLight('#ffe0b1', 0, 90, .53, .9, 2);
  light.position.set(x, 295, z); light.target.position.set(x * .22, 333, z * .22);
  scene.add(light, light.target); crownLights.push(light);
}
const target = new T.WebGLRenderTarget(host.clientWidth, host.clientHeight, { type: T.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target); composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, host.clientWidth, host.clientHeight);
ao.updateGtaoMaterial({ radius: 2.2, thickness: 2, distanceExponent: 2, samples: 8, screenSpaceRadius: false });
ao.updatePdMaterial({ radius: 4, samples: 8 }); ao.blendIntensity = .42; composer.addPass(ao); composer.addPass(new OutputPass());
let currentView = 'overview', time: TimeOfDay = 'day';
let result: ReturnType<typeof buildEmpireState> | undefined;
function updateState() {
  Object.assign(window, { __empireStudy: { ready: Boolean(result), revision: 2, view: currentView, night: time === 'night', time, stats: result?.stats, cityBuildings: city.buildings, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles } });
}
function setView(view: string) {
  currentView = view;
  camera.fov = view === 'street' ? 60 : view === 'facade' ? 42 : 32; camera.updateProjectionMatrix();
  if (view === 'overview') {
    controls.target.set(0, camera.aspect < .85 ? 180 : 210, 0);
    const distance = Math.max(490, 285 / camera.aspect) / (2 * Math.tan(T.MathUtils.degToRad(camera.fov) / 2));
    camera.position.copy(controls.target).add(new T.Vector3(.58, .09, 1).normalize().multiplyScalar(distance));
  } else if (view === 'crown') { controls.target.set(0, 358, 0); camera.position.set(170, 363, 273); }
  else if (view === 'facade') { controls.target.set(0, 151, 22); camera.position.set(47, 161, 102); }
  else { controls.target.set(0, 148, 0); camera.position.set(78, 2.1, 49); }
  controls.update();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  updateState();
}
function setLight(next: TimeOfDay) {
  time = next; document.body.classList.toggle('night', time === 'night');
  atmosphere.setTime(time); city.setNight(time === 'night'); result?.setNight(time === 'night');
  crownLights.forEach(light => { light.intensity = time === 'night' ? 1400 : 0; });
  document.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.light === time)));
  updateState();
}
setView('overview'); setLight('day');
new GLTFLoader().load('/assets-source/nyc-local/empire/empire-kit.glb', gltf => {
  try {
    result = buildEmpireState(gltf.scene); scene.add(result.building);
    document.querySelector<HTMLButtonElement>('#download')!.disabled = false;
    status.textContent = '● 场景已就绪'; result.setNight(time === 'night'); updateState();
    Object.assign(window, { __empireInspect: (origin: number[], direction: number[]) => new T.Raycaster(new T.Vector3().fromArray(origin), new T.Vector3().fromArray(direction).normalize()).intersectObject(result!.building, true).slice(0, 3).map(hit => ({ distance: hit.distance, point: hit.point.toArray(), name: hit.object.name })) });
  } catch (error) { fail(error); }
}, progress => { if (progress.total) status.textContent = `加载建筑… ${Math.round(progress.loaded / progress.total * 100)}%`; }, fail);
function fail(error: unknown) { status.textContent = '加载失败'; document.querySelector('#error')!.textContent = String(error); console.error(error); }
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view!)));
document.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(button => button.addEventListener('click', () => setLight(button.dataset.light as TimeOfDay)));
document.querySelector<HTMLButtonElement>('#download')!.addEventListener('click', async event => {
  if (!result) return;
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = '正在导出…';
  try {
    result.setNight(false);
    const exportModel = result.building.clone(true), exportGeometries: T.BufferGeometry[] = [];
    exportModel.traverse(object => {
      if (object instanceof T.Mesh && object.geometry.hasAttribute('instanceGlow')) {
        object.geometry = object.geometry.clone(); object.geometry.deleteAttribute('instanceGlow'); exportGeometries.push(object.geometry);
      }
    });
    let data: ArrayBuffer | { [key: string]: unknown };
    try { data = await new GLTFExporter().parseAsync(exportModel, { binary: true, maxTextureSize: 1024 }); }
    finally { result.setNight(time === 'night'); exportGeometries.forEach(geometry => geometry.dispose()); }
    if (!(data instanceof ArrayBuffer)) throw new Error('Expected binary GLB');
    const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
    const link = document.createElement('a'); link.href = url; link.download = 'empire-state-demo.glb'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { document.querySelector('#error')!.textContent = `导出失败：${String(error)}`; }
  finally { button.disabled = false; button.textContent = '↓ 导出建筑'; }
});
addEventListener('resize', () => {
  camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight); composer.setSize(host.clientWidth, host.clientHeight); setView(currentView);
});
let frames = 0;
renderer.setAnimationLoop(() => {
  controls.update(); camera.position.y = Math.max(camera.position.y, 1.7); atmosphere.sky.position.copy(camera.position);
  renderer.info.reset(); composer.render(); if (result && ++frames % 20 === 0) updateState();
});
