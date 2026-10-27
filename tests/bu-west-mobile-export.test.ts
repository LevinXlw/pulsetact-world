import {readFileSync} from 'node:fs';
import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation} from '../src/features/world/bu-terrain';

// Exercise the direct bake; mobile-campus-selected-base.test.ts also checks
// the runtime-selected MIT replacement base. West
// residences used to fall through to six-row generic boxes during the bake.
const bytes=readFileSync(new URL('../public/data/mobile/boston.glb',import.meta.url));
const baked=parseMobileCampus(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
baked.updateMatrixWorld(true);
const meshes=baked.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
const towers=['claflin-hall','sleeper-hall'].map(id=>BU_FULL_BUILDINGS.find(b=>b.id===id)!);
const dining=BU_FULL_BUILDINGS.find(b=>b.id==='west-dining')!;
const original=dining.terrainReference!.footprint;
afterAll(()=>{const materials=new Set<Material>();baked.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());});

describe('actual West Campus mobile export',()=>{
  it.each(towers)('retains the interior floor stack of $id in the GLB',tower=>{
    const ground=buElevation(tower.x,tower.z);
    for(const level of [0,5,11]){
      const top=ground+3.7+level*(tower.height-3.7)/12+.22;
      const hit=new Raycaster(new Vector3(tower.x,top+.5,tower.z),new Vector3(0,-1,0),0,1).intersectObjects(meshes,false)[0];
      expect(hit).toBeDefined();expect(hit.object.name).toMatch(/:concrete$/);expect(hit.point.y).toBeCloseTo(top,2);
    }
  });
  it.each([{id:'claflin-hall',a:13,b:14},{id:'sleeper-hall',a:64,b:65}])('keeps $id lobby glazing ahead of the dining connector',sample=>{
    const tower=towers.find(t=>t.id===sample.id)!,a=original[sample.a],b=original[sample.b];
    const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const ray=new Raycaster(new Vector3(x+dz/length*5,buElevation(tower.x,tower.z)+1.5,z-dx/length*5),new Vector3(-dz/length,0,dx/length),0,8);
    const hit=ray.intersectObjects(meshes,false)[0];expect(hit).toBeDefined();expect(hit.object.name).toMatch(/:glass(?:Light|Dark)?$/);
  });
});
