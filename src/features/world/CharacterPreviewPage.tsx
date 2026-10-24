import {Component, Suspense, lazy, useState, type ReactNode} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {ArrowLeft, ArrowUpRight, Check, Leaf, RotateCw, ScanFace} from 'lucide-react';
import {CHARACTER_CANDIDATES, characterCandidate, normalizePlayableCharacter, type CharacterId, type CharacterMotion} from './character-catalog';
import './character-preview.css';

const WorldScene = lazy(() => import('./WorldScene'));
const ignore = () => {};
class PreviewBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {return this.state.failed ? <div className="cp-load" role="alert">3D 预览未能启动。<button onClick={()=>location.reload()}>重新载入</button></div> : this.props.children;}
}

export default function CharacterPreviewPage() {
  const [searchParams] = useSearchParams();
  const [id, setId] = useState<CharacterId>(() => normalizePlayableCharacter(searchParams.get('character')));
  const [motion, setMotion] = useState<CharacterMotion>('Idle');
  const [angle, setAngle] = useState(0), [close, setClose] = useState(false);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const candidate = characterCandidate(id);
  const available = CHARACTER_CANDIDATES.filter(item => item.url).length;
  const select = (next: CharacterId) => {
    if (id === next || !characterCandidate(next).url) return;
    setReady(false); setError(''); setId(next); setMotion('Idle');
  };
  return <main className="cp-page">
    <aside className="cp-sidebar">
      <Link to="/" className="cp-back"><ArrowLeft size={15}/> 回到校园</Link>
      <div className="cp-brand"><Leaf size={22}/><span>pulsetact <i>world</i></span></div>
      <span className="cp-eyebrow">CHARACTER STUDY / 01</span>
      <h1>下一位，<br/>校园漫游者。</h1>
      <p className="cp-intro">把角色放进庭院的光里，<br/>看看谁更像这个世界的一员。</p>
      <div className="cp-list" aria-label="人物候选">
        {CHARACTER_CANDIDATES.map((item, index) => <article className={`cp-candidate ${id === item.id ? 'selected' : ''}`} key={item.id}>
          <button onClick={()=>select(item.id)} disabled={!item.url} aria-pressed={id === item.id}>
            <span className="cp-number">0{index + 1}</span>
            <span><strong>{item.name}</strong><small>{item.url ? '已导入 · 可在场景中预览' : '待导入 · 尚不可预览'}</small></span>
            {id === item.id && <Check size={17}/>}
          </button>
          {!item.url && <a href={item.source} target="_blank" rel="noreferrer">{item.id === 'hiyori' ? '登录 BOOTH 获取免费包' : '查看官方素材'} <ArrowUpRight size={12}/></a>}
        </article>)}
      </div>
      <Link className="cp-use" to={`/?character=${id}`} aria-disabled={!ready || !!error} tabIndex={!ready || !!error ? -1 : 0} onClick={event=>{if (!ready || error) event.preventDefault();}}>使用这个角色 <ArrowUpRight size={15}/></Link>
      <section className="cp-notes" aria-label="所选人物信息">
        <span className="cp-eyebrow">{candidate.subtitle}</span>
        <p>{candidate.description}</p>
        <small>{candidate.license}</small>
        <a href={candidate.source} target="_blank" rel="noreferrer">原作者与授权 <ArrowUpRight size={13}/></a>
      </section>
      <footer className="cp-sidebar-footer">{available} / 3 款已就绪 <span>MIT · KILLIAN COURT</span></footer>
    </aside>
    <section className="cp-stage" aria-label="人物场景预览">
      <PreviewBoundary><Suspense fallback={null}><WorldScene paused quality="standard" players={[]} selfId="character-preview" onMove={ignore} onInteract={ignore} onReady={()=>setReady(true)} onCharacterReady={()=>setReady(true)} onError={setError} characterReview={{id, motion, angle, close}}/></Suspense></PreviewBoundary>
      <div className="cp-stage-heading"><span>CAMPUS DAYLIGHT</span><p>同一座庭院 · 同一束日光</p></div>
      <div className="cp-status" role="status">{error ? '加载失败' : ready ? '实时 3D 预览' : '正在准备人物与校园…'}</div>
      {(!ready || error) && <div className="cp-load" role={error ? 'alert' : 'status'}>{error || '正在走进庭院…'}{error && <button onClick={()=>location.reload()}>重新载入</button>}</div>}
      <div className="cp-controls">
        <div className="cp-control-row"><span><RotateCw size={14}/> 观察角度</span><div>{[{label:'正面',value:0},{label:'侧面',value:Math.PI / 2},{label:'背面',value:Math.PI}].map(view=><button key={view.label} aria-pressed={angle === view.value} onClick={()=>setAngle(view.value)}>{view.label}</button>)}</div><button className="cp-closeup" aria-pressed={close} onClick={()=>setClose(!close)}><ScanFace size={15}/>{close ? '查看全身' : '面部近景'}</button></div>
        <div className="cp-control-row"><span>动作预览</span><div>{(['Idle','Walk','Run'] as const).map((value,index)=><button key={value} disabled={!ready || !candidate.motions.includes(value)} aria-pressed={motion === value} onClick={()=>setMotion(value)}>{['待机','走路','跑步'][index]}</button>)}</div><small>原地播放 · 比较服装与轮廓</small></div>
      </div>
    </section>
  </main>;
}
