import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Texture,Vector3,type MeshStandardMaterial} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {CDSInteriorCollision,createCDSInteriorCollision,loadCDSInteriorAssets,type CDSInteriorPhysicsManifest} from '../src/features/world/cds-interior-assets';
import {CDS_INTERIOR_SPAWN,CDS_INTERIOR_LOOK_AT,CDS_INTERIOR_EXITS,CDS_INTERIOR_OUTLINE,isInsideCDSInterior} from '../src/features/world/cds-interior-layout';

const folder='public/assets/bu-cds-interior/';
type Point3=[number,number,number];
type Manifest=CDSInteriorPhysicsManifest&{entrySpawn:Point3;entryLookAt:Point3;outlineXZ:number[][];exits:{position:Point3;radius:number}[];stairWaypoints:{grand:Point3[];butterfly:Point3[]}};
function readBytes(file:string){const bytes=readFileSync(folder+file);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;}
function box(name:string,y:number){const mesh=new Mesh(new BoxGeometry(8,.2,8),new MeshBasicMaterial());mesh.position.y=y-.1;mesh.name=name;return mesh;}
let manifest:Manifest,physics:Group,collision:CDSInteriorCollision;
beforeAll(async()=>{
  manifest=JSON.parse(readFileSync(folder+'manifest.json','utf8')) as Manifest;
  physics=(await new GLTFLoader().parseAsync(readBytes('physics.glb'),'')).scene;
  collision=createCDSInteriorCollision(physics,manifest);
});
afterEach(()=>vi.unstubAllGlobals());
afterAll(()=>{collision?.clear();physics?.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});});

describe('CDS independent interior collision',()=>{
  it('chooses the support near the feet instead of attracting a player to the upper floor',()=>{
    const lower=box('lower',0),upper=box('upper',5.6),local=new CDSInteriorCollision([lower,upper],[]);
    expect(local.groundHeight(0,0)).toBeCloseTo(0,6);
    expect(local.groundHeight(0,0,0)).toBeCloseTo(0,6);
    expect(local.groundHeight(0,0,5.6)).toBeCloseTo(5.6,6);
    expect(local.groundHeight(0,0,Number.NaN)).toBeUndefined();
    local.clear();expect(local.groundHeight(0,0,5.6)).toBeUndefined();
    for(const mesh of [lower,upper]){mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}
  });

  it('keeps synchronous spawn, exits and envelope aligned with the actual gameplay asset',()=>{
    expect(CDS_INTERIOR_SPAWN).toEqual([manifest.entrySpawn[0],manifest.entrySpawn[2]]);
    expect(CDS_INTERIOR_LOOK_AT).toEqual([manifest.entryLookAt[0],manifest.entryLookAt[2]]);
    expect(CDS_INTERIOR_OUTLINE).toEqual(manifest.outlineXZ);
    for(const [i,exit] of CDS_INTERIOR_EXITS.entries()){
      expect(exit.position).toEqual([manifest.exits[i].position[0],manifest.exits[i].position[2]]);
      expect(exit.radius).toBe(manifest.exits[i].radius);
      expect(isInsideCDSInterior(...exit.position)).toBe(true);
      expect(collision.groundHeight(...exit.position,0)).toBeCloseTo(0,6);
    }
    expect(isInsideCDSInterior(-15,17)).toBe(false); // removed preview-only southwest extension
    expect(isInsideCDSInterior(30,-10)).toBe(false); // L-shaped courtyard outside shell
    expect(isInsideCDSInterior(...CDS_INTERIOR_SPAWN)).toBe(true);
    expect(collision.groundHeight(...CDS_INTERIOR_SPAWN)).toBeCloseTo(0,6);
  });

  it('walks on the first floor below a second floor without snapping or blocking on its height',()=>{
    for(let x=39;x<=45;x+=.2){
      expect(collision.groundHeight(x,16,0)).toBeCloseTo(0,6);
      expect(collision.groundHeight(x,16,5.6)).toBeCloseTo(5.6,5);
    }
    expect(collision.distance(new Vector3(40,1.25,16),new Vector3(0,1,0),8,true)).toBeGreaterThan(3);
    // Ceiling is only a camera obstacle. It is never a walking-floor hit or
    // a wall returned by the horizontal player obstacle query.
    expect(collision.distance(new Vector3(40,1.25,16),new Vector3(0,1,0),4.2,false)).toBeUndefined();
  });

  for(const stair of ['grand','butterfly'] as const)it(`walks the actual ${stair} stair up and down through every tread and landing`,()=>{
    const walk=(points:Point3[])=>{
      let feet=points[0][1],previous=new Vector3(points[0][0],feet,points[0][2]);
      for(let segment=1;segment<points.length;segment++){
        const from=points[segment-1],to=points[segment],distance=Math.hypot(to[0]-from[0],to[2]-from[2]),steps=Math.ceil(distance/.055);
        for(let step=1;step<=steps;step++){
          const t=step/steps,x=from[0]+(to[0]-from[0])*t,z=from[2]+(to[2]-from[2])*t;
          const height=collision.groundHeight(x,z,feet),context=`${stair} ${segment}:${step} x=${x.toFixed(3)} z=${z.toFixed(3)} feet=${feet.toFixed(3)}`;
          expect(isInsideCDSInterior(x,z),context).toBe(true);expect(height,context).toBeDefined();
          expect(Math.abs(height!-feet),context).toBeLessThan(.34);
          const direction=new Vector3(x-previous.x,0,z-previous.z),reach=direction.length()+.34;
          const obstacle=collision.distance(new Vector3(previous.x,feet+.9,previous.z),direction.normalize(),reach);
          expect(obstacle,`${context} wall ${obstacle}`).toBeUndefined();
          const lowObstacle=collision.distance(new Vector3(previous.x,Math.max(feet,height!)+.34,previous.z),direction,reach);
          expect(lowObstacle,`${context} lower body wall ${lowObstacle}`).toBeUndefined();
          feet=height!;previous.set(x,feet,z);
        }
        expect(feet,`${stair} waypoint ${segment}`).toBeCloseTo(to[1],4);
      }
      return feet;
    };
    expect(walk(manifest.stairWaypoints[stair])).toBeCloseTo(5.6,5);
    expect(walk([...manifest.stairWaypoints[stair]].reverse())).toBeCloseTo(0,5);
  });

  it('blocks the envelope, cafe furniture and upper void edge with real physical proxies',()=>{
    expect(collision.distance(new Vector3(44.2,.9,18.15),new Vector3(0,0,1),2)).toBeDefined();
    expect(collision.distance(new Vector3(-15,.9,-6),new Vector3(1,0,0),5)).toBeDefined();
    expect(collision.distance(new Vector3(29,6.5,10.9),new Vector3(0,0,1),2)).toBeDefined();
  });

  it('blocks first-floor entry into the solid north side of the grand stair',()=>{
    // There is no accessible first-floor support inside the solid base. Both
    // the support cutout and real vertical side faces protect it; a ceiling
    // proxy or false higher-floor result must not substitute for body walls.
    for(const x of [20,23,25]){
      expect(collision.groundHeight(x,12.1,0)).toBeUndefined();
      const wall=collision.distance(new Vector3(x,.9,11.35),new Vector3(0,0,1),1.1);
      expect(wall,`grand north wall at x=${x}`).toBeDefined();
      expect(wall!).toBeGreaterThan(.5);expect(wall!).toBeLessThan(.7);
    }
    // The lowest seat terrace is above step height but below the torso ray;
    // neither its buried 1F slab nor the narrow construction gap is walkable.
    expect(collision.groundHeight(29,15,0)).toBeUndefined();
    expect(collision.groundHeight(25,14.2,0)).toBeUndefined();
  });

  it('blocks low tables and benches that sit below the original torso ray',()=>{
    for(const {x,z,expected} of [{x:37.5,z:13,expected:1.3},{x:-18.5,z:10.8,expected:1.29}]){
      const feet=collision.groundHeight(x,z,0)!,direction=new Vector3(0,0,1);
      expect(feet).toBeCloseTo(0,6);
      expect(collision.distance(new Vector3(x,feet+.9,z),direction,2)).toBeUndefined();
      const support=collision.groundHeight(x,z+1.5,feet)!;
      expect(support).toBeCloseTo(0,6); // Furniture tops are never walkable ground.
      const blocked=collision.distance(new Vector3(x,Math.max(feet,support)+.34,z),direction,2);
      expect(blocked).toBeCloseTo(expected,4);
    }
  });

  it('refuses a missing physical group instead of deriving walls from visible material batches',()=>{
    expect(()=>createCDSInteriorCollision(physics,{physics:{...manifest.physics,walls:['not-exported']}})).toThrow(/碰撞组缺失/);
  });
});

