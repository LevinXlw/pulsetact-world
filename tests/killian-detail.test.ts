import {gunzipSync} from 'node:zlib';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {isPorticoTriangle} from '../src/features/real-campus/portico';
it('Killian detail is a finite local mesh with recorded inputs and complete textures',()=>{
 const root='public/data/killian/',bytes=readFileSync(root+'detail.glb'),jsonLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
 expect(bytes.toString('ascii',0,4)).toBe('glTF');expect(bytes.readUInt32LE(8)).toBe(bytes.length);
 for(const a of doc.accessors){if(a.min)expect([...a.min,...a.max].every(Number.isFinite)).toBe(true);}
 const manifest=JSON.parse(readFileSync(root+'detail-manifest.json','utf8'));expect(manifest.columns).toBe(10);expect(manifest.trees).toHaveLength(22+JSON.parse(readFileSync(root+'environment.json','utf8')).placedTrees);expect(manifest.bytes).toBe(bytes.length);
 expect(manifest.sourceModels).toHaveLength(10);
 for(const id of ['CAM_IVRJC-BXJZD-X6ABS','CAM_CQMYN-XKY6H-I7J3C','CAM_CW7MH-H5BCN-PPGCW','CAM_ME1KO-1JBIG-12R97','CAM_MNJTM-TPVUN-KZN3Z','CAM_TLJEH-BZQZ7-XG4P4','CAM_KHMI4-9TDEE-EZ75Q'])expect(manifest.windowsByModel[id]).toBeGreaterThan(0);
 expect(Object.values(manifest.windowsByModel).reduce((sum:number,n)=>sum+Number(n),0)).toBe(manifest.windows);
 for(const name of ['stone','trim','grass','pavement','bark','columnStone','entranceDoor','entranceFrame'])expect(doc.materials.some((m:{name:string})=>m.name===name)).toBe(true);
 const sources=JSON.parse(readFileSync(root+'sources.json','utf8'));expect(sources.assets).toHaveLength(9);
 for(const asset of sources.assets){expect(existsSync(root+asset.file)).toBe(true);const b=readFileSync(root+asset.file);expect(createHash('sha256').update(b).digest('hex')).toBe(asset.sha256);}
});
it('opens only the measured front cover and keeps adjacent facade triangles',()=>{
 const manifest=JSON.parse(readFileSync('public/data/killian/detail-manifest.json','utf8')),b=readFileSync('public/data/campuses/mit/campus.glb'),length=b.readUInt32LE(12),doc=JSON.parse(b.toString('utf8',20,20+length));
 const attr=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION],view=doc.bufferViews[attr.bufferView],start=28+length+view.byteOffset;
 const vertices=new Float32Array(b.buffer.slice(b.byteOffset+start,b.byteOffset+start+view.byteLength));let removed=0;
 for(let i=0;i<vertices.length;i+=9)if(isPorticoTriangle([Array.from(vertices.slice(i,i+3)),Array.from(vertices.slice(i+3,i+6)),Array.from(vertices.slice(i+6,i+9))],manifest.porticoOpening))removed++;
 expect(removed).toBe(2);expect(manifest.steps).toBe(5);expect(manifest.platformHeight).toBeGreaterThan(3);
});

it('compressed local assets round-trip and vegetation stays separate from walkable geometry',()=>{
 const root='public/data/killian/',m=JSON.parse(readFileSync(root+'detail-manifest.json','utf8'));
 for(const file of ['detail.glb','vegetation.glb'])expect(gunzipSync(readFileSync(root+file+'.gz')).equals(readFileSync(root+file))).toBe(true);
 const b=readFileSync(root+'vegetation.glb'),d=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
 expect(d.meshes.length).toBe(m.vegetation.chunks);expect(d.materials.every((x:{name:string})=>x.name.startsWith('leaf'))).toBe(true);
 for(const a of d.accessors)if(a.min)expect([...a.min,...a.max].every(Number.isFinite)).toBe(true);
 expect(m.delivery.coreGzipBytes+m.delivery.vegetationGzipBytes).toBeLessThan((m.bytes+m.delivery.vegetationBytes)*.25);
});
