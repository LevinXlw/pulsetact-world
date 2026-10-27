import {BU_SERT_PARTS,buSertLocal} from './bu-sert-layout';

type Point=readonly[number,number];
type Finish='concrete'|'frame'|'frontageGlass'|'shade'|'brickDark';
export type BUSertPhotoBox=(finish:Finish,x:number,y:number,depth:number,width:number,height:number,thickness:number)=>void;

/** Bounded reconstruction from the 2021 Mugar south photo, BU's 2023 Link
 * photo and 2012 PNF §4.3.4. Neither photo establishes every upper window's
 * dimensions: the retained six-storey mass/floor rhythm and lower screen grid
 * are the dimensional anchors. Other elevations keep their previous source.
 * See assets-source/charles-bu/sert-photo-facades-20261026.json. */
const mugar=BU_SERT_PARTS.find(part=>part.id==='mugar-west')!;
const mugarLocal=mugar.footprint.map(buSertLocal);
const south=Math.max(...mugarLocal.map(point=>point[1]));
const edge=mugarLocal.filter(point=>Math.abs(point[1]-south)<.04);
export const BU_MUGAR_SOUTH_UPPER=Object.freeze({
  south,left:Math.min(...edge.map(point=>point[0])),right:Math.max(...edge.map(point=>point[0])),
  bottom:7.2,top:mugar.top,rows:4,primarySpacing:4.1,openingWidth:.46,openingHeight:2.55,
  wallThickness:.60,glassDepth:-.44,frameWidth:.045,
});
export const BU_GSU_LINK_SIDE=Object.freeze({
  minX:-26.5,maxX:-22,minZ:74.5,maxZ:98.2,
  glazingTop:5.2,brickTop:11.56,glazingDepth:-.34,windowSpacing:2.3,
});

export function isBUMugarSouthUpper(partId:string,centre:Point,outward:Point){
  return partId==='mugar-west'&&Math.abs(centre[1]-south)<.05&&outward[1]>centre[1]+.3;
}
export function isBUGSULinkSide(partId:string,centre:Point,outward:Point){
  const p=BU_GSU_LINK_SIDE;
  return partId==='gsu'&&centre[0]>p.minX&&centre[0]<p.maxX&&centre[1]>=p.minZ&&centre[1]<=p.maxZ&&outward[0]>centre[0]+.3;
}

export function buildBUMugarSouthUpper(width:number,box:BUSertPhotoBox){
  const p=BU_MUGAR_SOUTH_UPPER,columns=Math.max(1,Math.ceil(width/p.primarySpacing)),pitch=width/columns;
  const floor=(p.top-p.bottom)/p.rows;
  const openings=Array.from({length:p.rows},(_,row)=>Array.from({length:columns},(_,column)=>({
    x:-width/2+(column+.5)*pitch,bottom:p.bottom+row*floor+.50,
    top:p.bottom+row*floor+.50+p.openingHeight,width:p.openingWidth,
  }))).flat();
  // Solid strips partition the real wall around slit openings. No old wall,
  // generic projecting sill, horizontal storey band or full-height fin is
  // generated beneath this replacement. The deep lower sun screen is retained.
  const cuts=[p.bottom,p.top,...openings.flatMap(opening=>[opening.bottom,opening.top])].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
  for(let i=0;i<cuts.length-1;i++){
    const lower=cuts[i],upper=cuts[i+1],middle=(lower+upper)/2;
    const holes=openings.filter(opening=>middle>opening.bottom&&middle<opening.top).sort((a,b)=>a.x-b.x);
    let left=-width/2;
    for(const hole of [...holes,{x:width/2,width:0}]){
      const right=hole.x-hole.width/2;
      if(right-left>.001)box('concrete',(left+right)/2,middle,-p.wallThickness/2,right-left,upper-lower,p.wallThickness);
      left=hole.x+hole.width/2;
    }
  }
  for(const opening of openings){
    const h=opening.top-opening.bottom,y=(opening.bottom+opening.top)/2;
    box('frontageGlass',opening.x,y,p.glassDepth,opening.width-.025,h-.025,.025);
    // Frames remain inside the actual reveal instead of forming a decorative
    // hood or sill projecting across the exposed-aggregate concrete face.
    for(const side of [-1,1]){
      box('frame',opening.x+side*(opening.width/2-p.frameWidth/2),y,p.glassDepth+.035,p.frameWidth,h,.09);
      box('frame',opening.x,y+side*(h/2-p.frameWidth/2),p.glassDepth+.035,opening.width,p.frameWidth,.09);
    }
  }
  return{columns,pitch,openings,scope:'mugar-west south upper only',...p};
}

export function buildBUGSULinkSide(width:number,box:BUSertPhotoBox){
  const p=BU_GSU_LINK_SIDE,bays=Math.max(1,Math.round(width/p.windowSpacing)),pitch=width/bays;
  box('brickDark',0,(p.glazingTop+p.brickTop)/2,-.19,width,p.brickTop-p.glazingTop,.38);
  box('frontageGlass',0,(.22+p.glazingTop)/2,p.glazingDepth,width-.12,p.glazingTop-.22,.025);
  for(let column=0;column<=bays;column++)box('concrete',-width/2+column*pitch,p.glazingTop/2,-.055,.13,p.glazingTop,.45);
  for(const y of [.20,2.65,p.glazingTop-.075])box('frame',0,y,-.22,width,.075,.16);
  // One restrained concrete edge separates brick from the tall lower lights.
  box('concrete',0,p.glazingTop+.06,.015,width,.12,.42);
  return{bays,pitch,scope:'GSU east wall beside the Link, visible lower two levels only',...p};
}
