import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const host = document.querySelector<HTMLDivElement>('#stage')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9e6df');
scene.fog = new THREE.Fog('#e9e6df', 45, 105);
const camera = new THREE.PerspectiveCamera(35, host.clientWidth / host.clientHeight, .05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * .495;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture;
scene.environmentIntensity = .5;
room.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight('#e7efff', '#887b65', 1.35));
const sun = new THREE.DirectionalLight('#fff0d8', 3.5);
sun.position.set(-12, 22, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 24, bottom: -12, near: .1, far: 65 });
sun.shadow.bias = -.0002;
sun.shadow.normalBias = .018;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), new THREE.MeshStandardMaterial({ color: '#dfdcd4', roughness: .96 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.025;
floor.receiveShadow = true;
scene.add(floor);
const presentation = new THREE.Group();
scene.add(presentation);

async function init() {
  const loader = new GLTFLoader();
  const root = '/assets-source/nyc-local/sample/';
  const loaded = await Promise.all(['brownstone-entrance', 'brownstone-window', 'brownstone-wall'].map(async name => {
    const gltf = await loader.loadAsync(`${root}${name}.glb`);
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true; object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          const standard = material as THREE.MeshStandardMaterial;
          if (standard.map) standard.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          if (standard.transparent) {
            standard.depthWrite = false;
            standard.polygonOffset = true; standard.polygonOffsetFactor = -1;
          }
        }
      }
    });
    return gltf.scene;
  }));
  function setView(view: string) {
    presentation.clear();
    if (view === 'facade') {
      presentation.add(loaded[0].clone(true));
      for (const y of [4, 8]) for (const x of [-2, 2]) {
        const upper = loaded[1].clone(true); upper.position.set(x, y, .24); presentation.add(upper);
      }
    } else {
      presentation.add(loaded[view === 'entrance' ? 0 : 1].clone(true));
    }
    const bounds = new THREE.Box3().setFromObject(presentation);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const distance = Math.max(size.y, size.x / camera.aspect) / (2 * Math.tan(verticalFov / 2)) * 1.35;
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(.35, .14, 1).normalize().multiplyScalar(distance));
    controls.update();
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    Object.assign(window, { __nycStudy: { ready: true, view, models: 3, materialFidelity: 'approximate' } });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view!)));
  setView('facade');
  status.textContent = '● 本地样片已就绪';
}
init().catch(error => {
  status.textContent = '样片加载失败';
  document.querySelector('#error')!.textContent = `请先运行本地资源转换脚本。\n${String(error)}`;
  console.error(error);
});
addEventListener('resize', () => { camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
