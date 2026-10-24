import {CAMPUS_REGIONS,REMOTE_LAYOUTS,campusNavigationGuide,campusPlaces,campusRegion,type CampusId,type CampusPlaceId,type RemoteCampusId} from './campus-regions';
import {useEffect,useState,type CSSProperties} from 'react';
import {UMD_ROAD_SURFACES} from './maryland-road-layout';
import {MARYLAND_DETAIL_STREETS} from './maryland-street-layout';
import {ARIZONA_SURFACES} from './arizona-geography';

// GIS paving is clipped into small convex pieces for the 3D scene. Combine
// their outlines once so the atlas only renders a handful of SVG paths.
const marylandMapPaving=(()=>{
  const groups=new Map<string,{kind:string;material:string;parts:string[]}>();
  for(const surface of UMD_ROAD_SURFACES){
    const key=`${surface.kind}:${surface.material}`;
    let group=groups.get(key);
    if(!group){group={kind:surface.kind,material:surface.material,parts:[]};groups.set(key,group);}
    group.parts.push(surface.polygon.map(([x,z],index)=>`${index?'L':'M'}${x},${z}`).join('')+'Z');
  }
  const order=['parking','road','service','crosswalk'];
  return [...groups].map(([key,group])=>({key,kind:group.kind,path:group.parts.join(''),color:group.kind==='crosswalk'?'#f5f0df':group.kind==='parking'?'#d4d1bc':group.material==='brick'?'#cbb99d':group.material==='concrete'?'#d7d5c4':'#a9b0a1'})).sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind));
})();

const arizonaMapPaving=(()=>{
  const groups=new Map<string,string[]>();
  for(const surface of ARIZONA_SURFACES){
    const paths=groups.get(surface.kind)??[];
    paths.push([surface.points,...surface.holes??[]].map(ring=>ring.map(([x,z],i)=>`${i?'L':'M'}${x},${z}`).join('')+'Z').join(''));
    groups.set(surface.kind,paths);
  }
  const colors:Record<string,string>={grass:'#b7c591',lawn:'#b7c591',garden:'#d7cfaa',desert:'#e0d3b2',sand:'#e0d3b2',road:'#aaa99b',parking:'#bbb6a4',brick:'#c99c7d'};
  return [...groups].map(([kind,paths])=>({kind,path:paths.join(''),color:colors[kind]??'#efe5cd'}));
})();

export function CampusAtlas({campusId,visits,onCampusChange}:{campusId:CampusId;visits:string[];onCampusChange:(id:CampusId)=>void}){
  return <div className="solo-campus-atlas">
    <div className="pw-solo-map-heading"><div><h3>下一站，去哪里？</h3><p>从东海岸的河畔校园，走向 Tucson 的阳光与沙漠。</p></div></div>
    <div className="solo-campus-cards">{CAMPUS_REGIONS.map((region,index)=>{
      const here=region.id===campusId,places=campusPlaces(region.id);
      return <article key={region.id} style={{'--campus-color':region.color} as CSSProperties} className={here?'is-current':''}>
        <div className="solo-campus-postmark"><span>0{index+1}</span><small>{region.eyebrow}</small></div>
        <h4>{region.title}</h4><p>{region.description}</p>
        <ul>{region.id==='boston'?<><li>MIT · Killian Court</li><li>Charles River · Boston University</li></>:region.id==='umd'?<><li>中央校园 · 艺术与人文 · 工程与科学</li><li>北区生活 · 体育园区 · 南区校园</li><li>{places.filter(point=>visits.includes(point.id)).length} / {places.length} 处到访记录</li></>:region.id==='arizona'?<><li>Old Main · University Mall · 校园博物馆</li><li>Eller · ENR2 · 图书馆与体育区</li><li>{places.filter(point=>visits.includes(point.id)).length} / {places.length} 处到访记录</li></>:places.map(point=><li key={point.id}>{point.title}{visits.includes(point.id)&&<span> ✓</span>}</li>)}</ul>
        <button disabled={here} onClick={()=>onCampusChange(region.id)} aria-label={`前往 ${region.short}`}>{here?'正在这里':`前往 ${region.short}`}<span aria-hidden="true">↗</span></button>
      </article>;
    })}</div>
    <p className="pw-muted-note">通过这里切换校园。到访记录和每座校园的落脚点都会保留。</p>
  </div>;
}

