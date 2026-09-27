import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='assets-source/killian-reference';await mkdir(root,{recursive:true});
const images=[['maclaurin-wide.webp','37840250335_62c42e3d1b_o.jpg.webp?itok=QNSOrbmL'],['maclaurin-front.webp','37840233395_92f2496114_o.jpg.webp?itok=DWsOpmV2'],['maclaurin-oblique.webp','7215716600_8f1dfc92f7_o.jpg.webp?itok=2Glw5sYE']];
const records=[];
for(const [file,path] of images){
 const url=`https://listart.mit.edu/sites/default/files/styles/colorbox_desktop/public/media/images/2022-09/${path}`;
 const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${r.status}: ${url}`);
 const bytes=Buffer.from(await r.arrayBuffer());await writeFile(`${root}/${file}`,bytes);
 records.push({file,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:'https://listart.mit.edu/art-artists/maclaurin-buildings-1913',use:'Local visual reference only; no runtime texture',captureDate:'unknown'});
}
await writeFile(`${root}/maclaurin-sources.json`,JSON.stringify(records,null,2));console.log(records.map(r=>({file:r.file,bytes:r.bytes})));
