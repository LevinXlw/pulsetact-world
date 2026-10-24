import {DataTexture,NearestFilter,RedFormat,type Group,type Vector3} from 'three';
import type {CampusCollision} from '../real-campus/campus-collision';
import type {CampusId} from './campus-regions';

export type WorldAssets={
  model:Group;collision:CampusCollision;wind:{value:number};
  setQuality:(low:boolean)=>void;update:(camera:Vector3,deltaSeconds?:number)=>void;dispose:()=>void;
};

export function toonGradient(){
  const texture=new DataTexture(new Uint8Array([86,154,215,255]),4,1,RedFormat);
  texture.minFilter=NearestFilter;texture.magFilter=NearestFilter;texture.needsUpdate=true;
  return texture;
}

/** Select before importing builders or downloading models, not after allocation. */
export async function loadWorldAssets(signal:AbortSignal,campus:CampusId='boston',mobile=false):Promise<WorldAssets>{
  const load=mobile?(await import('./mobile-campus')).loadMobileCampus:(await import('./scene-assets-desktop')).loadWorldAssets;
  signal.throwIfAborted();
  return load(signal,campus);
}
