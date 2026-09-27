import {describe,it,expect} from 'vitest';
import {campusQuest,localTargets} from '../src/features/real-campus/local-data';
import {approach,turnTowards} from '../src/features/real-campus/traversal';
import {freshSave} from '../src/services/saveRepository';
import {readFileSync} from 'node:fs';
describe('campus story progression',()=>{
 for(const id of ['mit','harvard'] as const)it(`${id}: conversations and observation persist as an ordered story`,()=>{
  const p=freshSave().progress[id],q=campusQuest(id,p);
  expect(q.step).toBe(0);p.opened.push(q.ids[1]);expect(campusQuest(id,p).step).toBe(0);
  p.talked.push(q.ids[0]);expect(campusQuest(id,p).step).toBe(2);
  p.talked.push(q.ids[2]);expect(campusQuest(id,p).targetId).toBe(null);
  expect(campusQuest(id,JSON.parse(JSON.stringify(p))).step).toBe(3);
  const data=JSON.parse(readFileSync(`public/data/campuses/${id}/manifest.json`,'utf8'));
  const targets=localTargets(data);expect(targets.filter(t=>t.kind==='npc')).toHaveLength(2);expect(q.ids.every(k=>targets.some(t=>t.id===k))).toBe(true);
 });
 it('movement acceleration does not overshoot and turning takes the short arc',()=>{expect(approach(3,3.2,1)).toBe(3.2);expect(approach(4,0,10)).toBe(0);const angle=turnTowards(Math.PI-.01,-Math.PI+.01,.1);expect(angle).toBeGreaterThan(Math.PI-.01);expect(angle).toBeLessThan(Math.PI+.01);});
});
