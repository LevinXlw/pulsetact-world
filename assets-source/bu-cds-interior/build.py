"""Build the independently loaded CDS interior and shared low-poly physics.

Blender 4.5: blender --background --python-exit-code 1 --python this/file.py
Only writes assets-source/bu-cds-interior and public/assets/bu-cds-interior.
The existing complete exterior is deliberately not edited or embedded.
"""
from __future__ import annotations
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import bpy
import bmesh
from mathutils import Matrix,Vector

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
PUBLIC=REPO/'public/assets/bu-cds-interior'
spec=importlib.util.spec_from_file_location('cds_study',HERE/'source/study.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
LEVEL=s.LEVEL
DOORS=[30.2,44.2]
LAYER_NAMES=s.LAYERS
MOBILE=False


class TracedParts(s._Parts):
    def __init__(self,layer,finish):
        super().__init__();self.layer=layer;self.finish=finish
    def _append(self,bm,kind,bevel):
        v0,f0=len(self.vertices),len(self.faces)
        super()._append(bm,kind,bevel)
        self.records[-1].update(vertexRange=[v0,len(self.vertices)],faceRange=[f0,len(self.faces)])
    def box(self,kind,center,dimensions,bevel=.002):
        if MOBILE:
            if 'ceiling timber slat' in kind and round((center[0]+20.8)/.2)%2:
                return
            if not (self.layer=='stairs' and self.finish=='floor-concrete'):
                bevel=0
        super().box(kind,center,dimensions,bevel)
    def cylinder(self,kind,start,end,radius,bevel=.001):
        if not MOBILE:
            super().cylinder(kind,start,end,radius,bevel)
        else:
            a,b=Vector(start),Vector(end);axis=(b-a).normalized()
            matrix=Matrix.Translation((a+b)/2)@Vector((0,0,1)).rotation_difference(axis).to_matrix().to_4x4()
            bm=bmesh.new();bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=6,radius1=radius,radius2=radius,depth=(b-a).length,matrix=matrix)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));self._append(bm,kind,0)
        self.records[-1]['line']=[list(start),list(end)]


def traced_batch(layer,finish):
    key=(layer,finish)
    if key not in s.BATCHES:s.BATCHES[key]=TracedParts(layer,finish)
    return s.BATCHES[key]


s.batch=traced_batch


def glazing():
    """Exact authored exterior union and authored door axes, with real holes."""
    for level,layer in [(0,'shell-lower'),(LEVEL,'shell-upper')]:
        height=LEVEL-.18
        for i,a in enumerate(s.OUTLINE):
            b=s.OUTLINE[(i+1)%len(s.OUTLINE)]
            av,bv=Vector(a),Vector(b);d=bv-av;length=d.length;direction=d/length
            yaw=math.atan2(d.y,d.x)
            south=abs(a[1]-19.068)<.001 and abs(b[1]-19.068)<.001
            holes=[]
            if not level and south:
                for x in DOORS:
                    u=(Vector((x,19.068))-av).dot(direction)
                    holes.append((u-1.45,u+1.45,x))
                holes.sort()
            intervals=[];cursor=0
            for left,right,x in holes:
                if left>cursor:intervals.append((cursor,left))
                p=av+direction*((left+right)/2)
                s.box(layer,'glass','entry transom',(p.x,level+(2.85+height)/2,p.y),(2.9,height-2.85,.018),0,yaw)
                for u in (left,right):
                    q=av+direction*u
                    s.box(layer,'stainless-metal','entry jamb',(q.x,level+height/2,q.y),(.075,height,.12),.003,yaw)
                s.box(layer,'stainless-metal','entry door head',(p.x,level+2.85,p.y),(2.9,.075,.12),.003,yaw)
                cursor=right
            if cursor<length:intervals.append((cursor,length))
            for left,right in intervals:
                count=max(1,round((right-left)/2.35))
                for k in range(count):
                    u=left+(k+.5)*(right-left)/count;p=av+direction*u
                    s.box(layer,'glass','transparent envelope pane',(p.x,level+height/2,p.y),((right-left)/count-.075,height,.018),0,yaw)
                    q=av+direction*(left+k*(right-left)/count)
                    s.box(layer,'stainless-metal','envelope mullion',(q.x,level+height/2,q.y),(.07,height,.12),.003,yaw)
                if not holes:
                    p=(av+bv)/2
                    s.box(layer,'stainless-metal','envelope lower rail',(p.x,level+.06,p.y),(length,.07,.12),.003,yaw)
            p=(av+bv)/2
            s.box(layer,'stainless-metal','envelope top rail',(p.x,level+height,p.y),(length,.07,.12),.003,yaw)
    for x,z in [(-19,-18),(12,-18),(-19,8),(2,8),(8,8),(29,1),(40,1),(51,1),(40,17.8),(52,17.8)]:
        for level,layer in [(0,'floor-1'),(LEVEL,'floor-2')]:
            s.box(layer,'white-paint','structural column',(x,level+(LEVEL-.24)/2,z),(.46,LEVEL-.24,.46),.008)


