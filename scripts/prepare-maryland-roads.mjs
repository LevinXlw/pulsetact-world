import fs from 'node:fs';
import {ShapeUtils,Vector2} from 'three';

// Public UMD Facilities pavement polygons, transformed into the same authored
// coordinate frame as prepare-maryland-full-layout.mjs. No inferred road grid.
const source=JSON.parse(fs.readFileSync('assets-source/maryland/umd-official-roads.geojson','utf8').replace(/^\uFEFF/,''));
const parking=JSON.parse(fs.readFileSync('assets-source/maryland/umd-official-parking.geojson','utf8').replace(/^\uFEFF/,''));
// The dedicated parking layer is the authoritative parking surface. Do not draw
// occasional duplicate parking polygons also carried by the road layer twice.
source.features=source.features.filter(f=>f.properties.SURFUSE!=='Parking Lot').concat(parking.features);
const buildingsSource=JSON.parse(fs.readFileSync('assets-source/maryland/umd-official-buildings.geojson','utf8').replace(/^\uFEFF/,''));
const layout=fs.readFileSync('src/features/world/maryland-full-layout.ts','utf8');
const buildings=JSON.parse(layout.match(/UMD_FULL_BUILDINGS:UMDFullBuilding\[\]=(\[[\s\S]+?\]);/)[1]);
const spaces=JSON.parse(layout.match(/UMD_FULL_SPACES=(\[[\s\S]+?\]);/)[1]);
const bounds=JSON.parse(layout.match(/UMD_FULL_BOUNDS=(\{.+?\});/)[1]);
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0)/2);
const rings=f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates.map(p=>p[0]):[f.geometry.coordinates[0]];
const largest=f=>rings(f).sort((a,b)=>area(b)-area(a))[0];
const center=p=>[(Math.min(...p.map(p=>p[0]))+Math.max(...p.map(p=>p[0])))/2,(Math.min(...p.map(p=>p[1]))+Math.max(...p.map(p=>p[1])))/2];
const lib=center(largest(buildingsSource.features.find(f=>f.properties.BUILDINGID==='035'))),admin=center(largest(buildingsSource.features.find(f=>f.properties.BUILDINGID==='077')));
const mx=86300,mz=111300,dx=(admin[0]-lib[0])*mx,dz=-(admin[1]-lib[1])*mz,len=Math.hypot(dx,dz),cos=dx/len,sin=dz/len,scale=320/len;
const convert=p=>{const x=(p[0]-lib[0])*mx,z=-(p[1]-lib[1])*mz;return[(-160+(x*cos+z*sin)*scale)*1.65,(-x*sin+z*cos)*scale*1.7]};
const round=v=>Math.round(v*100)/100;
const rpoint=p=>p.map(round);
const bbox=p=>({minX:Math.min(...p.map(a=>a[0])),maxX:Math.max(...p.map(a=>a[0])),minZ:Math.min(...p.map(a=>a[1])),maxZ:Math.max(...p.map(a=>a[1]))});
const overlaps=(a,b)=>a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ;
function box(b,pad=3){const c=Math.abs(Math.cos(b.yaw)),s=Math.abs(Math.sin(b.yaw)),w=b.width*c+b.depth*s,d=b.width*s+b.depth*c;return{minX:b.x-w/2-pad,maxX:b.x+w/2+pad,minZ:b.z-d/2-pad,maxZ:b.z+d/2+pad}}
const exclusions=[
 {minX:-295,maxX:295,minZ:-170,maxZ:170},
 {minX:-245,maxX:-125,minZ:-280,maxZ:-175},
 {minX:-20,maxX:155,minZ:175,maxZ:280},
 ...buildings.filter(b=>!b.surveyAligned).map(b=>box(b,3.5)),
 ...spaces.map(s=>box(s,1.5)),
];
// Corrected districts share the pavement frame. Clip their actual concave
// rooflines, not the bounding rectangle: keep the courts and gaps between wings.
const roofTriangles=buildings.filter(b=>b.surveyAligned).flatMap(b=>{
 const rings=[b.footprint,...(b.holes??[])],points=rings.flat();
 return ShapeUtils.triangulateShape(rings[0].map(p=>new Vector2(...p)),rings.slice(1).map(r=>r.map(p=>new Vector2(...p)))).map(t=>{
  const polygon=t.map(i=>points[i]);return {polygon,bounds:bbox(polygon)};
 });
});
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)};
const rdp=(path,tol)=>{let far=0,index=0;for(let i=1;i<path.length-1;i++){const d=distance(path[i],path[0],path.at(-1));if(d>far){far=d;index=i}}if(far<=tol)return[path[0],path.at(-1)];return rdp(path.slice(0,index+1),tol).slice(0,-1).concat(rdp(path.slice(index),tol))};
function simplify(p,tol=.4){
 const q=p.slice();if(Math.hypot(q[0][0]-q.at(-1)[0],q[0][1]-q.at(-1)[1])<.01)q.pop();if(q.length<=4)return q;
 let far=1;for(let i=2;i<q.length;i++)if(Math.hypot(q[i][0]-q[0][0],q[i][1]-q[0][1])>Math.hypot(q[far][0]-q[0][0],q[far][1]-q[0][1]))far=i;
 const out=rdp(q.slice(0,far+1),tol).slice(0,-1).concat(rdp(q.slice(far).concat([q[0]]),tol).slice(0,-1));
 return out.length<3||Math.abs(area(out)/area(q)-1)>.05?q:out;
}
// Sutherland-Hodgman clipping against one axis-aligned half-plane. Subtracting
// a rectangle emits disjoint outside fragments and discards its inside part.
function half(poly,axis,value,greater){
 const out=[],inside=p=>greater?p[axis]>=value-1e-8:p[axis]<=value+1e-8;
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],ia=inside(a),ib=inside(b);
  if(ia)out.push(a);
  if(ia!==ib){const t=(value-a[axis])/(b[axis]-a[axis]);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
 }return out;
}
function subtract(poly,r){
 if(!overlaps(bbox(poly),r))return[poly];
 const out=[];let inside=poly;
 for(const [axis,value,greater]of [[0,r.minX,true],[0,r.maxX,false],[1,r.minZ,true],[1,r.maxZ,false]]){
  const p=half(inside,axis,value,!greater);if(p.length>=3&&area(p)>.05)out.push(p);
  inside=half(inside,axis,value,greater);if(inside.length<3)return out;
 }return out;
}
function subtractTriangle(poly,triangle){
 if(!overlaps(bbox(poly),triangle.bounds))return [poly];
 const ring=triangle.polygon,orientation=Math.sign((ring[1][0]-ring[0][0])*(ring[2][1]-ring[0][1])-(ring[1][1]-ring[0][1])*(ring[2][0]-ring[0][0]));
 const out=[];let inside=poly;
 for(let i=0;i<3;i++){
  const a=ring[i],b=ring[(i+1)%3],side=p=>orientation*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  const split=positive=>{const result=[];for(let j=0;j<inside.length;j++){
   const p=inside[j],q=inside[(j+1)%inside.length],sp=side(p),sq=side(q),ip=positive?sp>=0:sp<=0,iq=positive?sq>=0:sq<=0;
   if(ip)result.push(p);if(ip!==iq){const t=sp/(sp-sq);result.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t])}
  }return result};
  const outside=split(false),next=split(true);if(outside.length>=3&&area(outside)>.05)out.push(outside);inside=next;if(inside.length<3)return out;
 }return out;
}
const surfaces=[],stats={sourceFeatures:source.features.length,inCampusFeatures:0,sourceTriangles:0,fragments:0,areaByKind:{}};
for(const feature of source.features){
 const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];let contributed=false;
 for(const raw of polygons){
  const contours=raw.map(r=>simplify(r.map(convert))),outer=contours[0];if(outer.length<3||!overlaps(bbox(outer),bounds))continue;
  const localExclusions=exclusions.filter(o=>overlaps(bbox(outer),o));
  const localRoofs=roofTriangles.filter(t=>overlaps(bbox(outer),t.bounds));
  const points=contours.flat(),triangles=ShapeUtils.triangulateShape(outer.map(p=>new Vector2(...p)),contours.slice(1).map(r=>r.map(p=>new Vector2(...p))));
  stats.sourceTriangles+=triangles.length;
  for(const triangle of triangles){
   let clipped=triangle.map(i=>points[i]);
   for(const [axis,value,greater]of [[0,bounds.minX,true],[0,bounds.maxX,false],[1,bounds.minZ,true],[1,bounds.maxZ,false]])clipped=half(clipped,axis,value,greater);
   if(clipped.length<3)continue;let fragments=[clipped];
   for(const excluded of localExclusions)fragments=fragments.flatMap(p=>subtract(p,excluded));
   for(const roof of localRoofs)fragments=fragments.flatMap(p=>subtractTriangle(p,roof));
   for(const polygon of fragments){
    const a=area(polygon);if(a<.4)continue;
    const kind=feature.properties.SURFUSE==='Parking Lot'?'parking':feature.properties.SURFUSE==='Service Area'?'service':feature.properties.SURFUSE==='Crosswalk'?'crosswalk':'road';
    const material=feature.properties.SURFTYPE==='Concrete'?'concrete':feature.properties.SURFTYPE==='Brickpaver'?'brick':'asphalt';
    const p=polygon.map(rpoint).filter((p,i,arr)=>i===0||Math.hypot(p[0]-arr[i-1][0],p[1]-arr[i-1][1])>.01);if(p.length<3||area(p)<.3)continue;
    surfaces.push({id:`umd-road-${feature.properties.OBJECTID}-${surfaces.length}`,kind,material,polygon:p});
    stats.areaByKind[kind]=(stats.areaByKind[kind]??0)+a;contributed=true;
   }
  }
 }if(contributed)stats.inCampusFeatures++;
}
stats.fragments=surfaces.length;for(const k in stats.areaByKind)stats.areaByKind[k]=Math.round(stats.areaByKind[k]);
// Validate emitted fragments, including all edges, against exclusions. A tiny
// rounding allowance avoids treating a shared clipping boundary as an overlap.
for(const s of surfaces){
 for(const p of s.polygon)if(p[0]<bounds.minX-.01||p[0]>bounds.maxX+.01||p[1]<bounds.minZ-.01||p[1]>bounds.maxZ+.01)throw new Error('Road outside campus bounds');
 const centroid=[s.polygon.reduce((n,p)=>n+p[0],0)/s.polygon.length,s.polygon.reduce((n,p)=>n+p[1],0)/s.polygon.length];
 for(const r of exclusions)if(centroid[0]>r.minX+.02&&centroid[0]<r.maxX-.02&&centroid[1]>r.minZ+.02&&centroid[1]<r.maxZ-.02)throw new Error('Road intersects excluded building/core/field');
}
const module=`import type {WorldPoint} from './charles-geography';\n\n/** UMD Facilities pavement topology via Maryland iMAP; game-space adaptation.\n * Triangulated fragments preserve holes and exclude modeled buildings/fields.\n * Rebuild: node scripts/prepare-maryland-roads.mjs. */\nexport type UMDRoadSurface={id:string;kind:'road'|'parking'|'service'|'crosswalk';material:'asphalt'|'concrete'|'brick';polygon:WorldPoint[]};\n// Data is parsed rather than inferred as ten thousand heterogeneous TS tuples.\nexport const UMD_ROAD_SURFACES:UMDRoadSurface[]=JSON.parse(${JSON.stringify(JSON.stringify(surfaces))});\nexport const UMD_ROAD_STATS=${JSON.stringify(stats)};\n`;
fs.writeFileSync('src/features/world/maryland-road-layout.ts',module);
fs.writeFileSync('assets-source/maryland/road-references.json',JSON.stringify({retrieved:'2026-10-15',sources:[{url:'https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/0',title:'UMD Roads',credit:'Maryland iMAP, University of Maryland Facilities Management',geometry:'Public pavement polygons, including streets, parking access, service areas, traffic circles and crosswalks.'},{url:'https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/1',title:'UMD Parking Lots',credit:'Maryland iMAP, University of Maryland College Park Facilities Planning, 2013',geometry:'Paved parking surfaces from Facilities Planning and Department of Transportation Services.'}],adaptation:'Same east/south frame and expanded centroid spacing as the full-campus layout. Retains source road topology; clipped to the playable bounds, legacy Mall landscaping, modeled building clearances and authored sports/open spaces. Ground markings and current construction closures are not represented.',statistics:stats},null,2));
console.log(JSON.stringify(stats));
