import type {CampusId,Position,Target,Progress} from '../../types';
import {campuses} from '../../content/campuses';
export type CampusManifest = {campus:CampusId;radius:number;spawn:Position;points:Record<string,Position>;models?:{id:string;triangles:number}[];buildingCount:number;buildingTriangles:number;terrainTriangles:number;modelBytes:number;source:string};
export function mapPercent(p:Position,r:number):Position{return [(p[0]+r)/(2*r)*100,(p[1]+r)/(2*r)*100];}
export function insideCampus(p:Position,r:number){return p.every(Number.isFinite)&&Math.max(...p.map(Math.abs))<r-35;}
export function localTargets(data:CampusManifest):Target[]{
 const npcIds=data.campus==='mit'?['mit-alex','mit-sam']:['harvard-maya','harvard-leo'];
 const landmark=data.points[data.campus==='mit'?'mit-dome':'harvard-widener'];
 return campuses[data.campus].targets.filter(t=>t.kind!=='activity').map(t=>({...t,position:t.kind==='poi'?data.points[t.id]:t.id===npcIds[0]?[data.spawn[0]+4,data.spawn[1]+2]:[landmark[0]+5,landmark[1]+3]}));
}
export function campusQuest(campus:CampusId,progress:Progress){
 const ids=campus==='mit'?['mit-alex','mit-dome','mit-sam']:['harvard-maya','harvard-widener','harvard-leo'];
 const done=[progress.talked.includes(ids[0]),progress.opened.includes(ids[1]),progress.talked.includes(ids[2])];
 const first=done.findIndex(v=>!v);
 return {ids,done,step:first===-1?3:first,targetId:first===-1?null:ids[first],title:campus==='mit'?'穹顶下的新想法':'庭院里的一场相遇'};
}
export const localSummaries:Record<string,string>={
 'mit-dome':'Great Dome 是 MIT 校园的醒目地标，从 Killian Court 可以看见。这里保留 Cambridge 官方模型的测绘轮廓，标记位于庭院的室外观察点。',
 'mit-corridor':'Infinite Corridor 连接 MIT 的许多教学空间。这里展示附近的建筑外观；真实室内尚未建模，可返回艺术化校园体验模拟走廊。',
 'harvard-yard':'Harvard Yard 是哈佛校园的核心庭院。沿真实航拍中的步道观察建筑分布，收藏你感兴趣的地点。',
};
