import {useEffect, useRef, useState} from 'react';
import {AmbientLight, BackSide, CanvasTexture, Color, DirectionalLight, LinearFilter, Mesh, MeshLambertMaterial, OrthographicCamera, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer} from 'three';
import {ATLAS_SCHOOLS, type AtlasSchoolId} from './campus-atlas-data';
import {globeVector, normalizeGlobeView, paintWorldTexture, REGION_TEXTURE_BOUNDS, type LandCollection, type LonLat} from './globe-geography';
import {isMobileWorld} from './mobile-device';

export type GlobeFocus = {schoolId: AtlasSchoolId | null; revision: number};
type Props = {selectedId: AtlasSchoolId; focus: GlobeFocus; onSelect: (id: AtlasSchoolId) => void};
const GLOBAL = {longitude: -96, latitude: 30, zoom: 1};
const NORTHEAST = {longitude: -74, latitude: 40.7, zoom: 19};
const SOUTHWEST = {longitude: -111, latitude: 32.4, zoom: 9};
const BOSTON_IDS = new Set<AtlasSchoolId>(['mit', 'bu', 'harvard']);
type FocusTarget='global'|'northeast'|'southwest'|AtlasSchoolId;

export function CampusGlobe({selectedId, focus, onSelect}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const live = useRef({selectedId, onSelect, focus}); live.current = {selectedId, onSelect, focus};
  const commands = useRef<{focus: (target: FocusTarget) => void; zoom: (factor: number) => void} | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1);
  const [region,setRegion]=useState('global');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const mobile=isMobileWorld();
    const container = host.current!, surface = stage.current!;
    const abort = new AbortController();
    let renderer: WebGLRenderer | undefined, texture: CanvasTexture | undefined, regionTexture: CanvasTexture | undefined;
    let geometry: SphereGeometry | undefined, material: MeshLambertMaterial | undefined, atmosphere: ShaderMaterial | undefined;
    let observer: ResizeObserver | undefined, cleanupInput: (() => void) | undefined;
    let frame = 0, dead = false;
    setStatus('loading');
    async function initialize() {
      try {
        const response = await fetch('/assets/maps/world-land.json', {signal: abort.signal});
        if (!response.ok) throw new Error('World geography unavailable');
        const land: LandCollection = await response.json();
        if (dead) return;
        if (land.type !== 'FeatureCollection' || !Array.isArray(land.features)) throw new Error('Invalid geography');
        const paper = document.createElement('canvas'); paper.width = mobile?1024:4096; paper.height = mobile?512:2048;
        const ink = paper.getContext('2d'); if (!ink) throw new Error('Canvas unavailable');
        paintWorldTexture(ink, land);
        texture = new CanvasTexture(paper); texture.colorSpace = SRGBColorSpace; texture.minFilter = LinearFilter;texture.generateMipmaps=false;
        // A separate geographic texture preserves coast detail when the whole
        // globe texture would give the Northeast only a few dozen texels.
        const regionalPaper = document.createElement('canvas'); regionalPaper.width = mobile?512:2048; regionalPaper.height = mobile?512:2048;
        const regionalInk = regionalPaper.getContext('2d'); if (!regionalInk) throw new Error('Canvas unavailable');
        paintWorldTexture(regionalInk, land, REGION_TEXTURE_BOUNDS);
        regionTexture = new CanvasTexture(regionalPaper); regionTexture.colorSpace = SRGBColorSpace; regionTexture.minFilter = LinearFilter;regionTexture.generateMipmaps=false;
        renderer = new WebGLRenderer({alpha: true, antialias: !mobile, preserveDrawingBuffer: !mobile});
        renderer.setPixelRatio(mobile?1:Math.min(devicePixelRatio, 1.75)); renderer.setClearColor(new Color('#102a39'), 0);
        renderer.domElement.dataset.testid = 'campus-globe'; renderer.domElement.setAttribute('aria-hidden', 'true');
        container.appendChild(renderer.domElement);
        const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 8);
        geometry = new SphereGeometry(1, mobile?64:144, mobile?40:96); material = new MeshLambertMaterial({map: texture});
        material.onBeforeCompile = shader => {
          const [west, south, east, north] = REGION_TEXTURE_BOUNDS;
          shader.uniforms.atlasRegion = {value: regionTexture};
          shader.fragmentShader = `uniform sampler2D atlasRegion;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `
            #ifdef USE_MAP
              vec4 sampledDiffuseColor = texture2D(map, vMapUv);
              vec2 atlasUv = (vMapUv - vec2(${(west + 180) / 360}, ${(south + 90) / 180})) / vec2(${(east - west) / 360}, ${(north - south) / 180});
              if (all(greaterThanEqual(atlasUv, vec2(0.0))) && all(lessThanEqual(atlasUv, vec2(1.0)))) {
                vec2 edge = min(atlasUv, 1.0 - atlasUv);
                float blend = smoothstep(0.0, 0.025, min(edge.x, edge.y));
                sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(atlasRegion, atlasUv), blend);
              }
              diffuseColor *= sampledDiffuseColor;
            #endif
          `);
        };
        scene.add(new Mesh(geometry, material));
        scene.add(new AmbientLight('#eaf0df', 1.4));
        const sunlight = new DirectionalLight('#fff3d7', 2); sunlight.position.set(-2.5, 4, 5); camera.add(sunlight); scene.add(camera);
        atmosphere = new ShaderMaterial({
          side: BackSide, transparent: true, depthWrite: false,
          vertexShader: 'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);v=-p.xyz;gl_Position=projectionMatrix*p;}',
          fragmentShader: 'varying vec3 n; varying vec3 v; void main(){float rim=pow(1.0-abs(dot(normalize(n),normalize(v))),3.0);gl_FragColor=vec4(0.40,0.70,0.76,rim*0.36);}',
        });
        const halo = new Mesh(geometry, atmosphere); halo.scale.setScalar(1.025); scene.add(halo);
        let view = {...GLOBAL}, width = 1, height = 1;
        let target: typeof view | undefined;
        const position = new Vector3(), direction = new Vector3();
        const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        function projectPin(id: string, location: LonLat, shown: boolean) {
          const element = pins.current.get(id); if (!element) return;
          position.set(...globeVector(location));
          const front = position.dot(direction) > .08;
          position.project(camera);
          const x = (position.x + 1) * width / 2, y = (1 - position.y) * height / 2;
          const visible = shown && front && x > 8 && x < width - 8 && y > 25 && y < height - 25;
          element.hidden = !visible;
          if (visible) {element.style.left = `${x}px`; element.style.top = `${y}px`; element.dataset.edge = x + element.offsetWidth - 7 > width - 8 ? 'right' : 'left';}
        }
        function render() {
          if (dead || !renderer) return;
          camera.zoom = view.zoom;
          direction.set(...globeVector([view.longitude, view.latitude])); camera.position.copy(direction).multiplyScalar(3);
          camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
          renderer.render(scene, camera);
          const regional = view.zoom > 5;
          projectPin('cluster', [-74, 40.7], !regional);
          projectPin('boston', ATLAS_SCHOOLS.find(s => s.id === 'mit')!.location, regional);
          for (const school of ATLAS_SCHOOLS.filter(s=>!BOSTON_IDS.has(s.id))) projectPin(school.id,school.location,regional||school.location[0]<-90);
          const regionName=regional?(view.longitude<-90?'southwest':'northeast'):'global';
          surface.dataset.view = regionName;setRegion(previous=>previous===regionName?previous:regionName);
          surface.dataset.longitude = view.longitude.toFixed(3); surface.dataset.latitude = view.latitude.toFixed(3);
          surface.dataset.zoom = view.zoom.toFixed(2);
          setZoom(previous => Math.abs(previous - view.zoom) > .15 ? view.zoom : previous);
        }
        function animate() {
          frame = 0;
          if (!target || dead) return;
          const dLon = ((target.longitude - view.longitude + 540) % 360) - 180;
          view = normalizeGlobeView(view.longitude + dLon * .24, view.latitude + (target.latitude - view.latitude) * .24, view.zoom + (target.zoom - view.zoom) * .24);
          if (Math.abs(dLon) + Math.abs(view.latitude - target.latitude) + Math.abs(view.zoom - target.zoom) < .015) {view = {...target}; target = undefined;}
          render(); if (target) frame = requestAnimationFrame(animate);
        }
        function move(next: typeof view, smooth = false) {
          cancelAnimationFrame(frame); target = undefined;
          if (smooth && !reduceMotion) {target = next; frame = requestAnimationFrame(animate);}
          else {view = next; render();}
        }
        commands.current = {
          focus: requested => {
            const school=ATLAS_SCHOOLS.find(s=>s.id===requested);
            const destination=requested==='global'?GLOBAL:requested==='southwest'||(school&&school.location[0]<-90)?SOUTHWEST:NORTHEAST;
            move({...destination},true);
          },
          zoom: factor => move(normalizeGlobeView(view.longitude, view.latitude, view.zoom * factor)),
        };
        function resize() {
          width = container.clientWidth; height = container.clientHeight;
          if (!width || !height || !renderer) return;
          const aspect = width / height;
          camera.left = -1.22 * Math.max(1, aspect); camera.right = -camera.left;
          camera.top = 1.22 * Math.max(1, 1 / aspect); camera.bottom = -camera.top;
          renderer.setSize(width, height); render();
        }
        observer = new ResizeObserver(resize); observer.observe(container);
        const pointers = new Map<number, {x: number; y: number}>();
        const pinchDistance = () => {const p = [...pointers.values()]; return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;};
        const down = (event: PointerEvent) => {
          if ((event.target as HTMLElement).closest('button') || event.button !== 0) return;
          pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
          surface.setPointerCapture(event.pointerId); surface.focus({preventScroll: true});
        };
        const drag = (event: PointerEvent) => {
          const previous = pointers.get(event.pointerId); if (!previous) return;
          const distance = pinchDistance(); pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
          if (pointers.size === 2 && distance > 0) {
            move(normalizeGlobeView(view.longitude, view.latitude, view.zoom * pinchDistance() / distance));
          } else {
            const sensitivity = 130 / Math.min(width, height) / view.zoom;
            move(normalizeGlobeView(view.longitude - (event.clientX - previous.x) * sensitivity, view.latitude + (event.clientY - previous.y) * sensitivity, view.zoom));
          }
        };
        const up = (event: PointerEvent) => {pointers.delete(event.pointerId); if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);};
        const wheel = (event: WheelEvent) => {event.preventDefault(); commands.current?.zoom(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * .004));};
        const key = (event: KeyboardEvent) => {
          if (event.target !== surface) return;
          const step = 10 / view.zoom;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') move(normalizeGlobeView(view.longitude + (event.key === 'ArrowLeft' ? -step : step), view.latitude, view.zoom));
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') move(normalizeGlobeView(view.longitude, view.latitude + (event.key === 'ArrowUp' ? step : -step), view.zoom));
          else if (event.key === '+' || event.key === '=') commands.current?.zoom(1.5);
          else if (event.key === '-') commands.current?.zoom(1 / 1.5);
          else if (event.key === 'Home') commands.current?.focus('global');
          else return;
          event.preventDefault(); event.stopPropagation();
        };
        const contextLost = (event: Event) => {event.preventDefault(); setStatus('error');};
        surface.addEventListener('pointerdown', down); surface.addEventListener('pointermove', drag);
        surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', up); surface.addEventListener('lostpointercapture', up);
        surface.addEventListener('wheel', wheel, {passive: false}); surface.addEventListener('keydown', key);
        renderer.domElement.addEventListener('webglcontextlost', contextLost);
        cleanupInput = () => {
          surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', drag);
          surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', up); surface.removeEventListener('lostpointercapture', up);
          surface.removeEventListener('wheel', wheel); surface.removeEventListener('keydown', key);
          renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
        };
        resize(); setStatus('ready');
        if (live.current.focus.schoolId) commands.current.focus(live.current.focus.schoolId);
      } catch (error) {if (!dead && !(error instanceof DOMException && error.name === 'AbortError')) setStatus('error');}
    }
    void initialize();
    return () => {
      dead = true; abort.abort(); cancelAnimationFrame(frame); observer?.disconnect(); cleanupInput?.();
      commands.current = undefined; geometry?.dispose(); material?.dispose(); atmosphere?.dispose(); texture?.dispose(); regionTexture?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
    // Selection has its own effect; keep the GPU context stable across school selections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  useEffect(() => {if (focus.revision > 0) commands.current?.focus(focus.schoolId??'global');}, [focus]);
  const pinRef = (id: string) => (node: HTMLButtonElement | null) => {if (node) pins.current.set(id, node); else pins.current.delete(id);};

  return <div className="pw-globe-view">
    <div className="pw-globe-presets"><button onClick={() => commands.current?.focus('global')} aria-pressed={region==='global'}>全球</button><button onClick={() => commands.current?.focus('northeast')} aria-pressed={region==='northeast'}>美国东北部</button><button onClick={() => commands.current?.focus('southwest')} aria-pressed={region==='southwest'}>美国西南部</button><span>EARTH / CAMPUS ATLAS</span></div>
    <div ref={stage} className="pw-globe-stage" data-testid="campus-globe-stage" data-ready={status === 'ready'} tabIndex={0} role="group" aria-label="交互地球。拖动旋转，滚轮或双指缩放；方向键旋转，加减键缩放，Home 回到全球。">
      <div ref={host} className="pw-globe-canvas"/>
      <div className="pw-globe-orbit" aria-hidden="true"/>
      <button ref={pinRef('cluster')} hidden className="pw-globe-pin is-cluster" onClick={() => commands.current?.focus('northeast')} aria-label="放大美国东北部的 5 所学校"><i/><span>美国东北部 <b>5</b><small>展开校园分布 ↗</small></span></button>
      <button ref={pinRef('boston')} hidden className={`pw-globe-pin${BOSTON_IDS.has(selectedId) ? ' is-selected' : ''}`} onClick={() => live.current.onSelect(BOSTON_IDS.has(live.current.selectedId) ? live.current.selectedId : 'mit')} aria-label="查看 Boston 的 3 所学校"><i/><span>Boston <b>3</b><small>MIT · Harvard · BU</small></span></button>
      {ATLAS_SCHOOLS.filter(s=>!BOSTON_IDS.has(s.id)).map(school => <button key={school.id} ref={pinRef(school.id)} hidden className={`pw-globe-pin${selectedId === school.id ? ' is-selected' : ''}`} onClick={() => live.current.onSelect(school.id)} aria-label={`在地球上选择 ${school.short}`}><i/><span>{school.short}<small>{school.city}</small></span></button>)}
      {status !== 'ready' && <div className="pw-globe-status" role="status">{status === 'loading' ? '正在展开世界地图…' : <><p>地球视图暂时无法加载</p><small>仍可从下方选择学校、查看区域和进入校园。</small><button onClick={() => setRetry(value => value + 1)}>重新加载地球</button></>}</div>}
      <div className="pw-globe-zoom"><button aria-label="放大地球" disabled={status !== 'ready' || zoom >= 27.9} onClick={() => commands.current?.zoom(1.5)}>+</button><button aria-label="缩小地球" disabled={status !== 'ready' || zoom <= 1.01} onClick={() => commands.current?.zoom(1 / 1.5)}>−</button></div>
      <span className="pw-globe-compass" aria-hidden="true">N ↑</span>
    </div>
    <div className="pw-globe-caption"><span>拖动旋转 · 滚轮 / 双指缩放</span><span>Natural Earth · 地理总览</span></div>
  </div>;
}
