import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {ARIZONA_BUILDINGS,ARIZONA_ORIGIN,ARIZONA_PATHS,ARIZONA_SURFACES,arizonaElevation,arizonaNavigationBlocked,arizonaPointInside} from '../src/features/world/arizona-geography';
import {ARIZONA_LAYOUT} from '../src/features/world/arizona-layout';
import {guideCampusPaths} from '../src/features/world/campus-paths';
import type {WorldPoint} from '../src/features/world/charles-geography';

const distance=(p:WorldPoint,a:WorldPoint,b:WorldPoint)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};

describe('Arizona campus geography',()=>{
  it('keeps every source vertex in one consistent metre projection',()=>{
    const source=JSON.parse(readFileSync('assets-source/arizona/building-footprints.geojson','utf8'));
    for(const id of ['21','108','137','17','55','56']){
      const feature=source.features.find((f:{properties:{SpaceNum:number}})=>String(f.properties.SpaceNum)===id);
      const polys=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
      const vertices=polys.flat(2).map(([lon,lat]:WorldPoint)=>[(lon-ARIZONA_ORIGIN.longitude)*111320*Math.cos(ARIZONA_ORIGIN.latitude*Math.PI/180),(ARIZONA_ORIGIN.latitude-lat)*110905] as WorldPoint);
      for(const building of ARIZONA_BUILDINGS.filter(b=>b.sourceId===id))for(const point of building.footprint){
        expect(Math.min(...vertices.map((p:WorldPoint)=>Math.hypot(p[0]-point[0],p[1]-point[1]))),building.id).toBeLessThan(.015);
      }
    }
    expect(ARIZONA_ORIGIN.longitude).toBeCloseTo(-110.953443,5);
    expect(ARIZONA_BUILDINGS.find(b=>b.sourceId==='108')!.z).toBeLessThan(-500);
    expect(ARIZONA_BUILDINGS.some(b=>b.sourceId==='70')).toBe(false);
  });

  it('preserves disconnected ENR2 room wings and a clear canyon',()=>{
    const parts=ARIZONA_BUILDINGS.filter(b=>b.sourceId==='137');
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts[0].complexFootprints).toHaveLength(parts.length);
    const points=parts.flatMap(b=>b.footprint),x=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,z=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
    expect(arizonaNavigationBlocked(x,z)).toBe(false);
    expect(ARIZONA_BUILDINGS.some(b=>b.kind==='garage')).toBe(true);
    expect(ARIZONA_BUILDINGS.some(b=>b.kind==='arena')).toBe(true);
    expect(ARIZONA_SURFACES.some(s=>s.kind==='grass')).toBe(true);
  });

  it('places all arrivals outside footprints and on visible ground',()=>{
    expect(ARIZONA_LAYOUT.points).toHaveLength(9);
    for(const point of ARIZONA_LAYOUT.points){
      expect(arizonaNavigationBlocked(...point.position),point.id).toBe(false);
      expect(Number.isFinite(arizonaElevation(...point.position))).toBe(true);
      expect(ARIZONA_SURFACES.some(s=>arizonaPointInside(point.position,s.points)&&!(s.holes??[]).some(h=>arizonaPointInside(point.position,h))),point.id).toBe(true);
    }
  });

  it('routes all discovery pairs through open connected space in both directions',()=>{
    for(const a of ARIZONA_LAYOUT.points)for(const b of ARIZONA_LAYOUT.points){
      const guide=guideCampusPaths(ARIZONA_LAYOUT,a.position,b.position);
      expect(Number.isFinite(guide.distance),`${a.id} -> ${b.id}`).toBe(true);
      expect(guide.distance).toBeGreaterThanOrEqual(Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1])-.01);
    }
    for(const path of ARIZONA_PATHS)for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1]));
      let lastHeight=arizonaElevation(...a);
      for(let step=0;step<=n;step++){
        const p:WorldPoint=[a[0]+(b[0]-a[0])*step/n,a[1]+(b[1]-a[1])*step/n],height=arizonaElevation(...p);
        expect(arizonaNavigationBlocked(...p),`route at ${p}`).toBe(false);
        expect(Math.abs(height-lastHeight)).toBeLessThan(.45);lastHeight=height;
        const old=ARIZONA_BUILDINGS.find(building=>building.sourceId==='21')!;
        expect(Math.min(...old.footprint.map((q,j)=>distance(p,q,old.footprint[(j+1)%old.footprint.length])))).toBeGreaterThan(10.8);
      }
    }
  });
});
