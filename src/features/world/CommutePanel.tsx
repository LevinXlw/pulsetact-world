import {Bike,Check,Footprints,Wind} from 'lucide-react';
import {COMMUTE_MODES,type CommuteMode} from './commute';
import './commute.css';

export function CommutePanel({mode,onSelect}:{mode:CommuteMode;onSelect:(mode:CommuteMode)=>void}){
  return <div className="solo-commute-panel">
    <p>沿熟悉的街道，换一种出发方式。</p>
    <div className="solo-commute-options">{COMMUTE_MODES.map(option=>{
      const Icon=option.id==='walk'?Footprints:option.id==='motorcycle'?Bike:Wind;
      return <button key={option.id} type="button" aria-pressed={mode===option.id} aria-label={option.id==='walk'?'收起工具，步行':option.id==='motorcycle'?'召唤摩托车':'召唤魔法扫帚'} onClick={()=>onSelect(option.id)}>
        <span className={`solo-commute-icon ${option.id}`}><Icon size={32}/></span>
        <span className="solo-commute-copy"><strong>{option.title}</strong><small>{option.subtitle}</small><em>{option.id==='walk'?'随时停下来探索':`巡航 ${Math.round(option.speed*3.6)} km/h · 加速 ${Math.round(option.sprintSpeed*3.6)} km/h`}</em></span>
        <span className="solo-commute-select">{mode===option.id?<Check size={19}/>:<span>{option.id==='walk'?'步行':'召唤'}</span>}</span>
      </button>;
    })}</div>
    <p className="pw-muted-note">WASD / 方向键控制方向，Shift 加速。手机使用方向按钮，按住「加速」提速。<br/>魔法扫帚贴着地形低空巡航；请沿道路、步道和桥梁通行。进入室内或快速旅行时自动收起。</p>
  </div>;
}
