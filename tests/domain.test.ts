import {describe,it,expect} from 'vitest';
import {move,blocked,visible,metrics,goalMet,progressCount} from '../src/domain';
import {freshSave,validateSave} from '../src/services/saveRepository';
import {campuses,campusIds,sources} from '../src/content/campuses';
import {dialogues} from '../src/content/dialogues';
describe('movement and collision',()=>{
 it('normalizes diagonal motion',()=>{const straight=move([0,0],1,0,.1,[]),diagonal=move([0,0],1,1,.1,[]);expect(Math.hypot(...straight)).toBeCloseTo(Math.hypot(...diagonal));});
 it('slides along walls and prevents long frame tunnelling',()=>{const b=[{x:1,z:0,w:1,d:8}];const p=move([.1,0],1,1,4,b);expect(p[0]).toBeLessThan(.16);expect(p[1]).toBeGreaterThan(0);expect(blocked(...p,b)).toBe(false);});
 it('recovers invalid poses and blocks wall sightlines',()=>{expect(move([NaN,0],1,0,.01,[])).toEqual([0,11]);expect(visible([-3,0],[3,0],[{x:0,z:0,w:1,d:4}])).toBe(false);});
});
describe('activity rules',()=>{
 it('counts each item at most once and preserves over-budget state',()=>{expect(metrics(['quiet-desks','quiet-desks']).cost).toBe(4);expect(metrics(['quiet-desks','discussion-table','acoustic-screen']).cost).toBe(11);});
 it('checks all goal thresholds',()=>{expect(goalMet('偏安静',['quiet-desks','shared-power'])).toBe(true);expect(goalMet('偏协作',['discussion-table','shared-power'])).toBe(true);expect(goalMet('兼顾两者',['quiet-desks','discussion-table'])).toBe(true);expect(goalMet('偏安静',['whiteboard'])).toBe(false);});
});
describe('save and progress',()=>{
 it('deduplicates and ignores obsolete content ids and unsafe positions',()=>{const s=freshSave();s.progress.mit.opened=['mit-dome','mit-dome','missing'];s.progress.mit.position=[0,-8];const restored=validateSave(s);expect(restored.progress.mit.position).toEqual([0,11]);expect(progressCount(restored.progress.mit)).toBe(1);});
 it('rejects incompatible versions and malformed data',()=>{expect(()=>validateSave({schemaVersion:99})).toThrow();expect(()=>validateSave(null)).toThrow();});
 it('does not count discovery in main progress',()=>{const s=freshSave();s.progress.mit.discovered=['mit-dome'];expect(progressCount(s.progress.mit)).toBe(0);});
});
describe('content contracts',()=>{
 it('has globally unique IDs, complete campus content and sourced facts',()=>{const ids=campusIds.flatMap(id=>campuses[id].targets.map(t=>t.id));expect(new Set(ids).size).toBe(ids.length);for(const id of campusIds){const ts=campuses[id].targets;expect(ts.filter(t=>t.kind==='poi')).toHaveLength(3);expect(ts.filter(t=>t.kind==='npc')).toHaveLength(2);expect(ts.filter(t=>t.kind==='activity')).toHaveLength(1);for(const t of ts){expect(blocked(...t.position,campuses[id].blockers)).toBe(false);if(t.kind==='poi')expect(sources).toHaveProperty(t.sourceId!);if(t.kind==='npc'){expect(dialogues[t.id]).toHaveLength(3);for(const topic of dialogues[t.id]){expect(topic.choices).toHaveLength(2);for(const choice of topic.choices)expect(choice.text.length).toBeGreaterThan(10);}}}}});
});
