import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_SERT_FOUNDATION_ANCHOR,BU_SERT_PARTS} from '../src/features/world/bu-sert-layout';
import {buElevation} from '../src/features/world/bu-terrain';
import {BU_MUGAR_SOUTH_UPPER,isBUGSULinkSide,isBUMugarSouthUpper} from '../src/features/world/bu-sert-photo-facades';

const datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
const models=(['full','mobile'] as const).map(detail=>({detail,model:createBUFullCampus({buildingIds:new Set(['gsu-mugar']),includeSpaces:false,signage:false,detail})}));
type Facade={part:string;p:{x:number;z:number;yaw:number};width:number;columns:number;pitch:number;openings:{x:number;bottom:number;top:number;width:number}[]};
afterAll(()=>{
  for(const {model} of models){
    const materials=new Set<import('three').Material>();
    model.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
    materials.forEach(material=>material.dispose());model.group.clear();
  }
});

for(const {detail,model} of models)describe(`bounded photo-supported Sert facade replacements (${detail})`,()=>{
  const facades=model.group.userData.sertPhotoFacades as Facade[];
  const visible=model.group.children.filter((object):object is Mesh=>object instanceof Mesh&&object.visible);
  const forward=(f:Facade,x:number,y:number)=>{
    const p=f.p,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    return new Raycaster(new Vector3(p.x+x*c+2*s,datum+y,p.z-x*s+2*c),new Vector3(-s,0,-c),0,3).intersectObjects(visible,false);
  };

  it('replaces the south upper window wall with real narrow apertures and flush recessed frames',()=>{
    const fronts=facades.filter(f=>f.part==='mugar-west');expect(fronts).toHaveLength(1);
    const f=fronts[0];expect(f.openings).toHaveLength(f.columns*4);
    for(const opening of f.openings){
      const y=(opening.bottom+opening.top)/2;
      const glass=forward(f,opening.x,y)[0],frame=forward(f,opening.x+opening.width/2-.0225,y)[0];
      const wall=forward(f,opening.x+f.pitch*.42,y)[0],head=forward(f,opening.x,opening.top+.12)[0];
      expect(glass.object.name).toMatch(/:frontageGlass$/);expect(glass.distance).toBeCloseTo(2.4275,3);
      expect(frame.object.name).toMatch(/:frame$/);expect(frame.distance).toBeCloseTo(2.36,3);
      expect(wall.object.name).toMatch(/:concrete$/);expect(wall.distance).toBeCloseTo(2,3);
      expect(head.object.name).toMatch(/:concrete$/);expect(head.distance).toBeCloseTo(2,3);
      expect(opening.width/(opening.top-opening.bottom)).toBeLessThan(.2);
    }
  });

  it('gives only the observed GSU Link-side faces a blank brick middle level and lower glass',()=>{
    const sides=facades.filter(f=>f.part==='gsu');expect(sides.length).toBeGreaterThan(0);
    for(const f of sides){
      const x=-f.width/2+f.pitch*.5;
      const brick=forward(f,x,7.5)[0],glass=forward(f,x,1.6)[0];
      expect(brick.object.name).toMatch(/:brickDark$/);expect(brick.distance).toBeCloseTo(2,3);
      expect(glass.object.name).toMatch(/:frontageGlass$/);expect(glass.distance).toBeCloseTo(2.3275,3);
    }
  });

  it('keeps source foundation, occupied envelope and all exterior passage collisions',()=>{
    expect(model.walls).toHaveLength(BU_SERT_PARTS.length);
    for(const part of BU_SERT_PARTS){
      const wall=model.walls.find(mesh=>mesh.name===part.name)!;
      const expected=[...part.footprint];
      // Existing source normalization removes the near-duplicate closing
      // vertex (<20 mm) before construction; this pass does not change it.
      if(expected.length>3&&Math.hypot(expected[0][0]-expected.at(-1)![0],expected[0][1]-expected.at(-1)![1])<.02)expected.pop();
      expect((wall.userData.campusFootprint as number[][]).map(p=>p.join(',')).sort()).toEqual(expected.map(p=>p.join(',')).sort());
      expect(new Box3().setFromObject(wall).max.y-datum).toBeCloseTo(part.top,3);
    }
    expect(model.group.userData.districtModels[0].triangles).toBeLessThan(detail==='mobile'?25000:61000);
  });
});

describe('facade evidence stays bounded to identified orientations',()=>{
  it('does not project the visible treatments onto unreviewed walls',()=>{
    const z=BU_MUGAR_SOUTH_UPPER.south;
    expect(isBUMugarSouthUpper('mugar-west',[5,z],[5,z+.5])).toBe(true);
    expect(isBUMugarSouthUpper('mugar-west',[5,z],[5,z-.5])).toBe(false);
    expect(isBUMugarSouthUpper('mugar-east-five',[5,z],[5,z+.5])).toBe(false);
    expect(isBUGSULinkSide('gsu',[-25,84],[-24.5,84])).toBe(true);
    expect(isBUGSULinkSide('gsu',[-25,50],[-24.5,50])).toBe(false);
    expect(isBUGSULinkSide('gsu',[-25,84],[-25.5,84])).toBe(false);
    expect(isBUGSULinkSide('gsu-link',[-25,84],[-24.5,84])).toBe(false);
  });
});