class Physics:
    def __init__(self,name,role):self.name=name;self.role=role;self.vertices=[];self.faces=[];self.counts=Counter()
    def meshpart(self,parts,record,select=None,offset_y=0):
        vr,fr=record['vertexRange'],record['faceRange']
        lookup={}
        for face in parts.faces[fr[0]:fr[1]]:
            pts=[Vector(parts.vertices[i]) for i in face]
            normal=(pts[1]-pts[0]).cross(pts[2]-pts[0])
            if normal.length<1e-10:continue
            normal.normalize()
            if select and not select(normal,pts):continue
            ids=[]
            for index in face:
                if index not in lookup:
                    p=list(parts.vertices[index]);p[2]+=offset_y
                    lookup[index]=len(self.vertices);self.vertices.append(p)
                ids.append(lookup[index])
            self.faces.append(tuple(ids))
        self.counts[record['kind']]+=1
    def box(self,name,center,dimensions,yaw=0):
        p=s._Parts();p.box(name,s.xyz(center),(dimensions[0],dimensions[2],dimensions[1]),0)
        c,sn=math.cos(yaw),math.sin(yaw)
        for i,(x,by,y) in enumerate(p.vertices):
            dx,dz=x-center[0],-by-center[2]
            p.vertices[i]=(center[0]+c*dx-sn*dz,-(center[2]+sn*dx+c*dz),y)
        p.records[0].update(vertexRange=[0,len(p.vertices)],faceRange=[0,len(p.faces)])
        self.meshpart(p,p.records[0])
    def rail_wall(self,name,a,b):
        # Rail centerlines are Blender XYZ. A vertical strip closes each rail
        # for bodies without replacing the visible slender railing geometry.
        a,b=Vector(a),Vector(b);d=Vector((b.x-a.x,b.y-a.y,0));d.normalize()
        n=Vector((-d.y,d.x,0))*.055
        verts=[a+n,a-n,b-n,b+n]
        verts += [v-Vector((0,0,1.05)) for v in verts]
        offset=len(self.vertices);self.vertices.extend([tuple(v) for v in verts])
        self.faces.extend([tuple(offset+i for i in f) for f in [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]])
        self.counts[name]+=1
    def object(self):
        mesh=bpy.data.meshes.new(self.name);mesh.from_pydata(self.vertices,[],self.faces);mesh.update()
        bm=bmesh.new();bm.from_mesh(mesh)
        # An open support sheet has no inside/outside. Recalculating its normals
        # can flip disconnected treads; keep the source's verified up winding.
        if self.role=='wall':bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
        obj=bpy.data.objects.new(self.name,mesh);bpy.context.scene.collection.objects.link(obj)
        obj['campusInteriorRole']=self.role;obj[self.role]=True;obj['semanticCounts']=json.dumps(dict(self.counts))
        mat=bpy.data.materials.new(self.name);mat.diffuse_color=(.35,.5,.4,1);mat.use_backface_culling=False
        mesh.materials.append(mat)
        return obj


def record_bounds(parts,record):
    a,b=record['vertexRange'];points=parts.vertices[a:b]
    mn=[min(p[i] for p in points) for i in range(3)];mx=[max(p[i] for p in points) for i in range(3)]
    # Blender -> Three coordinates, independent of any stale pre-rotation bbox.
    return [mn[0],mn[2],-mx[1]],[mx[0],mx[2],-mn[1]]


