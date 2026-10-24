import {BufferGeometry,Color,Group,Mesh,Shape,ShapeGeometry,type MeshStandardMaterial} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {UMD_ROAD_SURFACES} from './maryland-road-layout';
import {drapeMarylandGeometry} from './maryland-terrain';

/** Public Facilities pavement footprints, adapted to the playable site plan.
 * Walking paths remain slightly above the quiet asphalt and parking surfaces.
 */
export function createMarylandCampusPaving(){
  const group=new Group();group.name='Maryland · campus streets and parking courts';
  const ground:Mesh[]=[],batches=new Map<string,{kind:string;material:string;parts:BufferGeometry[]}>();
  for(const surface of UMD_ROAD_SURFACES){
    if(surface.polygon.length<3)continue;
    const shape=new Shape();surface.polygon.forEach(([x,z],index)=>index?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    let geometry:BufferGeometry=new ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);geometry.translate(0,.008,0);
    // Long GIS triangles need intermediate vertices: moving only their corners
    // leaves a bridge across the crest of Stamp Hill and sinks below its slope.
    const flatGeometry=geometry;geometry=drapeMarylandGeometry(flatGeometry,7);flatGeometry.dispose();
    const [x,z]=surface.polygon.reduce(([x,z],point)=>[x+point[0]/surface.polygon.length,z+point[1]/surface.polygon.length],[0,0]);
    const key=`${Math.floor(x/240)}:${Math.floor(z/240)}:${surface.kind}:${surface.material}`;
    const batch=batches.get(key)??{kind:surface.kind,material:surface.material,parts:[]};
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();batch.parts.push(part);batches.set(key,batch);
  }
  const materials=new Map<string,MeshStandardMaterial>();
  for(const [key,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(part=>part.dispose());if(!geometry)continue;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const finish=`${batch.kind}:${batch.material}`;
    let material=materials.get(finish);
    if(!material){
      const asphalt=batch.material==='asphalt';
      material=createCampusSurface(asphalt?'road':'pavement') as MeshStandardMaterial;
      material.name=`Maryland ${finish}`;
      material.color=new Color(asphalt?(batch.kind==='parking'?'#96978a':'#848f89'):batch.material==='brick'?'#b99980':'#b9b9a5');
      // A centimetre of physical separation loses depth precision in long
      // campus views. Bias the thin paving overlays without raising the ground.
      material.polygonOffset=true;material.polygonOffsetFactor=-1;
      material.polygonOffsetUnits=batch.kind==='crosswalk'?-6:batch.kind==='service'?-5:batch.kind==='road'?-4:-2;
      material.roughness=1;materials.set(finish,material);
    }
    const mesh=new Mesh(geometry,material);mesh.name=`UMD pavement ${key}`;mesh.receiveShadow=true;group.add(mesh);ground.push(mesh);
  }
  group.updateMatrixWorld(true);return{group,ground};
}
