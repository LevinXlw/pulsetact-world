import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(command,args)=>new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd:root,stdio:'inherit',shell:false});
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?accept():reject(new Error(command+' failed: '+(signal??code))));
});

/** Both MIT replacement bases contain all of Boston, including BU. Rebuild
 * them together after every Boston bake; never ship one from an older bake.
 * Only exact surveyed MIT triangles are removed, and authored models and all
 * desktop exports remain untouched. Set PYTHON_EXECUTABLE or PYTHON if needed.
 */
export async function refreshBostonMobileReplacementBases(){
  const sourceUrl='/data/mobile/boston.glb';
  const sourceBytes=await readFile(resolve(root,'public'+sourceUrl));
  const source={url:sourceUrl,sha256:sha256(sourceBytes),bytes:sourceBytes.length};
  await run(process.execPath,['scripts/prepare-stata-base.mjs','--mobile-only']);
  await run(process.env.PYTHON_EXECUTABLE||process.env.PYTHON||'python',['scripts/prepare-mit-residences-base.py','--mobile-only']);
  const manifests=[];
  let previous=source;
  for(const url of ['/assets/mit-stata/boston-without-stata.glb','/assets/mit-residences/boston-without-residences.glb']){
    const manifest=JSON.parse(await readFile(resolve(root,'public'+url.replace(/\.glb$/,'.json')),'utf8'));
    const bytes=await readFile(resolve(root,'public'+url));
    assert.equal(manifest.url,url);
    assert.equal(manifest.sha256,sha256(bytes));assert.equal(manifest.bytes,bytes.length);
    assert.equal(manifest.inputUrl,previous.url);assert.equal(manifest.inputSHA256,previous.sha256);assert.equal(manifest.inputBytes,previous.bytes);
    manifests.push(manifest);previous=manifest;
  }
  assert.equal(sha256(await readFile(resolve(root,'public'+sourceUrl))),source.sha256,'Boston bake changed during replacement generation.');
  const result={version:1,source,stata:manifests[0],residences:manifests[1]};
  await writeFile(resolve(root,'public/data/mobile/boston.replacements.json'),JSON.stringify(result,null,2));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const replacements=await refreshBostonMobileReplacementBases();
  const path=resolve(root,'public/data/mobile/boston.json'),metadata=JSON.parse(await readFile(path,'utf8'));
  metadata.sha256=replacements.source.sha256;metadata.replacementBases=replacements;
  await writeFile(path,JSON.stringify(metadata,null,2));
  console.log(JSON.stringify(replacements));
}
