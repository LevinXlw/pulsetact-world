import {Mesh,Raycaster,Vector3} from 'three';
import {beforeAll,describe,expect,it} from 'vitest';
import {createMarylandFullCampus} from '../src/features/world/maryland-full-campus';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';
import {marylandElevation} from '../src/features/world/maryland-terrain';

describe('Maryland parking structures',()=>{
  let campus:ReturnType<typeof createMarylandFullCampus>;
  beforeAll(()=>{campus=createMarylandFullCampus({value:0});},30000);

  it('renders open parking bays rather than a closed academic facade for every garage',()=>{
    const visible=campus.group.children.filter((object):object is Mesh=>object instanceof Mesh&&object.visible);
    const garages=UMD_FULL_BUILDINGS.filter(b=>b.kind==='garage');
    expect(garages.map(b=>b.sourceBuildingId).sort()).toEqual(['179','202','218','403','404']);
    const ray=new Raycaster();ray.near=.01;ray.far=1.8;
    for(const b of garages){
      const pts=[...b.footprint];
      const area=pts.reduce((sum,a,i)=>{const c=pts[(i+1)%pts.length];return sum+a[0]*c[1]-c[0]*a[1];},0);if(area>0)pts.reverse();
      let openings=0,samples=0;
      for(let i=0;i<pts.length;i++){
        const a=pts[i],c=pts[(i+1)%pts.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);if(length<9)continue;
        const nx=-dz/length,nz=dx/length;
        for(let d=1.4;d<length-1;d+=1.2){
          const x=a[0]+dx*d/length,z=a[1]+dz*d/length;
          ray.set(new Vector3(x+nx*.9,marylandElevation(b.x,b.z)+1.8,z+nz*.9),new Vector3(-nx,0,-nz));
          samples++;if(ray.intersectObjects(visible,false).length===0)openings++;
        }
      }
      expect(samples,`${b.name}: facade samples`).toBeGreaterThan(15);
      expect(openings/samples,`${b.name}: open-air bay ratio`).toBeGreaterThan(.6);
    }
  });

  it('preserves the five GIS outlines and includes parking decks, roof stalls and internal ramps',()=>{
    const models=campus.group.userData.parkingGarages as {id:string;floors:number;stalls:number;ramp:boolean;footprint:[number,number][]}[];
    expect(models).toHaveLength(5);
    for(const model of models){
      const b=UMD_FULL_BUILDINGS.find(building=>building.id===model.id)!;
      expect(model.floors).toBeGreaterThanOrEqual(3);
      expect(model.stalls,`${b.name}: rooftop spaces`).toBeGreaterThan(5);
      expect(model.ramp,`${b.name}: ramp fits inside the surveyed outline`).toBe(true);
      expect(model.footprint.length).toBe(b.footprint.length);
      const collision=campus.walls.find(wall=>wall.name===b.name)!;
      expect(collision.position.y).toBeCloseTo(marylandElevation(b.x,b.z),5);
      expect(collision.userData.campusFootprint).toEqual(model.footprint);
    }
  });

  it('keeps parking floors level on sloping terrain',()=>{
    const visible=campus.group.children.filter((object):object is Mesh=>object instanceof Mesh&&object.visible);
    const ray=new Raycaster();ray.near=.01;ray.far=.8;
    const models=campus.group.userData.parkingGarages as {id:string;floors:number}[];
    for(const model of models){
      const b=UMD_FULL_BUILDINGS.find(building=>building.id===model.id)!,deckY=marylandElevation(b.x,b.z)+(model.floors-1)*3.1+.18;
      let flatDeckHits=0;
      // Shoot through the exterior outline on a regular world-space grid.
      // Keep only the substantial slab itself; painted lines and wheel stops
      // are deliberately separate elevated surfaces.
      const xs=b.footprint.map(p=>p[0]),zs=b.footprint.map(p=>p[1]);
      for(let x=Math.min(...xs)+2.4;x<Math.max(...xs)-2;x+=4.2)for(let z=Math.min(...zs)+2.7;z<Math.max(...zs)-2;z+=4.3){
        ray.set(new Vector3(x,deckY+.6,z),new Vector3(0,-1,0));
        const hits=ray.intersectObjects(visible,false).filter(hit=>hit.object instanceof Mesh&&hit.object.name.endsWith(':concrete')&&Math.abs((hit.face?.normal.y??0)-1)<1e-6);
        if(!hits.length)continue;
        const y=hits[0].point.y;
        // The wheel stops sit +0.19 m; the slab top is the common datum.
        if(Math.abs(y-deckY)<.10){expect(y,`${b.name}: horizontal deck at ${x}, ${z}`).toBeCloseTo(deckY,4);flatDeckHits++;}
      }
      expect(flatDeckHits,`${b.name}: exposed level roof deck`).toBeGreaterThan(15);
    }
  });
});
