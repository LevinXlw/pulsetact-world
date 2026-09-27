import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createAtmosphere, type TimeOfDay } from './empire-atmosphere';
import { buildRecoveredEmpire, type RecoveredScene } from './empire-original-model';

const host = document.querySelector<HTMLDivElement>('#stage')!, status = document.querySelector('#status')!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.toneMapping = T.AgXToneMapping;
renderer.info.autoReset = false; host.appendChild(renderer.domElement);
const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, host.clientWidth / host.clientHeight, .3, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 1800; controls.maxPolarAngle = Math.PI * .92;
const atmosphere = createAtmosphere(renderer, scene);
const ground = new T.Mesh(new T.PlaneGeometry(20000, 20000), new T.MeshStandardMaterial({ color: '#a5a6a1', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.1; ground.receiveShadow = true; scene.add(ground);
const target = new T.WebGLRenderTarget(host.clientWidth, host.clientHeight, { type: T.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target); composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, host.clientWidth, host.clientHeight);
ao.updateGtaoMaterial({ radius: 1.2, thickness: 1.5, distanceExponent: 2, samples: 8, screenSpaceRadius: false });
ao.updatePdMaterial({ radius: 4, samples: 8 }); ao.blendIntensity = .32; composer.addPass(ao); composer.addPass(new OutputPass());
let view = 'overview', time: TimeOfDay = 'day', result: ReturnType<typeof buildRecoveredEmpire> | undefined;
function setView(next: string) {
  view = next; camera.fov = view === 'street' ? 65 : view === 'facade' ? 40 : 32; camera.updateProjectionMatrix();
  if (view === 'overview') {
    const narrow = camera.aspect < .85;
    controls.target.set(0, narrow ? 208 : 223, 0);
    const distance = Math.max(narrow ? 630 : 590, 200 / camera.aspect) / (2 * Math.tan(T.MathUtils.degToRad(camera.fov) / 2));
    camera.position.copy(controls.target).add(new T.Vector3(.9, .18, 1.65).normalize().multiplyScalar(distance));
  } else if (view === 'crown') { controls.target.set(0, 373, 0); camera.position.set(175, 386, 230); }
  else if (view === 'facade') { controls.target.set(0, 210, 15); camera.position.set(43, 218, 85); }
  else { controls.target.set(0, 135, 0); camera.position.set(94, 2.5, 71); }
  controls.update(); document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}
function setTime(next: TimeOfDay) {
  time = next; atmosphere.setTime(time);
  renderer.toneMappingExposure = time === 'golden' ? 1.3 : 1.4;
  (scene.fog as T.FogExp2).density = .00012;
  document.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.light === time)));
}
setView(view); setTime(time);
async function load() {
  const response = await fetch('/assets-source/nyc-local/empire-original/manifest.json');
  if (!response.ok) throw new Error(`场景清单读取失败：${response.status}`);
  const manifest: RecoveredScene = await response.json();
  const library = await new GLTFLoader().loadAsync('/assets-source/nyc-local/empire-original/empire-kit.glb', progress => {
    if (progress.total) status.textContent = `读取原始构件… ${Math.round(progress.loaded / progress.total * 100)}%`;
  });
  result = buildRecoveredEmpire(library.scene, manifest); scene.add(result.building);
  document.querySelector('#measure')!.textContent = `${result.stats.instances.toLocaleString()} 个原始构件实例`;
  status.textContent = `● 原始场景已就绪 · ${result.stats.models} 种构件`;
  document.querySelector('#download')!.setAttribute('aria-disabled', 'false');
  Object.assign(window, { __empireOriginal: { ready: true, stats: result.stats } });
}
load().catch(error => { status.textContent = '场景加载失败'; document.querySelector('#error')!.textContent = String(error); console.error(error); });
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view!)));
document.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => b.addEventListener('click', () => setTime(b.dataset.light as TimeOfDay)));
addEventListener('resize', () => {
  camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight); composer.setSize(host.clientWidth, host.clientHeight); setView(view);
});
let frame = 0;
renderer.setAnimationLoop(() => {
  controls.update(); atmosphere.sky.position.copy(camera.position); renderer.info.reset(); composer.render();
  if (result && ++frame % 30 === 0) Object.assign(window, { __empireOriginal: { ready: true, view, time, stats: result.stats, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles } });
});
