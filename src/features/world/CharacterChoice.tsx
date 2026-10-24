import {Check} from 'lucide-react';
import {CHARACTER_OPTIONS, type PlayableCharacterId} from './character-catalog';

export function CharacterChoice({value, onChange}: {value: PlayableCharacterId; onChange: (value: PlayableCharacterId) => void}) {
  return <div className="pw-character-choice" role="group" aria-label="选择校园形象">
    <div className="pw-character-heading"><span>选择你的校园形象</span><small>随时可以更换</small></div>
    <div className="pw-character-options">{CHARACTER_OPTIONS.map(option => <button type="button" key={option.id} aria-label={`选择 ${option.label}`} aria-pressed={value === option.id} onClick={()=>onChange(option.id)}>
      <span className="pw-character-number">{option.marker}</span><span><strong>{option.label}</strong><small>{option.detail}</small></span>{value === option.id && <Check size={13}/>}
    </button>)}</div>
  </div>;
}
