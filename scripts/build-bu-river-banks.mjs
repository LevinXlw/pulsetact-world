import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try {
  const {geoToWorld}=await vite.ssrLoadModule('/src/features/world/charles-geography.ts');
  const raw=JSON.parse(await readFile('assets-source/charles-bu/massgis-hydrography.json','utf8'));
  const ring=raw.features.find(f=>f.attributes.OBJECTID===15812).geometry.rings[0];
  const convert=points=>points.map(([lon,lat])=>geoToWorld(lat,lon).map(v=>+v.toFixed(3)));
  const clipTop=points=>{while(points.length>1&&points[1][1]<-250)points.shift();if(points[0][1]<-250){const [a,b]=points,t=(-250-a[1])/(b[1]-a[1]);points[0]=[+(a[0]+t*(b[0]-a[0])).toFixed(3),-250];}return points;};
  const north=clipTop(convert(ring.slice(190,214))),south=clipTop(convert(ring.slice(217,242).reverse()));
  await writeFile('src/features/world/bu-river-banks.ts',`// Generated from MassGIS/MassDEP 1:25,000 hydrography, Charles River polygon 15812.\n// Western extension only; the existing MIT/Harvard Bridge approach stays fitted to its terrain.\nimport type {WorldPoint} from './charles-geography';\nexport const BU_WEST_NORTH_BANK:WorldPoint[]=${JSON.stringify(north)};\nexport const BU_WEST_SOUTH_BANK:WorldPoint[]=${JSON.stringify(south)};\n`);
  console.log({north:north.length,south:south.length,start:[north[0],south[0]],end:[north.at(-1),south.at(-1)]});
}finally{await vite.close();}
