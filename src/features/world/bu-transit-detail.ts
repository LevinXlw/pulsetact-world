import {BoxGeometry,BufferGeometry,CanvasTexture,DoubleSide,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,PlaneGeometry,SRGBColorSpace,type Material,type Texture} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {BU_TRANSIT_PLATFORM_DETAILS} from './bu-public-realm';
import {buElevation} from './bu-terrain';

type Finish='whiteSteel'|'roof'|'redFrame'|'darkMetal'|'concrete'|'wood'|'glass'|'greenGlass'|'blueGlass';
type Station=typeof BU_TRANSIT_PLATFORM_DETAILS[number];
const SIGN_WIDTH=2.15,SIGN_HEIGHT=.46;

/** One runtime owner for station detail in desktop AND mobile. Neither the
 * street mesh nor boston.glb should include a second canopy or nameplate.
 * Anchors/lengths are shared; cross sections are documented photo estimates. */
export function createBUTransitDetail({mobile=false}:{mobile?:boolean}={}){
  const group=new Group();group.name='BU · Green Line platform architecture';
  const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
  const batches=new Map<string,{finish:Finish;parts:BufferGeometry[];station:string;side:number}>();
  const palette:Record<Finish,MeshStandardMaterial>={
    whiteSteel:new MeshStandardMaterial({color:'#e0ded3',roughness:.47,metalness:.28,side:DoubleSide}),
    roof:new MeshStandardMaterial({color:'#9da7a5',roughness:.47,metalness:.48,side:DoubleSide}),
    redFrame:new MeshStandardMaterial({color:'#743e37',roughness:.65,metalness:.22,side:DoubleSide}),
    darkMetal:new MeshStandardMaterial({color:'#303c3a',roughness:.58,metalness:.38}),
    concrete:new MeshStandardMaterial({color:'#aaa99f',roughness:.96}),
    wood:new MeshStandardMaterial({color:'#8e6f4d',roughness:.76}),
    glass:new MeshStandardMaterial({color:'#c1d5cf',roughness:.17,metalness:.08,transparent:true,opacity:.20,depthWrite:false,side:DoubleSide}),
    greenGlass:new MeshStandardMaterial({color:'#61a35e',roughness:.25,metalness:0,transparent:true,opacity:.46,depthWrite:false,side:DoubleSide}),
    blueGlass:new MeshStandardMaterial({color:'#4f92a7',roughness:.25,metalness:0,transparent:true,opacity:.43,depthWrite:false,side:DoubleSide}),
  };
  for(const [name,material] of Object.entries(palette)){material.name=`BU station ${name}`;materials.add(material);}
  const counts={platforms:0,canopies:0,structuralRibs:0,columns:0,windscreenPanes:0,benches:0,nameplates:0};
  function append(station:Station,side:number,finish:Finish,g:BufferGeometry){
    const flat=g.index?g.toNonIndexed():g;if(flat!==g)g.dispose();
    if(!flat.getAttribute('uv'))flat.setAttribute('uv',new Float32BufferAttribute(new Float32Array(flat.getAttribute('position').count*2),2));
    // Opaque pieces share a bounded station batch across its two platforms;
    // transparent panes remain separate for sensible back-to-front sorting.
    const key=`${station.name}:${palette[finish].transparent?side:0}:${finish}`,batch=batches.get(key)??{finish,parts:[],station:station.name,side};batch.parts.push(flat);batches.set(key,batch);
  }
  for(const station of BU_TRANSIT_PLATFORM_DETAILS)for(const side of [-1,1]){
    counts.platforms++;counts.canopies++;
    const {dx,dz,nx,nz,width,canopyLength}=station;
    const cx=station.position[0]+nx*side*station.platformOffset,cz=station.position[1]+nz*side*station.platformOffset;
    // Across positive points to the ROAD, negative to the boarding edge. This
    // makes both platforms share the same safe, track-clear cross section.
    const at=(across:number,along:number)=>[cx+nx*side*across+dx*along,cz+nz*side*across+dz*along] as const;
    const p=(across:number,y:number,along:number)=>{const [x,z]=at(across,along);return[x,buElevation(x,z)+y,z];};
    const yaw=Math.atan2(dx,dz),outer=width/2-.18;
    const box=(finish:Finish,across:number,y:number,along:number,w:number,h:number,d:number)=>{
      const [x,z]=at(across,along),g=new BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,buElevation(x,z)+y,z);append(station,side,finish,g);
    };
    const quad=(finish:Finish,a:number[],b:number[],c:number[],d:number[],both=false,flip=false)=>{
      const vertices=flip?[...a,...c,...b,...a,...d,...c]:[...a,...b,...c,...a,...c,...d];if(both)vertices.push(...c,...b,...a,...d,...c,...a);
      const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();append(station,side,finish,g);
    };
    // A curved thin shell has a real soffit and edge, rather than a solid slab.
    // Central/East's short shelter is a red steel frame under a shallow wave;
    // the 2021 platforms have white closely spaced cantilever ribs.
    const roofY=(across:number)=>{
      const t=(across+width/2+.06)/(width+.12);
      return station.modern?3.37-.44*Math.sin(t*Math.PI*.66):3.10+.12*Math.sin(t*Math.PI*2-.4);
    };
    const segments=mobile?4:14,half=width/2+.06,thickness=.055,roofBays=Math.ceil(canopyLength/3);
    for(let k=0;k<segments;k++){
      const a=-half+2*half*k/segments,b=-half+2*half*(k+1)/segments;
      // A 45m roof cannot interpolate only its two far ends over a varying
      // street grade. Short structural spans follow the existing DEM and keep
      // every column/soffit above the same platform without altering terrain.
      for(let bay=0;bay<roofBays;bay++)for(const [height,reverse] of [[0,false],[-thickness,true]] as const){
        const lo=-canopyLength/2+canopyLength*bay/roofBays,hi=lo+canopyLength/roofBays;
        const corners=[p(a,roofY(a)+height,lo),p(b,roofY(b)+height,lo),p(b,roofY(b)+height,hi),p(a,roofY(a)+height,hi)];
        quad(station.modern?'whiteSteel':'roof',corners[0],corners[1],corners[2],corners[3],false,(side<0)!==reverse);
      }
      for(const end of [-1,1])quad(station.modern?'whiteSteel':'roof',p(a,roofY(a)-thickness,end*canopyLength/2),p(b,roofY(b)-thickness,end*canopyLength/2),p(b,roofY(b),end*canopyLength/2),p(a,roofY(a),end*canopyLength/2));
    }
    for(const edge of [-half,half])for(let bay=0;bay<roofBays;bay++){
      const lo=-canopyLength/2+canopyLength*bay/roofBays,hi=lo+canopyLength/roofBays;
      quad(station.modern?'whiteSteel':'roof',p(edge,roofY(edge),lo),p(edge,roofY(edge),hi),p(edge,roofY(edge)-thickness,hi),p(edge,roofY(edge)-thickness,lo));
    }
    const postFinish:Finish=station.modern?'whiteSteel':'redFrame';
    const bays=station.modern?16:2,postAlong=Array.from({length:bays+1},(_,i)=>-canopyLength/2+.25+(canopyLength-.5)*i/bays);
    for(const along of postAlong){
      counts.columns++;
      box('concrete',outer,.40,along,.40,.42,.46);
      box(postFinish,outer,1.77,along,.15,2.42,.16);
      box(postFinish,outer,.65,along,.25,.055,.27);
    }
    // Visible rib undersides taper toward the boarding edge. Use the same
    // curve in both quality tiers; mobile reduces only intermediate ribs.
    const ribPitch=mobile?3.0:.80;
    for(let along=-canopyLength/2+.12;along<canopyLength/2;along+=ribPitch){
      counts.structuralRibs++;
      for(let k=0;k<segments;k++){
        const a=-half+2*half*k/segments,b=-half+2*half*(k+1)/segments,depthA=.065+.115*(a+half)/(2*half),depthB=.065+.115*(b+half)/(2*half);
        for(const t of [-1,1])quad(postFinish,p(a,roofY(a)-thickness,along+t*.035),p(b,roofY(b)-thickness,along+t*.035),p(b,roofY(b)-thickness-depthB,along+t*.035),p(a,roofY(a)-thickness-depthA,along+t*.035));
        quad(postFinish,p(a,roofY(a)-thickness-depthA,along-.035),p(b,roofY(b)-thickness-depthB,along-.035),p(b,roofY(b)-thickness-depthB,along+.035),p(a,roofY(a)-thickness-depthA,along+.035));
      }
    }
    // Road-side back glazing leaves a continuous clear boarding lane. Modern
    // coloured panels reproduce only the material/color family, not artwork.
    const screens=station.modern?[-canopyLength*.31,0,canopyLength*.31]:[0];
    for(const center of screens){
      const length=station.modern?3.1:canopyLength-.6,panes=station.modern?3:6,paneLength=length/panes;
      for(let i=0;i<panes;i++){
        const a=center-length/2+i*paneLength+.035,b=a+paneLength-.07;counts.windscreenPanes++;
        const finish:Finish=station.modern&&i===0?(center<0?'blueGlass':'greenGlass'):'glass';
        quad(finish,p(outer,.65,a),p(outer,.65,b),p(outer,2.53,b),p(outer,2.53,a));
        box(postFinish,outer,1.57,a-.035,.055,1.96,.065);
        if(!station.modern)box(postFinish,outer,1.49,(a+b)/2,.055,.045,b-a);
      }
      box(postFinish,outer,1.57,center+length/2,.055,1.96,.065);
      for(const y of [.62,2.56])box(postFinish,outer,y,center,.065,.075,length+.08);
      if(station.modern&&(!mobile||center===0)){
        counts.benches++;
        for(let slat=0;slat<4;slat++)box('wood',outer-.12-slat*.10,.68,center,.085,.055,2.5);
        for(const d of [-.98,.98]){box('darkMetal',outer-.27,.44,center+d,.06,.45,.06);box('darkMetal',outer-.28,.64,center+d,.43,.06,.055);}
      }
    }
    // Fixed station name, not live service information. The measured source
    // is its green/white hierarchy; dimensions/font are authored for legibility.
    const signAlong=station.modern?canopyLength/2-3.0:canopyLength/2+2.1;
    const signAcross=outer,signY=2.25;
    box('darkMetal',signAcross,signY,signAlong,.075,SIGN_HEIGHT+.08,SIGN_WIDTH+.10);
    for(const d of [-SIGN_WIDTH/2-.05,SIGN_WIDTH/2+.05])box('darkMetal',signAcross,1.28,signAlong+d,.07,2.18,.065);
    if(typeof document!=='undefined'){
      const canvas=document.createElement('canvas');canvas.width=768;canvas.height=164;const context=canvas.getContext('2d');
      if(context){
        const title=station.name.replace('Boston University','BU').toUpperCase();
        context.fillStyle='#f0f0e6';context.fillRect(0,0,768,164);context.fillStyle='#00834b';context.fillRect(0,0,768,111);context.fillStyle='#ffffff';context.font='bold 62px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText(title,384,57,738);context.fillStyle='#202623';context.font='bold 24px Arial';context.fillText('GREEN LINE · B',384,139,730);
        const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;textures.add(texture);
        const material=new MeshStandardMaterial({map:texture,roughness:.7,side:DoubleSide});materials.add(material);
        for(const face of [-1,1]){
          const [x,z]=at(signAcross+face*.041,signAlong),geometry=new PlaneGeometry(SIGN_WIDTH,SIGN_HEIGHT);geometries.add(geometry);
          const mesh=new Mesh(geometry,material);mesh.name=`BU station nameplate · ${station.name}`;mesh.position.set(x,buElevation(x,z)+signY,z);mesh.rotation.y=Math.atan2(nx*side*face,nz*side*face);mesh.userData.buTransitNameplate={station:station.name,width:SIGN_WIDTH,height:SIGN_HEIGHT};group.add(mesh);
        }
      }
    }
    counts.nameplates++;
  }
  for(const {finish,parts,station,side} of batches.values()){
    const geometry=mergeGeometries(parts);parts.forEach(part=>part.dispose());if(!geometry)throw new Error(`Cannot merge BU platform ${finish}`);
    geometries.add(geometry);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,palette[finish]);mesh.name=`BU station ${station} ${side>0?'north':'south'} · ${finish}`;mesh.castShadow=!mobile&&!palette[finish].transparent;mesh.receiveShadow=!mobile;mesh.userData.buTransitFinish=finish;group.add(mesh);
  }
  group.userData.buTransitDetail={...counts,mobile,sourceNotes:'assets-source/charles-bu/transit-detail-20261024.json'};
  group.updateMatrixWorld(true);let disposed=false;
  return{group,dispose(){if(disposed)return;disposed=true;for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();group.clear();}};
}
