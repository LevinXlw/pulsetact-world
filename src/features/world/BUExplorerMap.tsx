import {useState} from 'react';
import {HARVARD_BRIDGE,NORTH_BANK,SOUTH_BANK,WORLD_BOUNDS,type WorldPoint} from './charles-geography';
import {WORLD_DESTINATIONS,NAVIGATION_PATHS,type RiverPlaceId} from './world-destinations';
import {BU_FULL_SPACES} from './bu-full-layout';
import {BU_MAP_BUILDINGS} from './bu-campus-footprints';
import {BU_CAMPUS_ROADS,BU_COMMONWEALTH_MEDIAN} from './bu-campus-layout';
import {BU_GREEN_LINE_STATIONS} from './bu-green-line-layout';
import {BU_CDS_MAP_FEATURE} from './bu-landmark-layout';
import {BU_CORE_STORROW_ROADS,BU_RIVER_FOOTBRIDGES} from './bu-river-core-layout';

type Props={position:WorldPoint;trackedId:string;visitedPlaces:string[];onTrack:(id:string)=>void;onTravel:(id:RiverPlaceId)=>void};
type Bounds={minX:number;maxX:number;minZ:number;maxZ:number};
const areas:Record<string,{title:string;bounds:Bounds}>={
  all:{title:'河岸与全校',bounds:WORLD_BOUNDS},
  mit:{title:'MIT 校园',bounds:{minX:-410,maxX:330,minZ:-380,maxZ:390}},
  bu:{title:'BU 主校区',bounds:{minX:-3050,maxX:260,minZ:400,maxZ:1580}},
  east:{title:'East Campus',bounds:{minX:-1070,maxX:260,minZ:800,maxZ:1300}},
  central:{title:'Central Campus',bounds:{minX:-1660,maxX:-850,minZ:770,maxZ:1240}},
  west:{title:'West Campus',bounds:{minX:-2930,maxX:-1580,minZ:430,maxZ:1110}},
  south:{title:'South Campus',bounds:{minX:-1500,maxX:-670,minZ:1080,maxZ:1540}},
};
const points=(p:readonly (readonly number[])[])=>p.map(v=>v.join(',')).join(' ');
const within=(p:WorldPoint,b:Bounds)=>p[0]>=b.minX&&p[0]<=b.maxX&&p[1]>=b.minZ&&p[1]<=b.maxZ;
const mapFeatures=[...BU_MAP_BUILDINGS,BU_CDS_MAP_FEATURE,...BU_FULL_SPACES.map(s=>({
  ...s,address:s.kind==='field-hockey'?'285 Babcock Street':'West Campus · Athletics',custom:false,
  footprint:([[-s.width/2,-s.depth/2],[s.width/2,-s.depth/2],[s.width/2,s.depth/2],[-s.width/2,s.depth/2]] as WorldPoint[])
    .map(([x,z])=>[s.x+x*Math.cos(s.yaw)+z*Math.sin(s.yaw),s.z-x*Math.sin(s.yaw)+z*Math.cos(s.yaw)] as WorldPoint),
}))];

