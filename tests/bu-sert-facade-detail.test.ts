import {afterAll,describe,expect,it,vi} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBUSertFacadeDetail} from '../src/features/world/bu-sert-facade-detail';
import {BU_SERT_LINK_ENTRY,buSertLocal,buSertPoint} from '../src/features/world/bu-sert-layout';
import {buFrontageGlazingVariant} from '../src/features/world/bu-frontage-glazing';

const full=createBUSertFacadeDetail(),mobile=createBUSertFacadeDetail({mobile:true});
afterAll(()=>{full.dispose();mobile.dispose();});
const forward=(model:typeof full,x:number,y:number,z:number)=>{
  const p=buSertPoint(x,z),q=buSertPoint(x,z-5),base=model.group.userData.facade.base;
  return new Raycaster(new Vector3(p[0],base+y,p[1]),new Vector3(q[0]-p[0],0,q[1]-p[1]).normalize(),0,5).intersectObjects(model.group.children,false);
};

describe('Mugar photo-led lower south sun screen',()=>{
  it('has a real deep vane, hanging tail and recessed glazing behind it',()=>{
    const f=full.group.userData.facade,x=f.left+f.spacing*3;
    const blade=forward(full,x,5,f.south+2)[0],tail=forward(full,x,3.1,f.south+2)[0],glass=forward(full,x+f.spacing*.5,5,f.south+2)[0];
    expect(blade.object.name).toContain('aggregate');expect(tail.object.name).toContain('aggregate');expect(glass.object.name).toContain('glazing');
    expect(buSertLocal([blade.point.x,blade.point.z])[1]-f.south).toBeCloseTo(.86,3);
    expect(buSertLocal([tail.point.x,tail.point.z])[1]-f.south).toBeCloseTo(.49,3);
    expect(glass.distance-blade.distance).toBeGreaterThan(1.10);
    expect(glass.distance-tail.distance).toBeGreaterThan(.74);
    // Below the suspended tail the same axis hits only the thin frame; it
    // must not be a giant concrete post all the way to the pavement.
    expect(forward(full,x,1.6,f.south+2)[0].object.name).toContain('frame');
  });

  it('does not add ground/collision or cover the shared Link doorway',()=>{
    expect(full.ground).toEqual([]);expect(full.walls).toEqual([]);
    const [x,z]=BU_SERT_LINK_ENTRY.local;
    for(const dx of [-3.4,0,3.4])for(const y of [1,2.1,5.6])expect(forward(full,x+dx,y,z+2)).toHaveLength(0);
    const f=full.group.userData.facade;
    for(const mesh of full.group.children as Mesh[]){
      const p=mesh.geometry.getAttribute('position');
      for(let i=0;i<p.count;i++){
        const local=buSertLocal([p.getX(i),p.getZ(i)]);
        expect(local[0]).toBeGreaterThan(f.left-.08);expect(local[0]).toBeLessThan(f.right+.08);
        expect(local[1]).toBeGreaterThan(f.south-.33);expect(local[1]).toBeLessThan(f.south+.91);
        expect(p.getY(i)-f.base).toBeGreaterThan(-.001);expect(p.getY(i)-f.base).toBeLessThan(7.21);
      }
    }
  });

  it('keeps phone silhouette identical, with bounded batches and scoped glass materials',()=>{
    expect(full.group.children).toHaveLength(4);expect(mobile.group.children).toHaveLength(4);
    expect(full.group.userData.triangles).toBeLessThan(2000);
    expect(full.group.userData.facade).toEqual(mobile.group.userData.facade);
    for(let i=0;i<full.group.children.length;i++){
      const a=full.group.children[i] as Mesh,b=mobile.group.children[i] as Mesh;
      expect([...a.geometry.getAttribute('position').array]).toEqual([...b.geometry.getAttribute('position').array]);
      expect([...a.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
      expect(a.geometry.boundingBox).toBeDefined();
    }
    const glass=full.group.getObjectByName('BU Mugar lower facade · glazing') as Mesh;
    expect(buFrontageGlazingVariant((glass.material as import('three').Material).name)).toBe('clear');
    const one=createBUSertFacadeDetail(),spies=(one.group.children as Mesh[]).map(m=>vi.spyOn(m.geometry,'dispose'));
    one.dispose();one.dispose();spies.forEach(spy=>expect(spy).toHaveBeenCalledTimes(1));
  });
});
