import {create} from 'zustand';
import {freshSave,loadSave,SAVE_KEY} from '../services/saveRepository';
import type {Save,CampusId,Position} from '../types';
const loaded=loadSave();
type State={save:Save;exists:boolean;issue:string;raw:string|null;writePaused:boolean;saved:boolean;mutate:(fn:(s:Save)=>void)=>void;mark:(campus:CampusId,key:'discovered'|'opened'|'talked'|'completed',id:string)=>void;pose:(campus:CampusId,p:Position)=>void;reset:()=>void;notify:(s:string)=>void};
export const useStore=create<State>((set,get)=>({save:loaded.save,exists:loaded.exists,issue:loaded.issue,raw:loaded.raw,writePaused:!!loaded.raw,saved:false,
 mutate:fn=>{const save=structuredClone(get().save);fn(save);save.updatedAt=new Date().toISOString();set({save,exists:true,saved:false});},
 mark:(campus,key,id)=>{if(!get().save.progress[campus][key].includes(id))get().mutate(s=>{s.progress[campus][key].push(id);});},
 pose:(campus,p)=>get().mutate(s=>{s.progress[campus].position=p;}),
 reset:()=>{set({save:freshSave(),exists:false,raw:null,writePaused:false,issue:'',saved:false});},notify:issue=>set({issue})}));
let timer:ReturnType<typeof setTimeout>;
export function flushSave(){clearTimeout(timer);const s=useStore.getState();if(s.writePaused||!s.exists)return;try{localStorage.setItem(SAVE_KEY,JSON.stringify(s.save));useStore.setState({saved:true});}catch{useStore.setState({issue:'本地保存失败，可能是空间不足。当前探索仍可继续，请下载存档备份。',saved:false});}}
useStore.subscribe((state,previous)=>{if(state.save!==previous.save){clearTimeout(timer);timer=setTimeout(flushSave,500);}});
window.addEventListener('pagehide',flushSave);
window.addEventListener('storage',e=>{if(e.key===SAVE_KEY){clearTimeout(timer);useStore.setState({writePaused:true,issue:'另一个标签页更新了存档，本页已暂停保存。请重新载入以使用最新记录。'});}});
