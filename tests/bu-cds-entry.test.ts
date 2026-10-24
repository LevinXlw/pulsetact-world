import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {BU_CDS_GROUND_TOWER,BU_CDS_GROUND_PODIUM,BU_CDS_SOUTH_DOORS,buCDSPoint} from '../src/features/world/bu-cds-entry-layout';
import {BU_CDS_YAW} from '../src/features/world/bu-landmark-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const campus=createBostonUniversity({wind:{value:0}}),visible:Mesh[]=[];
campus.group.traverse(o=>{if(o instanceof Mesh&&o.visible)visible.push(o);});
const base=buElevation(...buCDSPoint(0,0)),c=Math.cos(BU_CDS_YAW),s=Math.sin(BU_CDS_YAW);
const ray=new Raycaster();
function facadeHit(x:number,z:number,dx=0,dz=-1,y=1.7){
  const p=buCDSPoint(x,z);
  ray.set(new Vector3(p[0],base+y,p[1]),new Vector3(dx*c+dz*s,0,-dx*s+dz*c));
  return ray.intersectObjects(visible,false)[0];
}
function groundHit(x:number,z:number){
  const p=buCDSPoint(x,z);ray.set(new Vector3(p[0],base+20,p[1]),new Vector3(0,-1,0));
  return ray.intersectObjects(campus.ground,false)[0];
}
afterAll(()=>campus.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}}));

describe('CDS public ground-floor edge',()=>{
  it('shows exterior glazing before the recessed backing on the south and Granby faces',()=>{
    for(const hit of [facadeHit(-3.5,26),facadeHit(-26,-2.8,1,0)]){
      expect(hit?.object.name).toBe('BU architecture · glass');
    }
    // The south glass is 4 cm within the original footprint, not a second
    // full-size dark box that masks all new curtain-wall detail.
    expect(facadeHit(-3.5,26).distance).toBeCloseTo(26-(BU_CDS_GROUND_TOWER.z+BU_CDS_GROUND_TOWER.d/2)+.04,3);
  });
  it('has genuinely recessed double doors, distinct jamb depth and clear transoms',()=>{
    for(const door of BU_CDS_SOUTH_DOORS){
      for(const offset of [-.6,.6]){
        const pane=facadeHit(door.local[0]+offset,26);
        expect(pane?.object.name).toBe('BU architecture · glassShade');
        expect(pane.distance).toBeCloseTo(26-door.local[1]+.22,3);
      }
      const jamb=facadeHit(door.local[0]+door.width/2,26);
      expect(jamb?.object.name).toBe('BU architecture · frame');
      expect(jamb.distance).toBeCloseTo(26-door.local[1]-.12,3);
      expect(facadeHit(door.local[0]+.6,26,0,-1,4).object.name).toBe('BU architecture · glass');
    }
  });
  it('keeps the retained canopy columns outside the visible door approach axes',()=>{
    for(const door of BU_CDS_SOUTH_DOORS){
      // Collision-only tests miss the old uncollidable column that bisected
      // the door landing. Raycast the actual visible scene at walking height.
      const center=facadeHit(door.local[0],25.5);
      expect(center.object.name).toBe('BU architecture · frame');
      expect(center.distance).toBeCloseTo(25.5-door.local[1]+.13,3);
      for(const dx of [-1,1]){
        const leaf=facadeHit(door.local[0]+dx,25.5);
        expect(leaf.object.name).toBe('BU architecture · glassShade');
        expect(leaf.distance).toBeCloseTo(25.5-door.local[1]+.22,3);
      }
    }
    // The fix moves the approximate door groups, not the structural columns.
    for(const x of [28,42])expect(facadeHit(x,25.5).object.name).toBe('BU architecture · trim');
  });
  it('fills the former grass gap with continuous paving that follows the source DEM',()=>{
    const heights:number[]=[];
    for(const x of [-18,-8,0])for(let z=14.2;z<26;z+=.7){
      const p=buCDSPoint(x,z),hit=groundHit(x,z);
      expect(hit?.object.name).toBe('BU ground · paving');
      expect(hit.point.y).toBeCloseTo(buElevation(...p)+.039,4);
      heights.push(hit.point.y);
    }
    // A flat infill plane would hide the approximately 20 cm natural fall.
    expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(.12);
  });
  it('meets each door sill at a level threshold then slopes continuously to the apron',()=>{
    for(const door of BU_CDS_SOUTH_DOORS)for(const dx of [-.65,.65]){
      const x=door.local[0]+dx;
      for(const dz of [-.20,0,.10])expect(groundHit(x,door.local[1]+dz).point.y).toBeCloseTo(base+door.floor+.05,4);
      let previous=groundHit(x,door.local[1]+.16).point.y;
      for(let z=door.local[1]+.21;z<22.5;z+=.10){
        const height=groundHit(x,z).point.y,p=buCDSPoint(x,z);
        expect(height).toBeGreaterThanOrEqual(buElevation(...p)+.038);
        expect(previous-height).toBeGreaterThan(-.001);
        expect(previous-height).toBeLessThan(.012);previous=height;
      }
      const p=buCDSPoint(x,22.499);
      expect(groundHit(x,22.499).point.y).toBeCloseTo(buElevation(...p)+.041,3);
    }
  });
  it('retains the original closed ground envelopes and unobstructed outdoor approaches',()=>{
    const walls=campus.walls.filter(w=>w.name.startsWith('CDS ')&&!w.userData.foundationSkirt);
    expect(walls).toHaveLength(2);
    for(const [i,body] of [BU_CDS_GROUND_TOWER,BU_CDS_GROUND_PODIUM].entries()){
      const bounds=walls[i].geometry.boundingBox!,size=bounds.getSize(new Vector3());
      expect(size.x).toBeCloseTo(body.w,4);expect(size.y).toBeCloseTo(5.6,4);expect(size.z).toBeCloseTo(body.d,4);
    }
    for(const door of BU_CDS_SOUTH_DOORS)for(const dz of [.3,1.5,4,6]){
      const p=buCDSPoint(door.local[0],door.local[1]+dz);
      ray.set(new Vector3(p[0],30,p[1]),new Vector3(0,-1,0));
      expect(ray.intersectObjects(campus.walls,false)).toHaveLength(0);
    }
    // No fill behind the west public face, across the Granby edge, or east
    // of the old parcel apron. The change is confined to its L-shaped gap.
    for(const point of [[-3.5,13],[-22,19],[56,20]])expect(groundHit(point[0],point[1])).toBeUndefined();
  });
  it('retains the triangle budget while isolating the complete CDS batches',()=>{
    const triangles=visible.reduce((total,o)=>total+(o.geometry.index?.count??o.geometry.attributes.position.count)/3,0);
    // Measured immediately before this CDS-only pass; includes all landmarks.
    expect(triangles-109710).toBeGreaterThan(0);expect(triangles-109710).toBeLessThan(1000);
    // CDS and Questrom now keep separate replaceable skins, with identical
    // rendered triangles and independent ground collision for each school.
    expect(visible).toHaveLength(39);expect(campus.ground).toHaveLength(9);expect(campus.walls).toHaveLength(24);
  });
});
