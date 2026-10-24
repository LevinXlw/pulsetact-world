import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Lightbulb, RotateCcw, Sparkles, User, Users, X } from 'lucide-react';
import { isOpticsSolved, mirrorEndpoints, opticsBoard, traceOptics } from './optics-model';
import type { OpticsState } from './optics-model';
import './optics-workshop.css';

export type OpticsWorkshopProps = {
  state: OpticsState;
  onChange: (patch: Partial<OpticsState>) => void;
  onComplete: () => void;
  onClose: () => void;
  nickname: string;
  participants?: number;
  connected: boolean;
  disabled?: boolean;
  canClaimCompletion?: boolean;
  connectionNotice?: ReactNode;
};

const chapters = [
  { title: '让光，拐一个弯', label: '观察', prompt: '转动镜面 A，让光落进上方的接收环。慢慢转动，观察镜面和光束各自转了多少。' },
  { title: '发现光的约定', label: '理解', prompt: '虚线是垂直镜面的「法线」。先观察光线与法线的两个夹角，作出预测，再用角度读数验证。' },
  { title: '一起把光送到远方', label: '合作', prompt: '用两面镜子把光送进右侧接收环。先让 A 把光送到 B，再调整 B 的方向。' },
] as const;

function MirrorControl({ label, value, onChange, description, disabled = false }: { label: string; value: number; onChange: (value: number) => void; description: string; disabled?: boolean }) {
  const id = useId();
  return <div className="optics-control">
    <div className="optics-control-heading"><label htmlFor={id}>镜面 {label}</label><output htmlFor={id}>{value.toFixed(1)}<span>°</span></output></div>
    <div className="optics-slider-row">
      <button type="button" aria-label={`逆时针转动镜面 ${label} 0.5 度`} disabled={disabled || value <= -80} onClick={() => onChange(value - 0.5)}><ChevronLeft size={17} /></button>
      <input id={id} type="range" min="-80" max="80" step="0.5" disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-describedby={`${id}-hint`} />
      <button type="button" aria-label={`顺时针转动镜面 ${label} 0.5 度`} disabled={disabled || value >= 80} onClick={() => onChange(value + 0.5)}><ChevronRight size={17} /></button>
    </div>
    <p id={`${id}-hint`}>{description}</p>
  </div>;
}

