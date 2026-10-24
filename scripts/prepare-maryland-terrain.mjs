import fs from 'node:fs';

// Public bare-earth LiDAR, never building/roof elevations. The client uses the
// same stretched coordinate frame as prepare-maryland-full-layout.mjs.
const service='https://mdgeodata.md.gov/lidar/rest/services/PrinceGeorges/MD_princegeorges_dem_m/ImageServer';
const output='assets-source/maryland';
const round=v=>Math.round(v*1000)/1000;
async function read(url,params){
  for(let attempt=0;attempt<3;attempt++){
    try{const res=await fetch(url,{method:params?'POST':'GET',body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(90000)});if(!res.ok)throw new Error(`${res.status} ${url}`);const json=await res.json();if(json.error)throw new Error(JSON.stringify(json.error));return json;}catch(error){if(attempt===2)throw error;}
  }
}
const source=JSON.parse(fs.readFileSync(`${output}/umd-official-buildings.geojson`,'utf8').replace(/^\uFEFF/,''));
const rings=f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates.map(p=>p[0]):[f.geometry.coordinates[0]];
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0)/2);
const center=p=>[(Math.min(...p.map(p=>p[0]))+Math.max(...p.map(p=>p[0])))/2,(Math.min(...p.map(p=>p[1]))+Math.max(...p.map(p=>p[1])))/2];
const buildingCenter=id=>center(rings(source.features.find(f=>f.properties.BUILDINGID===id)).sort((a,b)=>area(b)-area(a))[0]);
const lib=buildingCenter('035'),admin=buildingCenter('077');
const mx=86300,mz=111300,dx=(admin[0]-lib[0])*mx,dz=-(admin[1]-lib[1])*mz,len=Math.hypot(dx,dz),cos=dx/len,sin=dz/len,scale=320/len;
const inverse=(x,z)=>{const a=(x/1.65+160)/scale,b=z/1.7/scale;return[lib[0]+(a*cos-b*sin)/mx,lib[1]-(a*sin+b*cos)/mz];};
const grid={minX:-1400,minZ:-1800,step:25,columns:105,rows:107};
const points=[];
for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++)points.push(inverse(grid.minX+col*grid.step,grid.minZ+row*grid.step));
const anchors=['035','077','163','179','052','068','039','360'].map(id=>({buildingId:id,coordinates:buildingCenter(id)}));
points.push(...anchors.map(a=>a.coordinates));
console.log(`Sampling ${points.length} ground heights from Maryland iMAP...`);
const metadata=await read(service+'?f=json');
fs.writeFileSync(`${output}/umd-dem-service.json`,JSON.stringify(metadata,null,2)+'\n');
const chunks=Array.from({length:Math.ceil(points.length/800)},(_,i)=>({start:i*800,points:points.slice(i*800,(i+1)*800)}));
const values=new Array(points.length);let next=0;
await Promise.all(Array.from({length:3},async()=>{
  while(next<chunks.length){const chunk=chunks[next++];const result=await read(service+'/getSamples',{f:'json',geometryType:'esriGeometryMultipoint',geometry:JSON.stringify({points:chunk.points,spatialReference:{wkid:4326}}),returnFirstValueOnly:'true',interpolation:'RSP_BilinearInterpolation'});
    if(result.samples?.length!==chunk.points.length)throw new Error(`Expected ${chunk.points.length} samples, got ${result.samples?.length}`);
    result.samples.forEach((s,i)=>{const value=Number(s.value);if(!Number.isFinite(value)||value<-100||value>300)throw new Error(`Invalid elevation ${s.value}`);values[chunk.start+i]=round(value);});
    console.log(`Sampled ${chunk.start+chunk.points.length}/${points.length}`);
  }
}));
anchors.forEach((a,i)=>a.elevationMeters=values[grid.rows*grid.columns+i]);
// ArcGIS carries the native feet vertical-CRS metadata even on the _dem_m
// output service. Its companion feet getSamples endpoint returns the same raw
// pixels, so verify with an independent USGS metres query, not the suffix.
const verificationSource=`https://epqs.nationalmap.gov/v1/json?x=${lib[0]}&y=${lib[1]}&units=Meters&includeDate=false`;
const reference=await read(verificationSource),usgsMeters=Number(reference.value),meters=anchors[0].elevationMeters;
if(!Number.isFinite(usgsMeters)||Math.abs(usgsMeters-meters)>3)throw new Error(`Unexpected service units: ${meters} iMAP / ${usgsMeters} USGS metres`);
const unitVerification={meters,usgsMeters,verificationSource};
const data={source:service,retrievedAt:new Date().toISOString(),units:'meters NAVD88',unitVerification,grid,transform:{library:lib,administration:admin,mx,mz,cos,sin,scale,stretchX:1.65,stretchZ:1.7},anchors,values:values.slice(0,grid.rows*grid.columns)};
fs.writeFileSync(`${output}/umd-terrain-samples.json`,JSON.stringify(data)+'\n');
fs.writeFileSync('src/features/world/maryland-terrain-data.ts',`// Generated from public Maryland iMAP bare-earth LiDAR. See scripts/prepare-maryland-terrain.mjs.\nexport const UMD_TERRAIN_DATA=${JSON.stringify(data)};\n`);
console.log(JSON.stringify({grid,minimum:Math.min(...data.values),maximum:Math.max(...data.values),anchors},null,2));
