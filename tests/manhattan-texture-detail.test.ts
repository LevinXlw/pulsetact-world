import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { chooseDetailTextures, CityTextureDetail, type DetailTexture } from '../src/experiments/manhattan-texture-detail';

const texture=(name:string,size=512) => { const t=new T.Texture(); t.source=new T.Source({width:size,height:size}); t.name=name; return t; };
const info=(size:number):DetailTexture => ({file:'test.webp',width:size,height:size,normal:false});
afterEach(()=>vi.unstubAllGlobals());
describe('nearby high-resolution texture budget',()=>{
  it('prefers visible larger surfaces while staying inside the mipmapped GPU estimate',()=>{
    const wall=texture('wall'),sign=texture('sign'),normal=texture('normal');
    const selected=chooseDetailTextures([{texture:sign,score:1},{texture:wall,score:8},{texture:normal,score:4}],
      {wall:info(2048),sign:info(2048),normal:info(1024)},30*1024*1024);
    expect([...selected.keys()]).toEqual([wall,normal]);
  });
  it('does not upscale native small textures, double-count shared textures or request missing entries',()=>{
    const small=texture('small',64),wall=texture('wall'),missing=texture('missing');
    const selected=chooseDetailTextures([{texture:small,score:8},{texture:wall,score:7},{texture:wall,score:6},{texture:missing,score:9}],{small:info(64),wall:info(2048)});
    expect([...selected.keys()]).toEqual([wall]);
  });
  it('keeps upgraded textures selected using saved base dimensions, avoiding upgrade/downgrade flicker',()=>{
    const upgraded=texture('wall',2048);
    expect(chooseDetailTextures([{texture:upgraded,score:8,baseSize:[512,512]}],{wall:info(2048)}).has(upgraded)).toBe(true);
    expect(chooseDetailTextures([{texture:upgraded,score:8}],{wall:info(2048)}).size).toBe(0);
  });
  it('restores the original texture source and closes the HD bitmap when standard quality is selected',async()=>{
    const wall=texture('wall'),original=wall.source,bitmap={width:2048,height:2048,close:vi.fn()};
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('index.json') ? new Response(JSON.stringify({version:1,textures:{wall:info(2048)}})) : new Response('image')));
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
    const pool=new CityTextureDetail(8,()=>{}); await pool.init(); pool.update([{texture:wall,score:1}]);
    await vi.waitFor(()=>expect(wall.image).toBe(bitmap)); expect(wall.anisotropy).toBe(8);
    pool.setEnabled(false); expect(wall.source).toBe(original); expect(wall.anisotropy).toBe(1); expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
  it('discards a late bitmap if quality was disabled while it was decoding',async()=>{
    const wall=texture('wall'),original=wall.source,bitmap={width:2048,height:2048,close:vi.fn()};
    let finish!: (value:unknown)=>void;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('index.json') ? new Response(JSON.stringify({version:1,textures:{wall:info(2048)}})) : new Response('image')));
    vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve;})));
    const pool=new CityTextureDetail(8,()=>{}); await pool.init(); pool.update([{texture:wall,score:1}]);
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function')); pool.setEnabled(false); finish(bitmap);
    await vi.waitFor(()=>expect(bitmap.close).toHaveBeenCalledTimes(1)); expect(wall.source).toBe(original);
  });
});