export function OpticsWorkshop({ state, onChange, onComplete, onClose, nickname, participants = 1, connected, disabled = false, canClaimCompletion = true, connectionNotice }: OpticsWorkshopProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const svgId = useId().replaceAll(':', '');
  const [showHint, setShowHint] = useState(false);
  const complete = state.stage === 3;
  const lessonChapters = chapters.map((item, index) => index === 2 && !connected ? { ...item, title: '把光送到远方', label: '两镜接力' } : item);
  const chapter = lessonChapters[Math.min(state.stage, 2)];
  const ray = traceOptics(state);
  const solved = isOpticsSolved(state);
  const reflection = ray.reflections[0];
  const cooperative = state.stage >= 2;
  const angleLabel = reflection ? `${reflection.incidence.toFixed(1)}°` : '—';
  const reflectionLabel = reflection ? `${reflection.reflection.toFixed(1)}°` : '—';

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    setShowHint(false);
    if (dialogRef.current) dialogRef.current.scrollTop = 0;
  }, [state.stage]);

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function advance() {
    if (!disabled && solved && state.stage < 3) onChange({ stage: (state.stage + 1) as OpticsState['stage'] });
  }

  return <div className="optics-backdrop" onKeyDown={handleKey} onKeyUp={(event) => event.stopPropagation()}>
    <div className="optics-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <header className="optics-header">
        <div className="optics-place"><span className="optics-place-icon"><Lightbulb size={21} strokeWidth={1.5} /></span><div><span className="optics-eyebrow">MIT · 河畔学习工坊</span><h2 id={headingId}>光的接力</h2></div></div>
        <button ref={closeRef} type="button" className="optics-close" onClick={onClose} aria-label="离开光学工坊"><X size={21} /></button>
      </header>

      {connectionNotice && <div className="pw-lesson-banner">{connectionNotice}</div>}

      <div className="optics-meta"><span>{connected || disabled ? <Users size={14} /> : <User size={14} />}{disabled ? '共同实验 · 等待重新加入' : connected ? `同房间 · ${participants} 位探索者` : '独自探索 · 本地进度'}</span><span>5–15 分钟 · 入门光学</span></div>

      <ol className="optics-steps" aria-label="实验进度">
        {lessonChapters.map((item, index) => <li key={item.label} className={state.stage === index ? 'is-current' : state.stage > index ? 'is-done' : ''} aria-current={state.stage === index ? 'step' : undefined}><span>{state.stage > index ? <Check size={12} /> : `0${index + 1}`}</span>{item.label}</li>)}
      </ol>

      {complete ? <div className="optics-completion">
        <div className="optics-completion-seal"><Sparkles size={33} strokeWidth={1.2} /></div>
        <p className="optics-eyebrow">{canClaimCompletion ? connected ? '一次共同的发现' : '一次属于你的发现' : '上一轮实验已结束'}</p>
        <h3>{canClaimCompletion ? '光抵达了，你也找到了规律。' : '新的发现，从你这一轮开始。'}</h3>
        <p>{canClaimCompletion ? `${nickname}，你让光经过两次反射，抵达了接收环。` : '伙伴们刚刚完成了上一轮。开启新的实验，亲手转动镜面，留下自己的探索记录。'}每一次转弯都遵循同一个约定：<strong>入射角等于反射角。</strong></p>
        <div className="optics-result"><span>探索记录</span><strong>{canClaimCompletion ? '光的接力 · 已完成' : '光的接力 · 等待你的参与'}</strong><span>观察镜面 → 验证规律 → 两镜接力</span></div>
        <p className="optics-takeaway">下次经过查尔斯河时，看看水面的倒影。你今天发现的规律，也在那里。</p>
        <button type="button" className="optics-primary" disabled={disabled} onClick={() => canClaimCompletion ? onComplete() : onChange({stage:0})}>{canClaimCompletion ? '把发现带回庭院' : '开始新的实验'} <ArrowRight size={17} /></button>
        {canClaimCompletion && <button type="button" className="optics-text-button" disabled={disabled} onClick={() => onChange({ stage: 0 })}><RotateCcw size={14} />{connected && participants > 1 ? '为大家开启下一轮实验' : '再做一次实验'}</button>}
      </div> : <>
        <div className="optics-intro"><span className="optics-eyebrow">EXPERIMENT {String(state.stage + 1).padStart(2, '0')}</span><h3>{chapter.title}</h3><p>{chapter.prompt}</p></div>

        <div className={`optics-board ${ray.reachedReceiver ? 'is-lit' : ''}`}>
          <svg viewBox="0 0 640 380" role="img" aria-label={`光学实验示意图。镜面 A 为 ${state.mirrorA} 度${cooperative ? `，镜面 B 为 ${state.mirrorB} 度` : ''}。${ray.reachedReceiver ? '光已到达接收环。' : '光尚未到达接收环。'}`}>
            <defs>
              <pattern id={`${svgId}-grid`} width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#577463" opacity=".14" /></pattern>
              <filter id={`${svgId}-glow`} filterUnits="userSpaceOnUse" x="0" y="0" width="640" height="380"><feGaussianBlur stdDeviation="3.6" /></filter>
              <linearGradient id={`${svgId}-beam`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="640" y2="0"><stop offset="0" stopColor="#d49c3d" /><stop offset="1" stopColor="#ead597" /></linearGradient>
            </defs>
            <rect x="0" y="0" width="640" height="380" fill={`url(#${svgId}-grid)`} />
            <text x="23" y="27" className="optics-board-caption">反射实验台 / 从上方观察</text>
            <path d="M20 48V22h27 M593 22h27v26 M20 329v27h27 M593 356h27v-27" fill="none" stroke="#bccabd" strokeWidth="1" />
            {ray.segments.map((segment, index) => <g key={index}><line x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} stroke="#e1ba5c" strokeWidth="10" opacity=".23" filter={`url(#${svgId}-glow)`} /><line x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} stroke={`url(#${svgId}-beam)`} strokeWidth="3.2" strokeLinecap="round" /></g>)}
            {state.stage === 1 && reflection && <g transform={`translate(${reflection.point.x} ${reflection.point.y}) rotate(${state.mirrorA + 90})`}><line x1="-100" x2="100" y1="0" y2="0" stroke="#718878" strokeWidth="1.3" strokeDasharray="4 5" /><text x="80" y="-9" textAnchor="middle" className="optics-normal-label">法线</text></g>}
            {[{ label: 'A', center: opticsBoard.mirrorA, degrees: state.mirrorA }, ...(cooperative ? [{ label: 'B', center: opticsBoard.mirrorB, degrees: state.mirrorB }] : [])].map((mirror) => {
              const [start, end] = mirrorEndpoints(mirror.center, mirror.degrees);
              return <g key={mirror.label}><circle cx={mirror.center.x} cy={mirror.center.y} r="48" fill="none" stroke="#819c8b" strokeWidth="1" strokeDasharray="2 7" opacity=".42" /><line x1={start.x + 1} y1={start.y + 2} x2={end.x + 1} y2={end.y + 2} stroke="#627a6b" strokeWidth="9" strokeLinecap="round" opacity=".15" /><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#315945" strokeWidth="7" strokeLinecap="round" /><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#bdd3ce" strokeWidth="2" strokeLinecap="round" /><circle cx={mirror.center.x} cy={mirror.center.y} r="5" fill="#f6f2e5" stroke="#496c54" strokeWidth="2" /><text x={mirror.center.x + 58} y={mirror.center.y + 7} className="optics-mirror-label">{mirror.label}</text></g>;
            })}
            <g transform={`translate(${opticsBoard.source.x} ${opticsBoard.source.y})`}><rect x="-22" y="-12" width="25" height="24" rx="6" fill="#405b49" /><path d="M1-7L10-11V11L1 7Z" fill="#d5a950" /><circle r="3" cx="8" fill="#f8e8a8" /><text x="-6" y="37" textAnchor="middle" className="optics-board-label">光源</text></g>
            <g transform={`translate(${ray.receiver.x} ${ray.receiver.y})`} className={ray.reachedReceiver ? 'optics-receiver is-lit' : 'optics-receiver'}>
              <circle r="24" fill={ray.reachedReceiver ? '#cbb568' : '#ced7c6'} opacity=".17" /><circle r="18" fill="none" stroke={ray.reachedReceiver ? '#ba933c' : '#72927a'} strokeWidth="1" /><circle r="12" fill={ray.reachedReceiver ? '#e4c26c' : '#e8eadc'} stroke={ray.reachedReceiver ? '#b68c37' : '#91a68c'} strokeWidth="2" /><circle r="4" fill={ray.reachedReceiver ? '#fff9d8' : '#a1b19a'} /><text x="0" y={cooperative ? 40 : -33} textAnchor="middle" className="optics-board-label">接收环</text>
            </g>
            <text x="617" y="367" textAnchor="end" className="optics-board-caption">镜面角度以水平向右为 0°</text>
          </svg>
          <div className={`optics-ray-status ${ray.reachedReceiver ? 'is-success' : ''}`} role="status"><span />{ray.reachedReceiver ? '接收环亮起来了' : cooperative ? '让光依次经过 A、B，再抵达接收环' : '调整镜面，让接收环亮起来'}</div>
        </div>

        <fieldset className="optics-inputs" disabled={disabled}>
        {state.stage === 1 ? <div className="optics-reasoning">
          {!state.prediction && <p className="optics-prediction-note">先猜一猜，选出你的预测后再查看测量结果。可以转动镜面，从不同方向观察。</p>}
          <fieldset><legend>光线与法线的两个夹角，有什么关系？</legend><div className="optics-answers">{([{ value: 'equal', label: '两角相等' }, { value: 'double', label: '反射角是两倍' }, { value: 'half', label: '反射角是一半' }] as const).map((answer) => <button type="button" key={answer.value} className={state.prediction === answer.value ? 'is-selected' : ''} aria-pressed={state.prediction === answer.value} onClick={() => onChange({ prediction: answer.value })}>{state.prediction === answer.value && <Check size={14} />}{answer.label}</button>)}</div></fieldset>
          {state.prediction && <><div className="optics-angle-readings"><div><span>入射角</span><strong>{angleLabel}</strong></div><div><span>反射角</span><strong>{reflectionLabel}</strong></div><p>都从法线开始量起</p></div><p className={`optics-answer-feedback ${reflection && state.prediction === 'equal' ? 'is-correct' : ''}`} role="status">{!reflection ? '光线暂时没有形成反射。转动镜面，让光碰到镜面后再比较读数。' : state.prediction === 'equal' ? '这次测量支持你的预测。再转动镜子，看看两个角度的关系是否改变，然后把光送回接收环。' : '这次测量和你的预测一致吗？转动镜子再观察一次，可以修改你的判断。'}</p></>}
          <MirrorControl label="A" value={state.mirrorA} onChange={(value) => onChange({ mirrorA: value })} description="试着改变角度验证规律，再把光送回接收环。" />
        </div> : <div className={`optics-controls ${cooperative ? 'has-two' : ''}`}><MirrorControl label="A" value={state.mirrorA} onChange={(value) => onChange({ mirrorA: value })} description={cooperative ? '第一棒：把光送到镜面 B。' : '拖动滑块；方向键或两侧按钮可精调。'} />{cooperative && <MirrorControl label="B" value={state.mirrorB} onChange={(value) => onChange({ mirrorB: value })} description="第二棒：把光送进右侧接收环。" />}</div>}

        </fieldset>
        {cooperative && <p className="optics-team-note">{connected ? <Users size={15} /> : <Lightbulb size={15} />}{connected ? participants > 1 ? '和朋友约好：一人调整 A，一人调整 B。所有人的实验台实时同步。' : '独自一人也能操作两面镜子。邀请朋友进入同一房间，可以分工接力。' : '先观察 A 的出射光能否碰到 B，再微调 B。两面镜子，都由你来掌握。'}</p>}
        <div className="optics-help"><button type="button" className="optics-text-button" aria-expanded={showHint} onClick={() => setShowHint((value) => !value)}><Lightbulb size={14} />{showHint ? '收起一点提示' : '给我一点提示'}</button>{showHint && <p>{state.stage === 0 ? '光需要向上转 90°。试试把镜面放在水平方向与竖直方向之间，再一点点微调。' : state.stage === 1 ? '角度从垂直镜面的虚线量起，而不是从镜面本身量起。把光重新送进接收环，就能继续。' : 'A 需要把水平光线变成向上的光线；B 再把向上的光线变成向右的光线。试试让两面镜子互相平行，像一个潜望镜。'}</p>}</div>
        <footer className="optics-footer"><p>{disabled ? '重新加入工坊后，继续共同实验。' : solved ? (state.stage === 2 ? '两次反射，一次抵达。记下这个发现。' : '观察完成，带着这个发现继续。') : (state.stage === 1 ? '选出规律，并让接收环保持亮起。' : '接收环亮起后，即可继续。')}</p><button type="button" className="optics-primary" disabled={disabled || !solved} onClick={advance}>{state.stage === 2 ? '记录这次发现' : '继续探索'}<ArrowRight size={16} /></button></footer>
      </>}
    </div>
  </div>;
}

export default OpticsWorkshop;
