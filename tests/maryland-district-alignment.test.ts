import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';
import {UMD_ROAD_SURFACES} from '../src/features/world/maryland-road-layout';
type Point=readonly [number,number];
const source=JSON.parse(readFileSync('assets-source/maryland/umd-official-buildings.geojson','utf8').replace(/^\uFEFF/,'')) as {features:{properties:{BUILDINGID:string};geometry:{type:string;coordinates:number[][][]|number[][][][]}}[]};
const area=(p:readonly Point[])=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1]},0)/2);
const rings=(f:typeof source.features[number])=>(f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates]) as unknown as Point[][][];
const outer=(f:typeof source.features[number])=>rings(f).sort((a,b)=>area(b[0])-area(a[0]))[0];
const center=(p:Point[])=>[(Math.min(...p.map(p=>p[0]))+Math.max(...p.map(p=>p[0])))/2,(Math.min(...p.map(p=>p[1]))+Math.max(...p.map(p=>p[1])))/2];
const library=center(outer(source.features.find(f=>f.properties.BUILDINGID==='035')!)[0]);
const admin=center(outer(source.features.find(f=>f.properties.BUILDINGID==='077')!)[0]);
const dx=(admin[0]-library[0])*86300,dz=-(admin[1]-library[1])*111300,length=Math.hypot(dx,dz),c=dx/length,s=dz/length,scale=320/length;
const convert=(p:Point):Point=>{const x=(p[0]-library[0])*86300,z=-(p[1]-library[1])*111300;return [(-160+(x*c+z*s)*scale)*1.65,(-x*s+z*c)*scale*1.7]};
const distance=(p:Point,a:Point,b:Point)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)};
const border=(p:Point,ring:readonly Point[])=>Math.min(...ring.map((a,i)=>distance(p,a,ring[(i+1)%ring.length])));
const inside=(p:Point,ring:readonly Point[])=>{let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result}return result};
describe('UMD business and engineering district geography',()=>{
 it('uses the road and DEM transform for every GIS vertex without independent spacing or relocation',()=>{
  const buildings=UMD_FULL_BUILDINGS.filter(b=>b.surveyAligned&&source.features.some(f=>f.properties.BUILDINGID===b.sourceBuildingId));
  expect(buildings).toHaveLength(17);
  for(const b of buildings){
   const geographic=outer(source.features.find(f=>f.properties.BUILDINGID===b.sourceBuildingId)!);
   const actual=[b.footprint,...b.holes??[]];expect(actual.length,b.name).toBe(geographic.length);
   geographic.forEach((ring,i)=>{const converted=ring.map(convert);expect(area(actual[i])/area(converted),b.name).toBeCloseTo(1,2);for(const point of converted)expect(border(point,actual[i]),b.name).toBeLessThan(.35)});
   expect(b.layoutOffset).toEqual([0,0]);
  }
 });
 it('keeps pavement out of the corrected buildings while retaining their open courts',()=>{
  let checked=0;
  for(const b of UMD_FULL_BUILDINGS.filter(b=>b.surveyAligned)){
   const xs=b.footprint.map(p=>p[0]),zs=b.footprint.map(p=>p[1]);
   for(const surface of UMD_ROAD_SURFACES){
    const p:Point=[surface.polygon.reduce((sum,q)=>sum+q[0],0)/surface.polygon.length,surface.polygon.reduce((sum,q)=>sum+q[1],0)/surface.polygon.length];
    if(p[0]<Math.min(...xs)||p[0]>Math.max(...xs)||p[1]<Math.min(...zs)||p[1]>Math.max(...zs))continue;
    checked++;
    expect(inside(p,b.footprint)&&!(b.holes??[]).some(h=>inside(p,h))&&border(p,b.footprint)>.035,`${surface.id} inside ${b.name}`).toBe(false);
   }
  }
  expect(checked).toBeGreaterThan(10);
 });
});
