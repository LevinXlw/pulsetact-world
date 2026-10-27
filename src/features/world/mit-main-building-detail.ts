import {
  BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group,
  InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Shape, TorusGeometry, Vector3,
} from 'three';
import {createMITPoeticSurface} from './mit-poetic-materials';

export type MITMainBuildingManifest = {
  porticoOpening: {center:number[]; normal:number[]};
  porticoSample?: {columns:number};
  dome: {center:number[]; profile:number[][]};
};

// Recorded in public/data/killian/detail-manifest.json v8. Sharing these
// source-space anchors lets mobile add the same components without another
// request. A desktop loader may pass its already loaded manifest instead.
export const MIT_MAIN_BUILDING_ANCHORS:MITMainBuildingManifest={
  porticoOpening:{center:[12.904326162332634,0,-34.57887840848196],
    normal:[.41896891593933105,0,.9080005288124084]},
  porticoSample:{columns:10},
  dome:{center:[-1.8490800857543945,-67.1385498046875],profile:[[18.948387145996094,37.52000045776367]]},
};

export type MITMainBuildingDetail=Group & {
  setQuality:(low:boolean)=>void;
  stats:{version:number;columns:number;drumRibs:number;drumGuttae:number;wreaths:number;
    wreathLeaves:number;doorHeads:number;doorHeadFinials:number;batches:number;
    triangles:number;visibleTriangles:number;lowQuality:boolean;source:string;scope:string};
};

type Instance = {position:Vector3; scale:Vector3; angle:number; roll?:number};

/** Supplemental components for the existing Building 10 asset. Coordinates
 * follow portico-study.json and build-killian-detail.mjs. The photographs in
 * assets-source/killian-reference/maclaurin-{front,oblique}.webp establish the
 * solid Ionic bolster and the drum's paired relief/guttae. Small dimensions
 * are photo-based estimates; this adds neither a new facade nor collision.
 *
 * The source already has shaft flutes, neck/echinus moldings, abaci, spiral
 * tubes, central drum strips and continuous drum rings. Keep those untouched.
 */
