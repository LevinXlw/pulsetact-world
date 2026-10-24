import {mkdir,writeFile} from 'node:fs/promises';
const root='assets-source/maryland/engineering-references';
await mkdir(root,{recursive:true});
const sources={
 'engineering-map.png':'https://clarknet.eng.umd.edu/sites/default/files/images/egr-maps/map_0.png',
 'kim-aerial.jpg':'https://eng.umd.edu/sites/clark.umd.edu/files/fac_kim-topdown.jpg',
 'clark-exterior.jpg':'https://eng.umd.edu/sites/clark.umd.edu/files/internal-hero-images/1440x535_clarkhall01_1.jpg',
 'clark-plan.png':'https://clarknet.eng.umd.edu/sites/default/files/images/egr-maps/bldg429/clarkhall-1.png',
 'kim-plan.png':'https://clarknet.eng.umd.edu/sites/default/files/images/egr-maps/kim/keb-1-2017.png',
 'martin-plan.png':'https://clarknet.eng.umd.edu/sites/default/files/images/egr-maps/bldg088/firstfloor.png',
 'idea-plan.png':'https://clarknet.eng.umd.edu/sites/default/files/images/egr-maps/bldg228/idea-factory-2.png',
 'idea-exterior.jpg':'https://cdn.prod.website-files.com/6ab68d5e2db5d054067d314b/6ab6d7176fa83ac2328081ce_building-second-floor-terrace.jpg',
};
await Promise.all(Object.entries(sources).map(async([name,url])=>{const r=await fetch(url);if(!r.ok)throw new Error(`${r.status}: ${url}`);await writeFile(`${root}/${name}`,new Uint8Array(await r.arrayBuffer()));console.log(name);}));
await writeFile(`${root}/sources.json`,JSON.stringify({retrieved:'2026-10-15',purpose:'Reference only; no source photos or plans shipped to the game.',sources},null,2));
for(const id of ['088','225']){
 const page=`https://facilities.umd.edu/info-resources/building-inventory/bldg-${id}`;
 const html=await(await fetch(page)).text();
 const tags=[...html.matchAll(/<img[^>]+>/gi)].map(m=>m[0]);
 console.log(id,tags.filter(t=>!t.includes('logo')).join('\n'));
 const match=tags.find(t=>t.includes(`/bldg/`)||t.includes(`${id}.`)||t.includes(`-${id}`))?.match(/src="([^"]+)"/);
 if(match){const url=new URL(match[1],page);const r=await fetch(url);if(r.ok)await writeFile(`${root}/${id}-exterior.jpg`,new Uint8Array(await r.arrayBuffer()));}
}