export function BUExplorerMap({position,trackedId,visitedPlaces,onTrack,onTravel}:Props){
  const [area,setArea]=useState('all'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string>();
  const building=mapFeatures.find(b=>b.id===selected),q=query.trim().toLowerCase();
  const matches=q?mapFeatures.filter(b=>`${b.name} ${b.address}`.toLowerCase().includes(q)):[];
  const bounds=building?{minX:building.x-190,maxX:building.x+190,minZ:building.z-130,maxZ:building.z+130}:areas[area].bounds;
  const width=bounds.maxX-bounds.minX,height=bounds.maxZ-bounds.minZ;
  const overview=!building&&(area==='all'||area==='bu');
  const pin=([x,z]:WorldPoint)=>({left:`${(x-bounds.minX)/width*100}%`,top:`${(z-bounds.minZ)/height*100}%`});
  const places=WORLD_DESTINATIONS.filter(p=>(area==='all'||(area==='bu'?p.id.startsWith('bu-'):within(p.position,areas[area].bounds)))&&(!q||`${p.title} ${p.subtitle}`.toLowerCase().includes(q)));
  const closest=building?WORLD_DESTINATIONS.filter(p=>p.id.startsWith('bu-')).sort((a,b)=>Math.hypot(a.position[0]-building.x,a.position[1]-building.z)-Math.hypot(b.position[0]-building.x,b.position[1]-building.z))[0]:undefined;
  const chooseArea=(value:string)=>{setArea(value);setSelected(undefined);setQuery('');};
  return <>
    <div className="pw-solo-map-heading"><div><h3>{area==='mit'?'MIT · 校园与沿河宿舍':area==='all'?'MIT · 查尔斯河 · Boston University':'Boston University · 查尔斯河校区'}</h3><p>{area==='mit'?'从 Killian Court 出发，走向 Stata Center、Maseeh Hall 与 Baker House。':'沿校园与河岸探索，选择地点后可以步行或快速前往。'}</p></div><span>{visitedPlaces.length} / {WORLD_DESTINATIONS.length} 已到访</span></div>
    <div className="pw-bu-map-tools">
      <label>查找地点<input aria-label="搜索 BU 建筑或地点" value={query} onChange={e=>{setQuery(e.target.value);setSelected(undefined);}} placeholder="Questrom、Warren、Agganis…"/></label>
      <label>地图范围<select aria-label="选择 BU 校园分区" value={area} onChange={e=>chooseArea(e.target.value)}>{Object.entries(areas).map(([id,a])=><option key={id} value={id}>{a.title}</option>)}</select></label>
      <button onClick={()=>chooseArea('bu')}>BU 主校区总览</button>
    </div>
    {q&&<div className="pw-bu-search-results" aria-label="BU 建筑搜索结果">{matches.slice(0,12).map(b=><button key={b.id} aria-label={`查看 BU 建筑 ${b.name} ${b.address}`} onClick={()=>setSelected(b.id)}>{b.name}<small>{b.address}</small></button>)}{!matches.length&&!places.length&&<p>没有找到匹配地点，试试建筑英文名或街道名称。</p>}{matches.length>12&&<p>找到 {matches.length} 处地点，请输入更多文字缩小范围。</p>}</div>}
    <div className="pw-solo-map-art pw-river-map-art pw-bu-map-art" style={{aspectRatio:`${width} / ${height}`}}>
      <svg viewBox={`${bounds.minX} ${bounds.minZ} ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="BU 主校区地图，显示建筑轮廓、道路、绿线 B 支线车站与步行路线，北朝上">
        <rect x={bounds.minX} y={bounds.minZ} width={width} height={height} fill="#e6ead9"/>
        <polygon points={points([...NORTH_BANK,...[...SOUTH_BANK].reverse()])} fill="#9fc5c5"/>
        <polyline points={points(HARVARD_BRIDGE)} fill="none" stroke="#f5efda" strokeWidth="21"/>
        {BU_CAMPUS_ROADS.map(road=><polyline key={road.id} points={points(road.points)} fill="none" stroke="#f6f1e2" strokeWidth={road.width+6} strokeLinejoin="round"/>)}
        <polyline points={points(BU_COMMONWEALTH_MEDIAN)} fill="none" stroke="#26764e" strokeWidth={width>2000?6:3.5} strokeLinejoin="round"><title>MBTA Green Line · B branch</title></polyline>
        {BU_CORE_STORROW_ROADS.map(road=><polyline key={road.id} points={points(road.points)} fill="none" stroke="#a6aaa0" strokeWidth={road.width} strokeLinejoin="round"><title>{road.name}</title></polyline>)}
        {mapFeatures.map(b=><path key={b.id} d={[b.footprint,...('holes' in b?b.holes??[]:[])].map(r=>'M'+points(r)+'Z').join(' ')} fillRule="evenodd" fill={b.id===selected?'#ba8862':q&&!matches.includes(b)?'#d5d9ca':b.custom?'#b7a78a':/soccer|field-hockey|softball/.test(b.kind)?'#91b187':'#b6bfa6'} fillOpacity={'raised' in b&&b.raised?.6:1} stroke={b.id===selected?'#725337':'#919d84'} strokeWidth={b.id===selected?2.8:.65} strokeDasharray={'raised' in b&&b.raised?'3 2':undefined}><title>{b.name} · {b.address}{'raised' in b&&b.raised?' · 高架体量，下方保留通行空间':''}</title></path>)}
        {BU_RIVER_FOOTBRIDGES.map(bridge=><g key={bridge.id}><polyline points={points(bridge.points)} fill="none" stroke="#7e8980" strokeWidth={bridge.width+2} strokeLinejoin="round"/><polyline points={points(bridge.points)} fill="none" stroke="#f6f1e2" strokeWidth={bridge.width} strokeLinejoin="round"><title>{bridge.name}</title></polyline></g>)}
        {NAVIGATION_PATHS.map((path,i)=><polyline key={i} points={points(path)} fill="none" stroke="#65846e" strokeWidth={width>2000?3.5:2.2} strokeDasharray="7 7" strokeLinejoin="round"/>)}
        {BU_GREEN_LINE_STATIONS.filter(stop=>within(stop.position,bounds)).map(stop=><g key={stop.id} transform={`translate(${stop.position[0]} ${stop.position[1]})`}><title>{stop.name} · Green Line B</title><circle r={width*.0028} fill="#fffbed" stroke="#26764e" strokeWidth={width*.001}/>{width<1600&&<text y={width*.017} textAnchor="middle" fill="#185a3d" fontSize={width*.012} stroke="#f4f0e0" strokeWidth={width*.002} paintOrder="stroke" fontWeight="600">{stop.name.replace('Boston University','BU')}</text>}</g>)}
        {area==='all'&&<text x="-55" y="-80" fill="#61775f" fontSize="32" fontFamily="Georgia,serif">MIT</text>}
        <g transform={`translate(${bounds.maxX-width*.045} ${bounds.minZ+height*.10})`} fill="#647761" textAnchor="middle" fontSize={width*.018}><path d={`M0 5L${-width*.006} ${width*.025}L0 ${width*.019}L${width*.006} ${width*.025}Z`}/><text y="0">N</text></g>
      </svg>
      {overview&&([{id:'east',point:[-640,1025]},{id:'central',point:[-1320,920]},{id:'west',point:[-2230,750]},{id:'south',point:[-1090,1300]}] as {id:string;point:WorldPoint}[]).map(a=><button key={a.id} className="pw-bu-district-pin" style={pin(a.point)} aria-label={`放大 ${areas[a.id].title}`} onClick={()=>chooseArea(a.id)}>{areas[a.id].title}<span>查看分区 ↗</span></button>)}
      {WORLD_DESTINATIONS.filter(p=>within(p.position,bounds)&&(!overview||!p.id.startsWith('bu-'))).map(p=><button key={p.id} className={`pw-solo-map-point${trackedId===p.id?' is-tracked':''}${visitedPlaces.includes(p.id)?' is-complete':''}`} style={pin(p.position)} title={p.title} aria-label={`设为目标：${p.title}`} aria-pressed={trackedId===p.id} onClick={()=>onTrack(p.id)}><span>{visitedPlaces.includes(p.id)?'✓':WORLD_DESTINATIONS.indexOf(p)+1}</span>{(trackedId===p.id||width<1000)&&<strong>{p.title}</strong>}</button>)}
      {within(position,bounds)&&<span className="pw-solo-map-player" style={pin(position)} role="img" aria-label="你现在的位置"><i/></span>}
      <span className="pw-solo-map-caption">北 ↑ · 建筑轮廓与校园道路</span>
    </div>
    {building&&<div className="pw-bu-building-card"><div><strong>{building.name}</strong><span>{building.address}</span></div>{closest&&<button onClick={()=>onTravel(closest.id)}>前往附近：{closest.title} ↗</button>}<button onClick={()=>setSelected(undefined)}>返回分区</button></div>}
    <div className="pw-solo-map-legend"><span><i/>你的位置</span><span><b/>正在前往</span><span>绿色实线与圆点：绿线 B 支线及车站</span><span>虚线为步行路线 · 数字对应下方地点</span></div>
    <div className="pw-river-destinations pw-bu-destinations">{places.map(point=><article key={point.id} className={trackedId===point.id?'is-tracked':undefined}>
      <div className="pw-solo-map-card-top"><span>{String(WORLD_DESTINATIONS.indexOf(point)+1).padStart(2,'0')} · 直线 {Math.round(Math.hypot(position[0]-point.position[0],position[1]-point.position[1]))} 米</span><span>{visitedPlaces.includes(point.id)?'已到访 ✓':trackedId===point.id?'正在前往':'待探索'}</span></div>
      <h4>{point.title}</h4><p>{point.subtitle}</p><div><button onClick={()=>onTrack(point.id)} aria-label={`步行前往${point.title}`}>标记步行路线 ↗</button><button onClick={()=>onTravel(point.id)} aria-label={`快速前往${point.title}`}>快速前往</button></div>
    </article>)}</div>
    <p className="pw-muted-note">可以沿路步行，也可以快速前往。抵达后按 E，把地点收进手册。Fenway 与 Medical Campus 将在后续开放。</p>
  </>;
}
