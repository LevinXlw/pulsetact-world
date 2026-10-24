import {finishLimestone} from './surface-finish';
import {Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,BufferGeometry} from 'three';

export function tintCampusBuildings(base:Group,models:{id:string;triangles:number;name?:string}[],detailed:string[]=[]){
 base.traverse(o=>{if(!(o instanceof Mesh)||Array.isArray(o.material)||o.material.name!=='Cambridge buildings (untextured)')return;
  const count=o.geometry.getAttribute('position').count;if(models.reduce((n,m)=>n+m.triangles*3,0)!==count)return;
  const colors=new Float32Array(count*3),facade=new Float32Array(count*4),p=o.geometry.getAttribute('position'),normal=o.geometry.getAttribute('normal');let cursor=0,vertex=0;
  for(const model of models){const hash=[...model.id].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0),tone=.86+(hash%15)/100;
   let low=Infinity,high=-Infinity;for(let i=vertex;i<vertex+model.triangles*3;i++){low=Math.min(low,p.getY(i));high=Math.max(high,p.getY(i));}
   const eligible=!detailed.includes(model.id)&&high-low>8&&!/bridge|tunnel|tower|plant|reserve|lot|pavilion|chapel|auditorium/i.test(model.name||'');
   for(let i=0;i<model.triangles*3;i++,vertex++){
    colors[cursor++]=tone;colors[cursor++]=tone;colors[cursor++]=tone;
    facade.set([eligible&&Math.abs(normal.getY(vertex))<.02?1:0,p.getY(vertex)-low,high-p.getY(vertex),(hash%7)/7],vertex*4);
   }
  }o.geometry.setAttribute('color',new Float32BufferAttribute(colors,3));o.geometry.setAttribute('facade',new Float32BufferAttribute(facade,4));
 });
}

export function extractSurveyedBridge(base:Group,models:{id:string;triangles:number}[]){
 const additions:Mesh[]=[];
 base.traverse(o=>{if(!(o instanceof Mesh)||Array.isArray(o.material)||o.material.name!=='Cambridge buildings (untextured)')return;
  const old=o.geometry as BufferGeometry,p=old.getAttribute('position');if(old.index||models.reduce((n,m)=>n+m.triangles*3,0)!==p.count)return;
  const keep:number[]=[],bridge:number[]=[];let index=0;
  for(const model of models)for(let i=0;i<model.triangles*3;i++)(model.id==='CAM_FYDFW-CRKIM-2M698'?bridge:keep).push(index++);
  if(!bridge.length)return;
  const subset=(ids:number[])=>{const g=new BufferGeometry();for(const [name,a] of Object.entries(old.attributes)){const values=new Float32Array(ids.length*a.itemSize);ids.forEach((id,i)=>{for(let k=0;k<a.itemSize;k++)values[i*a.itemSize+k]=a.getComponent(id,k);});g.setAttribute(name,new Float32BufferAttribute(values,a.itemSize));}return g;};
  const material=o.material.clone();material.name='surveyedBridge';additions.push(new Mesh(subset(bridge),material));o.geometry=subset(keep);old.dispose();
 });
 base.add(...additions);
}