describe('CDS interior loading lifecycle',()=>{
  it('requests only the zero-texture room mobile asset and disposes it exactly once',async()=>{
    const requested:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      requested.push(url);const file=url.split('/').pop()!;
      return new Response(file==='manifest.json'?JSON.stringify(manifest):readBytes(file));
    }));
    const assets=await loadCDSInteriorAssets(new AbortController().signal,true);
    expect(requested.sort()).toEqual(['/assets/bu-cds-interior/interior-mobile.glb','/assets/bu-cds-interior/manifest.json','/assets/bu-cds-interior/physics.glb'].sort());
    const dispose=vi.fn(),close=vi.fn();let meshes=0;
    class OwnedBitmap{close=close;}
    vi.stubGlobal('ImageBitmap',OwnedBitmap);const bitmap=new OwnedBitmap() as unknown as ImageBitmap;
    assets.model.traverse(object=>{if(object instanceof Mesh){
      meshes++;object.geometry.addEventListener('dispose',dispose);expect(object.castShadow).toBe(false);
      if(meshes===1){
        const material=(Array.isArray(object.material)?object.material[0]:object.material) as MeshStandardMaterial;
        material.map=new Texture(bitmap);material.normalMap=new Texture(bitmap);
      }
    }});
    expect(meshes).toBeGreaterThan(0);assets.setQuality(false);
    assets.model.traverse(object=>{if(object instanceof Mesh)expect(object.castShadow).toBe(false);});
    expect(assets.collision.groundHeight(...CDS_INTERIOR_SPAWN,0)).toBeCloseTo(0,6);
    assets.dispose();const first=dispose.mock.calls.length;expect(first).toBeGreaterThan(0);assets.dispose();
    expect(dispose).toHaveBeenCalledTimes(first);expect(assets.model.children).toHaveLength(0);
    expect(close).toHaveBeenCalledTimes(1);
    expect(assets.collision.groundHeight(...CDS_INTERIOR_SPAWN,0)).toBeUndefined();
  });

  it('honors an aborted entry without falling back to a campus or desktop model',async()=>{
    const controller=new AbortController();controller.abort();const requested:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{requested.push(url);options.signal!.throwIfAborted();throw new Error('unreachable');}));
    await expect(loadCDSInteriorAssets(controller.signal,true)).rejects.toMatchObject({name:'AbortError'});
    expect(requested.every(url=>url.startsWith('/assets/bu-cds-interior/'))).toBe(true);
    expect(requested.some(url=>url.includes('desktop'))).toBe(false);
  });
});
