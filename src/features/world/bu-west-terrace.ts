import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,PlaneGeometry,type BufferGeometry as Geometry} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {configureBUGroundLayer} from './bu-ground-layers';
import {buElevation,buWestSurveyElevation,drapeBUGeometry} from './bu-terrain';
import {BU_COURTYARD_PATHS,buSegmentProjection} from './bu-campus-layout';
import {BU_WEST_TERRACE_EDGE,BU_WEST_TERRACE_WALKS,buWestTerraceDatum} from './bu-west-terrace-layout';

/** The same small public-realm group is included by desktop and mobile export. */
export function createBUWestTerrace(){
  const group=new Group();group.name='BU West residence terrace';
  const ground:Mesh[]=[],walls:Mesh[]=[],paving:Geometry[]=[],faces:number[]=[];
  const links=BU_COURTYARD_PATHS.filter(path=>path[0][0]<-2250).flatMap(path=>path.slice(1).map((b,i)=>({a:path[i],b})));
  const quad=(a:number[],b:number[],c:number[],d:number[])=>faces.push(...a,...b,...c,...a,...c,...d);
  for(let i=1;i<BU_WEST_TERRACE_EDGE.length;i++){
    const a=BU_WEST_TERRACE_EDGE[i-1],b=BU_WEST_TERRACE_EDGE[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),count=Math.ceil(length/1.5),nx=-dz/length,nz=dx/length;
    for(let j=0;j<count;j++){
      const u=j/count,v=(j+1)/count,x=(a[0]+dx*(u+v)/2),z=(a[1]+dz*(u+v)/2);
      // Retain the existing public connection; no new wall crosses its route.
      if(links.some(link=>buSegmentProjection(x,z,link.a,link.b).distance<2.6))continue;
      const ax=a[0]+dx*u,az=a[1]+dz*u,bx=a[0]+dx*v,bz=a[1]+dz*v;
      const topA=buWestTerraceDatum(ax,az)+.12,topB=buWestTerraceDatum(bx,bz)+.12;
      const bottomA=Math.min(buWestSurveyElevation(ax-nx*3,az-nz*3)??7.8,buElevation(ax,az),7.8)-.15;
      const bottomB=Math.min(buWestSurveyElevation(bx-nx*3,bz-nz*3)??7.8,buElevation(bx,bz),7.8)-.15;
      const wa=[ax,topA,az],wb=[bx,topB,bz],wc=[bx+nx*.5,topB,bz+nz*.5],wd=[ax+nx*.5,topA,az+nz*.5];
      // Explicit front/back/top surfaces: a raised campus terrace is not a
      // grass mountain. The omitted underside is buried in the retained DEM.
      quad([ax,bottomA,az],[bx,bottomB,bz],wb,wa);
      quad([ax+nx*.5,bottomA,az+nz*.5],wd,wc,[bx+nx*.5,bottomB,bz+nz*.5]);
      quad(wa,wb,wc,wd);
    }
  }
  for(const path of BU_WEST_TERRACE_WALKS)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const g=new PlaneGeometry(3.2,length+.04);g.rotateX(-Math.PI/2);g.rotateY(Math.atan2(b[0]-a[0],b[1]-a[1]));g.translate((a[0]+b[0])/2,5.31,(a[1]+b[1])/2);
    paving.push(drapeBUGeometry(g,3));g.dispose();
  }
  const wallMaterial=createCampusSurface('concrete',{profile:'bu',geometryFrame:true}) as MeshStandardMaterial;
  wallMaterial.color.set('#a7a38c');wallMaterial.side=2;
  const wallGeometry=new BufferGeometry();wallGeometry.setAttribute('position',new Float32BufferAttribute(faces,3));wallGeometry.computeVertexNormals();wallGeometry.computeBoundingBox();wallGeometry.computeBoundingSphere();
  const wall=new Mesh(wallGeometry,wallMaterial);wall.name='BU West terrace retaining wall';wall.castShadow=true;wall.receiveShadow=true;wall.userData.mobileWall=true;group.add(wall);walls.push(wall);
  const pavingMaterial=createCampusSurface('pavement',{profile:'bu',pavingStyle:'concrete',groundHeight:5.2}) as MeshStandardMaterial;
  configureBUGroundLayer(pavingMaterial,'surface');
  const geometry=mergeGeometries(paving,false)!;paving.forEach(g=>g.dispose());geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const walk=new Mesh(geometry,pavingMaterial);walk.name='BU West terrace paving';walk.receiveShadow=true;walk.userData.mobileGround=true;group.add(walk);ground.push(walk);
  group.updateMatrixWorld(true);group.userData.source='assets-source/charles-bu/west-road-terrain-20261027.json';
  return{group,ground,walls,setQuality:(low:boolean)=>{wall.castShadow=!low;wall.receiveShadow=!low;walk.receiveShadow=!low;}};
}
