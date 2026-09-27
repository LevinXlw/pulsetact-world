import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {insideCampus,mapPercent} from '../src/features/real-campus/local-data';
describe('local campus assets',()=>{
 for(const campus of ['mit','harvard'])it(`${campus} has valid local geometry, terrain coverage and landmarks`,()=>{
  const root=`public/data/campuses/${campus}/`,m=JSON.parse(readFileSync(root+'manifest.json','utf8')),b=readFileSync(root+'campus.glb');
  expect(b.toString('ascii',0,4)).toBe('glTF');expect(b.readUInt32LE(8)).toBe(b.length);
  const jsonLength=b.readUInt32LE(12),doc=JSON.parse(b.toString('utf8',20,20+jsonLength)),start=28+jsonLength;
  const positions=doc.meshes[0].primitives.map((p:{attributes:{POSITION:number}})=>{const a=doc.accessors[p.attributes.POSITION],v=doc.bufferViews[a.bufferView];return new Float32Array(b.buffer.slice(b.byteOffset+start+v.byteOffset,b.byteOffset+start+v.byteOffset+v.byteLength));});
  expect(positions[0].length/9).toBe(m.buildingTriangles);expect(positions[1].length/9).toBe(m.terrainTriangles);
  expect(positions.every((p:Float32Array)=>p.every(Number.isFinite))).toBe(true);
  const terrain=positions[1] as Float32Array;
  for(const p of [m.spawn,...Object.values(m.points)] as number[][]){
   let covered=false;
   for(let i=0;i<terrain.length;i+=9){const [ax,,az,bx,,bz,cx,,cz]=terrain.slice(i,i+9),den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;
    const u=((bz-cz)*(p[0]-cx)+(cx-bx)*(p[1]-cz))/den,v=((cz-az)*(p[0]-cx)+(ax-cx)*(p[1]-cz))/den;if(u>=0&&v>=0&&u+v<=1){covered=true;break;}}
   expect(covered,`ground under ${p}`).toBe(true);
  }
  const landmark=campus==='mit'?'CAM_PX4ND-TBOZP-3FRN5':'CAM_20TZA-X87UC-ZWCKG';expect(m.models.some((v:{id:string})=>v.id===landmark)).toBe(true);
  expect(doc.images[0].mimeType).toBe('image/jpeg');expect(doc.images[0].uri).toBeUndefined();
 });
 it('keeps map coordinates and movement boundaries finite',()=>{expect(mapPercent([0,0],420)).toEqual([50,50]);expect(mapPercent([-420,420],420)).toEqual([0,100]);expect(insideCampus([NaN,0],420)).toBe(false);expect(insideCampus([410,0],420)).toBe(false);});
});
