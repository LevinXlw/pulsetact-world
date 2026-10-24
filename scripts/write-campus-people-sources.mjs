import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const directory=new URL('../public/assets/people/',import.meta.url);
const titles={nathan:'Nathan Animated 003 — Walking',sophia:'Sophia Animated 003 — Idling'};
const ids={nathan:'143a2b1ea5eb4385ae90a73657aca3bc',sophia:'dc448c3be0e74f96a55fb475a13433cf'};
const models=JSON.parse(await readFile(new URL('models.json',directory),'utf8')).models;
const assets=[];
for(const model of models){
 const buffer=await readFile(new URL(model.file,directory));
 assets.push({file:model.file,title:titles[model.id],author:'Renderpeople GmbH',bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),
  acquiredFrom:'https://renderpeople.com/sample/free/renderpeople_free_animated_people_FBX.zip',
  sourcePage:'https://renderpeople.com/free-3d-people/',acquiredAt:'2026-10-05',
  license:'Renderpeople website terms — local evaluation; public redistribution not cleared',
  licenseUrl:'https://renderpeople.com/general-terms-and-conditions/',
  alternateAuthorListing:{url:`https://sketchfab.com/models/${ids[model.id]}`,publicMetadataLicense:'CC BY 4.0',note:'A separate publication of the same named model. This build was obtained from the vendor website, not this download channel.'},
  modifications:['Converted FBX to GLB with Blender 4.5 LTS','Diffuse and normal maps resized to 2048px; gloss converted to 1024px roughness','Bind frame excluded; horizontal root motion removed; loop endpoint matched; feet aligned to ground',...(model.id==='nathan'?['Derived a neutral standing pose with subtle breathing from the walking motion']:[])],
  triangles:model.triangles,clips:model.exportedClips
 });
}
await writeFile(new URL('sources.json',directory),JSON.stringify({scope:'Local MIT campus evaluation. Not published or offered as standalone asset downloads.',assets},null,2)+'\n');
console.log('Wrote verified people provenance for',assets.length,'models');