def build_physics():
    ground=Physics('interior-ground','ground');walls=Physics('interior-walls','wall');ceilings=Physics('interior-ceilings','ceiling')
    ground_names={'grand walking tread','grand seating terrace','grand upper landing','butterfly lower flight tread','butterfly upper flight tread','butterfly curved landing segment','butterfly lower landing','butterfly upper landing'}
    box_obstacles={'service core context','cafe counter carcass','cafe white payment block','cafe back wall','structural column','classroom glazed boundary','classroom west boundary','classroom corridor glazing','classroom door transom','collaboration writable wall'}
    furniture={'shared table top','study chair seat','timber bench','terrace timber bench'}
    for (layer,finish),parts in s.BATCHES.items():
        for r in parts.records:
            name=r['kind']
            if 'slab cell' in name and layer=='floor-2-slab' or layer=='stairs' and name in ground_names:
                ground.meshpart(parts,r,lambda n,p:n.z>.5)
            if name in ('grand walking tread','grand seating terrace'):
                # These are solid concrete volumes down to the ground floor.
                # Copy their real sides, not their tops, into the body walls.
                # A normal 15.6cm riser stays below the player's torso query.
                walls.meshpart(parts,r,lambda n,p:abs(n.z)<.5)
            if layer=='floor-2-slab' or layer=='roof':
                offset=-.185 if layer=='floor-2-slab' else -.205
                ceilings.meshpart(parts,r,lambda n,p:n.z<-.5,offset)
            if name=='butterfly thick black parapet':walls.meshpart(parts,r)
            if name=='handrail':walls.rail_wall(name,*r['line'])
            if name in box_obstacles or name in furniture:
                lo,hi=record_bounds(parts,r)
                if name in furniture:
                    lo[1]=LEVEL if layer=='floor-2' else lo[1] if name=='terrace timber bench' else 0
                    if name=='study chair seat':hi[1]=lo[1]+.98
                center=[(lo[i]+hi[i])/2 for i in range(3)];size=[max(.012,hi[i]-lo[i]) for i in range(3)]
                walls.box(name,center,size)
            if layer=='stairs' and (finish=='floor-concrete' or 'undertray' in name):
                ceilings.meshpart(parts,r,lambda n,p:n.z<-.2 and max(v.z for v in p)>.5)
    # Do not expose the hidden first-floor slab inside the solid collaborative
    # stair: otherwise a low seat riser can be above the allowed step yet below
    # the torso ray, and support selection incorrectly returns the buried y=0.
    # The 30cm construction gap between the lanes is not body-accessible either.
    grand_solid=[6.96,30.0,12.0,19.0]
    xs=sorted(set([p[0] for p in s.OUTLINE]+grand_solid[:2]))
    zs=sorted(set([p[1] for p in s.OUTLINE]+grand_solid[2:]))
    for x0,x1 in zip(xs,xs[1:]):
        for z0,z1 in zip(zs,zs[1:]):
            x,z=(x0+x1)/2,(z0+z1)/2
            if not s.point_inside(x,z) or grand_solid[0]<x<grand_solid[1] and grand_solid[2]<z<grand_solid[3]:continue
            offset=len(ground.vertices)
            ground.vertices.extend([s.xyz(p) for p in [(x0,0,z0),(x0,0,z1),(x1,0,z1),(x1,0,z0)]])
            ground.faces.append(tuple(offset+i for i in range(4)))
            ground.counts['exposed first-floor support cell']+=1
    for i,a in enumerate(s.OUTLINE):
        b=s.OUTLINE[(i+1)%len(s.OUTLINE)];av,bv=Vector(a),Vector(b);delta=bv-av;length=delta.length;yaw=math.atan2(delta.y,delta.x)
        south=abs(a[1]-19.068)<.001 and abs(b[1]-19.068)<.001
        if south:
            lo,hi=sorted((a[0],b[0]));cursor=lo
            for x in DOORS:
                left,right=x-1.45,x+1.45
                walls.box('perimeter',( (cursor+left)/2,5.5,19.068),(left-cursor,11,.16))
                walls.box('portal head',(x,(2.85+11)/2,19.068),(2.9,11-2.85,.16))
                walls.box('exit safety gate',(x,1.45,19.20),(3.2,2.9,.12))
                cursor=right
            walls.box('perimeter',((cursor+hi)/2,5.5,19.068),(hi-cursor,11,.16))
        else:
            mid=(av+bv)/2;walls.box('perimeter',(mid.x,5.5,mid.y),(length,11,.16),yaw)
    return [ground,walls,ceilings]


def make_meshes():
    groups={};objects=[]
    for layer in LAYER_NAMES:
        parent=bpy.data.objects.new(layer,None);bpy.context.scene.collection.objects.link(parent);groups[layer]=parent
    for (layer,finish),parts in s.BATCHES.items():
        if not parts.vertices:continue
        obj=parts.mesh(s.MATERIALS[finish],bpy.context.scene.collection,f'{layer} · {finish}');obj.parent=groups[layer]
        for key in ('bu_refinement','bu_detail_source'):
            if key in obj:del obj[key]
        obj['campusInteriorLayer']=layer;obj['campusInteriorFinish']=finish;obj['authoredInterior']=True
        obj['semanticCounts']=json.dumps(dict(Counter(r['kind'] for r in parts.records)))
        bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4]);bm.to_mesh(obj.data);bm.free();obj.data.update()
        if not MOBILE:s.shared.metre_uv(obj)
        else:
            for uv in list(obj.data.uv_layers):obj.data.uv_layers.remove(uv)
        objects.append(obj)
    return objects,list(groups.values())


