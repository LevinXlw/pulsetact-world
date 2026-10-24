from pathlib import Path
import bpy, json, math, random
from mathutils import Vector
from collections import defaultdict
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
FT=1200/3937
O=(766425.8129794697-731100,2956167.074144031-2902900)
def read_source():
    vertices=[];faces=[]
    for line in (HERE/'source.obj').read_text().splitlines():
        if line.startswith('v '):
            x,y,z=map(float,line.split()[1:4]);vertices.append(((x-O[0])*FT,(y-O[1])*FT,z*FT))
        elif line.startswith('f '):faces.append([int(t.split('/')[0])-1 for t in line.split()[1:]])
    return vertices,faces
def source_object():
    vs,fs=read_source();mesh=bpy.data.meshes.new('Stata original measured shell');mesh.from_pydata(vs,[],fs);mesh.update();obj=bpy.data.objects.new('Stata measured 2018',mesh);bpy.context.collection.objects.link(obj);return obj
def patches(obj):
    mesh=obj.data;edge_faces=defaultdict(list)
    for p in mesh.polygons:
        for edge in p.edge_keys:edge_faces[edge].append(p.index)
    todo=set(range(len(mesh.polygons)));parts=[]
    while todo:
        seed=min(todo);todo.remove(seed);ids=[seed];stack=[seed];normal=mesh.polygons[seed].normal.copy();d=normal.dot(mesh.polygons[seed].center)
        while stack:
            current=mesh.polygons[stack.pop()]
            for edge in current.edge_keys:
                for j in edge_faces[edge]:
                    if j in todo:
                        p=mesh.polygons[j]
                        if p.normal.dot(normal)>.9995 and abs(normal.dot(p.center)-d)<.035:
                            todo.remove(j);ids.append(j);stack.append(j)
        area=sum(mesh.polygons[i].area for i in ids)
        if area<8:continue
        coords=[mesh.vertices[i].co for f in ids for i in mesh.polygons[f].vertices]
        center=sum((mesh.polygons[i].center*mesh.polygons[i].area for i in ids),Vector())/area
        parts.append({'faces':ids,'area':area,'normal':list(normal),'center':list(center),'bounds':{'min':[min(p[k] for p in coords) for k in range(3)],'max':[max(p[k] for p in coords) for k in range(3)]}})
    parts.sort(key=lambda p:-p['area'])
    for i,p in enumerate(parts):p['id']=i
    return parts
def look(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
def setup():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    s=bpy.context.scene;s.render.engine='BLENDER_EEVEE_NEXT';s.render.resolution_x=1500;s.render.resolution_y=1050;s.render.resolution_percentage=100
    s.world.color=(.65,.7,.8);s.view_settings.view_transform='Standard';s.render.image_settings.file_format='PNG'
    bpy.ops.object.light_add(type='SUN',location=(0,100,150));bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.6,-.3,-.4)
    bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=170
    return s,cam
if __name__=='__main__':
    s,cam=setup();obj=source_object();parts=patches(obj);(HERE/'patches.json').write_text(json.dumps(parts,indent=2));rng=random.Random(123)
    for p in parts:
        mat=bpy.data.materials.new('patch-'+str(p['id']));mat.diffuse_color=(*[rng.uniform(.2,.8) for _ in range(3)],1);obj.data.materials.append(mat)
        for i in p['faces']:obj.data.polygons[i].material_index=len(obj.data.materials)-1
        if p['area']>35 and abs(p['normal'][2])<.8:
            bpy.ops.object.text_add(location=Vector(p['center'])+Vector(p['normal'])*.5);label=bpy.context.object;label.name='Label '+str(p['id']);label.data.body=str(p['id']);label.data.size=2.8;label.data.align_x='CENTER';label.rotation_euler=Vector(p['normal']).to_track_quat('Z','Y').to_euler()
    views={'northwest':(-50,430,145),'northeast':(260,430,145),'southwest':(-30,120,130),'southeast':(280,140,145),'top':(114,275,300)}
    for name,eye in views.items():
        cam.location=eye;look(cam,(114,275,20));s.render.filepath=str(HERE/(name+'-patches.png'));bpy.ops.render.render(write_still=True)
    print(json.dumps({'patches':len(parts),'largeWalls':sum(p['area']>35 and abs(p['normal'][2])<.8 for p in parts)}))