export function createMITMainBuildingDetail(manifest:MITMainBuildingManifest=MIT_MAIN_BUILDING_ANCHORS):MITMainBuildingDetail {
  const group=new Group();
  group.name='MIT-main-building-structural-detail';
  group.userData.collision='none';
  const stone=createMITPoeticSurface('columnTrim');
  const matrix=new Matrix4(),rotation=new Quaternion(),roll=new Quaternion(),up=new Vector3(0,1,0),front=new Vector3(0,0,1);

  const batch=(name:string,geometry:BufferGeometry,instances:Instance[],material:MeshStandardMaterial=stone)=>{
    const mesh=new InstancedMesh(geometry,material,instances.length);
    mesh.name=name;
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    mesh.userData.collision='none';
    for(const [i,instance] of instances.entries()){
      rotation.setFromAxisAngle(up,instance.angle);
      if(instance.roll)rotation.multiply(roll.setFromAxisAngle(front,instance.roll));
      matrix.compose(instance.position,rotation,instance.scale);
      mesh.setMatrixAt(i,matrix);
    }
    mesh.computeBoundingBox();mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };

  const {center,normal}=manifest.porticoOpening;
  const [nx,,nz]=normal,angle=Math.atan2(nx,nz);
  const count=manifest.porticoSample?.columns??10;
  const capitals:Instance[]=[];
  // A single connected, extruded bolster behind the existing spiral tubes.
  // Its front/back are at +/-0.745 m, leaving the +/-0.78 m spiral centres
  // proud. The 12 mm bevel joins the old scroll edge without a second scroll.
  const shape=new Shape();
  shape.moveTo(-.59,.545);shape.lineTo(.59,.545);
  shape.absarc(.59,.25,.295,Math.PI/2,-Math.PI/2,true);
  shape.quadraticCurveTo(.34,-.045,.30,.15);
  shape.quadraticCurveTo(0,.11,-.30,.15);
  shape.quadraticCurveTo(-.34,-.045,-.59,-.045);
  shape.absarc(-.59,.25,.295,-Math.PI/2,-Math.PI*1.5,true);
  shape.closePath();
  const bolster=new ExtrudeGeometry(shape,{depth:1.466,curveSegments:16,
    bevelEnabled:true,bevelSegments:2,bevelSize:.012,bevelThickness:.012,steps:1});
  bolster.translate(0,0,-.733);
  for(let i=0;i<count;i++){
    const x=(i-(count-1)/2)*4.10,z=1.15+.4*(1-(x/19)**2);
    capitals.push({position:new Vector3(center[0]+nz*x+nx*z,18.92,center[2]-nx*x+nz*z),
      scale:new Vector3(1,1,1),angle});
  }
  batch('MIT-Ionic-solid-bolsters',bolster,capitals);

  // maclaurin-front.webp and maclaurin-oblique.webp show a shallow wreath
  // at each end of the inscription frieze. The retained frieze face is at
  // local z=2.52 m; these real relief surfaces overlap it, without a backing
  // plaque or a second inscription. Leaf shapes/counts are photo-estimated,
  // not an exact ornamental survey. Keep the ring on the low tier.
  const local=(x:number,y:number,z:number,scale=new Vector3(1,1,1),r=0):Instance=>({
    position:new Vector3(center[0]+nz*x+nx*z,y,center[2]-nx*x+nz*z),scale,angle,roll:r,
  });
  const wreathRings:Instance[]=[],wreathLeaves:Instance[]=[];
  for(const x of [-20.45,20.45]){
    wreathRings.push(local(x,20.04,2.548));
    for(let i=0;i<28;i++){
      const a=i*Math.PI*2/28;
      wreathLeaves.push(local(x+Math.sin(a)*.35,20.04+Math.cos(a)*.35,2.575,
        new Vector3(1,1,1),-a+.65));
    }
  }
  batch('MIT-frieze-wreath-rings',new TorusGeometry(.345,.033,8,48),wreathRings);
  const leafShape=new Shape();
  leafShape.moveTo(0,-.085);leafShape.bezierCurveTo(.055,-.035,.065,.025,0,.085);
  leafShape.bezierCurveTo(-.065,.025,-.055,-.035,0,-.085);
  const leaf=new ExtrudeGeometry(leafShape,{depth:.018,curveSegments:5,steps:1,
    bevelEnabled:true,bevelSegments:1,bevelSize:.004,bevelThickness:.004});
  batch('MIT-frieze-wreath-leaves',leaf,wreathLeaves);

  // The same frontal photo clearly shows dark projecting heads above all
  // three timber door groups. Preserve the existing leaves, handles, stone
  // returns and open aperture. Only add the visible upper molding and a
  // restrained silhouette: detailed joinery / ornament identity is unknown.
  // Floor and opening top come from portico-study + detail-manifest v8.
  const floor=4.86498924701769,doorTop=floor+3.32;
  const doorHeadPieces:Instance[]=[],doorHeadFinials:Instance[]=[];
  for(const x of [-4.10,0,4.10]){
    doorHeadPieces.push(local(x,doorTop+.11,-2.88,new Vector3(2.98,.14,.18)));
    doorHeadPieces.push(local(x,doorTop+.26,-2.83,new Vector3(3.08,.13,.20)));
    doorHeadPieces.push(local(x,doorTop+.37,-2.79,new Vector3(3.30,.09,.22)));
    for(const dx of [-1.30,0,1.30])doorHeadFinials.push(local(x+dx,doorTop+.415,-2.80));
  }
  const bronze=new MeshStandardMaterial({name:'MIT-door-head-patinated-metal',
    color:'#514b3c',roughness:.62,metalness:.45});
  bronze.userData.reference='maclaurin-front.webp; dark metal tone and small dimensions photo-estimated';
  batch('MIT-entrance-head-moldings',new BoxGeometry(1,1,1),doorHeadPieces,bronze);
  const crestShape=new Shape();
  crestShape.moveTo(-.11,0);crestShape.lineTo(-.11,.045);crestShape.lineTo(-.065,.045);
  crestShape.quadraticCurveTo(-.075,.13,0,.185);
  crestShape.quadraticCurveTo(.075,.13,.065,.045);
  crestShape.lineTo(.11,.045);crestShape.lineTo(.11,0);crestShape.closePath();
  const crest=new ExtrudeGeometry(crestShape,{depth:.075,curveSegments:5,steps:1,
    bevelEnabled:true,bevelSegments:1,bevelSize:.005,bevelThickness:.005});
  batch('MIT-entrance-head-silhouettes',crest,doorHeadFinials,bronze);

  const radius=manifest.dome.profile[0]?.[0];
  const ribs:Instance[]=[],guttae:Instance[]=[];
  if(Number.isFinite(radius)&&radius>0){
    for(let i=0;i<64;i++){
      const a=i*Math.PI*2/64,s=Math.sin(a),c=Math.cos(a);
      const at=(x:number,y:number,depth:number,scale:Vector3):Instance=>({
        position:new Vector3(manifest.dome.center[0]+c*x+s*depth,y,
          manifest.dome.center[1]-s*x+c*depth),scale,angle:a,
      });
      // Exact anchors of the already established real-campus detail layer.
      for(const side of [-1,1])ribs.push(at(side*.135,34.7,radius+.083,new Vector3(.055,1.035,.145)));
      // Raised 50 mm so the top intersects the original 34.12 m torus ring.
      for(let j=-2;j<=2;j++)guttae.push(at(j*.071,34.025,radius+.128,new Vector3(1,1,1)));
    }
    batch('MIT-drum-paired-ribs',new BoxGeometry(1,1,1),ribs);
    batch('MIT-drum-guttae',new CylinderGeometry(.035,.026,.085,6),guttae);
  }
  const triangles=group.children.reduce((total,child)=>{
    const mesh=child as InstancedMesh;
    return total+(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3*mesh.count;
  },0);
  const stats={version:2,columns:capitals.length,drumRibs:ribs.length,
    drumGuttae:guttae.length,wreaths:wreathRings.length,wreathLeaves:wreathLeaves.length,
    doorHeads:3,doorHeadFinials:doorHeadFinials.length,batches:group.children.length,triangles,
    visibleTriangles:triangles,lowQuality:false,
    source:'portico-study.json; maclaurin-front.webp; maclaurin-oblique.webp',
    scope:'Solid Ionic bolsters, drum relief, two frieze wreaths and three projecting door heads; small dimensions and ornament silhouettes photo-estimated',
  };
  const fineDetails=['MIT-drum-guttae','MIT-frieze-wreath-leaves']
    .map(name=>group.getObjectByName(name) as InstancedMesh|undefined).filter((mesh):mesh is InstancedMesh=>!!mesh);
  const fineTriangles=fineDetails.reduce((total,mesh)=>total+(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3*mesh.count,0);
  const setQuality=(low:boolean)=>{
    // Tiny elevated pendants can disappear at the low tier. The connected
    // Ionic silhouettes and the drum rhythm remain identical in every tier.
    fineDetails.forEach(mesh=>{mesh.visible=!low;});
    stats.lowQuality=low;stats.visibleTriangles=triangles-(low?fineTriangles:0);
  };
  group.userData.mainBuildingDetail=stats;
  return Object.assign(group,{setQuality,stats});
}
