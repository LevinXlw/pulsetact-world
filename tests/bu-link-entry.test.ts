import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_SERT_FOUNDATION_ANCHOR,BU_SERT_LINK_ENTRY,BU_SERT_PARTS,buSertLocal,buSertPoint} from '../src/features/world/bu-sert-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
const models=(['full','mobile'] as const).map(detail=>({detail,model:createBUFullCampus({buildingIds:new Set(['gsu-mugar']),includeSpaces:false,signage:false,detail})}));
afterAll(()=>{
  for(const {model} of models){
    const materials=new Set<import('three').Material>();
    model.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
    materials.forEach(material=>material.dispose());model.group.clear();
  }
});

for(const {detail,model} of models)describe(`GSU–Mugar shared Link entrance (${detail})`,()=>{
  const visible=model.group.children.filter((object):object is Mesh=>object instanceof Mesh&&object.visible);
  const down=(x:number,z:number)=>{
    const p=buSertPoint(x,z);
    return new Raycaster(new Vector3(p[0],20,p[1]),new Vector3(0,-1,0),0,25).intersectObjects(model.ground,false)[0];
  };
  const forward=(x:number,z:number,y:number)=>{
    const a=buSertPoint(x,z),b=buSertPoint(x,z-8);
    return new Raycaster(new Vector3(a[0],datum+y,a[1]),new Vector3(b[0]-a[0],0,b[1]-a[1]).normalize(),0,8).intersectObjects(visible,false)[0];
  };

  it('has a recessed door at the shared south entrance, with visible head and adjoining glazing',()=>{
    const [x,z]=BU_SERT_LINK_ENTRY.local;
    const door=forward(x+.52,z+3.5,1.7),head=forward(x+.52,z+3.5,4.13),side=forward(x+5,z+3.5,1.7);
    expect(door.object.name).toMatch(/:frontageGlassDark$/);
    expect(head.object.name).toMatch(/:concrete$/);
    expect(side.object.name).toMatch(/:frontageGlass$/);
    expect(door.distance-head.distance).toBeGreaterThan(.5);
    expect(buSertLocal([door.point.x,door.point.z])[1]).toBeLessThan(z-.35);
    // GIS facade is at local z 74.54; reviewed entry axis is 6 mm north.
    expect(buSertLocal([side.point.x,side.point.z])[1]).toBeCloseTo(74.54-.45,3);
    // One occupied Link connector has a two-storey-high south window wall
    // (PNF §4.3.4 / BU 2023 photograph), not the old 4.15 m low roof. Only
    // height changes: footprint collision still closes unmodelled interiors.
    const wall=model.walls.find(mesh=>mesh.name==='GSU–Mugar Link')!;
    const source=BU_SERT_PARTS.find(part=>part.id==='gsu-link')!;
    expect((wall.userData.campusFootprint as number[][]).map(p=>p.join(',')).sort()).toEqual(source.footprint.map(p=>p.join(',')).sort());
    expect(new Box3().setFromObject(wall).max.y-datum).toBeCloseTo(source.top,3);
    expect(source.top).toBe(7.4);
    expect(source.levels).toBe(1);
    for(const y of [4.65,5.7,6.75]){
      const upper=forward(x+.52,z+3.5,y);
      expect(upper.object.name).toMatch(/:frontageGlass$/);
      expect(buSertLocal([upper.point.x,upper.point.z])[1]).toBeCloseTo(74.54-.45,3);
    }
  });

  it('partitions the Link court into brick and pale stone at the same DEM surface',()=>{
    // The photo supports the material pattern, not surveyed grid dimensions.
    // Tests protect the authored 4 x 3.6 m grid from z-fighting overlays or
    // a hidden change in grade while leaving the eastern Mugar paving alone.
    for(const [x,z,finish] of [[-18.4,89.5,'paving'],[-16.9,89.5,'pavingBrick'],[-16.9,88.934,'paving'],[8,90,'paving']] as const){
      const p=buSertPoint(x,z),hits=new Raycaster(new Vector3(p[0],20,p[1]),new Vector3(0,-1,0),0,25).intersectObjects(model.ground,false);
      expect(hits[0].object.name).toMatch(new RegExp(`:${finish}$`));
      expect(hits[0].point.y-buElevation(...p)).toBeCloseTo(.155,3);
      // A random interior point must have a single surface triangle, not an
      // old complete court hidden underneath the new material division.
      expect(hits.filter(hit=>Math.abs(hit.point.y-hits[0].point.y)<.0005)).toHaveLength(1);
    }
  });

  it('provides continuous ground across the old court, new brick approach and level door landing',()=>{
    const [entryX,entryZ]=BU_SERT_LINK_ENTRY.local;
    for(const lateral of [-2.8,0,2.8]){
      let previous:number|undefined;
      for(let z=91;z>=entryZ+.1;z-=.25){
        const hit=down(entryX+lateral,z);
        expect(hit,`missing ground at ${entryX+lateral},${z}`).toBeDefined();
        const p=buSertPoint(entryX+lateral,z);
        expect(hit.point.y-buElevation(...p)).toBeGreaterThan(.1);
        if(previous!==undefined)expect(Math.abs(hit.point.y-previous)).toBeLessThan(.08);
        previous=hit.point.y;
      }
    }
    // Sample both sides of the material boundary; coincident polygons or a
    // lost approach used to leave grass between the forecourt and Link wall.
    for(const z of [85.51,85.5,85.49,76.15,76.13,76.11,74.65])expect(down(entryX,z)).toBeDefined();
    const before=down(entryX,85.51),after=down(entryX,85.49);
    expect(Math.abs(before.point.y-after.point.y)).toBeLessThan(.005);
    expect(after.object.name).toMatch(/:pavingBrick$/);
    expect(down(entryX,74.65).point.y).toBeGreaterThan(datum+.35);
    const a=buSertPoint(entryX,91),b=buSertPoint(entryX,entryZ+.1),direction=new Vector3(b[0]-a[0],0,b[1]-a[1]);
    expect(new Raycaster(new Vector3(a[0],datum+1.5,a[1]),direction.clone().normalize(),0,direction.length()).intersectObjects(model.walls,false)).toHaveLength(0);
  });

  it('keeps the entrance improvement inside a small offline geometry allowance',()=>{
    const triangles=model.group.userData.districtModels[0].triangles;
    // The 2026-10-26 Mugar/GSU replacement preserves true upper apertures on
    // mobile as well, increasing its old 22,702 count to 24,118 triangles.
    // It reuses the same material batches and stays within this bounded budget.
    expect(triangles).toBeLessThan(detail==='mobile'?25000:61000);
    expect(visible).toHaveLength(15);
    expect(model.walls).toHaveLength(BU_SERT_PARTS.length);
  });
});
