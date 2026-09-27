import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const destination=new URL('public/decoders/draco/',root);
await mkdir(destination,{recursive:true});
for(const file of ['draco_decoder.js','draco_decoder.wasm','draco_wasm_wrapper.js']){
  await copyFile(new URL(`node_modules/three/examples/jsm/libs/draco/gltf/${file}`,root),new URL(file,destination));
}
console.log(`Copied locked Three.js Draco decoders to ${fileURLToPath(destination)}`);
