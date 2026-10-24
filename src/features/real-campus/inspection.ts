export const inspectionViews=[['people','人物近景'],['lawnedge','草坪步道'],['aerial','庭院鸟瞰'],['eye','步行视角'],['entrance','柱廊近景'],['sampledoor','主楼门窗'],['sampleside','柱廊侧视'],['westcourt','西侧庭院'],['eastcourt','东侧庭院'],['riverwalk','河岸步道'],['trees','树木近景'],['building3court','3 号楼庭院面'],['building4court','4 号楼庭院面'],['westshade','西侧树荫'],['building7','7 号楼'],['building5','5 号楼'],['building2','2 号楼'],['building1','1 号楼'],['building6','6 号楼'],['building8','8 号楼'],['building11','11 号楼'],['overview','全图总览'],['river','河岸环境'],['bridge','桥面近景']] as const;
export type Inspection=typeof inspectionViews[number][0];
export function courtPoint(u:number,s:number):[number,number]{return [12.904326+.9080005*u+.4189689*s,-34.578878-.4189689*u+.9080005*s];}
export const humanViews={
 lawnedge:{position:courtPoint(1.1,108),target:courtPoint(2.9,103.7),aimHeight:.25},
 people:{position:courtPoint(4.2,105),target:courtPoint(1.1,99),aimHeight:1.1},
 building3court:{position:courtPoint(-43,56),target:courtPoint(-54,40),aimHeight:9},
 building4court:{position:courtPoint(43,56),target:courtPoint(54,40),aimHeight:9},
 westshade:{position:courtPoint(-28,66),target:courtPoint(-40,57),aimHeight:9},
 sampledoor:{position:courtPoint(0,1),target:courtPoint(0,-3.6),aimHeight:3.25},
 sampleside:{position:courtPoint(-17,9),target:courtPoint(0,-3.6),aimHeight:6.8},
 westcourt:{position:courtPoint(-86,129.5),target:courtPoint(-86,110),aimHeight:1.65},
 eastcourt:{position:courtPoint(86,129.5),target:courtPoint(86,110),aimHeight:1.65},
 riverwalk:{position:courtPoint(0,175),target:courtPoint(15,227),aimHeight:1.2},
 trees:{position:[22,12] as [number,number],target:[-15.52,-3.84] as [number,number],aimHeight:9},
};
