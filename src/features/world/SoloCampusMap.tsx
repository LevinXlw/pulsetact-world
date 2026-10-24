import {useState} from 'react';
import {SOLO_DISCOVERIES} from './solo-locations';

import {WORLD_DESTINATIONS,regionAt,type RiverPlaceId} from './world-destinations';
import './solo-map.css';
import {BUExplorerMap} from './BUExplorerMap';
import {CampusAtlas,RegionalCampusMap} from './CampusTravelMap';
import {GlobeAtlas} from './GlobeAtlas';
import type {AtlasSchoolId} from './campus-atlas-data';
import type {CampusId,CampusPlaceId} from './campus-regions';

type SoloCampusMapProps = {
  campusId:CampusId;
  campusVisits:string[];
  onCampusChange:(id:CampusId)=>void;
  onSchoolEnter:(id:AtlasSchoolId)=>void;
  position: [number, number];
  trackedId: string;
  completedIds: string[];
  visitedPlaces: string[];
  onTrack: (id: string) => void;
  onTravel: (id: RiverPlaceId|CampusPlaceId) => void;
};

// Keep the illustrated map, markers and player on the same world X/Z bounds.
const BOUNDS = {minX: -15, maxX: 105, minZ: -55, maxZ: 80};
function mapPosition([x, z]: [number, number]) {
  return {
    left: `${Math.max(3, Math.min(97, (x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX) * 100))}%`,
    top: `${Math.max(4, Math.min(96, (z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ) * 100))}%`,
  };
}

