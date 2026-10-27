import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3,type Material} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation,buWestDEMWeight} from '../src/features/world/bu-terrain';

const ids=['stuvi-one','claflin-hall','west-dining'];
const models=(['full','mobile'] as const).map(detail=>({detail,campus:createBUFullCampus({buildingIds:new Set(ids),detail,includeSpaces:false,signage:false})}));
afterAll(()=>{for(const {campus}of models){const materials=new Set<Material>();campus.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());}});
for(const {detail,campus}of models)describe(`West survey foundation closure (${detail})`,()=>{
  const visible=campus.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
  it('extends collision and visible masonry to measured low grade without changing roof height or occupied footprint',()=>{
    for(const id of ids){
      const source=BU_FULL_BUILDINGS.find(b=>b.id===id)!,anchor=source.terrainReference?.anchor??[source.x,source.z],base=buElevation(anchor[0],anchor[1]);
      expect(buWestDEMWeight(source.x,source.z)).toBeGreaterThan(0);
      const wall=campus.walls.find(w=>w.name===source.name)!,bounds=new Box3().setFromObject(wall);
      expect(bounds.min.y).toBeLessThanOrEqual(Math.min(base-.14,...source.footprint.map(p=>buElevation(...p)-.29)));
      expect(bounds.max.y).toBeCloseTo(base+source.height,3);
      expect((wall.userData.campusFootprint as number[][]).map(p=>p.join(',')).sort()).toEqual(source.footprint.map(p=>p.join(',')).sort());
      const edge=source.footprint.map((a,i)=>{const b=source.footprint[(i+1)%source.footprint.length],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;return{a,b,x,z,elevation:buElevation(x,z)};}).sort((a,b)=>a.elevation-b.elevation)[0];
      // StuVi has a substantial exposed base. Other footprints can be nearly
      // level after survey void repair; their skirt must still close below 0.
      if(id==='stuvi-one')expect(base-edge.elevation).toBeGreaterThan(.2);
      const y=Math.min(base-.08,(base+edge.elevation)/2),dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz),at=new Vector3(edge.x,y,edge.z);
      const hits=(objects:Mesh[])=>[-1,1].flatMap(side=>new Raycaster(new Vector3(edge.x+dz/length*side,y,edge.z-dx/length*side),new Vector3(-dz/length*side,0,dx/length*side),0,2).intersectObjects(objects,false));
      expect(hits(visible).some(hit=>hit.point.distanceTo(at)<.01),`${id} visible foundation is open below its floor`).toBe(true);
      expect(hits([wall]).some(hit=>hit.point.distanceTo(at)<.01),`${id} collision is open below its floor`).toBe(true);
    }
  });
});
