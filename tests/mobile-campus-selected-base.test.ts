import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {loadMobileCampus} from '../src/features/world/mobile-campus';
import {loadMITCampusReplacement,residenceAssetURL,residenceBaseURL} from '../src/features/world/mit-residences-asset';
import {MIT_STATA_MOBILE_BASE_URL} from '../src/features/world/mit-stata-asset';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation} from '../src/features/world/bu-terrain';

// Only the browser canvas foliage and authored texture decoding are substituted.
// Fetches, real mobile loader/base selection, shipped base bytes, its parser,
// collision assembly and BU materials all run. No WebGL or browser is started.
vi.mock('../src/features/world/painterly-vegetation',async()=>{
  const {Group}=await import('three');
  return {createPainterlyVegetation:()=>({group:new Group(),setQuality:()=>{},update:()=>{},dispose:()=>{}})};
});
const disk=(url:string)=>readFileSync(new URL('../public'+url,import.meta.url));
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const glb=(bytes:Buffer)=>{const length=bytes.readUInt32LE(12);return{document:JSON.parse(bytes.subarray(20,20+length).toString()),binary:bytes.subarray(28+length)};};
const source=disk('/data/mobile/boston.glb'),original=glb(source);
let assets:Awaited<ReturnType<typeof loadMobileCampus>>;
const requests:string[]=[];
let missingDorm=false;
beforeAll(async()=>{
  vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>{
    const scene=new Group();scene.add(new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'authored MIT fixture'})));
    return {scene} as never;
  });
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL)=>{
    const url=String(input);requests.push(url);
    if(missingDorm&&url===residenceAssetURL('maseeh','mobile'))return new Response(null,{status:404});
    return new Response(new Uint8Array(disk(url)));
  }));
  assets=await loadMobileCampus(new AbortController().signal,'boston');
},60000);
afterAll(()=>{assets?.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});

function expectCurrentBoston(baseUrl:string){
  const bytes=disk(baseUrl),selected=glb(bytes);
  // Removing MIT shells appends indices only. Every original byte (including
  // current BU facades, floors, DEM and collision) must remain unchanged.
  expect(selected.binary.subarray(0,original.binary.length).equals(original.binary)).toBe(true);
  const unrelated=(doc:any)=>doc.meshes.filter((mesh:any)=>!mesh.primitives.some((p:any)=>/Cambridge[ _]buildings/.test(doc.materials[p.material]?.name??'')));
  expect(unrelated(selected.document)).toEqual(unrelated(original.document));
  expect(selected.document.materials).toEqual(original.document.materials);
}

describe('actual Boston phone loader base selection',()=>{
  it('loads the MIT replacement base once and keeps all three authored exteriors',()=>{
    const url=residenceBaseURL('mobile');
    expect(assets.model.userData.mobileBaseAsset).toEqual({url,bytes:disk(url).length});
    expect(assets.model.userData.stataReplacement.status).toBe('loaded');
    expect(assets.model.userData.mitResidenceReplacement.status).toBe('loaded');
    expect(requests.filter(url=>url.endsWith('without-residences.glb')||url.endsWith('without-stata.glb')||url==='/data/mobile/boston.glb')).toEqual([url]);
    expectCurrentBoston(url);
  });
  it('matches the complete source SHA chain for both selected and fallback bases',()=>{
    const manifest=JSON.parse(disk('/data/mobile/boston.replacements.json').toString());
    const metadata=JSON.parse(disk('/data/mobile/boston.json').toString());
    expect(manifest.source).toEqual({url:'/data/mobile/boston.glb',sha256:sha(source),bytes:source.length});
    expect(metadata.sha256).toBe(manifest.source.sha256);expect(metadata.replacementBases).toEqual(manifest);
    let prior=manifest.source;
    for(const item of [manifest.stata,manifest.residences]){
      const bytes=disk(item.url);
      expect(item.sha256).toBe(sha(bytes));expect(item.bytes).toBe(bytes.length);
      expect(item.inputUrl).toBe(prior.url);expect(item.inputSHA256).toBe(prior.sha256);expect(item.inputBytes).toBe(prior.bytes);
      expect(JSON.parse(disk(item.url.replace(/\.glb$/,'.json')).toString())).toEqual(item);
      expectCurrentBoston(item.url);prior=item;
    }
  });
  it('contains the real 560 fascia and West interior floor stack after runtime assembly',()=>{
    const visible:Mesh[]=[];assets.model.traverse(o=>{if(o instanceof Mesh&&o.visible)visible.push(o);});
    expect(visible.some(o=>o.name.includes(':bankFascia'))).toBe(true);
    for(const id of ['claflin-hall','sleeper-hall']){
      const tower=BU_FULL_BUILDINGS.find(b=>b.id===id)!,ground=buElevation(tower.x,tower.z);
      for(const level of [0,5,11]){
        const top=ground+3.7+level*(tower.height-3.7)/12+.22;
        const hit=new Raycaster(new Vector3(tower.x,top+.5,tower.z),new Vector3(0,-1,0),0,1).intersectObjects(visible,false)[0];
        expect(hit).toBeDefined();expect(hit.object.name).toMatch(/:concrete$/);expect(hit.point.y).toBeCloseTo(top,2);
      }
    }
  });
  it('keeps the same current BU when a missing MIT dorm selects the Stata-only fallback',async()=>{
    missingDorm=true;vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fallback=await loadMITCampusReplacement(new AbortController().signal,'mobile');
    try{
      expect(fallback.residences).toBeUndefined();expect(fallback.baseUrl).toBe(MIT_STATA_MOBILE_BASE_URL);
      expect(Buffer.from(fallback.baseBytes).equals(disk(MIT_STATA_MOBILE_BASE_URL))).toBe(true);
      expectCurrentBoston(fallback.baseUrl);
    }finally{fallback.building.dispose();missingDorm=false;}
  });
});
