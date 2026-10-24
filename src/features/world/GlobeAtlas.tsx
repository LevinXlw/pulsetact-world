import {useState} from 'react';
import {ArrowUpRight, Globe2, MapPin} from 'lucide-react';
import {ATLAS_SCHOOLS, type AtlasSchoolId} from './campus-atlas-data';
import {CampusGlobe, type GlobeFocus} from './CampusGlobe';
import {CampusRegionInset} from './CampusRegionInset';
import {distanceKm} from './globe-geography';
import {CAMPUS_REGIONS,type CampusId} from './campus-regions';
import './globe-atlas.css';

type Props = {campusId: CampusId; inBostonUniversity: boolean; onSchoolEnter: (id: AtlasSchoolId) => void};

export function GlobeAtlas({campusId, inBostonUniversity, onSchoolEnter}: Props) {
  const currentId: AtlasSchoolId = campusId === 'boston' ? inBostonUniversity ? 'bu' : 'mit' : campusId;
  const [selectedId, setSelectedId] = useState<AtlasSchoolId>(currentId);
  const [focus, setFocus] = useState<GlobeFocus>({schoolId: null, revision: 0});
  const selected = ATLAS_SCHOOLS.find(school => school.id === selectedId)!;
  const current = ATLAS_SCHOOLS.find(school => school.id === currentId)!;
  const distance = distanceKm(current.location, selected.location);
  function select(id: AtlasSchoolId) {setSelectedId(id); setFocus(previous => ({schoolId: id, revision: previous.revision + 1}));}

  return <section className="pw-earth-atlas" aria-label="地球校园总览">
    <header className="pw-earth-heading"><div><span>THE WORLD IS YOUR CAMPUS</span><h3><Globe2 size={19}/> 从地球出发，发现校园</h3><p>沿着真实的地理位置，找到下一段旅程。</p></div><b>{ATLAS_SCHOOLS.length} 所学校 <small>· {CAMPUS_REGIONS.length} 座城市区域</small></b></header>
    <div className="pw-earth-layout">
      <div className="pw-earth-main">
        <CampusGlobe selectedId={selectedId} focus={focus} onSelect={select}/>
        <div className="pw-earth-schools" aria-label="选择学校">
          {ATLAS_SCHOOLS.map((school, index) => <button key={school.id} aria-label={`查看 ${school.short} 的地理位置`} aria-pressed={selectedId === school.id} data-school-id={school.id} data-longitude={school.location[0]} data-latitude={school.location[1]} onClick={() => select(school.id)}>
            <span className="pw-earth-school-number">0{index + 1}</span><strong>{school.short}</strong><small>{school.city}</small><i>{school.id === currentId ? '所在校园' : school.status === 'planned' ? '待开放' : '可探索'}</i>
          </button>)}
        </div>
      </div>
      <aside className="pw-earth-detail" aria-label="所选校园详情">
        <span className="pw-earth-detail-kicker"><MapPin size={12}/> UNITED STATES <b>{selected.status === 'open' ? '可探索' : '待开放'}</b></span>
        <h4>{selected.short}</h4><p className="pw-earth-full-name">{selected.name}</p>
        <p className="pw-earth-address">{selected.city}, {selected.state}</p>
        <div className="pw-earth-coordinates"><span>{selected.location[1].toFixed(4)}° N</span><span>{Math.abs(selected.location[0]).toFixed(4)}° W</span></div>
        <CampusRegionInset schools={ATLAS_SCHOOLS} selectedId={selectedId} onSelect={select}/>
        <p className="pw-earth-scope">{selected.scope}</p>
        <p className="pw-earth-distance">{selectedId === currentId ? '你当前所在的校园' : `距 ${current.short} 约 ${distance < 10 ? distance.toFixed(1) : Math.round(distance).toLocaleString()} km · 直线距离`}</p>
        <button className="pw-earth-enter" disabled={selected.status !== 'open'} onClick={() => onSchoolEnter(selectedId)}>{selected.status === 'open' ? <>进入 {selected.short} 校园 <ArrowUpRight size={15}/></> : '校园漫游尚未开放'}</button>
      </aside>
    </div>
    <footer className="pw-earth-footnote">全球位置 → 城市分布 → 校园区域 <span>学校位置依据官方地图 · 区域轮廓为主校区示意</span></footer>
  </section>;
}
