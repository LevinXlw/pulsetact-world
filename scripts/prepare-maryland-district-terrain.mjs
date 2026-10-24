import fs from 'node:fs';

// Local 6.25-world-metre samples of the same 2020/2021 public bare-earth DEM
// used by the whole-campus grid. The geographic transform and NAVD88 datum
// intentionally remain identical to prepare-maryland-terrain.mjs.
const original=JSON.parse(fs.readFileSync('assets-source/maryland/umd-terrain-samples.json','utf8'));
const {source,transform,units,unitVerification}=original;
const {library,mx,mz,cos,sin,scale,stretchX,stretchZ}=transform;
const inverse=(x,z)=>{const a=(x/stretchX+160)/scale,b=z/stretchZ/scale;return[library[0]+(a*cos-b*sin)/mx,library[1]-(a*sin+b*cos)/mz];};
const districts=[
  {id:'business',name:'Van Munching / Mowatt Lane',grid:{minX:-700,minZ:225,step:6.25,columns:77,rows:69}},
  {id:'engineering',name:'Clark School / Paint Branch Drive',grid:{minX:150,minZ:-1050,step:6.25,columns:113,rows:129}},
];
const points=[];
for(const district of districts){
  district.start=points.length;
  const {grid}=district;
  for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++)points.push(inverse(grid.minX+col*grid.step,grid.minZ+row*grid.step));
}
async function read(params){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(source+'/getSamples',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(90000)});
      if(!response.ok)throw new Error(`DEM service HTTP ${response.status}`);
      const result=await response.json();if(result.error)throw new Error(JSON.stringify(result.error));return result;
    }catch(error){if(attempt===2)throw error;}
  }
}
const values=new Array(points.length),chunks=Array.from({length:Math.ceil(points.length/750)},(_,i)=>({start:i*750,points:points.slice(i*750,(i+1)*750)}));
let next=0;
console.log(`Sampling ${points.length} bare-earth points in two UMD districts...`);
await Promise.all(Array.from({length:3},async()=>{
  while(next<chunks.length){
    const chunk=chunks[next++],result=await read({f:'json',geometryType:'esriGeometryMultipoint',geometry:JSON.stringify({points:chunk.points,spatialReference:{wkid:4326}}),returnFirstValueOnly:'true',interpolation:'RSP_BilinearInterpolation'});
    if(result.samples?.length!==chunk.points.length)throw new Error(`Incomplete sample batch at ${chunk.start}`);
    result.samples.forEach((sample,i)=>{const elevation=Number(sample.value);if(!Number.isFinite(elevation)||elevation<0||elevation>100)throw new Error(`Invalid DEM value ${sample.value}`);values[chunk.start+i]=Math.round(elevation*1000)/1000;});
    console.log(`Sampled ${chunk.start+chunk.points.length}/${points.length}`);
  }
}));
const data={source,retrievedAt:new Date().toISOString(),survey:'2020–2021 Prince George’s County bare-earth LiDAR',units,unitVerification,transform,districts:districts.map(({start,...district})=>({...district,values:values.slice(start,start+district.grid.rows*district.grid.columns)}))};
fs.writeFileSync('assets-source/maryland/umd-district-terrain-samples.json',JSON.stringify(data)+'\n');
fs.writeFileSync('src/features/world/maryland-district-terrain-data.ts',`// Public Maryland iMAP bare-earth DEM. Rebuild: node scripts/prepare-maryland-district-terrain.mjs.\nexport const UMD_DISTRICT_TERRAIN_DATA=${JSON.stringify(data)};\n`);
console.log(JSON.stringify(data.districts.map(d=>({id:d.id,samples:d.values.length,min:Math.min(...d.values),max:Math.max(...d.values)})),null,2));
