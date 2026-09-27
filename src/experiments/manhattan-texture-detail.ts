import * as T from 'three';

export interface DetailTexture { file: string; width: number; height: number; normal: boolean }
export interface TextureCandidate { texture: T.Texture; score: number; baseSize?: [number, number] }
interface ActiveTexture { source: T.Source; anisotropy: number; bitmap: ImageBitmap; bytes: number }
const ROOT = '/assets-source/nyc-local/manhattan/';
const BUDGET = 160 * 1024 * 1024;

/** Select nearby visible surfaces without exceeding the estimated mipmapped RGBA budget. */
export function chooseDetailTextures(candidates: TextureCandidate[], catalog: Record<string, DetailTexture>, budget = BUDGET) {
  let bytes = 0;
  const chosen = new Map<T.Texture, DetailTexture>();
  for (const { texture, baseSize } of [...candidates].sort((a,b) => b.score-a.score)) {
    if (chosen.has(texture)) continue;
    const info = catalog[texture.name]; if (!info) continue;
    const image = texture.image as {width?:number;height?:number};
    if ((baseSize?.[0] ?? image?.width ?? 0) >= info.width && (baseSize?.[1] ?? image?.height ?? 0) >= info.height) continue;
    const cost = Math.ceil(info.width*info.height*4*4/3);
    if (bytes+cost > budget) continue;
    bytes += cost; chosen.set(texture,info);
  }
  return chosen;
}

/** Upgrade only the nearby texture sources; restore base sources and release HD bitmaps on exit. */
export class CityTextureDetail {
  private catalog: Record<string, DetailTexture> = {};
  private active = new Map<T.Texture, ActiveTexture>();
  private pending = new Map<T.Texture, AbortController>();
  private wanted = new Map<T.Texture, DetailTexture>();
  private failed = new Set<string>();
  private enabled = true;
  private initialized = false;
  available = false;
  constructor(private anisotropy: number, private report: (message: string, active: number, stats?: {bytes:number;maxDimension:number}) => void) {}
  async init() {
    try {
      const response = await fetch(ROOT+'textures-hd/index.json');
      if (!response.ok) return;
      const data = await response.json();
      if (data.version!==1 || !data.textures) return;
      this.catalog=data.textures; this.available=true;
    } finally { this.initialized=true; this.status(); }
  }
  setEnabled(enabled: boolean) {
    this.enabled=enabled;
    if (enabled) this.failed.clear();
    if (!enabled) this.update([]);
    this.status();
  }
  private status() {
    const entries=[...this.active.values()];
    const message=!this.enabled ? '标准贴图 · 适合浏览全图' : !this.available ? (this.initialized ? '高清资源暂不可用，保留标准贴图' : '正在读取高清资源…') : this.pending.size ? `载入近景细节 · ${this.active.size} 张就绪` : this.active.size ? `高清近景 · ${this.active.size} 张贴图` : '接近建筑时载入高清细节';
    this.report(message+(this.enabled&&this.failed.size ? ' · 部分未载入' : ''),this.active.size,
      {bytes:entries.reduce((sum,e)=>sum+e.bytes,0),maxDimension:Math.max(0,...entries.flatMap(e=>[e.bitmap.width,e.bitmap.height]))});
  }
  update(candidates: TextureCandidate[]) {
    // Selection is measured against the saved base dimensions, not an already upgraded source.
    const originalSizes = candidates.map(c => {
      const entry=this.active.get(c.texture);
      if (!entry) return c;
      const image=entry.source.data as {width:number;height:number};
      return {...c,baseSize:[image.width,image.height] as [number,number]};
    });
    this.wanted=this.enabled ? chooseDetailTextures(originalSizes,this.catalog) : new Map<T.Texture,DetailTexture>();
    for (const [texture,entry] of this.active) if (!this.wanted.has(texture)) {
      texture.dispose(); texture.source=entry.source; texture.anisotropy=entry.anisotropy; texture.needsUpdate=true;
      entry.bitmap.close(); this.active.delete(texture);
    }
    for (const [texture,controller] of this.pending) if (!this.wanted.has(texture)) controller.abort();
    this.pump(); this.status();
  }
  private pump() {
    for (const [texture,info] of this.wanted) {
      if (this.pending.size >= 2) break;
      if (this.active.has(texture) || this.pending.has(texture) || this.failed.has(info.file)) continue;
      const controller=new AbortController(); this.pending.set(texture,controller);
      void this.upgrade(texture,info,controller);
    }
  }
  private async upgrade(texture: T.Texture, info: DetailTexture, controller: AbortController) {
    let bitmap: ImageBitmap | undefined;
    try {
      const response=await fetch(ROOT+info.file,{signal:controller.signal});
      if (!response.ok) throw new Error(`HD texture ${response.status}`);
      bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      if (!this.enabled || !this.wanted.has(texture) || controller.signal.aborted) { bitmap.close(); return; }
      const entry={source:texture.source,anisotropy:texture.anisotropy,bitmap,bytes:Math.ceil(info.width*info.height*4*4/3)};
      texture.dispose(); texture.source=new T.Source(bitmap); texture.anisotropy=this.anisotropy; texture.needsUpdate=true;
      this.active.set(texture,entry);
    } catch (error) {
      bitmap?.close();
      if (!controller.signal.aborted) { this.failed.add(info.file); console.warn('近景贴图暂不可用，保留标准贴图',info.file,error); }
    } finally {
      this.pending.delete(texture); this.pump(); this.status();
    }
  }
}
