import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {geoToWorld} from '../src/features/world/geo-coordinates';

const source=JSON.parse(readFileSync('assets-source/charles-bu/boston-buildings-bu-area.json','utf8'));
const index=JSON.parse(readFileSync('assets-source/charles-bu/bu-selected-building-index.json','utf8'));
const manifest=JSON.parse(readFileSync('assets-source/charles-bu/bu-campus-source-manifest.json','utf8'));
const recovered=[{id:'commonwealth-560',city:1372,owned:false,vertices:38},{id:'commonwealth-566',city:1373,owned:false,vertices:31},{id:'commonwealth-580',city:1374,owned:true,vertices:60}];
describe('opposite Questrom source recovery stays bounded to separate real buildings',()=>{
  it('retains each City ring exactly instead of treating the tower parcel as one building',()=>{
    for(const item of recovered){
      const b=BU_FULL_BUILDINGS.find(b=>b.id===item.id)!;
      const city=source.features.find((f:any)=>f.attributes.OBJECTID===item.city);
      const ring=city.geometry.rings[0].slice(0,-1).map(([lon,lat]:number[])=>geoToWorld(lat,lon).map(v=>Math.round(v*1000)/1000));
      expect(b.cityObjectId).toBe(item.city);expect(b.footprint).toHaveLength(item.vertices);expect(b.footprint).toEqual(ring);
      expect(index.find((i:any)=>i.id===item.id)?.cityObjectId).toBe(item.city);
    }
    const low=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-560')!,tower=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-566')!;
    expect(Math.min(...low.footprint.map(p=>p[0]))).toBeGreaterThan(Math.max(...tower.footprint.map(p=>p[0])));
    expect(low.height).toBeLessThan(10);expect(tower.height).toBeGreaterThan(35);
  });
  it('keeps the two private context buildings distinct from verified BU housing',()=>{
    for(const item of recovered){const b=BU_FULL_BUILDINGS.find(b=>b.id===item.id)!;expect(b.universityOwned).toBe(item.owned);expect(b.kind).toBe(item.owned?'residence':'context');}
    expect(manifest.selectedCount).toBe(BU_FULL_BUILDINGS.length);
    expect(manifest.universityOwnedOrNamed).toBe(BU_FULL_BUILDINGS.filter(b=>b.universityOwned).length);
    expect(manifest.contextCount).toBe(BU_FULL_BUILDINGS.filter(b=>!b.universityOwned).length);
    expect(index).toHaveLength(BU_FULL_BUILDINGS.length);
  });
});
