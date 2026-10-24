import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';

// Reproducible point samples, in the project's exact Massachusetts Lambert
// coordinate frame. A service pixel size is not a claim about survey accuracy.
const source='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const directory='assets-source/charles-bu/terrain';
const grid={minX:-1668,minZ:744,step:6,columns:177,rows:77};
const module=ts.transpile(await readFile('src/features/world/geo-coordinates.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const {geoToWorld}=await import('data:text/javascript;base64,'+Buffer.from(module).toString('base64'));
function inverse(x,z){
  let lat=42.35915-z/111111,lon=-71.09205+x/82300;
  for(let i=0;i<5;i++){
    const a=geoToWorld(lat,lon),b=geoToWorld(lat+1e-5,lon),c=geoToWorld(lat,lon+1e-5);
    const j00=(b[0]-a[0])/1e-5,j10=(b[1]-a[1])/1e-5,j01=(c[0]-a[0])/1e-5,j11=(c[1]-a[1])/1e-5,det=j00*j11-j01*j10;
    lat+=((x-a[0])*j11-(z-a[1])*j01)/det;lon+=(j00*(z-a[1])-j10*(x-a[0]))/det;
  }
  const check=geoToWorld(lat,lon);if(Math.hypot(check[0]-x,check[1]-z)>.001)throw new Error('Projection round-trip failed');
  return [lon,lat];
}
await mkdir(directory,{recursive:true});
async function request(operation,params){
  for(let attempt=0;attempt<3;attempt++)try{
    const response=await fetch(source+operation,{method:'POST',body:new URLSearchParams({f:'json',...params}),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error('USGS HTTP '+response.status);
    const data=await response.json();if(data.error)throw new Error(JSON.stringify(data.error));return data;
  }catch(error){if(attempt===2)throw error;}
}
let data;
if(process.argv.includes('--download')){
  const points=[];for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++)points.push(inverse(grid.minX+col*grid.step,grid.minZ+row*grid.step));
  const geometry={points,spatialReference:{wkid:4326}};
  const catalogue=await request('/query',{geometry:JSON.stringify({x:inverse(-1200,960)[0],y:inverse(-1200,960)[1],spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,Name,ProductName,Source,VerticalDatum,AcquisitionDate,URL,Metadata,Resolution_X,Resolution_Y,Best',returnGeometry:'false'});
  await writeFile(directory+'/catalogue.json',JSON.stringify(catalogue,null,2));
  const values=new Array(points.length),rasterIds=new Set(),batches=Array.from({length:Math.ceil(points.length/400)},(_,i)=>({start:i*400,points:points.slice(i*400,(i+1)*400)}));
  let next=0,completed=0;
  await Promise.all(Array.from({length:3},async()=>{
    while(next<batches.length){
      const batch=batches[next++],samples=await request('/getSamples',{geometry:JSON.stringify({...geometry,points:batch.points}),geometryType:'esriGeometryMultipoint',returnFirstValueOnly:'true',interpolation:'RSP_BilinearInterpolation',outFields:'Name,VerticalDatum,Resolution_X,Resolution_Y',pixelSize:JSON.stringify({x:1,y:1,spatialReference:{wkid:3857}})});
      if(samples.samples?.length!==batch.points.length)throw new Error('Incomplete DEM samples at '+batch.start);
      await writeFile(directory+'/samples-'+batch.start+'.json',JSON.stringify(samples));
      samples.samples.forEach((sample,i)=>{
        const value=Number(sample.value);if(!Number.isFinite(value)||value< -3||value>30)throw new Error('Invalid BU ground height: '+sample.value);
        const location=sample.location,expected=batch.points[i];
        if(location&&Math.hypot(location.x-expected[0],location.y-expected[1])>1e-6)throw new Error('DEM sample order mismatch');
        values[batch.start+i]=Math.round(value*1000)/1000;rasterIds.add(sample.rasterId);
      });
      console.log('Downloaded terrain batch '+(++completed)+'/'+batches.length);
    }
  }));
  data={source,retrievedAt:new Date().toISOString(),units:'metres',grid,values,rasterIds:[...rasterIds],coordinateFrame:'geo-coordinates.ts GRS80 Lambert, east/up/south; geographic origin 42.35915,-71.09205',interpolation:'Bilinear samples from raw bare-earth DEM, no rendering rule / height exaggeration',notes:['6 m sample spacing; runtime terrain uses a coarser shared lattice.','Bare earth does not contain bridge decks, stair treads or building floor elevations.','Source catalogue is saved separately; retrieval date is not acquisition date.']};
  await writeFile(directory+'/terrain-samples.json',JSON.stringify(data));
}else data=JSON.parse(await readFile(directory+'/terrain-samples.json','utf8'));
const catalogue=JSON.parse(await readFile(directory+'/catalogue.json','utf8'));
data.datasets=catalogue.features.map(f=>f.attributes).filter(a=>data.rasterIds.includes(a.OBJECTID)).map(a=>({id:a.OBJECTID,name:a.Name,verticalDatum:a.VerticalDatum,url:a.URL}));
if(data.datasets.length!==data.rasterIds.length)throw new Error('Source provenance incomplete');
data.notes=data.notes.filter(note=>!note.startsWith('The sampled source'));
data.notes.push('The sampled source is the 2013 MA_NE_CMGP_Sandy_Z19 project; these are not 2026 survey observations. Subsequent earthworks require separate checks.');
await writeFile(directory+'/terrain-samples.json',JSON.stringify(data));
await writeFile('src/features/world/bu-terrain-data.ts','// USGS 3DEP bare-earth point samples. Rebuild: node scripts/prepare-bu-terrain.mjs\nexport const BU_TERRAIN_DATA='+JSON.stringify(data)+';\n');
console.log(JSON.stringify({samples:data.values.length,min:Math.min(...data.values),max:Math.max(...data.values),rasterIds:data.rasterIds}));
