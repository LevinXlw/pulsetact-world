import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buildBU566Commonwealth,BU_566_SECTION,bu566Frame} from '../src/features/world/bu-566-commonwealth';

const source=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-566')!;
const meshes:Mesh[]=[],mats=new Map<string,MeshBasicMaterial>();
const model=buildBU566Commonwealth(source.footprint,{put:(finish,g,x,y,z,yaw=0)=>{
  const material=mats.get(finish)??new MeshBasicMaterial();material.name=finish;mats.set(finish,material);
  const mesh=new Mesh(g,material);mesh.name=finish;mesh.position.set(x,y,z);mesh.rotation.y=yaw;mesh.updateMatrixWorld(true);meshes.push(mesh);
}});
afterAll(()=>{meshes.forEach(m=>m.geometry.dispose());mats.forEach(m=>m.dispose());});
const ray=(p:Vector3,d:Vector3,far:number)=>new Raycaster(p,d,0,far).intersectObjects(meshes,false);

describe('566 Commonwealth bounded private context reconstruction',()=>{
  it('keeps the measured 31-point tower distinct from BU580 and the low commercial parcel',()=>{
    expect(source.cityObjectId).toBe(1373);expect(source.footprint).toHaveLength(31);expect(source.universityOwned).toBe(false);expect(source.kind).toBe('context');
    expect(source.height).toBe(BU_566_SECTION.mainTop);
    const adjacent=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-580')!;expect(source.x).toBeGreaterThan(adjacent.x);
    const f=bu566Frame(source.footprint);expect(f.upper.every(p=>f.local(p)[1]>=f.cut-.00001)).toBe(true);
    expect(Math.min(...f.upper.map(p=>f.local(p)[1]))-f.minZ).toBeCloseTo(BU_566_SECTION.balconyDepth,6);
  });
  it('uses finite physical construction within a measured envelope and bounded material budget',()=>{
    for(const mesh of meshes){const values=mesh.geometry.getAttribute('position').array;expect(Array.from(values).every(Number.isFinite)).toBe(true);}
    const bounds=new Box3();meshes.forEach(m=>bounds.union(new Box3().setFromObject(m)));
    expect(bounds.min.x).toBeGreaterThan(Math.min(...source.footprint.map(p=>p[0]))-.5);expect(bounds.max.x).toBeLessThan(Math.max(...source.footprint.map(p=>p[0]))+.5);
    expect(bounds.min.z).toBeGreaterThan(Math.min(...source.footprint.map(p=>p[1]))-.5);
    expect(model.resources.triangles).toBeLessThan(45000);expect(model.resources.materials).toBeLessThanOrEqual(7);
    expect([...mats.keys()]).toEqual(expect.arrayContaining(['brick','concrete','metal','frontageGlass','frame','roof']));
  });
  it('leaves deep balcony voids and puts reflective glass behind actual open masonry holes',()=>{
    expect(model.northBalconyProbes).toHaveLength(BU_566_SECTION.upperFloors);
    for(const p of model.northBalconyProbes){const [nx,nz]=p.normal;
      const hits=ray(new Vector3(p.glassX+nx*3,p.glassY,p.glassZ+nz*3),new Vector3(-nx,0,-nz),4);
      expect(hits[0]?.object.name).toBe('frontageGlass');expect(hits[0].distance).toBeCloseTo(3,3);
      const balconyFloor=ray(new Vector3(p.x,p.y+1.6,p.z),new Vector3(0,-1,0),2);
      expect(balconyFloor[0]?.object.name).toBe('concrete');expect(balconyFloor[0].point.y).toBeCloseTo(p.y,3);
    }
  });
  it('closes every occupied level instead of exposing sky through the apartment tower',()=>{
    expect(model.floorSlabProbes).toHaveLength(BU_566_SECTION.upperFloors+1);
    for(const p of model.floorSlabProbes){const hits=ray(new Vector3(p.x,p.y+1,p.z),new Vector3(0,-1,0),1.5);expect(hits[0]).toBeDefined();expect(hits[0].point.y).toBeCloseTo(p.y,3);}
  });
  it('keeps the pale end walls different from the north balcony facade',()=>{
    const ends=model.facades.filter(f=>f.kind==='pale-end-wall');expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(ends.every(f=>f.windows.every(w=>w.height===.42&&w.width<=1.5))).toBe(true);
    expect(model.facades.some(f=>f.kind==='north-recessed-balcony-doors'&&f.windows.length===44)).toBe(true);
  });
});
