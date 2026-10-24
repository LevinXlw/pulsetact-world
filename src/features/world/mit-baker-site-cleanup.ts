import {Mesh,Vector3,type Group} from 'three';

/** Remove the survey's low, untextured planter shells only when their authored
 * replacement is present. Never remove terrain, a neighbouring building or a
 * face that crosses this surveyed courtyard envelope. Source footprint audit:
 * assets-source/mit-residences/references/baker-north-entry-registered.png. */
export function replaceBakerSurveyPlanters(base:Group,replacement?:Group){
 let ready=false;replacement?.traverse(o=>{if(o.userData.bakerNorthCourt===true)ready=true;});
 if(!ready)return 0;
 base.updateMatrixWorld(true);let removed=0,oldPaving=0;const point=new Vector3();
 base.traverse(o=>{
  if(!(o instanceof Mesh))return;
  const materials=Array.isArray(o.material)?o.material:[o.material];
  if(!materials.some(m=>/Cambridge[ _]buildings/i.test(m.name)||/^(road|pavement)$/.test(m.name)))return;
  const g=o.geometry,p=g.getAttribute('position'),index=g.index,count=index?.count??p.count,selected=new Uint8Array(p.count);
  for(let i=0;i<p.count;i++){
   point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
   const dx=point.x+293.613281,dz=point.z-251.2005,u=.885512*dx+.464617*dz,v=.464617*dx-.885512*dz;
   selected[i]=Number(point.y<4&&u>=-24&&u<=24&&v>=-3&&v<=24);
  }
  const keep:number[]=[],groups:{start:number;count:number;materialIndex:number}[]=[];let dropped=0;
  const sourceGroups=g.groups.length?g.groups:[{start:0,count,materialIndex:0}];
  for(const group of sourceGroups){
   const start=keep.length,name=materials[group.materialIndex??0]?.name??'',eligible=/Cambridge[ _]buildings/i.test(name),paving=/^(road|pavement)$/.test(name);
   for(let i=group.start;i<Math.min(count,group.start+group.count);i+=3){
    const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
    if(eligible&&ids.every(id=>selected[id]))dropped++;
    else if(paving&&ids.every(id=>{point.fromBufferAttribute(p,id).applyMatrix4(o.matrixWorld);return point.y<4&&point.x>=-365&&point.x<=-258&&Math.abs(point.z-(-.458*point.x+101.5))<9;})){oldPaving++;dropped++;}
    else keep.push(...ids);
   }
   if(keep.length>start)groups.push({start,count:keep.length-start,materialIndex:group.materialIndex??0});
  }
  if(!dropped)return;
  g.setIndex(keep);g.clearGroups();groups.forEach(group=>g.addGroup(group.start,group.count,group.materialIndex));
  removed+=dropped;
 });
 base.userData.bakerNorthCourtReady=true;base.userData.bakerReplacedLegacyPavingTriangles=oldPaving;base.userData.bakerReplacedSurveyPlanterTriangles=removed-oldPaving;return removed-oldPaving;
}