export function RegionalCampusMap({campusId,position,trackedId,visited,onTrack,onTravel}:{campusId:RemoteCampusId;position:[number,number];trackedId:string;visited:string[];onTrack:(id:string)=>void;onTravel:(id:CampusPlaceId)=>void}){
  const [districtId,setDistrictId]=useState('all'),[query,setQuery]=useState(''),[selectedBuilding,setSelectedBuilding]=useState('');
  useEffect(()=>{setDistrictId('all');setQuery('');setSelectedBuilding('');},[campusId]);
  const layout=REMOTE_LAYOUTS[campusId],region=campusRegion(campusId),districts=layout.districts??[],district=districts.find(item=>item.id===districtId);
  const selected=layout.mapBuildings.find(building=>building.label===selectedBuilding);
  const districtBuildings=layout.mapBuildings.filter(building=>building.district===districtId);
  const districtPoints=layout.points.filter(point=>point.district===districtId);
  let b=layout.bounds;
  if(selected){
    const extent=Math.max(115,selected.width*.8,selected.depth*.8);
    b={minX:selected.x-extent*1.4,maxX:selected.x+extent*1.4,minZ:selected.z-extent,maxZ:selected.z+extent};
  }else if(district){
    const xs=[district.center[0],...districtBuildings.flatMap(item=>{const extent=(Math.abs(Math.cos(item.yaw))*item.width+Math.abs(Math.sin(item.yaw))*item.depth)/2;return [item.x-extent,item.x+extent];}),...districtPoints.map(item=>item.position[0])];
    const zs=[district.center[1],...districtBuildings.flatMap(item=>{const extent=(Math.abs(Math.sin(item.yaw))*item.width+Math.abs(Math.cos(item.yaw))*item.depth)/2;return [item.z-extent,item.z+extent];}),...districtPoints.map(item=>item.position[1])];
    const centerX=(Math.min(...xs)+Math.max(...xs))/2,centerZ=(Math.min(...zs)+Math.max(...zs))/2;
    const height=Math.max(220,Math.max(...zs)-Math.min(...zs)+100,(Math.max(...xs)-Math.min(...xs)+100)/1.4);
    b={minX:centerX-height*.7,maxX:centerX+height*.7,minZ:centerZ-height/2,maxZ:centerZ+height/2};
  }
  const width=b.maxX-b.minX,height=b.maxZ-b.minZ,overview=districts.length>0&&!district&&!selected;
  const paths=layout.paths??[layout.route];
  const normalized=query.trim().toLocaleLowerCase();
  const matches=(text:string)=>text.toLocaleLowerCase().includes(normalized);
  const visiblePoints=layout.points.filter(point=>(!district||point.district===district.id)&&(!normalized||matches(`${point.title} ${point.subtitle} ${point.note}`)));
  const matchingBuildings=normalized?layout.mapBuildings.filter(building=>building.label&&(!district||building.district===district.id)&&matches(building.label)):[];
  const inView=([x,z]:[number,number])=>x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;
  const mapPosition=([x,z]:[number,number])=>({left:`${(x-b.minX)/width*100}%`,top:`${(z-b.minZ)/height*100}%`});
  const resetOverview=()=>{setDistrictId('all');setSelectedBuilding('');setQuery('');};
  return <>
    <div className="pw-solo-map-heading"><div><h3>{region.detail} · 校园漫游</h3><p>{districts.length?'选择分区看清建筑，或搜索名称找到目的地。':'沿步道观察建筑，也可以直接前往一个落脚点。'}</p></div><span>{layout.points.filter(point=>visited.includes(point.id)).length} / {layout.points.length} 已到访</span></div>
    {districts.length>0&&<div className="pw-campus-map-tools">
      <label className="pw-campus-map-search"><span>寻找校园地点</span><input type="search" aria-label="搜索校园地点" placeholder="搜索建筑、地标…" value={query} onChange={event=>{setQuery(event.target.value);setSelectedBuilding('');}}/></label>
      <label><span>校园分区</span><select aria-label="选择校园分区" value={districtId} onChange={event=>{setDistrictId(event.target.value);setSelectedBuilding('');setQuery('');}}><option value="all">全校总览</option>{districts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button onClick={resetOverview} aria-label="全校总览" disabled={!district&&!selected&&!query}>全校总览 ↗</button>
    </div>}
    {district&&<div className="pw-campus-district-note"><strong>{district.name}</strong><p>{district.description}</p></div>}
    {normalized&&<div className="pw-campus-search-results" role="region" aria-label="校园地点搜索结果"><p role="status">{!matchingBuildings.length&&!visiblePoints.length?'没有找到匹配的校园地点':`找到 ${matchingBuildings.length} 座建筑、${visiblePoints.length} 个落脚点`}</p>{matchingBuildings.slice(0,8).map(building=>{
      const nearest=layout.points.reduce((best,point)=>Math.hypot(point.position[0]-building.x,point.position[1]-building.z)<Math.hypot(best.position[0]-building.x,best.position[1]-building.z)?point:best);
      return <div key={building.label}><button className={selectedBuilding===building.label?'is-selected':undefined} onClick={()=>setSelectedBuilding(building.label)} aria-label={`查看建筑：${building.label}`}>{building.label}<span>定位 ↗</span></button><button onClick={()=>onTravel(nearest.id)} aria-label={`快速前往 ${building.label} 附近`}>前往附近</button></div>;
    })}{matchingBuildings.length>8&&<small>结果较多，继续输入以缩小范围。</small>}</div>}
    <div className={`pw-solo-map-art pw-regional-map-art${overview?' is-campus-overview':''}`} style={{aspectRatio:`${width} / ${height}`}}>
      <svg viewBox={`${b.minX} ${b.minZ} ${width} ${height}`} role="img" aria-label={`${region.title} ${selectedBuilding||district?.name||'校园'}与步行路线示意`}>
        <rect x={b.minX} y={b.minZ} width={width} height={height} fill={campusId==='arizona'?'#e8ddbf':'#e5ead9'}/>
        {campusId!=='arizona'&&<rect x={layout.bounds.minX+12} y={layout.bounds.minZ+12} width={layout.bounds.maxX-layout.bounds.minX-24} height={layout.bounds.maxZ-layout.bounds.minZ-24} rx="20" fill="#cbd9b6"/>}
        {campusId==='arizona'&&<g aria-label="Tucson 校园铺地与景观">{arizonaMapPaving.map(surface=><path key={surface.kind} d={surface.path} fill={surface.color} fillRule="evenodd"/>)}</g>}
        {campusId==='umd'&&<g aria-hidden="true">{marylandMapPaving.map(surface=><path key={surface.key} d={surface.path} fill={surface.color}/>)}</g>}
        {campusId==='umd'&&<g aria-label="Campus Drive、Union Lane 与 Fieldhouse Drive">{MARYLAND_DETAIL_STREETS.map(street=><g key={street.name}><title>{street.name}</title><polyline points={street.points.map(p=>p.join(',')).join(' ')} fill="none" stroke="#ded9c4" strokeWidth={street.width+7} strokeLinejoin="round" strokeLinecap="round"/><polyline points={street.points.map(p=>p.join(',')).join(' ')} fill="none" stroke="#929f91" strokeWidth={street.width} strokeLinejoin="round" strokeLinecap="round"/></g>)}</g>}
        {campusId==='umd'&&<g><rect x="-104" y="-62" width="208" height="124" rx="3" fill="#b8cd9f"/><rect x="-34" y="-3.55" width="78" height="7.1" rx="1" fill="#89afb2" stroke="#f1e9d8" strokeWidth="2"/></g>}
        {paths.map((path,index)=><polyline key={index} points={path.map(p=>p.join(',')).join(' ')} fill="none" stroke="#f5efdd" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round"/>)}
        {layout.mapBuildings.map((building,index)=>{
          const shapeStyle={fill:building.label===selectedBuilding?'#577e65':campusId==='arizona'?'#bf9275':campusId==='umd'?'#bb9d83':'#98aaa0',stroke:building.label===selectedBuilding?'#315644':'#82917b',strokeWidth:building.label===selectedBuilding?3:1};
          return <g key={index} opacity={district&&building.district!==district.id&&!selected?.label?'.4':1}>
            <title>{building.label||'Chapel wing'}</title>
            {building.footprint?<path d={[building.footprint,...building.holes??[]].map(ring=>ring.map(([x,z],i)=>`${i?'L':'M'}${x},${z}`).join('')+'Z').join('')} fillRule="evenodd" {...shapeStyle}/>:<rect transform={`translate(${building.x} ${building.z}) rotate(${-building.yaw*180/Math.PI})`} x={-building.width/2} y={-building.depth/2} width={building.width} height={building.depth} {...shapeStyle}/>}
            {!overview&&building.label!==selectedBuilding&&<text x={building.x} y={building.z} textAnchor="middle" dominantBaseline="middle" fontSize="5" fill="#3d594c">{building.label}</text>}
          </g>;
        })}
        {paths.map((path,index)=><polyline key={index} points={path.map(p=>p.join(',')).join(' ')} fill="none" stroke="#668663" strokeWidth="1" strokeDasharray="3 3"/>)}
      </svg>
      {overview&&districts.map(item=><button className={`pw-campus-district-pin is-${item.id}${item.center[0]>b.maxX-width*.16?' is-east-edge':item.center[0]<b.minX+width*.16?' is-west-edge':''}`} key={item.id} style={mapPosition(item.center)} aria-label={`查看分区 ${item.name}`} onClick={()=>setDistrictId(item.id)}>{item.name}<span>↗</span></button>)}
      {layout.points.map((point,index)=>inView(point.position)&&(!district||point.district===district.id)&&(!overview||trackedId===point.id)&&<button key={point.id} className={`pw-solo-map-point${trackedId===point.id?' is-tracked':''}${visited.includes(point.id)?' is-complete':''}${point.position[0]<b.minX+width*.2?' is-west-edge':point.position[0]>b.minX+width*.8?' is-east-edge':''}`} style={mapPosition(point.position)} aria-label={`设为目标：${point.title}`} aria-pressed={trackedId===point.id} onClick={()=>onTrack(point.id)}><span>{visited.includes(point.id)?'✓':index+1}</span><strong>{point.title}</strong></button>)}
      {inView(position)&&<span className="pw-solo-map-player" style={mapPosition(position)} role="img" aria-label="你现在的位置"><i/></span>}
      <span className="pw-campus-map-north" aria-label="北">N ↑</span>
      {selected&&<span className="pw-campus-building-label" style={mapPosition([selected.x,selected.z])}>{selected.label}</span>}
      <span className="pw-solo-map-caption">{selectedBuilding||district?.name||(campusId==='umd'?'College Park · 全校总览':campusId==='arizona'?'Tucson · 主校区':'核心区域')} · 步行路线示意</span>
    </div>
    <div className={`pw-river-destinations${districts.length?' pw-campus-destinations':''}`} aria-label="校园落脚点">{visiblePoints.map(point=><article key={point.id} className={trackedId===point.id?'is-tracked':undefined}>
      <div className="pw-solo-map-card-top"><span>{String(layout.points.indexOf(point)+1).padStart(2,'0')} · 步行 {Math.round(campusNavigationGuide(campusId,position,point.position).distance)} 米</span><span>{visited.includes(point.id)?'已到访 ✓':'待探索'}</span></div>
      <h4>{point.title}</h4><p>{point.subtitle}</p><div><button onClick={()=>onTrack(point.id)} aria-label={`步行前往${point.title}`}>标记步行路线 ↗</button><button onClick={()=>onTravel(point.id)} aria-label={`快速前往${point.title}`}>快速前往</button></div>
    </article>)}</div>
    {!visiblePoints.length&&<p className="pw-muted-note">没有匹配的落脚点。试试建筑英文名，或返回全校总览。</p>}
    <p className="pw-muted-note">到达地点后按 E 记录到访，按 P 留下风景。{campusId==='umd'?'校园按真实分区组织，步行距离经过压缩；建筑为风格化室外还原。':'当前可探索核心户外区域。'}</p>
  </>;
}
