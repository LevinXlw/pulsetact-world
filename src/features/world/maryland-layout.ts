import type {CampusLayout} from './campus-regions';
import {UMD_DISTRICTS,UMD_FULL_BOUNDS,UMD_FULL_BUILDINGS,UMD_FULL_PATHS,UMD_FULL_PLACES} from './maryland-full-layout';

/** Local east/up/south metres; map-derived adjacencies with compressed distances. */
export const MARYLAND_LAYOUT = {
  bounds:UMD_FULL_BOUNDS,
  districts:UMD_DISTRICTS,
  spawn:[-108,14],
  lookTarget:[-160,0],
  route:[[-108,14],[-72,14],[0,14],[72,14],[110,14]],
  paths:[
    [[-116,14],[-108,14],[-72,14],[0,14],[72,14],[110,14],[116,14]],
    [[-116,-155],[-116,14],[-116,65],[-116,145]],
    [[116,-155],[116,-140],[116,14],[116,65],[116,145]],
    [[-210,-155],[-185,-155],[-116,-155],[116,-155]],
    [[-185,-155],[-185,-182]],
    [[116,-140],[190,-140]],
    [[-116,145],[110,145],[116,145],[170,145]],
    [[110,145],[110,172]],
    ...UMD_FULL_PATHS,
  ],
  points:[
    {id:'umd-library',district:'central',title:'McKeldin 图书馆',subtitle:'University of Maryland · College Park',position:[-108,14],lookAt:[-160,0],view:{pitch:.18,distance:11.5},radius:18,
      description:'沿着大草坪来到图书馆东侧门廊。红砖、浅色柱廊与层叠檐口围合着校园西端。',
      note:'图书馆东侧广场 · 室外参观'},
    {id:'umd-mall',district:'central',title:'McKeldin Mall',subtitle:'Omicron Delta Kappa Fountain',position:[0,14],lookAt:[5,0],view:{pitch:.025,distance:7.2},radius:17,
      description:'在长条喷泉旁停一会儿。开阔草坪、林荫步道和远处的红砖校园构成 College Park 的核心景色。',
      note:'沿水池南侧步道游览 · 可返回图书馆或行政楼'},
    {id:'umd-administration',district:'central',title:'Miller 行政楼',subtitle:'Thomas V. Miller Jr. Administration Building',position:[110,14],lookAt:[160,0],view:{pitch:.18,distance:10},radius:18,
      description:'从 McKeldin Mall 望向东端的行政楼，近看白色柱廊、三角山花和红砖立面。',
      note:'行政楼西侧前庭 · 室外参观'},
    {id:'umd-stamp',district:'central',title:'STAMP 学生中心',subtitle:'Adele H. Stamp Student Union',position:[-185,-182],lookAt:[-185,-236],view:{pitch:.10,distance:10},radius:16,
      description:'沿图书馆西侧向北，来到学生中心前的开放广场。层叠红砖体块、浅石入口与露台连接校园日常。',
      note:'学生中心南侧广场 · 沿北侧步道可继续前往 Armory'},
    {id:'umd-armory',district:'central',title:'Reckord Armory',subtitle:'ARMORY · CAMPUS LANDMARK',position:[174,-140],lookAt:[230,-140],view:{pitch:.20,distance:11.5},radius:22,
      description:'在大草坪东北侧，看看 Armory 宽厚的红砖门面、石材入口和高窗。这里连接中央校园与东侧步道。',
      note:'Armory 西侧前庭 · 沿林荫步道返回 McKeldin Mall'},
    {id:'umd-chapel',district:'central',title:'Memorial Chapel',subtitle:'MEMORIAL CHAPEL · GARDEN WALK',position:[110,145],lookAt:[110,220],view:{pitch:.27,distance:12.5},radius:28,
      description:'穿过南侧庭院与林荫步道，教堂的尖塔在红砖屋顶之上显现。走近北侧入口，观察拱窗、门廊与屋檐。',
      note:'纪念教堂北侧花园 · 沿南侧步道绕回图书馆'},
    ...UMD_FULL_PLACES,
  ],
  mapBuildings:[
    {x:-160,z:0,width:60,depth:105,yaw:0,label:'McKeldin Library',district:'central'},
    {x:160,z:0,width:46,depth:94,yaw:0,label:'Miller Administration',district:'central'},
    {x:-66,z:-88,width:92,depth:30,yaw:0,label:'Jiménez Hall',district:'central'},
    {x:55,z:-88,width:80,depth:30,yaw:0,label:'Symons Hall',district:'central'},
    {x:-61,z:88,width:96,depth:30,yaw:0,label:'Taliaferro Hall',district:'central'},
    {x:64,z:88,width:84,depth:30,yaw:0,label:'Francis Scott Key Hall',district:'central'},
    {x:-185,z:-236,width:92,depth:64,yaw:0,label:'STAMP Student Union',district:'central'},
    {x:230,z:-140,width:42,depth:84,yaw:0,label:'Reckord Armory',district:'central'},
    {x:110,z:220,width:30,depth:64,yaw:0,label:'Memorial Chapel',district:'central'},
    {x:78,z:234,width:34,depth:24,yaw:0,label:'Memorial Chapel Garden Wing',district:'central'},
    ...UMD_FULL_BUILDINGS.map(building=>({x:building.x,z:building.z,width:building.width,depth:building.depth,yaw:building.yaw,label:building.name,district:building.district,footprint:building.footprint,holes:building.holes})),
  ],
} satisfies CampusLayout;

/** A returning player may have saved on ground now occupied by a larger,
 * corrected building. Roofline holes and open courts must remain valid. */
export function marylandNavigationBlocked(x:number,z:number,clearance=1.1){
  const inside=(ring:readonly (readonly number[])[])=>{
    let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;
    }return result;
  };
  const near=(ring:readonly (readonly number[])[])=>ring.some((a,i)=>{
    const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<clearance;
  });
  // Only the corrected solid buildings need this migration. A map rectangle
  // is not a collider: older stadium plans include the playable pitch.
  return UMD_FULL_BUILDINGS.filter(b=>b.surveyAligned).some(b=>(inside(b.footprint)&&!(b.holes??[]).some(inside))||[b.footprint,...b.holes??[]].some(near));
}
