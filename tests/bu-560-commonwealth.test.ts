import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buildBU560Commonwealth,BU_560_SECTION} from '../src/features/world/bu-560-commonwealth';
const b=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-560')!,meshes:Mesh[]=[],materials=new Map<string,MeshBasicMaterial>();
const metadata=buildBU560Commonwealth(b.footprint,{put:(finish,g,x,y,z,yaw=0)=>{const mat=materials.get(finish)??new MeshBasicMaterial();materials.set(finish,mat);const mesh=new Mesh(g,mat);mesh.name=finish;mesh.position.set(x,y,z);mesh.rotation.y=yaw;mesh.updateMatrixWorld(true);meshes.push(mesh);}});
afterAll(()=>{meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>m.dispose());});
const ray=(point:Vector3,direction:Vector3,distance:number)=>new Raycaster(point,direction,0,distance).intersectObjects(meshes,false);
describe('560 Commonwealth independent curved commercial building',()=>{
  it('retains the independent private surveyed ring and one tall banking hall rather than a tower podium',()=>{
    expect(b.cityObjectId).toBe(1372);expect(b.kind).toBe('context');expect(b.universityOwned).toBe(false);expect(b.footprint).toHaveLength(38);
    const tower=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-566')!;expect(b.x-tower.x).toBeGreaterThan(40);expect(BU_560_SECTION.roofTop).toBe(b.height);
    expect(metadata.curveFacets).toHaveLength(27);expect(metadata.glazingProbes.some(p=>p.kind==='curved-entry')).toBe(true);
  });
  it('places recessed glass in actual openings around the curved nose and both street sides',()=>{
    for(const p of metadata.glazingProbes){const [nx,nz]=p.normal,hits=ray(new Vector3(p.x+nx*2,p.y,p.z+nz*2),new Vector3(-nx,0,-nz),3);
      expect(hits[0]?.object.name).toBe('frontageGlass');expect(hits[0].distance).toBeCloseTo(2,3);
    }
  });
  it('uses a closed surveyed roof and keeps the cyan fascia opaque above the window band',()=>{
    const p=metadata.roofProbe,hits=ray(new Vector3(p.x,p.y+1,p.z),new Vector3(0,-1,0),2);expect(hits[0]?.object.name).toBe('roof');expect(hits[0].point.y).toBeCloseTo(p.y,3);
    const glass=metadata.glazingProbes[0],[nx,nz]=glass.normal;
    const fascia=ray(new Vector3(glass.x+nx*2,7.2,glass.z+nz*2),new Vector3(-nx,0,-nz),3);expect(fascia[0]?.object.name).toBe('bankFascia');
  });
  it('preserves finite geometry, measured overall height and a small source budget',()=>{
    const box=new Box3();for(const m of meshes){expect(Array.from(m.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);box.union(new Box3().setFromObject(m));}
    expect(box.max.y).toBeCloseTo(BU_560_SECTION.roofTop,3);expect(box.min.x).toBeGreaterThan(Math.min(...b.footprint.map(p=>p[0]))-.5);expect(box.max.x).toBeLessThan(Math.max(...b.footprint.map(p=>p[0]))+.5);
    expect(metadata.resources.triangles).toBeLessThan(10000);expect(metadata.resources.materials).toBe(6);
  });
});
