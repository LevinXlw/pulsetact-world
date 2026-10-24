import {BoxGeometry,CylinderGeometry,Group,Mesh,MeshStandardMaterial,Quaternion,Vector3,type BufferGeometry} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {CampusCollision} from '../real-campus/campus-collision';
import {createPainterlyVegetation} from './painterly-vegetation';

// Photo/orthophoto estimates, with open entrance and clear walking route.
// Provenance and uncertainty: references/memorial-east-corrections.json.
const trees=[{x:-119,z:181.8,radius:4.4},{x:-108.3,z:195.7,radius:5.7},{x:-99.5,z:194.7,radius:5.3}];
// Registered orthophoto / source planter footprints; soil elevations exported
// by Blender in assets-source/mit-residences/baker/entry-layout.json.
const bakerTrees=[
 {x:-295.5,z:243.4,radius:2.2,height:6.5,rootY:3.016618},
 {x:-278.718,z:244.335,radius:4.1,height:10.2,rootY:3.55},
 {x:-284.583,z:246.904,radius:2.4,height:6.4,rootY:3.55},
];
const bakerShrubs=[
 ...[[-300.9,248.0],[-299.7,248.6],[-298.6,249.25]].map(([x,z],i)=>({x,z,radius:.63,height:.95+i*.12,rootY:3.58})),
 ...[[-285.5,248.0],[-284.9,247.6],[-283.4,246.5],[-281.8,245.7],[-280.1,245.1],[-277.4,243.4],[-275.5,242.1],[-274.0,241.6]].map(([x,z],i)=>({x,z,radius:.8,height:1.05+(i%3)*.18,rootY:3.55})),
 ...[[-297.0,244.2],[-294.0,242.2],[-295.7,244.8]].map(([x,z])=>({x,z,radius:.45,height:.6})),
];
const fences=[[[ -122,213.2],[-108.2,207]], [[-105.4,205.8],[-82.5,195.5]]] as const;

export function createMITResidenceLandscape(collision:CampusCollision,wind:{value:number},mobile=false,bakerNorthCourt=false){
 const group=new Group();group.name='MIT residences · planted courtyards and iron boundary';
 const vegetation=createPainterlyVegetation([...trees,...(bakerNorthCourt?[...bakerTrees,...bakerShrubs]:[])],collision,null,wind,true,'residence');group.add(vegetation.group);
 const walls:Mesh[]=[],pieces:Record<'stone'|'iron',BufferGeometry[]>={stone:[],iron:[]};
 const up=new Vector3(0,1,0),q=new Quaternion();
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,kind:'stone'|'iron',yaw=0)=>{const g=new BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);pieces[kind].push(g);};
 const bar=(a:Vector3,b:Vector3,r:number)=>{const d=b.clone().sub(a),g=new CylinderGeometry(r,r,d.length(),mobile?5:7);q.setFromUnitVectors(up,d.normalize());g.applyQuaternion(q);g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);pieces.iron.push(g);};
 for(const [a,b] of fences){
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
  const at=(d:number,h=0)=>{const x=a[0]+(b[0]-a[0])*d/length,z=a[1]+(b[1]-a[1])*d/length;return new Vector3(x,(collision.groundHeight(x,z)??3.2)+h,z);};
  // Short sections follow the slope; the central 3 m gate stays unobstructed.
  for(let d=0;d<length;d+=2){const p=at(d),r=at(Math.min(length,d+2));box((p.x+r.x)/2,(p.y+r.y)/2+.10,(p.z+r.z)/2,.29,.20,p.distanceTo(r),'stone',yaw);for(const h of [.36,1.12])bar(at(d,h),at(Math.min(length,d+2),h),.027);}
  for(let d=.15;d<length;d+=.16)bar(at(d,.24),at(d,1.25),.012);
  const sections=Math.ceil(length/5.5);for(let i=0;i<=sections;i++){const p=at(i*length/sections);box(p.x,p.y+.67,p.z,.48,1.34,.48,'stone');box(p.x,p.y+1.37,p.z,.58,.14,.58,'stone');}
  const p=at(0),r=at(length),proxy=new Mesh(new BoxGeometry(.35,1.35,length),new MeshStandardMaterial());proxy.position.copy(p).add(r).multiplyScalar(.5).addScaledVector(up,.675);proxy.rotation.y=yaw;proxy.visible=false;proxy.userData.mobileHidden=true;proxy.userData.mobileWall=true;walls.push(proxy);group.add(proxy);
 }
 const materials={stone:new MeshStandardMaterial({name:'Maseeh fence limestone',color:'#aaa799',roughness:.88}),iron:new MeshStandardMaterial({name:'Maseeh painted iron',color:'#29322c',roughness:.48,metalness:.65})};
 for(const key of ['stone','iron'] as const){const geometry=mergeGeometries(pieces[key]);pieces[key].forEach(g=>g.dispose());if(!geometry)continue;geometry.computeBoundingSphere();const mesh=new Mesh(geometry,materials[key]);mesh.name=`Maseeh boundary ${key}`;mesh.receiveShadow=true;mesh.castShadow=!mobile;group.add(mesh);}
 vegetation.group.traverse(o=>{if(o instanceof Mesh&&o.userData.treeTrunk){o.userData.mobileHidden=true;o.userData.mobileWall=true;walls.push(o);}});
 walls.forEach(mesh=>mesh.geometry.computeBoundingBox());group.updateMatrixWorld(true);
 return{group,walls,setQuality:(low:boolean)=>{vegetation.setQuality(mobile||low);group.children.forEach(o=>{if(o instanceof Mesh&&!o.userData.mobileHidden)o.castShadow=!mobile&&!low;});},update:vegetation.update};
}
