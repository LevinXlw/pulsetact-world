import {useEffect,useState} from 'react';

type Model={id:string;name:string;position:[number,number]};
const priorities=['CAM_IVRJC-BXJZD-X6ABS','CAM_CQMYN-XKY6H-I7J3C','CAM_CW7MH-H5BCN-PPGCW','CAM_ME1KO-1JBIG-12R97'];
export function BuildingCoverage(){
 const [environment,setEnvironment]=useState<{trees:number;water:number;green:number;roads:number}|null>(null);
 const [models,setModels]=useState<Model[]>([]),[enhanced,setEnhanced]=useState<string[]>([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[limit,setLimit]=useState(12);
 useEffect(()=>{const controller=new AbortController();
  Promise.all(['/data/campuses/mit/manifest.json','/data/killian/detail-manifest.json','/data/killian/environment.json'].map(async url=>{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw new Error('建筑状态读取失败');return r.json();})).then(([base,detail,env])=>{setModels(base.models);setEnhanced(detail.sourceModels);setEnvironment({trees:detail.trees.length,water:env.waterArea,green:env.greenArea,roads:env.roadArea});setLoaded(true);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();
 },[]);
 const upgraded=models.filter(m=>enhanced.includes(m.id)).length;
 const rank=(m:Model)=>enhanced.includes(m.id)?0:priorities.includes(m.id)?1:2;
 const items=models.filter(m=>(filter==='all'||(filter==='detail'?enhanced.includes(m.id):!enhanced.includes(m.id)))&&`${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name));
 return <section className="building-coverage" aria-label="MIT 建筑更新状态"><h3>建筑更新状态</h3>
 {error?<p role="alert">{error}</p>:!loaded?<p>正在核对模型清单……</p>:<>
 <p><strong>{upgraded} 个已部分细化 · {models.length-upgraded} 个基础材质模型</strong><br/>增强模式已补全图墙面材质、外围通用立面与航拍屋顶。尚无完整复原建筑；统计含周边和未命名对象。</p>
 <p className="soft-label">10 号楼：柱廊、台阶、穹顶与立面。3、4 号楼：庭院面窗洞、窗台、腰线与檐口。1、2、5、6、7、8、11 号楼：通用窗格与材质。真实室内均未完成。</p>
 {environment&&<p className="local-stats">{environment.trees} 棵立体树木<br/>水面 {(environment.water/10000).toFixed(1)} 万 m² · 绿地候选 {(environment.green/10000).toFixed(1)} 万 m²<br/>道路候选 {(environment.roads/10000).toFixed(1)} 万 m²<br/><small>图面分类与近似布置，非实测景观清单。核心庭院覆盖单独制作。</small></p>}
 <details><summary>逐栋制作清单</summary>
 <p>3、4 号楼的六个庭院面已制作带进深的窗洞，外壳沿用测绘位置，开窗布局为照片参考下的近似。6、8、11 号楼保留贴合测绘边界的通用窗框。主楼已依据照片调整中央入口与窗带，当前仍不代表完整复原。</p>
 <label>搜索楼名或 GIS 编号<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(12);}} placeholder="例如 Building 7"/></label>
 <label>细化状态<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(12);}}><option value="all">全部模型</option><option value="detail">已部分细化</option><option value="base">基础材质模型</option></select></label>
 <p aria-live="polite">匹配 {items.length} 个</p>
 <ul>{items.slice(0,limit).map(m=><li key={m.id}><strong>{m.name.trim()||'未命名 GIS 对象'}</strong><span>{enhanced.includes(m.id)?'部分细化':priorities.includes(m.id)?'基础材质模型 · 建议优先更新':'基础材质模型'}</span><small>{m.id}</small></li>)}</ul>
 {items.length>limit&&<button onClick={()=>setLimit(limit+24)}>显示更多建筑</button>}
 <small>名称沿用本地 GIS 清单，未逐一核对学校当前楼名。切换「对比原始模型」只改变显示，不改变制作进度。</small>
 </details></>}
 </section>;
}
