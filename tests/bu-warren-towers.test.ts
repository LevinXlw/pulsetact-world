import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const b=BU_FULL_BUILDINGS.find(v=>v.id==='warren-towers')!;
const models=(['full','mobile'] as const).map(detail=>({detail,...createBUFullCampus({buildingIds:new Set([b.id]),includeSpaces:false,signage:false,detail})}));
const point=(x:number,z:number,y:number)=>new Vector3(b.x+x*Math.cos(b.yaw)+z*Math.sin(b.yaw),buElevation(b.x,b.z)+y,b.z-x*Math.sin(b.yaw)+z*Math.cos(b.yaw));
afterAll(()=>{for(const model of models){const materials=new Set<import('three').Material>();model.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());}});

describe('Warren existing tower envelope from the BU roof plan',()=>{
  it.each(models)('has narrow street ends and deep perpendicular towers in $detail',model=>{
    const towers=model.group.userData.warrenTowers.towers;
    expect(towers).toHaveLength(3);
    for(const t of towers){expect(t.width).toBeGreaterThan(18);expect(t.width).toBeLessThan(21);expect(t.depth).toBeGreaterThan(33);expect(t.depth).toBeLessThan(35);}
    // Preserve GIS podium/closed ground collision while correcting only the
    // upper volume. Full and low must keep exactly the same tower envelopes.
    expect(model.walls).toHaveLength(1);
    expect(model.walls[0].userData.campusFootprint.map((p:number[])=>p.join(',')).sort()).toEqual(b.footprint.map(p=>p.join(',')).sort());
    expect(towers).toEqual(models[0].group.userData.warrenTowers.towers);
  });
  it.each(models)('has actual recessed central north glazing and solid brick beside it in $detail',model=>{
    const meshes=model.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible),tower=model.group.userData.warrenTowers.towers[1];
    const x=b.width*.065,z=-tower.depth/2,y=14.2+(60.2-14.2)/14*5+2.5;
    const direction=new Vector3(Math.sin(b.yaw),0,Math.cos(b.yaw));
    const glass=new Raycaster(point(x+.7,z-2,y),direction,0,4).intersectObjects(meshes,false)[0];
    const brick=new Raycaster(point(x+5,z-2,y),direction,0,4).intersectObjects(meshes,false)[0];
    expect(glass.object.name).toMatch(/frontageGlass/);expect(glass.distance).toBeGreaterThan(2.2);
    expect(brick.object.name).toMatch(/brickBuff/);expect(brick.distance).toBeCloseTo(2,2);
  });
});
