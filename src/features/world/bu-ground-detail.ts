import {Group,Mesh,Vector3} from 'three';
import {createPainterlyGrass} from './painterly-vegetation';
import {createCampusGroundSampler} from './campus-ground-sampler';

export type LawnFootprint={x:number;z:number;width:number;depth:number;yaw:number};

/** Signed clearance inside the rotated turf footprint. */
export function lawnFootprintDistance(x:number,z:number,patches:readonly LawnFootprint[]){
  let clearance=-Infinity;
  for(const patch of patches){
    const dx=x-patch.x,dz=z-patch.z,c=Math.cos(patch.yaw),s=Math.sin(patch.yaw);
    const localX=dx*c-dz*s,localZ=dx*s+dz*c;
    clearance=Math.max(clearance,Math.min(patch.width/2-Math.abs(localX),patch.depth/2-Math.abs(localZ)));
  }
  return clearance;
}

export function createBULawnDetail(lawns:Mesh[],patches:readonly LawnFootprint[],wind:{value:number},groundHeight:(x:number,z:number)=>number|undefined,maxTufts=7000){
  const group=new Group();group.name='Campus mown lawn detail';
  // The river arrival path is a separate mesh just above the lawn. Footprints
  // alone cannot detect it. Sample the actual ground, including the tuft's
  // spread, so blades cannot protrude through this or any other raised paving.
  const offsets=[[0,0],[-.4,0],[.4,0],[0,-.4],[0,.4]];
  const turfHeight=createCampusGroundSampler(lawns);
  const fields=lawns.map(lawn=>createPainterlyGrass(lawn,wind,{
    edgeDistance:(x,z)=>lawnFootprintDistance(x,z,patches),maxTufts,upwardOnly:true,
    // Compare each neighbour with its own turf elevation. Comparing uphill
    // neighbours with the root's Y incorrectly removed all grass on slopes.
    rootAllowed:(x,_y,z)=>{
      // InstancedMesh stores translation in Float32. Test that same position:
      // a double-precision candidate just outside a ramp can round a few
      // micrometres across its edge, putting a visible tuft into the paving.
      const renderedX=Math.fround(x),renderedZ=Math.fround(z);
      return offsets.every(([dx,dz])=>{
        const turf=turfHeight(renderedX+dx,renderedZ+dz);
        return turf!==undefined&&(groundHeight(renderedX+dx,renderedZ+dz)??turf)<=turf+.001;
      });
    },
  }));
  fields.forEach(field=>group.add(field.group));
  group.userData.stats={grassTufts:fields.reduce((count,field)=>count+field.count,0),chunks:fields.reduce((count,field)=>count+field.chunks,0)};
  return {group,setQuality:(low:boolean)=>fields.forEach(field=>field.setQuality(low)),
    update:(camera:Vector3)=>fields.forEach(field=>field.update(camera))};
}
