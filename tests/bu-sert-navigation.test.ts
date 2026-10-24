import {describe,expect,it} from 'vitest';
import {BU_GROUND_BUILDINGS,BU_MAP_BUILDINGS} from '../src/features/world/bu-campus-footprints';
import {BU_FULL_PLACES,buNavigationBlocked} from '../src/features/world/bu-campus-layout';
import {BU_CAMPUS_ROUTE,navigationGuide} from '../src/features/world/world-destinations';
import {BU_SERT_LINK_ENTRY,BU_SERT_PARTS,BU_SERT_PUBLIC_PASSAGES,buSertPoint,buSertLocal} from '../src/features/world/bu-sert-layout';
import {resolveWorldArrival} from '../src/features/world/world-arrival';
import {buElevation} from '../src/features/world/bu-terrain';
import type {WorldPoint} from '../src/features/world/geo-coordinates';

function contains(p:readonly[number,number],ring:readonly (readonly[number,number])[]){
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
describe('reviewed Sert footprint navigation and map integration',()=>{
  it('blocks the later Redstone building and relocates a checkpoint left in the former open courtyard',()=>{
    expect(BU_GROUND_BUILDINGS.some(b=>b.id==='gsu-mugar')).toBe(false);
    for(const [x,z] of [[60,47],[87,48]]){
      const point=[...buSertPoint(x,z)] as WorldPoint;
      expect(buNavigationBlocked(...point)).toBe(true);
      expect(BU_MAP_BUILDINGS.some(b=>contains(point,b.footprint))).toBe(true);
      const arrival=resolveWorldArrival('boston',point,buElevation)!;
      expect(arrival).toBeDefined();expect(arrival.position).not.toEqual(point);expect(buNavigationBlocked(...arrival.position)).toBe(false);
    }
  });
  it('shows the elevated Pappas link without treating the ground underneath as occupied',()=>{
    const point=buSertPoint(100.4,35),bridge=BU_MAP_BUILDINGS.find(b=>b.id==='sert-pappas-bridge')!;
    expect(contains(point,bridge.footprint)).toBe(true);expect(bridge.raised).toBe(true);
    expect(BU_GROUND_BUILDINGS.some(b=>contains(point,b.footprint))).toBe(false);
    expect(buNavigationBlocked(...point)).toBe(false);
    expect(BU_MAP_BUILDINGS.filter(b=>b.name==='Mugar Memorial Library')).toHaveLength(1);
    expect(BU_MAP_BUILDINGS.some(b=>b.id==='gsu-mugar')).toBe(false);
  });
  it('keeps restored Marsh links solid and routes along the genuine exterior clearances',()=>{
    expect(buNavigationBlocked(-1162.12,966.22)).toBe(true);
    for(const route of [BU_CAMPUS_ROUTE,...BU_SERT_PUBLIC_PASSAGES.map(p=>p.points)])for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.7);
      for(let sample=0;sample<=count;sample++){
        const t=sample/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        expect(buNavigationBlocked(x,z),`blocked exterior route at ${x},${z}`).toBe(false);
      }
    }
  });
  it('connects the Mugar entrance and under-bridge corridor to the live campus guide in both directions',()=>{
    const mugar=BU_FULL_PLACES.find(p=>p.id==='bu-mugar')!.position,law=BU_FULL_PLACES.find(p=>p.id==='bu-law')!.position,gsu=BU_FULL_PLACES.find(p=>p.id==='bu-gsu')!.position;
    const underpass=[...buSertPoint(100.4,35)] as WorldPoint;
    const doorApproach=[...buSertPoint(-12.52,78)] as WorldPoint;
    for(const [start,destination] of [[mugar,underpass],[underpass,mugar],[underpass,law],[gsu,doorApproach],[doorApproach,gsu]]){
      let current:WorldPoint=[...start];
      for(let step=0;step<2500&&Math.hypot(current[0]-destination[0],current[1]-destination[1])>1;step++){
        const guide=navigationGuide(current,destination),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],length=Math.hypot(dx,dz);
        expect(Number.isFinite(guide.distance)).toBe(true);expect(length).toBeGreaterThan(.0001);
        const stride=Math.min(.6,length);current=[current[0]+dx/length*stride,current[1]+dz/length*stride];
        expect(buNavigationBlocked(...current),`guide entered building at ${current}`).toBe(false);
      }
      expect(Math.hypot(current[0]-destination[0],current[1]-destination[1])).toBeLessThanOrEqual(1);
    }
  },20000);
  it('arrives outside the shared Link and faces its south frontage instead of the closed Mugar window wall',()=>{
    const link=BU_SERT_PARTS.find(p=>p.id==='gsu-link')!,south=Math.max(...link.footprint.map(p=>buSertLocal(p)[1]));
    for(const id of ['bu-mugar','bu-gsu']){
      const place=BU_FULL_PLACES.find(p=>p.id===id)!,[x,z]=buSertLocal(place.position),[tx,tz]=buSertLocal(place.lookAt);
      expect(x).toBeGreaterThan(-22.5);expect(x).toBeLessThan(-1);
      expect(z).toBeGreaterThan(south+2);expect(z).toBeLessThan(102);
      expect(Math.abs(tz-south)).toBeLessThan(.02);expect(tx).toBeGreaterThan(-24);expect(tx).toBeLessThan(-1);
      expect(buNavigationBlocked(...place.position)).toBe(false);
      const arrival=resolveWorldArrival('boston',place.position,buElevation)!;
      expect(arrival.position).toEqual(place.position);
    }
    expect(buNavigationBlocked(...buSertPoint(BU_SERT_LINK_ENTRY.local[0],72))).toBe(true);
  });
});
