import {describe,expect,it,vi} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {BU_CAS_BEDS,BU_CAS_CLEAR_WALK,BU_CAS_ENTRY_GAPS,BU_CAS_LANDSCAPE_BOUNDS,BU_CAS_TREE_SITES,buCASCoordinates,buCASFrameAt,buCASLandscapeReplaces,buCASPointAt} from '../src/features/world/bu-comm-ave-landscape-layout';
import {createBUCommAveLandscape} from '../src/features/world/bu-comm-ave-landscape';
import {buElevation} from '../src/features/world/bu-terrain';

describe('CAS photograph-guided streetscape',()=>{
  it('limits replacement to the north-frontage band and excludes source buildings/other streets',()=>{
    expect(Object.isFrozen(BU_CAS_LANDSCAPE_BOUNDS)).toBe(true);
    expect(BU_CAS_BEDS.length).toBeGreaterThanOrEqual(10);
    for(const x of [-1130,-1105,-1085,-1055,-1025,-999]){
      const f=buCASFrameAt(x)!;expect(f.depth).toBeGreaterThan(10);expect(f.depth).toBeLessThan(25);
      expect(buCASLandscapeReplaces(...buCASPointAt(x,.9))).toBe(true);
      expect(buCASLandscapeReplaces(...buCASPointAt(x,-9))).toBe(false);
      expect(buCASLandscapeReplaces(...buCASPointAt(x,f.depth+1))).toBe(false);
    }
    for(const p of [[-1177,981],[-1050,960],[-1050,1055],[-945,1037]])expect(buCASLandscapeReplaces(p[0],p[1])).toBe(false);
    for(const tree of BU_CAS_TREE_SITES){expect(buCASLandscapeReplaces(tree.x,tree.z)).toBe(true);const p=buCASCoordinates(tree.x,tree.z)!;expect(p.depth<1.7||p.depth>5.4).toBe(true);}
  });

  it('preserves entry openings and a continuous existing walking route in actual generated geometry',()=>{
    for(const [a,b] of BU_CAS_ENTRY_GAPS){expect(b-a).toBeGreaterThanOrEqual(3);for(const bed of BU_CAS_BEDS)expect(bed.to<=a||bed.from>=b,bed.id).toBe(true);}
    const scene=createBUCommAveLandscape(),ray=new Raycaster();
    const test=(x:number,d:number)=>{const p=buCASPointAt(x,d);ray.set(new Vector3(p[0],30,p[1]),new Vector3(0,-1,0));expect(ray.intersectObjects(scene.group.children,true),`Unexpected obstruction at ${x}, ${d}`).toHaveLength(0);};
    // Sample the complete 3.4 m clear band, not only model control points.
    for(let x=-1136;x<=-979;x+=1)for(const d of [1.86,2.7,3.5,4.4,5.24])test(x,d);
    for(const [a,b] of BU_CAS_ENTRY_GAPS)for(let x=a+.5;x<b;x+=1)for(let d=.3;d<10;d+=.8)test(x,d);
    expect(BU_CAS_CLEAR_WALK.length).toBeGreaterThan(30);scene.dispose();
  });

  it('keeps both detail levels finite, terrain-attached, and releases resources once',()=>{
    const counts:number[]=[];
    for(const mobile of [false,true]){
      const scene=createBUCommAveLandscape({mobile});let triangles=0;
      expect(scene.walls).toHaveLength(0);expect(scene.ground).toHaveLength(3);
      for(const tree of scene.trees)expect(tree.rootY).toBeCloseTo(buElevation(tree.x,tree.z)+.14,8);
      const spies:(ReturnType<typeof vi.spyOn>)[]=[];
      scene.group.traverse(o=>{if(!(o instanceof Mesh))return;const g=o.geometry,p=g.getAttribute('position');triangles+=p.count/3;expect([...p.array].every(Number.isFinite)).toBe(true);expect(g.boundingSphere!.radius).toBeLessThan(100);spies.push(vi.spyOn(g,'dispose'));});
      counts.push(triangles);scene.dispose();scene.dispose();spies.forEach(spy=>expect(spy).toHaveBeenCalledTimes(1));expect(scene.group.children).toHaveLength(0);
    }
    expect(counts[0]).toBeLessThan(100000);expect(counts[1]).toBeLessThan(counts[0]/2);
  });
});