def reset(mobile):
    global MOBILE
    MOBILE=mobile
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    s.BATCHES={};s.COUNTS.clear();s.MATERIALS.clear();s.OBJECTS.clear();s.COLLECTIONS.clear()
    s.make_materials()
    if mobile:
        for finish,old in list(s.MATERIALS.items()):
            material=bpy.data.materials.new(finish+' · mobile interior');material.use_nodes=True
            bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            tint=list(old['bu_base_tint']);alpha=.12 if finish=='glass' else 1
            bsdf.inputs['Base Color'].default_value=(*tint,1);bsdf.inputs['Roughness'].default_value=.78;bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Alpha'].default_value=alpha
            material.diffuse_color=(*tint,alpha);material['bu_base_tint']=tint
            if alpha<1:material.surface_render_method='DITHERED'
            s.MATERIALS[finish]=material


def make_parts():
    s.slab('floor-1',0);s.slab('floor-2-slab',LEVEL,s.VOIDS)
    s.grand_stair();butterfly=s.butterfly_stair();s.public_rooms();glazing();s.ceiling()
    return butterfly


def export(path,objects,parents=(),textured=False):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [*objects,*parents]:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,
        export_texcoords=textured,export_normals=True,export_tangents=textured,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    if textured:s.patch_glb(path)
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+length])
    triangles=sum(doc['accessors'][p['indices']]['count']//3 for mesh in doc['meshes'] for p in mesh['primitives'])
    return {'url':'/assets/bu-cds-interior/'+path.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'triangles':triangles,'meshes':len(doc['meshes']),'textures':len(doc.get('textures',[]))}


def ground_signature(parts):
    """Exact desktop/mobile ground component arrays; no tolerance masks drift."""
    records=[]
    names={'grand walking tread','grand seating terrace','grand upper landing','butterfly lower flight tread','butterfly upper flight tread','butterfly curved landing segment','butterfly lower landing','butterfly upper landing'}
    for (layer,finish),part in parts.items():
        if layer=='stairs' and finish=='floor-concrete' or layer in ('floor-1','floor-2-slab') and finish=='floor-concrete':
            for r in part.records:
                if 'slab cell' not in r['kind'] and r['kind'] not in names:continue
                lo,hi=r['vertexRange'];fl,fh=r['faceRange']
                records.append((r['kind'],part.vertices[lo:hi],[tuple(i-lo for i in f) for f in part.faces[fl:fh]]))
    return hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()


def stair_waypoints(butterfly):
    grand=[[31.2,0,13.04]];x=30
    for i in range(36):
        run=(.36,.36,1.2)[i%3]
        grand.append([x-run/2,(i+1)*LEVEL/36,13.04]);x-=run
    grand.extend([[5.92,LEVEL,13.04],[5.92,LEVEL,11.0]])
    start=Vector((butterfly['lowerLanding'][0],butterfly['lowerLanding'][2]));a=Vector((butterfly['firstTangent'][0],butterfly['firstTangent'][2]))
    center=Vector((butterfly['turnLanding'][0],butterfly['turnLanding'][2]));b=Vector((butterfly['secondTangent'][0],butterfly['secondTangent'][2]));end=Vector((24,10.65))
    foot=start-(a-start).normalized()*.55
    path=[[float(foot.x),0,float(foot.y)]]
    for i in range(18):
        p=start+(a-start)*((i+.5)/18);path.append([float(p.x),(i+1)*LEVEL/36,float(p.y)])
    aa=math.atan2(a.y-center.y,a.x-center.x);bb=math.atan2(b.y-center.y,b.x-center.x)
    while bb<aa:bb+=math.tau
    # The next tread extends 2 mm across the final tangency. Keep waypoints
    # inside the landing and then move to the first actual upper-tread center.
    for i in range(24):
        angle=aa+(bb-aa)*i/24;p=center+Vector((math.cos(angle),math.sin(angle)))*butterfly['turnRadius'];path.append([float(p.x),LEVEL/2,float(p.y)])
    for i in range(18):
        p=b+(end-b)*((i+.5)/18);path.append([float(p.x),LEVEL/2+(i+1)*LEVEL/36,float(p.y)])
    path.extend([[24,LEVEL,11.4],[27.8,LEVEL,11.4]])
    return {'grand':grand,'butterfly':path}


def main():
    PUBLIC.mkdir(parents=True,exist_ok=True)
    reset(False);butterfly=make_parts();expected_ground=ground_signature(s.BATCHES)
    physics=build_physics();objects,parents=make_meshes()
    bpy.context.scene.unit_settings.system='METRIC'
    for image in bpy.data.images:
        if image.source=='FILE' and image.filepath:image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'interior-desktop.blend'))
    desktop=export(PUBLIC/'interior-desktop.glb',objects,parents,True)
    physics_objects=[p.object() for p in physics]
    collision=export(PUBLIC/'physics.glb',physics_objects)
    reset(True);make_parts();mobile_ground=ground_signature(s.BATCHES)
    if mobile_ground!=expected_ground:raise RuntimeError('Desktop/mobile walkable geometry differs')
    objects,parents=make_meshes();mobile=export(PUBLIC/'interior-mobile.glb',objects,parents)
    if mobile['textures']!=0:raise RuntimeError('Mobile interior must remain texture-free')
    walks=stair_waypoints(butterfly)
    manifest={
        'id':'bu-cds-interior','version':1,'mode':'independent-interior','units':'metres','axes':{'x':'east','y':'up','z':'south'},
        'assets':{'desktop':desktop,'mobile':mobile,'physics':collision},'levels':{'ground':0,'second':LEVEL},
        'outlineXZ':s.OUTLINE,'voidsXZ':s.VOIDS,'layers':LAYER_NAMES,
        'entrySpawn':[44.2,0,16.8],'entryLookAt':[34,1.3,12],
        'exits':[{'id':'west','position':[30.2,0,18.15],'outsideLocal':[30.2,.15,22.5],'radius':1.55},{'id':'east','position':[44.2,0,18.15],'outsideLocal':[44.2,.15,22.5],'radius':1.55}],
        'doors':[{'center':[x,0,19.068],'width':2.9,'height':2.85,'source':'Existing exterior authored axis, not a measured door survey'} for x in DOORS],
        'anchors':{'cafe':[-17.7,0,2.5],'grandStairLower':[31.2,0,13.04],'grandStairUpper':[5.92,LEVEL,13.04],
            'butterflyLower':walks['butterfly'][0],'butterflyUpper':[24,LEVEL,11.4],'secondFloorWest':[-10,LEVEL,7],'secondFloorEast':[41,LEVEL,13]},
        'stairWaypoints':walks,'walkableGeometryHash':expected_ground,
        'physics':{'ground':['interior-ground'],'walls':['interior-walls'],'ceilings':['interior-ceilings'],
            'meshes':[{'name':p.name,'role':p.role,'components':dict(p.counts)} for p in physics],
            'usage':'Ground supports player raycasts; wall blocks player and camera; ceiling is camera-only. Both quality levels use this exact same file.',
            'solidGroundExclusionsXZ':[[6.96,30.0,12.0,19.0]],
            'exitSafetyGates':'Two invisible planes behind the visual door holes keep bodies on the slab until exit interaction completes.'},
        'alignment':{'exteriorOriginWorld':[-905.6183790617798,4.478491176840529,1009.5274712685497],'yaw':-.145,
            'note':'Original CDS local frame. Do NOT add exterior GLB sample offset (35.75,0,21.15). Runtime independent mode need not use this world transform.',
            'removedPreviewAreaSquareMetres':129.83013504,'exteriorUnmodified':True},
        'sources':[
            {'url':'https://www.bu.edu/community/files/2019/04/BUDataSciences-Vol-1.pdf','evidence':'2019 Figures 2-12/2-13 broad program relationships, not as-built dimensions'},
            {'url':'https://www.bu.edu/articles/2023/center-for-computing-data-sciences-wins-global-award-for-interior-design/','evidence':'As-built gray seating terraces, timber benches/red pads, timber slats and curved black stair guards'},
            {'url':'https://www.bu.edu/articles/2023/center-for-computing-and-data-sciences-opening-photo-gallery/','evidence':'Café, separate butterfly stair and second-floor public learning areas'}],
        'estimates':['Room and furniture placement','5.6m floor height, stair dimensions and tread counts','PBR parameters and menu-screen placeholders'],
        'notClaimed':['Measured as-built interior','Seamless transparent connection to existing exterior','Upper floors or operational elevators']
    }
    text=json.dumps(manifest,indent=2)
    (HERE/'manifest.json').write_text(text,encoding='utf-8');(PUBLIC/'manifest.json').write_text(text,encoding='utf-8')
    print('CDS_INTERIOR_GAME_RESULT '+json.dumps({'assets':manifest['assets'],'walkableGeometryHash':expected_ground}),flush=True)


if __name__=='__main__':main()
