import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output='public/data/killian';await mkdir(output,{recursive:true});
const records=[];
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`${r.status}: ${url}`);return r;}
for(const id of ['leafy_grass','concrete_wall_001','concrete_pavement']){
 const index=await (await get(`https://api.polyhaven.com/files/${id}`)).json();
 for(const [key,label] of [['diff','color'],['nor_gl','normal'],['rough','roughness']]){
  const actual=Object.keys(index).find(k=>k.toLowerCase()===key||(key==='diff'&&k.toLowerCase()==='diffuse'));const variants=index[actual]?.['1k'];if(!variants)continue;
  const item=variants.jpg||variants.png;if(!item)continue;
  const bytes=Buffer.from(await (await get(item.url)).arrayBuffer()),ext=variants.jpg?'jpg':'png',file=`${id}-${label}.${ext}`;
  await writeFile(`${output}/${file}`,bytes);records.push({file,url:item.url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),license:'CC0',source:`https://polyhaven.com/a/${id}`});console.log(file,bytes.length);
 }
}
await mkdir('assets-source/killian-reference',{recursive:true});
const url='https://web.mit.edu/lucha/www/img/killiancourt.jpg';
const photo=Buffer.from(await (await get(url)).arrayBuffer());await writeFile('assets-source/killian-reference/killiancourt.jpg',photo);
await writeFile(`${output}/sources.json`,JSON.stringify({assets:records,reference:{url,usage:'Visual reference only, not used as a runtime texture'},geometryReference:'https://listart.mit.edu/art-artists/maclaurin-buildings-1913',notes:'Facade layout approximated from images; original GIS building coordinates retained. Tripo not used.'},null,2));
