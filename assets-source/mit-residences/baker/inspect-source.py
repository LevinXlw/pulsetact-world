from pathlib import Path
import json, zipfile, collections
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
FT=1200/3937
O=(766425.8129794697-731100,2956167.074144031-2902900)
info=next(x for x in json.loads((ROOT/'assets-source/mit-residences/source-index.json').read_text())['residences'] if x['id']=='baker')['components'][0]
with zipfile.ZipFile(ROOT/info['sourceArchive']) as z:
    (HERE/'source.obj').write_bytes(z.read(info['sourceEntry']))
v=[];f=[]
for line in (HERE/'source.obj').read_text().splitlines():
    a=line.split()
    if a and a[0]=='v':
        x,y,z=map(float,a[1:4]);v.append(((x-O[0])*FT,(y-O[1])*FT,z*FT))
    elif a and a[0]=='f': f.append([int(t.split('/')[0])-1 for t in a[1:]])
data={'source':info,'vertices':v,'faces':f}
(HERE/'source-geometry.json').write_text(json.dumps(data,indent=2))
print('bounds',[(min(p[k] for p in v),max(p[k] for p in v)) for k in range(3)])
print('levels',collections.Counter(round(p[2],3) for p in v))
if __name__=='__main__' and 'bpy' in __import__('sys').modules:
    import bpy, random
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    mesh=bpy.data.meshes.new('Survey');mesh.from_pydata(v,[],f);mesh.update()
    obj=bpy.data.objects.new('Survey',mesh);bpy.context.collection.objects.link(obj)
    rng=random.Random(4)
    for level in sorted(set(round(p[2],3) for p in v)):
        mat=bpy.data.materials.new(str(level));mat.diffuse_color=(*[rng.uniform(.2,.8) for _ in range(3)],1);obj.data.materials.append(mat)
    heights=[float(m.name) for m in obj.data.materials]
    for p in mesh.polygons: p.material_index=min(range(len(heights)),key=lambda j:abs(heights[j]-p.center.z))
    s=bpy.context.scene;s.render.engine='BLENDER_EEVEE_NEXT';s.render.resolution_x=1600;s.render.resolution_y=1100;s.render.resolution_percentage=100
    s.world.color=(.6,.6,.6);s.view_settings.view_transform='Standard'
    bpy.ops.object.light_add(type='SUN');bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.4,-.3,-.7)
    bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=125
    for name,eye in {'source-top':(-300.6,-279.83,180),'source-south':(-350,-380,100),'source-north':(-250,-180,100)}.items():
        cam.location=eye;cam.rotation_euler=(Vector((-300.6,-279.83,10))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(HERE/(name+'.png'));bpy.ops.render.render(write_still=True)
