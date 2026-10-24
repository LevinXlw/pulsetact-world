import {WORKSHOP_POSITION} from './world-locations';

export type DiscoveryId = 'axis' | 'dome' | 'optics';
export type Discovery = {id: DiscoveryId; title: string; subtitle: string; position: [number, number]; radius: number; task: string};
export const SOLO_DISCOVERIES: Discovery[] = [
  {id:'axis',title:'庭院的中轴',subtitle:'停下来，读一读建筑',position:[44,20],radius:7,task:'走近草坪标记，观察中央入口与两翼建筑。'},
  {id:'dome',title:'穹顶留影',subtitle:'收藏自己的校园视角',position:[28,-6],radius:8,task:'走到观景点，调整镜头，拍下你的第一张穹顶照片。'},
  {id:'optics',title:'光的路径',subtitle:'一束光的独自旅行',position:[...WORKSHOP_POSITION],radius:12,task:'走近木桌，转动两面镜子，完成一次反射实验。'},
];

export function nearestDiscovery(position: [number, number]) {
  return SOLO_DISCOVERIES.map(point=>({point,distance:Math.hypot(position[0]-point.position[0],position[1]-point.position[1])}))
    .filter(item=>item.distance<=item.point.radius).sort((a,b)=>a.distance-b.distance)[0]?.point;
}
