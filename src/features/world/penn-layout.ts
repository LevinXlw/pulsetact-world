import type {CampusLayout} from './campus-regions';

// Local metres, x east / z south. The walkable vignette preserves College
// Green's real adjacencies; it is not a survey or a model of the entire campus.
export const PENN_LAYOUT = {
  bounds:{minX:-158,maxX:145,minZ:-118,maxZ:132},
  spawn:[-23,-25],lookTarget:[-23,65],
  route:[[-23,-25],[-23,29],[58,29],[61,11]],
  points:[
    {id:'penn-college',title:'College Hall',subtitle:'GREEN STONE · COLLEGE HALL',position:[-23,29],radius:19,
      description:'College Green 南侧的绿色石砌大厅。尖拱窗、红褐色窗套和层叠屋顶勾勒出校园最早的建筑轮廓。',note:'从草坪抬头，寻找绿色石材与暖色窗框的交接。'},
    {id:'penn-green',title:'College Green',subtitle:'COLLEGE GREEN · PHILADELPHIA',position:[-23,-25],radius:23,
      description:'穿过砖石步道与树荫，在 College Hall 和 Fisher 图书馆之间停留。这里是费城校园的户外核心。',note:'沿步道慢走，从同一片草坪看见两种建筑语言。'},
    {id:'penn-fisher',title:'Fisher Fine Arts Library',subtitle:'FURNESS · FINE ARTS LIBRARY',position:[61,11],radius:18,
      description:'红砖、砂岩拱券与陡峭屋顶组成 Frank Furness 图书馆的外立面。当前可探索入口广场与周边庭院。',note:'走近入口，观察深拱、短柱与层层退进的石材。'},
  ],
  mapBuildings:[
    {x:-23,z:65,width:112,depth:34,yaw:0,label:'College Hall'},
    {x:95,z:11,width:38,depth:70,yaw:0,label:'Fisher Fine Arts'},
    {x:-28,z:-87,width:122,depth:36,yaw:0,label:'Van Pelt Library'},
    {x:101,z:-65,width:56,depth:39,yaw:0,label:'Meyerson Hall'},
    {x:-23,z:116,width:69,depth:26,yaw:0,label:'Cohen Hall'},
  ],
} satisfies CampusLayout;
