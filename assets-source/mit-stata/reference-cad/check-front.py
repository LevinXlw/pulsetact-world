from pathlib import Path
import bpy,sys,json,math,ast,collections,importlib
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3];HERE=ROOT/'assets-source/mit-stata';sys.path.insert(0,str(HERE))
shape=importlib.import_module('shape-controls');twins=importlib.import_module('twins-controls')
P=json.loads((HERE/'patches.json').read_text());V=[];F=[];ft=1200/3937;o=(766425.8129794697-731100,2956167.074144031-2902900)
for l in (HERE/'source.obj').read_text().splitlines():
 if l.startswith('v '):
  x,y,z=map(float,l.split()[1:4]);V.append(Vector(((x-o[0])*ft,(y-o[1])*ft,z*ft)))
 elif l.startswith('f '):F.append([int(t.split('/')[0])-1 for t in l.split()[1:]])
tree=ast.parse((HERE/'build-stata.py').read_text(encoding='utf-8-sig'));brick=set()
for n in tree.body:
 if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='BRICK' for t in n.targets):brick=ast.literal_eval(n.value)
 if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call):
  f=n.value.func
  if isinstance(f,ast.Attribute) and isinstance(f.value,ast.Name) and f.value.id=='BRICK' and f.attr=='difference_update':brick.difference_update(ast.literal_eval(n.value.args[0]))
C,changes=shape.corrected_vertices(V,F,P,brick);fp={f:p for p in P for f in p['faces']}
mappers={f:twins.mapper_for(fp.get(f,{'faces':[f]})) or shape.surface_mapper(fp.get(f,{'faces':[f]}),V,C,F) for f in range(len(F))}
def mapped(f,p):return mappers[f](p) if mappers[f] else Vector(p)
edges=collections.defaultdict(list)
for f,ids in enumerate(F):
 for a,b in zip(ids,ids[1:]+ids[:1]):
  key=tuple(sorted(tuple(round(t,4) for t in V[i]) for i in (a,b)));edges[key].append((f,a,b))
seams=[]
for key,items in edges.items():
 if len(items)<2:continue
 first=items[0];a,b=V[first[1]],V[first[2]]
 for j in items[1:]:
  for t in (0,.125,.25,.5,.75,.875,1):
   q=a.lerp(b,t);d=(mapped(first[0],q)-mapped(j[0],q)).length
   if d>.002:seams.append({'faces':[first[0],j[0]],'patches':[fp.get(first[0],{}).get('id'),fp.get(j[0],{}).get('id')],'t':t,'gap':d})
def clip(poly,n,k,sign):
 out=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  da=(n.dot(a)-k)*sign;db=(n.dot(b)-k)*sign;ina=da<=1e-7;inb=db<=1e-7
  if ina:out.append(a)
  if ina!=inb:
   t=da/(da-db);out.append(a.lerp(b,t))
 return out
vertices=[];tris=[];mats=[];flips=[];deg=0;nonfinite=0;maxdis=0
for f,ids in enumerate(F):
 poly=[V[i] for i in ids];mapper=mappers[f];parts=[poly]
 if mapper:
  planes=[(Vector((0,0,1)),z) for z in getattr(mapper,'split_levels',[])]+[(Vector(n),k) for n,k in getattr(mapper,'split_planes',[])]
  for n,k in planes:
   nxt=[]
   for p in parts:
    ds=[n.dot(q)-k for q in p]
    if min(ds)<-1e-5 and max(ds)>1e-5:nxt.extend([clip(p,n,k,1),clip(p,n,k,-1)])
    else:nxt.append(p)
   parts=nxt
 orig=(poly[1]-poly[0]).cross(poly[2]-poly[0])
 for part in parts:
  qs=[mapped(f,q) for q in part]
  for a,b in zip(part,qs):maxdis=max(maxdis,(b-a).length);nonfinite+=not all(math.isfinite(x) for x in b)
  offset=len(vertices);vertices.extend(qs)
  for j in range(1,len(qs)-1):
   before=(part[j]-part[0]).cross(part[j+1]-part[0])
   if before.length_squared<1e-12:continue
   normal=(qs[j]-qs[0]).cross(qs[j+1]-qs[0])
   if normal.length_squared<1e-12:
    deg+=1;print("DEGENERATE",f,fp.get(f,{}).get("id"),before.length_squared,normal.length_squared,[list(x) for x in (part[0],part[j],part[j+1])])
   if normal.dot(orig)<-1e-6:flips.append({'face':f,'patch':fp.get(f,{}).get('id'),'normalDot':normal.dot(orig)})
   tris.append((offset,offset+j,offset+j+1));mats.append(1 if fp.get(f,{}).get('id') in brick else 2 if fp.get(f,{}).get('id') in (23,82) else 0)
report={'modified_source_vertices':len(changes),'triangle_count':len(tris),'nonfinite':nonfinite,'new_degenerate':deg,'max_displacement_m':maxdis,'seam_errors':seams[:50],'seam_error_count':len(seams),'flipped_relative_triangles':flips[:50],'flipped_count':len(flips)}
out=HERE/'reference-cad';(out/'front-geometry-check.json').write_text(json.dumps(report,indent=2));print('CHECK '+json.dumps(report))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('Photo-reconstructed shell diagnostic');mesh.from_pydata(vertices,[],tris);mesh.update();obj=bpy.data.objects.new('Shell diagnostic',mesh);bpy.context.collection.objects.link(obj)
for name,color in [('silver',(.65,.69,.73,1)),('brick',(.56,.24,.13,1)),('glass',(.08,.20,.25,1))]:
 mat=bpy.data.materials.new(name);mat.diffuse_color=color;mesh.materials.append(mat)
for i,p in enumerate(mesh.polygons):p.material_index=mats[i]
s=bpy.context.scene;s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO';s.display.shading.color_type='MATERIAL';s.display.shading.show_shadows=True;s.display.shading.show_cavity=True;s.display.shading.cavity_type='BOTH';s.display.shading.background_type='WORLD';s.world.color=(.18,.20,.22);s.render.resolution_x=1200;s.render.resolution_y=1000;s.render.resolution_percentage=100
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='PERSP';cam.data.lens=45
for name,eye,target in [('front-gates-shape',(180,398,45),(130,321,24)),('front-dreyfoos-shape',(68,352,38),(57,285,23))]:
 cam.location=eye;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)

