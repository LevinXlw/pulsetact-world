import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {createBUCampusStreets} from '../src/features/world/bu-campus-streets';
import {BU_ROAD_EDGES} from '../src/features/world/bu-campus-layout';
import {BU_SILBER_FOOTBRIDGE} from '../src/features/world/bu-river-core-layout';
import {buElevation} from '../src/features/world/bu-terrain';

describe('Bay State / Silber physical street kerbs',()=>{
  let streets:ReturnType<typeof createBUCampusStreets>,kerbs:Mesh[];
  beforeAll(()=>{
    streets=createBUCampusStreets();
    kerbs=streets.group.children.filter((object):object is Mesh=>object instanceof Mesh&&object.name==='BU street detail curb');
  },30000);
  afterAll(()=>{
    const materials=new Set<Material>();
    streets.group.traverse(object=>{
      if(!(object instanceof Mesh))return;
      object.geometry.dispose();
      for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
    });
    materials.forEach(material=>material.dispose());
  });
  function pointOnKerb(id:string,t:number,side:number){
    const edge=BU_ROAD_EDGES.find(e=>e.road.id===id)!;
    const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz),nx=-dz/length*side,nz=dx/length*side;
    return {x:edge.a[0]+dx*t+nx*(edge.road.width/2+.1),z:edge.a[1]+dz*t+nz*(edge.road.width/2+.1),nx,nz};
  }
  function faceHits(p:ReturnType<typeof pointOnKerb>,height=.08){
    return new Raycaster(new Vector3(p.x-p.nx*.4,buElevation(p.x,p.z)+height,p.z-p.nz*.4),new Vector3(p.nx,0,p.nz),0,.8).intersectObjects(kerbs,false);
  }
  it('gives both sides of Bay State and the Silber bridge approach visible faces without blocking walking',()=>{
    for(const id of ['massgis-169237-0-0','massgis-42666-0-0'])for(const side of [-1,1]){
      const p=pointOnKerb(id,.5,side),hits=faceHits(p);
      expect(hits.length,`${id} side ${side} has no physical kerb`).toBeGreaterThan(0);
      expect(hits[0].distance).toBeCloseTo(.29,2);
      expect(streets.walls.includes(hits[0].object as Mesh)).toBe(false);
      expect(streets.ground.includes(hits[0].object as Mesh)).toBe(false);
    }
  });
  it('lowers the existing cross street and diagonal Silber bridge landing instead of erecting a lip across them',()=>{
    // Bay State intersects Silber at the surveyed shared road endpoint.
    for(const side of [-1,1])expect(faceHits(pointOnKerb('massgis-169237-0-0',.999,side),.09)).toHaveLength(0);
    // Intersect the actual last bridge segment with Silber's west kerb. This
    // would be raised if a generic junction check ignored pedestrian entries.
    const a=BU_SILBER_FOOTBRIDGE.at(-2)!,b=BU_SILBER_FOOTBRIDGE.at(-1)!;
    const start=pointOnKerb('massgis-42666-0-0',0,-1),end=pointOnKerb('massgis-42666-0-0',1,-1);
    const dx=end.x-start.x,dz=end.z-start.z,bx=b[0]-a[0],bz=b[1]-a[1];
    const t=((a[0]-start.x)*bz-(a[1]-start.z)*bx)/(dx*bz-dz*bx);
    expect(t).toBeGreaterThan(0);expect(t).toBeLessThan(1);
    expect(faceHits(pointOnKerb('massgis-42666-0-0',t,-1),.09)).toHaveLength(0);
    // No hidden barrier was added for any of these street-side details.
    expect(kerbs.some(mesh=>streets.walls.includes(mesh))).toBe(false);
  });
  it('keeps the full street scene below its existing 400,000 triangle budget',()=>{
    let triangles=0;
    streets.group.traverse(object=>{if(object instanceof Mesh)triangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3;});
    expect(triangles).toBeLessThan(400000);
  });
});