// Retain the original geometry and derive roof UVs from the same local coordinates as the terrain.
// Aerial projection supplies roof context; it is not an independently measured roof material.
export function applyCampusSurfaces(base:Group,detail:Group,radius:number){
 let aerial:MeshStandardMaterial|undefined,stone:MeshStandardMaterial|undefined;
 base.traverse(o=>{if(o instanceof Mesh&&!Array.isArray(o.material)&&o.material.name.includes('orthophotography'))aerial=o.material;});
 detail.traverse(o=>{if(o instanceof Mesh&&!Array.isArray(o.material)&&o.material.name==='stone')stone=o.material;});
 if(!aerial?.map||!stone?.map)return;
 // Some source terrain triangles were clipped at tile boundaries. A low backdrop
 // keeps the georeferenced image visible through those gaps, including under bridges.
 const r=radius,backdropGeometry=new BufferGeometry();
 backdropGeometry.setAttribute('position',new Float32BufferAttribute([-r,-.1,-r,-r,-.1,r,r,-.1,-r,r,-.1,-r,-r,-.1,r,r,-.1,r],3));
 backdropGeometry.setAttribute('uv',new Float32BufferAttribute([0,0,0,1,1,0,1,0,0,1,1,1],2));backdropGeometry.computeVertexNormals();
 const backdropMaterial=aerial.clone();backdropMaterial.name='2025 orthophotography continuity';base.add(new Mesh(backdropGeometry,backdropMaterial));
 base.traverse(o=>{
  if(!(o instanceof Mesh)||Array.isArray(o.material)||o.material.name!=='Cambridge buildings (untextured)')return;
  const original=o.geometry,g=original.index?original.toNonIndexed():original,p=g.getAttribute('position'),n=g.getAttribute('normal');
  const uv=new Float32Array(p.count*2),walls:number[]=[],roofs:number[]=[];
  for(let i=0;i<p.count;i+=3){
   // Keep domes and pitched surfaces uniform instead of producing alternating aerial bands.
   const roof=(n.getY(i)+n.getY(i+1)+n.getY(i+2))/3>.9999;
   for(let j=i;j<i+3;j++){
    uv[j*2]=roof?(p.getX(j)+radius)/(radius*2):(Math.abs(n.getX(i))>.5?p.getZ(j):p.getX(j))/2;
    uv[j*2+1]=roof?(p.getZ(j)+radius)/(radius*2):p.getY(j)/2;
    (roof?roofs:walls).push(j);
   }
  }
  g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex([...walls,...roofs]);g.clearGroups();g.addGroup(0,walls.length,0);g.addGroup(walls.length,roofs.length,1);
  const wall=stone!.clone();wall.name='Campus wall material';wall.color.setRGB(1.65,1.64,1.56);wall.side=o.material.side;
  wall.vertexColors=!!g.getAttribute('color');finishLimestone(wall);wall.normalScale.set(.045,.045);
  if(g.getAttribute('facade')){
   const stoneFinish=wall.onBeforeCompile,stoneKey=wall.customProgramCacheKey();wall.onBeforeCompile=(shader,renderer)=>{stoneFinish(shader,renderer);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 facade; varying vec4 vFacade;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFacade=facade;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 vFacade;');
    // The limestone finish establishes its albedo after map_fragment. Put the
    // distant window layer after that finish, otherwise it is painted over.
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
     if(vFacade.x>.5 && vFacade.y>2.0 && vFacade.z>2.0){
      vec2 grid=vec2(vMapUv.x*2.0/3.5+vFacade.w,vFacade.y/3.8);
      vec2 cell=fract(grid),aa=max(fwidth(grid),vec2(.004));
      vec2 mask=smoothstep(vec2(.2),vec2(.2)+aa,cell)*(1.0-smoothstep(vec2(.8)-aa,vec2(.8),cell));
      float pane=mask.x*mask.y;
      float mullion=1.0-smoothstep(.01,.01+aa.x,abs(cell.x-.5));
      float fade=1.0-smoothstep(250.0,800.0,length(vViewPosition));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.085,.13,.155),pane*(1.0-mullion*.6)*fade*.88);
     }`);
   };wall.customProgramCacheKey=()=> `${stoneKey}-background-facades-v3`;
  }
  const roof=new MeshStandardMaterial({name:'Aerial roof projection',map:aerial!.map,roughness:1,side:o.material.side});
  roof.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   float context=smoothstep(100.0,230.0,length(vViewPosition));
   float grain=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   diffuseColor.rgb=mix(vec3(.27,.285,.28)*mix(.95,1.05,grain),diffuseColor.rgb,context);
  `);};roof.customProgramCacheKey=()=> 'campus-roof-distance-finish-v1';
  o.material.dispose();o.material=[wall,roof];o.geometry=g;if(g!==original)original.dispose();
  base.userData.surfaceTriangles={walls:walls.length/3,roofs:roofs.length/3};
 });
}
