import fs from 'node:fs/promises';
import sharp from 'sharp';
const data=JSON.parse(await fs.readFile('assets-source/arizona/building-footprints.geojson','utf8'));
for(const id of [21,108,137]){
 const feature=data.features.find(f=>Number(f.properties.SpaceNum)===id),polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];
 const all=polygons.flat(2),minLon=Math.min(...all.map(p=>p[0])),minLat=Math.min(...all.map(p=>p[1])),maxLat=Math.max(...all.map(p=>p[1]));
 const rings=polygons.map(poly=>poly.map(ring=>ring.map(p=>[(p[0]-minLon)*94180,(maxLat-p[1])*111320]))),points=rings.flat(2),width=Math.max(...points.map(p=>p[0])),depth=(maxLat-minLat)*111320,scale=650/Math.max(width,depth);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="760" viewBox="0 0 760 760"><rect width="760" height="760" fill="#f0e8d4"/><text x="25" y="25" font-family="sans-serif">${feature.properties.Name} / north up / official ground footprint</text>${rings.map((poly,i)=>`<path d="${poly.map(r=>r.map((p,j)=>`${j?'L':'M'}${40+p[0]*scale},${60+p[1]*scale}`).join(' ')+'Z').join(' ')}" stroke="#314b47" fill="${i%2?'#ae7656':'#9caf85'}" fill-rule="evenodd" stroke-width="1"/>`).join('')}</svg>`;
 await sharp(Buffer.from(svg)).png().toFile(`assets-source/arizona/landmark-footprint-${id}.png`);
}
