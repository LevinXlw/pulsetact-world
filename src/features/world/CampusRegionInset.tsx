import type {CSSProperties} from 'react';
import type {AtlasSchool,AtlasSchoolId} from './campus-atlas-data';
import './campus-region-inset.css';

type Props={schools:readonly AtlasSchool[];selectedId:AtlasSchoolId;onSelect:(id:AtlasSchoolId)=>void};
const BOSTON_SCHOOLS=new Set<string>(['mit','bu','harvard']);
const COLORS:Record<string,string>={mit:'#587c71',bu:'#b47753',harvard:'#996865',umd:'#ad8251',upenn:'#667f98',arizona:'#b57955'};
const WIDTH=420,HEIGHT=280;

/** A local metric projection: longitude is scaled by latitude, north remains up. */
function insetGeometry(schools:readonly AtlasSchool[]){
  const coordinates=schools.flatMap(school=>[school.location,...school.outline]);
  const originLon=coordinates.reduce((sum,point)=>sum+point[0],0)/coordinates.length;
  const originLat=coordinates.reduce((sum,point)=>sum+point[1],0)/coordinates.length;
  const longitudeScale=111320*Math.cos(originLat*Math.PI/180);
  const project=([longitude,latitude]:readonly [number,number]):[number,number]=>[(longitude-originLon)*longitudeScale,-(latitude-originLat)*111320];
  const points=coordinates.map(project);
  const minX=Math.min(...points.map(point=>point[0])),maxX=Math.max(...points.map(point=>point[0]));
  const minY=Math.min(...points.map(point=>point[1])),maxY=Math.max(...points.map(point=>point[1]));
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  // Leave room around the actual geometry for labels, north arrow, and scale.
  const height=Math.max(500,(maxY-minY)*1.5,(maxX-minX)*1.4*HEIGHT/WIDTH);
  const width=height*WIDTH/HEIGHT;
  const x=centerX-width/2,y=centerY-height/2;
  const pixel=(coordinate:readonly [number,number]):[number,number]=>{
    const point=project(coordinate);return [(point[0]-x)/width*WIDTH,(point[1]-y)/height*HEIGHT];
  };
  const desiredScale=width*.21,power=10**Math.floor(Math.log10(desiredScale));
  const scale=[1,2,5].map(value=>value*power).filter(value=>value<=desiredScale).at(-1)??power;
  return {pixel,scale,scalePixels:scale/width*WIDTH};
}

export function CampusRegionInset({schools,selectedId,onSelect}:Props){
  const selected=schools.find(school=>school.id===selectedId)??schools[0];
  if(!selected)return null;
  const boston=BOSTON_SCHOOLS.has(selected.id);
  const visible=boston?schools.filter(school=>BOSTON_SCHOOLS.has(school.id)):[selected];
  const {pixel,scale,scalePixels}=insetGeometry(visible);
  const regionName=boston?'BOSTON · CAMBRIDGE':`${selected.city} · ${selected.state}`;
  const scaleLabel=scale>=1000?`${scale/1000} km`:`${scale} m`;
  return <section className="campus-region-inset" aria-label="校园区域示意">
    <div className="campus-region-inset-map">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${regionName}，校园区域与相对位置，北方在上`}>
        <rect width={WIDTH} height={HEIGHT} fill="#eeecdf"/>
        <g className="campus-region-inset-grid" aria-hidden="true">
          {[70,140,210,280,350].map(x=><path key={`x${x}`} d={`M${x} 0V${HEIGHT}`}/>)}
          {[70,140,210].map(y=><path key={`y${y}`} d={`M0 ${y}H${WIDTH}`}/>)}
        </g>
        {visible.map(school=><polygon key={school.id} points={school.outline.map(point=>pixel(point).join(',')).join(' ')} fill={COLORS[school.id]??'#6d8571'} fillOpacity={school.id===selectedId?.3:.14} stroke={COLORS[school.id]??'#6d8571'} strokeWidth={school.id===selectedId?1.8:1.2} strokeDasharray={school.status==='planned'?'4 3':undefined} strokeLinejoin="round"><title>{school.name}</title></polygon>)}
        <g className="campus-region-inset-scale" transform="translate(18 254)" aria-label={`比例尺 ${scaleLabel}`}>
          <path d={`M0 -5V0H${scalePixels}V-5`}/><text x={scalePixels/2} y="-9" textAnchor="middle">{scaleLabel}</text>
        </g>
        <g className="campus-region-inset-north" transform="translate(390 30)" aria-label="北方">
          <text textAnchor="middle" y="-8">N</text><path d="M0 0L-4 11L0 8L4 11Z"/>
        </g>
      </svg>
      <span className="campus-region-inset-place">{regionName}</span>
      {visible.map(school=>{
        const [x,y]=pixel(school.location);
        const style={'--inset-school-color':COLORS[school.id]??'#6d8571',left:`${x/WIDTH*100}%`,top:`${y/HEIGHT*100}%`} as CSSProperties;
        return <button key={school.id} className={`campus-region-inset-pin${school.id===selectedId?' is-selected':''}${x>WIDTH*.7?' is-east':''}`} style={style} onClick={()=>onSelect(school.id)} aria-label={`查看 ${school.name} 区域`} aria-pressed={school.id===selectedId}><i aria-hidden="true"/><span>{school.short}</span></button>;
      })}
    </div>
    <div className="campus-region-inset-caption"><span>校园区域示意</span><span>{boston?'三校相对位置 · 选择查看':'北 ↑ · 主要校园区域'}</span></div>
  </section>;
}