export function SoloCampusMap({campusId,campusVisits,onCampusChange,onSchoolEnter,position, trackedId, completedIds, visitedPlaces, onTrack,onTravel}: SoloCampusMapProps) {
  const [area,setArea]=useState<'courtyard'|'river'|'campus'|'atlas'|'globe'>(()=>campusId!=='boston'?'campus':WORLD_DESTINATIONS.some(point=>point.id===trackedId)||regionAt(position).id!=='mit'?'river':'courtyard');
  const discoveries = SOLO_DISCOVERIES.map(discovery => ({
    ...discovery,
    distance: Math.round(Math.hypot(position[0] - discovery.position[0], position[1] - discovery.position[1])),
    complete: completedIds.includes(discovery.id),
    tracked: trackedId === discovery.id,
  }));
  const outsideMap = position[0] < BOUNDS.minX || position[0] > BOUNDS.maxX || position[1] < BOUNDS.minZ || position[1] > BOUNDS.maxZ;

  return <section className="pw-solo-map" aria-label="校园与河岸探索地图">
    <nav className="pw-solo-map-tabs" aria-label="地图范围"><button aria-pressed={area==='globe'} onClick={()=>setArea('globe')}>地球总览</button>{campusId==='boston'?<><button aria-pressed={area==='courtyard'} onClick={()=>setArea('courtyard')}>庭院</button><button aria-pressed={area==='river'} onClick={()=>setArea('river')}>河岸与 BU</button></>:<button aria-pressed={area==='campus'} onClick={()=>setArea('campus')}>校园漫游</button>}<button aria-pressed={area==='atlas'} onClick={()=>setArea('atlas')}>校园旅行</button></nav>
    {area==='globe'?<GlobeAtlas campusId={campusId} inBostonUniversity={regionAt(position).id==='bu'} onSchoolEnter={onSchoolEnter}/>:area==='atlas'?<CampusAtlas campusId={campusId} visits={campusVisits} onCampusChange={onCampusChange}/>:area==='campus'&&campusId!=='boston'?<RegionalCampusMap campusId={campusId} position={position} trackedId={trackedId} visited={campusVisits} onTrack={onTrack} onTravel={onTravel}/>:area==='river'?<BUExplorerMap position={position} trackedId={trackedId} visitedPlaces={visitedPlaces} onTrack={onTrack} onTravel={onTravel}/>:<>
    <div className="pw-solo-map-heading">
      <div><h3>Killian Court · 庭院漫游</h3><p>选择一个地点，沿着自己的节奏出发。</p></div>
      <span>{discoveries.filter(point => point.complete).length} / {discoveries.length} 已完成</span>
    </div>
    <div className="pw-solo-map-art">
      <svg viewBox="0 0 600 400" role="img" aria-label="庭院局部示意，中央建筑位于地图上方，草坪和步道位于庭院中央">
        <rect width="600" height="400" fill="#e6ead9"/>
        <path d="M0 351Q130 330 230 361T600 350V400H0Z" fill="#d5debf"/>
        <path d="M72 38H530V105H497V292H466V107H128V292H95V105H72Z" fill="#bbc7b0" stroke="#8d9c87" strokeWidth="2"/>
        <path d="M259 64H335V117H259Z" fill="#d1d6c3" stroke="#8d9c87" strokeWidth="2"/>
        <circle cx="297" cy="68" r="25" fill="#e4e2cc" stroke="#91a088" strokeWidth="2"/>
        <path d="M297 43V92M272 68H322" stroke="#bbc5ad" strokeWidth="1.5"/>
        <path d="M132 133H455V314H132Z" fill="#c6d5ad" stroke="#b7c89d"/>
        <path d="M293 117V359M126 272H468M140 133L453 312M451 133L139 312" fill="none" stroke="#eae6d3" strokeWidth="12"/>
        <path d="M293 117V359M126 272H468" fill="none" stroke="#f4eedc" strokeWidth="4"/>
        <g fill="#a9bf96" stroke="#93ab82" strokeWidth="1.5">
          <circle cx="57" cy="141" r="15"/><circle cx="55" cy="208" r="18"/><circle cx="62" cy="281" r="16"/>
          <circle cx="550" cy="142" r="17"/><circle cx="545" cy="215" r="15"/><circle cx="549" cy="291" r="18"/>
          <circle cx="173" cy="350" r="15"/><circle cx="431" cy="350" r="16"/>
        </g>
        <g fill="#73856e" fontSize="13" textAnchor="middle" fontFamily="Georgia, serif">
          <text x="173" y="81">MIT</text><text x="399" y="81">MIT</text>
          <text x="202" y="225" fontSize="11" letterSpacing="2">LAWN</text>
        </g>
        <circle cx="342.5" cy="318.5" r="4" fill="#97a489"/>
        <text x="342.5" y="340" fill="#7e8c73" fontSize="11" textAnchor="middle">入场点</text>
      </svg>
      <span className="pw-solo-map-caption">校园局部示意</span>
      {discoveries.map((point, index) => <button
        key={point.id}
        type="button"
        className={`pw-solo-map-point${point.tracked ? ' is-tracked' : ''}${point.complete ? ' is-complete' : ''}`}
        style={mapPosition(point.position)}
        aria-label={`设为目标：${point.title}，距离 ${point.distance} 米${point.complete ? '，已完成' : ''}`}
        aria-pressed={point.tracked}
        onClick={() => onTrack(point.id)}
      ><span>{point.complete ? '✓' : `0${index + 1}`}</span><strong>{point.title}</strong></button>)}
      <span className="pw-solo-map-player" style={mapPosition(position)} role="img" aria-label={outsideMap ? '你在地图范围之外，位置显示在地图边缘' : '你现在的位置'}><i/></span>
    </div>
    <div className="pw-solo-map-legend"><span><i/>你的位置{outsideMap ? '（地图边缘）' : ''}</span><span><b/>正在前往</span><span>点击地点设置目标</span></div>
    <div className="pw-solo-map-destinations">
      {discoveries.map((point, index) => <button
        type="button"
        key={point.id}
        className={point.tracked ? 'is-tracked' : undefined}
        aria-pressed={point.tracked}
        onClick={() => onTrack(point.id)}
      >
        <span className="pw-solo-map-card-top"><span>0{index + 1} · {point.distance} 米</span><span>{point.complete ? '已完成 ✓' : point.tracked ? '正在前往' : '待探索'}</span></span>
        <strong>{point.title}</strong><small>{point.subtitle}</small>
        <span className="pw-solo-map-card-action">{point.tracked ? '当前目标' : '设为目标'} <span aria-hidden="true">↗</span></span>
      </button>)}
    </div>
    <p className="pw-muted-note">想走得更远？切换「河岸与 BU」，沿 Harvard Bridge 前往波士顿。</p>
    </>}
  </section>;
}

