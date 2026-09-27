import {expect,it,vi} from 'vitest';
import {gzipSync} from 'node:zlib';
import {BufferGeometry,Float32BufferAttribute,Group,LOD,Mesh,MeshStandardMaterial} from 'three';
import {localBinary} from '../src/features/real-campus/local-assets';
import {vegetationLOD} from '../src/features/real-campus/vegetation-lod';

it('decodes local gzip and accepts an already decoded response',async()=>{
 const raw=new Uint8Array([103,108,84,70,2,0,0,0]);
 try{for(const data of [gzipSync(raw),raw]){
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(data)));
  expect(new Uint8Array(await localBinary('/raw','/packed',new AbortController().signal))).toEqual(raw);
 }}finally{vi.unstubAllGlobals();}
});
it('falls back to raw when the compressed asset is absent',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:404})).mockResolvedValueOnce(new Response('glTF'));
 vi.stubGlobal('fetch',fetcher);
 try{await localBinary('/raw','/packed',new AbortController().signal);expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/packed','/raw']);}finally{vi.unstubAllGlobals();}
});
it('far foliage selects whole clusters and shares near attribute buffers',()=>{
 const source=new Group(),g=new BufferGeometry(),p=new Float32Array(54*3);for(let i=0;i<54;i++){p[i*3]=i;p[i*3+1]=i%3;}
 g.setAttribute('position',new Float32BufferAttribute(p,3));const high=new Mesh(g,new MeshStandardMaterial());source.add(high);
 const result=vegetationLOD(source),lod=result.children[0] as LOD,far=lod.levels[1].object as Mesh;
 expect(lod.getObjectForDistance(10)).toBe(high);expect(lod.getObjectForDistance(250)).toBe(far);
 expect(far.geometry.index?.count).toBe(18);expect(far.geometry.getAttribute('position')).toBe(high.geometry.getAttribute('position'));
 expect(far.castShadow).toBe(false);expect(lod.position.x).toBe(26.5);
});
