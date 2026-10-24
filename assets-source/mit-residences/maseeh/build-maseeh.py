"""Photo-informed Maseeh exterior; Cambridge survey supplies the world shell.

Run Blender --background --python-exit-code 1 --python this-file.
All geometry stays east,north,up. No navigable interior is claimed.
"""
from pathlib import Path
from collections import defaultdict
import sys,json,math,struct,hashlib,importlib
import bpy,bmesh,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
sys.path.insert(0,str(HERE));inspect=importlib.import_module('inspect-source')
V,F,SOURCE=inspect.read_source()
OUT=ROOT/'public/assets/mit-residences'
UP=Vector((0,0,1));E=Vector((.91,.415,0)).normalized();N=Vector((-E.y,E.x,0));C=Vector((-114.592,-168.846,0))
ROOF=26.165239827279652
def world(x,y,z):return C+E*x+N*y+UP*z
def local(p):p=Vector(p)-C;return (p.dot(E),p.dot(N),p.z)
def clip(poly,axis,value,less):
 out=[]
 for i,a in enumerate(poly):
  b=poly[(i+1)%len(poly)];da=(a[axis]-value)*(1 if less else -1);db=(b[axis]-value)*(1 if less else -1);ina=da<=1e-8;inb=db<=1e-8
  if ina:out.append(a)
  if ina!=inb:
   t=da/(da-db);out.append(tuple(a[k]+(b[k]-a[k])*t for k in range(len(a))))
 return out
def subtract(poly,r):
 out=[];remain=poly
 for axis,val,less in ((0,r[0],True),(0,r[2],False),(1,r[1],True),(1,r[3],False)):
  if len(remain)<3:break
  a=clip(remain,axis,val,less)
  if len(a)>2:out.append(a)
  remain=clip(remain,axis,val,not less)
 return out
def inside(q,tris):
 for tri in tris:
  ds=[(tri[(i+1)%3][0]-tri[i][0])*(q[1]-tri[i][1])-(tri[(i+1)%3][1]-tri[i][1])*(q[0]-tri[i][0]) for i in range(3)]
  if min(ds)>-1e-5 or max(ds)<1e-5:return True
 return False
class Geometry:
 def __init__(self):self.groups=defaultdict(lambda:{'v':[],'f':[],'uv':[]})
 def polygon(self,mat,ps,uv=None):
  if len(ps)<3:return
  ps=[Vector(p) for p in ps];g=self.groups[mat];off=len(g['v']);g['v'].extend(tuple(p) for p in ps)
  if uv is None:
   norm=(ps[1]-ps[0]).cross(ps[2]-ps[0]);axis=max(range(3),key=lambda k:abs(norm[k]));axes=(0,1) if axis==2 else ((0,2) if axis==1 else (1,2));scale=(1.92,.60) if mat=='brick' else (2,2);uv=[(p[axes[0]]/scale[0],p[axes[1]]/scale[1]) for p in ps]
  g['uv'].extend(uv)
  for i in range(1,len(ps)-1):
   if (ps[i]-ps[0]).cross(ps[i+1]-ps[0]).length_squared>1e-12:g['f'].append((off,off+i,off+i+1))
 def box(self,mat,c,u,v,n,w,h,d):
  c=Vector(c);u=Vector(u)*w/2;v=Vector(v)*h/2;n=Vector(n)*d/2;p=[c+u*a+v*b+n*s for s in (-1,1) for b in (-1,1) for a in (-1,1)]
  for ids in ((0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)):self.polygon(mat,[p[i] for i in ids])
 def line(self,mat,a,b,r,segments=6):
  a=Vector(a);b=Vector(b);d=(b-a).normalized();u=d.cross(UP if abs(d.z)<.95 else E).normalized();v=d.cross(u)
  for i in range(segments):
   pa=u*math.cos(i*math.tau/segments)*r+v*math.sin(i*math.tau/segments)*r;pb=u*math.cos((i+1)*math.tau/segments)*r+v*math.sin((i+1)*math.tau/segments)*r;self.polygon(mat,[a+pa,a+pb,b+pb,b+pa])
 def build(self,mats,prefix):
  result=[]
  for name,g in self.groups.items():
   if not g['f']:continue
   mesh=bpy.data.meshes.new(prefix+' '+name);mesh.from_pydata(g['v'],[],g['f']);mesh.update();uv=mesh.uv_layers.new(name='UVMap')
   for p in mesh.polygons:
    for li in p.loop_indices:uv.data[li].uv=g['uv'][mesh.loops[li].vertex_index]
   # World-coordinate float32 vertices can differ by several micrometres at
   # a shared ring. Weld the cap at 0.1 mm so its smooth normals are continuous.
   bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001 if name=='copper' else .000001);bm.to_mesh(mesh);bm.free();mesh.update()
   if name=='copper':
    for p in mesh.polygons:p.use_smooth=True
   obj=bpy.data.objects.new(prefix+' '+name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(mats[name]);result.append(obj)
  return result
def packed(name,pixels):
 h,w=pixels.shape[:2];im=bpy.data.images.new(name,width=w,height=h,alpha=True);im.pixels.foreach_set(pixels.astype(np.float32).ravel());im.file_format='PNG';im.pack();return im
def materials(mobile):
 size=256 if mobile else 512;rng=np.random.default_rng(10123);yy,xx=np.mgrid[:size,:size];noise=rng.normal(0,.006,(size,size));images={}
 row=np.floor(yy/size*8).astype(int);bx=(xx/size*8+(row%2)*.5)%1;by=(yy/size*8)%1;cell=(np.floor(xx/size*8+(row%2)*.5).astype(int)%8)+row*8;vari=rng.uniform(.82,1.18,64)[cell];mortar=(bx<.026)|(by<.092)
 # Eight 240 x 75 mm courses per 1.92 x .60 m tile. Muted fired brick and
 # recessed warm-grey mortar preserve the photographed fine masonry scale.
 brick=np.zeros((size,size,4),np.float32);brick[:,:,:3]=np.clip(np.array([.315,.157,.111])[None,None,:]*vari[:,:,None]+noise[:,:,None],0,1);brick[mortar,:3]=np.array([.40,.365,.305])+noise[mortar,None];brick[:,:,3]=1;images['brick']=packed('Maseeh rough burgundy brick',brick)
 relief=np.where(mortar,.15,.85);dx=(np.roll(relief,-1,1)-np.roll(relief,1,1))*.26;dy=(np.roll(relief,-1,0)-np.roll(relief,1,0))*.26;normal=np.ones((size,size,4),np.float32);normal[:,:,0]=.5-dx;normal[:,:,1]=.5-dy;normal[:,:,2]=np.sqrt(np.maximum(.1,1-dx*dx-dy*dy))*.5+.5;normalim=packed('Maseeh mortar normal',normal);normalim.colorspace_settings.name='Non-Color'
 for name,color in [('stone',(.63,.61,.54)),('roof',(.18,.19,.18))]:
  ar=np.ones((size,size,4),np.float32);v=rng.normal(0,.007,(size,size));weather=.006*np.sin(xx/size*math.tau*5)*np.cos(yy/size*math.tau*3);ar[:,:,:3]=np.clip(np.array(color)[None,None,:]+v[:,:,None]+weather[:,:,None],0,1);images[name]=packed('Maseeh '+name+' finish',ar[::2,::2])
 # The restored 2011 caps are dark brown/charcoal copper, not uniformly green.
 # Large, restrained patina clouds and narrow runoff streaks are baked so
 # Blender and glTF share the same appearance without procedural-only nodes.
 phase=xx/size*math.tau;vphase=yy/size*math.tau
 cloud=(np.sin(phase*2+.7*np.cos(vphase*3))+np.cos(vphase*3+phase)+np.sin(phase*7-vphase*2)) / 6 + .5
 patina=np.clip((cloud-.56)*1.7,0,.35);streak=(np.sin(phase*33+.7*np.sin(vphase*2))*.5+.5)**10*.018
 ar=np.ones((size,size,4),np.float32);ar[:,:,:3]=np.array([.155,.145,.120])[None,None,:]*(.82+.35*cloud[:,:,None])
 ar[:,:,:3]=ar[:,:,:3]*(1-patina[:,:,None])+np.array([.14,.205,.17])[None,None,:]*patina[:,:,None]+streak[:,:,None];images['copper']=packed('Maseeh oxidized copper panels',ar)
 specs={'brick':((1,1,1,1),.88,0),'stone':((1,1,1,1),.79,0),'roof':((1,1,1,1),.94,0),'copper':((1,1,1,1),.34,.72),'copperEdge':((.19,.205,.17,1),.37,.68),'frame':((.50,.49,.43,1),.55,.08),'glass':((.035,.052,.058,1),.14,.18),'glassShade':((.07,.076,.067,1),.24,.1),'reveal':((.075,.08,.075,1),.9,0),'iron':((.035,.041,.036,1),.46,.7),'grass':((.18,.23,.09,1),.98,0),'paving':((.54,.53,.47,1),.91,0)}
 mats={}
 for name,(col,rough,metal) in specs.items():
  m=bpy.data.materials.new(name);m.diffuse_color=col;m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=col;p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
  if name in images:
   t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=images[name];m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
  if name=='brick':
   t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=normalim;nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.65;m.node_tree.links.new(t.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
  mats[name]=m
 return mats
def glb(path):
 raw=path.read_bytes();ln=struct.unpack_from('<I',raw,12)[0];return json.loads(raw[20:20+ln]),raw[28+ln:]
def accessor(doc,data,idx):
 a=doc['accessors'][idx];b=doc['bufferViews'][a['bufferView']];num={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];typ={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']];size=struct.calcsize(typ)*num;off=b.get('byteOffset',0)+a.get('byteOffset',0);return [struct.unpack_from('<'+typ*num,data,off+i*b.get('byteStride',size)) for i in range(a['count'])]
def compact_glb(path):
 doc,data=glb(path)
 for node in doc['nodes']:
  if node.get('extras',{}).get('mitResidenceCollisionOnly'):
   for p in doc['meshes'][node['mesh']]['primitives']:p['attributes']={k:v for k,v in p['attributes'].items() if k=='POSITION'}
 for idx in sorted({p['attributes']['NORMAL'] for m in doc['meshes'] for p in m['primitives'] if 'NORMAL' in p['attributes']}):
  packed=bytearray()
  for xyz in accessor(doc,data,idx):packed.extend(struct.pack('<bbbx',*[max(-127,min(127,round(x*127))) for x in xyz]))
  data+=b'\0'*((-len(data))%4);off=len(data);data+=packed;vi=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(packed),'byteStride':4,'target':34962});a=doc['accessors'][idx];a.update({'bufferView':vi,'byteOffset':0,'componentType':5120,'normalized':True});a.pop('min',None);a.pop('max',None)
 for key in ('extensionsUsed','extensionsRequired'):
  if 'KHR_mesh_quantization' not in doc.setdefault(key,[]):doc[key].append('KHR_mesh_quantization')
 used=sorted({a for m in doc['meshes'] for p in m['primitives'] for a in [*p['attributes'].values(),p['indices']]});am={old:new for new,old in enumerate(used)};doc['accessors']=[doc['accessors'][i] for i in used]
 for m in doc['meshes']:
  for p in m['primitives']:p['attributes']={k:am[v] for k,v in p['attributes'].items()};p['indices']=am[p['indices']]
 usedviews=sorted({a['bufferView'] for a in doc['accessors']}|{im['bufferView'] for im in doc.get('images',[])});vm={old:new for new,old in enumerate(usedviews)};blob=bytearray();views=[]
 for old in usedviews:
  view=doc['bufferViews'][old];start=view.get('byteOffset',0);blob.extend(b'\0'*((-len(blob))%4));off=len(blob);blob.extend(data[start:start+view['byteLength']]);views.append({**view,'byteOffset':off})
 for a in doc['accessors']:a['bufferView']=vm[a['bufferView']]
 for im in doc.get('images',[]):im['bufferView']=vm[im['bufferView']]
 doc['bufferViews']=views;doc['buffers'][0]['byteLength']=len(blob);encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);blob+=b'\0'*((-len(blob))%4);path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(blob))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(blob),0x004e4942)+blob)
def terrain():
 vs=[];fs=[]
 for file in ['public/data/campuses/mit/campus.glb','public/data/killian/detail.glb']:
  doc,data=glb(ROOT/file)
  for m in doc['meshes']:
   for p in m['primitives']:
    name=doc['materials'][p.get('material',0)].get('name','')
    if file.endswith('detail.glb'):
     if name not in ('grass','pavement','steps','road','arterial','porticoFloor','courtCurb'):continue
    elif 'building' in name.lower():continue
    pos=accessor(doc,data,p['attributes']['POSITION']);ids=[x[0] for x in accessor(doc,data,p['indices'])] if 'indices' in p else list(range(len(pos)));off=len(vs);vs.extend((x,-z,y) for x,y,z in pos);fs.extend(tuple(off+ids[i+j] for j in range(3)) for i in range(0,len(ids),3))
 return BVHTree.FromPolygons(vs,fs,all_triangles=True)
TERRAIN=terrain()
def ground(x,y):
 hit=TERRAIN.ray_cast(Vector((x,y,65)),Vector((0,0,-1)),100)[0];return hit.z if hit else 3.0
def patches():
 groups=[]
 for i,ids in enumerate(F):
  p=[Vector(V[j]) for j in ids];n=(p[1]-p[0]).cross(p[2]-p[0]).normalized();d=n.dot(p[0]);found=None
  for gr in groups:
   if gr['n'].dot(n)>.99999 and abs(gr['d']-d)<.035:found=gr;break
  if found is None:found={'n':n,'d':d,'faces':[]};groups.append(found)
  found['faces'].append(i)
 return groups
def add_window(g,at,r,index,mobile):
 x0,z0,x1,z1=r;w=x1-x0;h=z1-z0;u=(at(1,0,0)-at(0,0,0)).normalized();n=u.cross(UP);back=-.22;front=.045
 corners=[(x0,z0),(x1,z0),(x1,z1),(x0,z1)]
 g.openings.append((at((x0+x1)/2,(z0+z1)/2),u,n,w/2,h/2))
 for i in range(4):
  a,b=corners[i],corners[(i+1)%4];g.polygon('stone',[at(*a,.018),at(*b,.018),at(*b,back),at(*a,back)])
 g.polygon('glassShade' if index%8 in (1,3) else 'glass',[at(x0,z0,back),at(x1,z0,back),at(x1,z1,back),at(x0,z1,back)])
 # Projecting limestone surround, header and deep sill; sash remains recessed.
 for a,b,c,d in [(x0-.13,z0-.13,x0,z1+.16),(x1,z0-.13,x1+.13,z1+.16),(x0,z1,x1,z1+.20)]:
  g.polygon('stone',[at(a,b,.075),at(c,b,.075),at(c,d,.075),at(a,d,.075)])
  if not mobile:
   # Real exposed outside return, not a paper-thin pale rectangle.
   aa,bb=((a,b),(a,d)) if a<x0 else (((c,d),(c,b)) if c>x1 else ((a,d),(c,d)))
   g.polygon('stone',[at(*aa,0),at(*aa,.075),at(*bb,.075),at(*bb,0)])
 if mobile:
  for ps in [[at(x0-.215,z0-.175,.255),at(x1+.215,z0-.175,.255),at(x1+.215,z0-.005,.255),at(x0-.215,z0-.005,.255)],[at(x0-.215,z0-.005,.255),at(x1+.215,z0-.005,.255),at(x1+.215,z0-.005,-.065),at(x0-.215,z0-.005,-.065)]]:g.polygon('stone',ps)
 else:g.box('stone',at((x0+x1)/2,z0-.09,.095),u,UP,n,w+.43,.17,.32)
 # Pale painted double hung sash, six panes in the upper sash.
 lines=[(x0+.035,(z0+z1)/2,.05,h),(x1-.035,(z0+z1)/2,.05,h),((x0+x1)/2,z0+.035,w,.055),((x0+x1)/2,z1-.035,w,.055),((x0+x1)/2,z0+h*.47,w,.05)]
 if not mobile:lines += [(x0+w/3,z0+h*.74,.025,h*.51),(x0+w*2/3,z0+h*.74,.025,h*.51),((x0+x1)/2,z0+h*.75,w,.025)]
 else:lines += [((x0+x1)/2,z0+h*.74,.03,h*.51)]
 for x,z,ww,hh in lines:g.polygon('frame',[at(x-ww/2,z-hh/2,back+.035),at(x+ww/2,z-hh/2,back+.035),at(x+ww/2,z+hh/2,back+.035),at(x-ww/2,z+hh/2,back+.035)])
def shell(g,mobile):
 count=0;wallgroups=0;g.openings=[];quoins=[]
 levels=[(5.60,1.75),(8.80,2.15),(11.95,2.05),(15.10,2.05),(18.25,1.85),(21.40,1.85),(24.52,1.75)]
 for group in patches():
  n=group['n'];ids=group['faces'];ps=[Vector(V[j]) for i in ids for j in F[i]];zmin=min(p.z for p in ps);zmax=max(p.z for p in ps)
  if zmin>=29.28:continue # Replace the two faceted survey caps by real bell copper caps.
  if abs(n.z)>.05:
   for i in ids:g.polygon('roof' if n.z>.2 else ('brick' if zmax<29.2 else 'copper'),[V[j] for j in F[i]])
   continue
  wallgroups+=1;u=Vector((-n.y,n.x,0)).normalized();o=n*group['d'];at=lambda x,z,d=0,o=o,u=u,n=n:o+u*x+UP*z+n*d
  tris=[[(Vector(V[j]).dot(u),V[j][2]) for j in F[i]] for i in ids];xs=[q[0] for t in tris for q in t];a,b=min(xs),max(xs);width=b-a;rects=[]
  # The survey captures a small faceted vestibule in the south court. Its
  # 2011 renovation glazing must not inherit the generic brick wall material.
  if abs(zmax-6.725239827)<.01:
   for tri in tris:
    for lo,hi,mat in [(-1,3.95,'stone'),(3.95,6.48,'glass'),(6.48,7,'iron')]:
     part=clip(clip(tri,1,lo,False),1,hi,True)
     if len(part)>2:g.polygon(mat,[at(x,z,.015) for x,z in part])
   for x in (a+.035,b-.035):g.box('iron',at(x,5.22,.035),u,UP,n,.07,2.55,.09)
   g.box('iron',at((a+b)/2,5.22,.04),u,UP,n,.045,2.55,.08)
   for z in (4.02,6.30):g.box('iron',at((a+b)/2,z,.045),u,UP,n,width,.07,.10)
   if n.dot(-N)>.9:
    # Closed double leaf doors are at the FRONT of the surveyed vestibule.
    for x in ((a+b)/2-.14,(a+b)/2+.14):g.line('iron',at(x,4.85,.16),at(x,5.30,.16),.025,5)
   continue
  # Window spacing follows the individual measured bays, with paired windows
  # on wider projections and one window on narrow octagonal/bay-return faces.
  is_tower=zmax>29.2 and zmin<1 and width<3
  usable=width-.9
  num=max(1,round(usable/2.45)) if width>1.65 and zmax-zmin>3 else 0
  if num>0:
   spacing=usable/num;ww=min(1.32,spacing*.61) if not is_tower else min(1.05,width-.85)
   for row,(zc,hh) in enumerate(levels):
    for col in range(num):
     cx=a+.45+spacing*(col+.5);r=(cx-ww/2,zc-hh/2,cx+ww/2,zc+hh/2);pt=at(cx,zc);lu,ln,_=local(pt)
     # Leave the north/south entry axes for a composed stone portal.
     if abs(lu-1)<5.2 and abs(ln-14.9)<.5 and n.dot(N)>.8:continue
     if abs(lu-1)<5.2 and abs(ln-1.7)<.6 and n.dot(-N)>.8:continue
     if zc>25.6 or zc<hh/2+ground(pt.x,pt.y)+.6:continue
     if all(inside(q,tris) for q in [(r[0]-.13,r[1]-.14),(r[2]+.13,r[1]-.14),(r[2]+.13,r[3]+.24),(r[0]-.13,r[3]+.24)]):rects.append(r);add_window(g,at,r,count,mobile);count+=1
  # Both photographed entrance elevations have a tall masonry center axis.
  # North has a clear close photograph; the south axis is partly tree-screened.
  middle=at((a+b)/2,5);_,middle_n,_=local(middle)
  is_north_center=n.dot(N)>.8 and abs(middle_n-14.9)<.5
  is_south_center=n.dot(-N)>.8 and abs(middle_n-1.7)<.6
  if is_north_center or is_south_center:
   for row,(zc,hh) in enumerate(levels):
    if row==0:continue
    zc,hh=[(0,0),(9.7,1.7),(12.75,2.05),(15.8,2.05),(18.8,1.85),(21.7,1.85),(24.6,1.75)][row]
    offsets=[-3.7,-1.85,0,1.85,3.7] if row<=3 else [-4.05,-1.25,1.25,4.05]
    for lu in offsets:
     cx=world(1+lu,14.9 if is_north_center else 1.7,0).dot(u);r=(cx-.51,zc-hh/2,cx+.51,zc+hh/2)
     if all(inside(q,tris) for q in [(r[0]-.1,r[1]),(r[2]+.1,r[1]),(r[2]+.1,r[3]),(r[0]-.1,r[3])]):rects.append(r);add_window(g,at,r,count,mobile);count+=1
  # Cut the composed portals through the source wall rather than painting
  # glass over masonry. The visible doors close the shallow exterior recess.
  middle=at((a+b)/2,5);_,middle_n,_=local(middle)
  if (n.dot(N)>.8 and abs(middle_n-14.9)<.5) or (n.dot(-N)>.8 and abs(middle_n-1.7)<.6):
   north=n.dot(N)>.8;portal=world(1,14.95 if north else 1.68,0);cx=portal.dot(u);floor=ground(portal.x+n.x*3,portal.y+n.y*3)+(.90 if north else .12)
   rects.append((cx-4.65,floor,cx+4.65,floor+3.85))
  for tri in tris:
   pieces=[tri]
   for r in rects:
    if max(q[0] for q in tri)<r[0] or min(q[0] for q in tri)>r[2] or max(q[1] for q in tri)<r[1] or min(q[1] for q in tri)>r[3]:continue
    pieces=[z for p in pieces for z in subtract(p,r)]
   for poly in pieces:
    # Keep actual brick ground-storey areas; only the low plinth is limestone.
    for lo,hi,mat in [(-1,3.85,'stone'),(3.85,99,'brick')]:
     clipped=clip(clip(poly,1,lo,False),1,hi,True)
     if len(clipped)>2:g.polygon(mat,[at(x,z) for x,z in clipped],[(x/1.92,z/.60) for x,z in clipped] if mat=='brick' else None)
  for z,h,d in [(3.88,.16,.13),(6.95,.22,.17),(17.0,.15,.12),(25.95,.23,.20)]:
   if zmin+.1<z<zmax-.05:
    # Clip each horizontal band to source triangles, preserving the gaps.
    for tri in tris:
     poly=clip(clip(tri,1,z-h/2,False),1,z+h/2,True)
     if len(poly)>2:g.polygon('stone',[at(x,zz,d) for x,zz in poly])
  if width>3.4 and zmax>20:
   for x in (a+.18,b-.18):
    for k in range(36):
     z=4.4+k*.60;qw=.38 if k%2 else .58
     if z>25.7:break
     if inside((x,z),tris) and not any(r[0]-.2<x<r[2]+.2 and r[1]-.2<z<r[3]+.25 for r in rects):
      quoins.append((at(x,z,.045),u.copy(),n.copy(),qw))
 for q,u,n,qw in quoins:
  if any(abs((q-c).dot(nn))<.25 and abs((q-c).dot(uu))<hw+qw/2+.1 and abs(q.z-c.z)<hh+.4 for c,uu,nn,hw,hh in g.openings):continue
  if mobile:g.polygon('stone',[q-u*qw/2-UP*.295+n*.062,q+u*qw/2-UP*.295+n*.062,q+u*qw/2+UP*.295+n*.062,q-u*qw/2+UP*.295+n*.062])
  else:g.box('stone',q,u,UP,n,qw,.59,.12)
 return {'windowOpenings':count,'facadeGroups':wallgroups}
def parapets(g,mobile):
 # Extract the real main-roof outline; do not wrap a rectangular bounding box.
 edges=defaultdict(int)
 for ids in F:
  if all(abs(V[i][2]-ROOF)<.001 for i in ids):
   p=[Vector(V[i]) for i in ids]
   if (p[1]-p[0]).cross(p[2]-p[0]).z<=0:continue
   for a,b in zip(ids,ids[1:]+ids[:1]):edges[tuple(sorted((a,b)))]+=1
 for (ia,ib),count in edges.items():
  if count!=1:continue
  a,b=Vector(V[ia]),Vector(V[ib]);u=(b-a).normalized();length=(b-a).length
  if length<.35:continue
  n=u.cross(UP);mid=(a+b)/2;g.box('brick',mid+UP*.27,u,UP,n,length,.54,.35);g.box('stone',mid+UP*.59,u,UP,n,length+.06,.12,.46)
  lu,ln,_=local(mid)
  if abs(lu)>23.5 and (ln<-28 or ln>27):
   num=max(1,round(length/1.65))
   for j in range(num):
    p=a+(b-a)*(j+.5)/num;g.box('brick',p+UP*.98,u,UP,n,.78,.80,.48);g.box('stone',p+UP*1.41,u,UP,n,.87,.12,.57)
def cupolas(g,mobile):
 centers=[]
 for target in [(-13.5,-32.6),(14.9,-32.6)]:
  # Source surveyed drum remains. Estimate the center from its cap ring.
  points=[Vector(p) for p in V if abs(p[2]-29.28523982727965)<.002 and abs(local(p)[0]-target[0])<4 and local(p)[1]<-28]
  center=sum(points,Vector())/len(points);center.z=29.28523982727965;centers.append(tuple(center))
  control=[(0,2.68),(.12,2.77),(.28,2.74),(.62,2.62),(1.08,2.34),(1.50,1.94),(1.90,1.42),(2.25,.88),(2.52,.46),(2.78,.23),(3.05,.15),(3.25,.11)]
  # Smooth measured-height bell profile: broad shoulders, then a narrow neck.
  # Catmull-Rom interpolation removes the coarse stacked-cone highlights.
  rings=[]
  for k in range(len(control)-1):
   a=Vector(control[max(0,k-1)]);b=Vector(control[k]);c=Vector(control[k+1]);d=Vector(control[min(len(control)-1,k+2)])
   for j in range(1 if mobile else 2):
    t=j/(1 if mobile else 2);p=.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);rings.append(tuple(p))
  rings.append(control[-1]);seg=48 if not mobile else 24
  def cap_point(angle,z,r):
   # Eight slightly flattened panels align with the octagonal brick drum.
   octagon=math.cos(math.pi/8)/math.cos((angle+math.pi/8)%(math.pi/4)-math.pi/8)
   rr=r*((1-.70*max(0,1-z/2.8))+.70*max(0,1-z/2.8)*octagon)
   return center+Vector((math.cos(angle)*rr,math.sin(angle)*rr,z))
  for (za,ra),(zb,rb) in zip(rings,rings[1:]):
   for i in range(seg):
    aa=math.tau*i/seg;ab=math.tau*(i+1)/seg;g.polygon('copper',[cap_point(aa,za,ra),cap_point(ab,za,ra),cap_point(ab,zb,rb),cap_point(aa,zb,rb)],[(i/seg,za/3.25),((i+1)/seg,za/3.25),((i+1)/seg,zb/3.25),(i/seg,zb/3.25)])
  for i in range(8):
   angle=math.tau*i/8
   for (za,ra),(zb,rb) in zip(rings,rings[1:]):g.line('copperEdge',cap_point(angle,za,ra+.018),cap_point(angle,zb,rb+.018),.024,4)
  for i in range(seg):
   a=math.tau*i/seg;b=math.tau*(i+1)/seg
   g.polygon('copperEdge',[cap_point(a,-.07,2.68),cap_point(b,-.07,2.68),cap_point(b,.02,2.68),cap_point(a,.02,2.68)])
  g.line('iron',center+UP*3.12,center+UP*5.3,.045,6);g.line('iron',center+UP*4.55-E*.8,center+UP*4.55+E*.8,.025,5)
  g.polygon('iron',[center+UP*4.7+E*.85,center+UP*4.4+E*.85,center+UP*4.55+E*1.17]);g.line('copperEdge',center+UP*3.45,center+UP*3.67,.12,8)
  # Octagonal cornice at drum-cap join, plus a waist course.
  for z in (26.16,29.20):
   for i in range(8):
    a=center+Vector((math.cos(math.tau*i/8)*2.7,math.sin(math.tau*i/8)*2.7,z-center.z));b=center+Vector((math.cos(math.tau*(i+1)/8)*2.7,math.sin(math.tau*(i+1)/8)*2.7,z-center.z));u=(b-a).normalized();g.box('stone',(a+b)/2,u,UP,u.cross(UP),(b-a).length,.20,.25)
 return centers
def arch(g,base,u,n,width,rise,mat='stone',thick=.27,segments=20):
 # Semicircular archivolt, with genuine opening and edge depth.
 base=Vector(base);u=Vector(u);n=Vector(n)
 for i in range(segments):
  a=math.pi*i/segments;b=math.pi*(i+1)/segments
  def pt(t,r,d):return base+u*(math.cos(t)*r)+UP*(math.sin(t)*r*rise/(width/2))+n*d
  g.polygon(mat,[pt(a,width/2,0),pt(b,width/2,0),pt(b,width/2+thick,0),pt(a,width/2+thick,0)])
  g.polygon(mat,[pt(a,width/2,0),pt(a,width/2,-.24),pt(b,width/2,-.24),pt(b,width/2,0)])
def entry(g,groundg,mobile,north):
 n=N if north else -N;u=Vector((-n.y,n.x,0));basept=world(1,14.95 if north else 1.68,0);h0=ground(basept.x+n.x*3,basept.y+n.y*3);floor=h0+(.90 if north else .12)
 def at(x,z,d=.16):return basept+u*x+UP*z+n*d
 g.polygon('stone',[at(-4.65,floor,-.16),at(4.65,floor,-.16),at(4.65,floor+3.85,-.16),at(-4.65,floor+3.85,-.16)])
 # Dark closed external doors and side glazing, within a limestone tripartite portal.
 for x,w in [(-3.25,1.65),(0,3.55),(3.25,1.65)]:
  ps=[at(x-w/2,floor,-.04),at(x+w/2,floor,-.04)]
  for i in range(17):
   t=math.pi*i/16;ps.append(at(x+w/2*math.cos(t),floor+2.30+.95*math.sin(t),-.04))
  g.polygon('glass',ps)
  arch(g,at(x,floor+2.30,.32),u,n,w,.95,segments=12 if mobile else 20)
  for dx in (-w/2,w/2):g.box('stone',at(x+dx,floor+1.15,.26),u,UP,n,.25,2.3,.38)
  g.box('frame',at(x,floor+1.1,.08),u,UP,n,.065,2.2,.07);g.box('frame',at(x,floor+2.25,.08),u,UP,n,w,.07,.07)
 for x in (-4.7,-1.99,1.99,4.7):g.box('stone',at(x,floor+1.85,.20),u,UP,n,.48,3.70,.55)
 g.box('stone',at(0,floor+3.75,.22),u,UP,n,9.7,.30,.65)
 # Shallow black/bronze canopy on the north portal, supported at the sides.
 if north:
  g.box('iron',at(0,floor+2.70,1.25),u,n,UP,4.7,2.4,.14)
  for x in (-2.15,2.15):g.line('iron',at(x,floor,2.22),at(x,floor+2.7,2.22),.055,6)
 if True:
  # Both official 2011 exterior views show a stone vertical axis and gable.
  # The south detail is partly obscured by trees, so its fine carving remains
  # an explicitly photo-informed approximation of the surviving north work.
  for z in (9.7,12.75,15.8):
   for x in (-4.8,-2.775,-.925,.925,2.775,4.8):g.box('stone',at(x,z,.18),u,UP,n,.28,2.8,.32)
   g.box('stone',at(0,z-1.45,.17),u,UP,n,9.6,.25,.45)
   for x in (-3.7,-1.85,0,1.85,3.7):g.box('stone',at(x,z-1.25,.14),u,UP,n,1.22,.28,.25)
  # Paired cornice steps, capital blocks and recessed spandrel tablets give
  # the limestone shaft its depth without substituting a flat pale stripe.
  for z in (8.12,10.96,17.22):
   g.box('stone',at(0,z,.20),u,UP,n,9.9,.20,.50)
   g.box('stone',at(0,z+.17,.23),u,UP,n,10.08,.13,.58)
  for z in (9.7,12.75,15.8):
   for x in (-4.8,-2.775,-.925,.925,2.775,4.8):
    for zz in (z-1.22,z+1.23):g.box('stone',at(x,zz,.21),u,UP,n,.43,.15,.42)
  for x in (-3.7,-1.85,0,1.85,3.7):
   for z in (11.24,14.28):
    g.box('stone',at(x,z,.08),u,UP,n,1.27,.40,.20)
  # Rustication around the three arches follows the entry masonry scale.
  for x in (-4.7,-1.99,1.99,4.7):
   for z in (floor+.25,floor+.85,floor+1.45,floor+2.05,floor+2.65,floor+3.25):g.box('stone',at(x,z,.29),u,UP,n,.55,.035,.58)
  # Scroll-edged central Dutch gable, including curved shoulders and finials.
  outline=[(-5.1,26.15),(-5.1,27.4),(-4.6,27.4),(-4.6,28.4),(-4.2,29.1),(-3.5,29.7),(-2.7,29.8),(-2.7,30.5),(-2.1,30.5)]
  for i in range(13):
   t=math.pi-math.pi*i/12;outline.append((2.1*math.cos(t),30.5+2.0*math.sin(t)))
  outline += [(2.7,30.5),(2.7,29.8),(3.5,29.7),(4.2,29.1),(4.6,28.4),(4.6,27.4),(5.1,27.4),(5.1,26.15)]
  # Convex fan is not valid for scroll silhouette; triangulate via Blender tessellator.
  from mathutils.geometry import tessellate_polygon
  front=[at(x,z,.10) for x,z in outline];back=[at(x,z,-.40) for x,z in outline]
  for tri in tessellate_polygon([front]):g.polygon('brick',list(reversed([front[i] if isinstance(i,int) else i for i in tri])))
  for tri in tessellate_polygon([back]):g.polygon('brick',[back[i] if isinstance(i,int) else i for i in tri])
  for i in range(len(outline)):
   j=(i+1)%len(outline);g.polygon('stone',[front[i],back[i],back[j],front[j]]);g.line('stone',front[i]+n*.05,front[j]+n*.05,.12,5)
  for x,z in [(-5.1,27.4),(5.1,27.4),(0,32.5)]:g.line('stone',at(x,z,.12),at(x,z+1.1,.12),.10,7)
  g.box('stone',at(0,29.0,.22),u,UP,n,2.6,1.8,.18)
 if not north:
  # Rebuilt river-court vestibule canopy, outlined along the surveyed
  # rounded vestibule. The side glazing above supplies the visible depth.
  canopy=[world(1,1.8,6.83)]
  for i in range(17):
   t=math.pi+math.pi*i/16;canopy.append(world(1+3.2*math.cos(t),.1+3.2*math.sin(t),6.83))
  for i in range(1,len(canopy)-1):g.polygon('iron',[canopy[0],canopy[i],canopy[i+1]])
  for a,b in zip(canopy[1:],canopy[2:]):g.line('iron',a,b,.075,5)
 # Only the small entry landing/steps are added as new walk surfaces.
 for k in range(7 if north else 0):
  z=h0+(k+1)*(floor-h0)/(7 if north else 1);d=3.75-k*.30 if north else 2.2
  groundg.polygon('paving',[at(-4.6,z,d),at(4.6,z,d),at(4.6,z,d-.30 if north else .4),at(-4.6,z,d-.30 if north else .4)])
  g.polygon('stone',[at(-4.6,z-(floor-h0)/(7 if north else 1),d),at(4.6,z-(floor-h0)/(7 if north else 1),d),at(4.6,z,d),at(-4.6,z,d)])
 if north:
  groundg.polygon('paving',[at(-4.6,floor,1.95),at(4.6,floor,1.95),at(4.6,floor,.02),at(-4.6,floor,.02)])
  door=at(0,floor,.1);front=at(0,h0+.9/7,3.75);safe=at(0,h0,5.2)
 else:
  # The old apron stopped behind the measured rounded vestibule. This small
  # 9.2 x 5.86 m landing reaches its real front and connects to the site path.
  front_d=5.88
  groundg.polygon('paving',[at(-4.6,floor,front_d),at(4.6,floor,front_d),at(4.6,floor,.02),at(-4.6,floor,.02)])
  for aa,bb in [((-4.6,front_d),(4.6,front_d)),((4.6,front_d),(4.6,.02)),((-4.6,.02),(-4.6,front_d))]:
   g.polygon('stone',[at(aa[0],h0,aa[1]),at(bb[0],h0,bb[1]),at(bb[0],floor,bb[1]),at(aa[0],floor,aa[1])])
  door=world(.72,-1.95,floor);front=at(0,floor,front_d);safe=at(0,h0,6.6)
 return {'side':'Amherst Street north' if north else 'Memorial Drive south court','approximateDoorCenterEastNorthUp':list(door),'platformFrontCenterWorldXZ':[front.x,-front.y],'platformFrontCenterEastNorthUp':list(front),'safeExteriorEastNorthUp':list(safe),'sourceTerrainHeight':h0,'landingHeight':floor}
def setup_render(objects,mobile):
 s=bpy.context.scene;s.render.engine='BLENDER_EEVEE_NEXT';s.render.resolution_x=1500;s.render.resolution_y=1100;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX';s.world.use_nodes=True;s.world.node_tree.nodes.get('Background').inputs[0].default_value=(.55,.65,.8,1);s.world.node_tree.nodes.get('Background').inputs[1].default_value=.7
 bpy.ops.object.light_add(type='SUN');sun=bpy.context.object;sun.data.energy=3.;sun.rotation_euler=(.6,-.4,-.5);sun.data.angle=.09
 bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=100
 views={'south-overall':(world(5,-135,52),world(0,-5,17),104),'north-overall':(world(3,130,52),world(1,3,17),104),'south-court':(world(1,-80,15),world(1,-8,17),62),'north-entry':(world(1,65,17),world(1,16,17),45),'east-overall':(world(115,-38,55),world(2,0,17),104)}
 if mobile:views={'mobile-south':views['south-overall']}
 for name,(eye,target,scale) in views.items():
  cam.location=eye;cam.rotation_euler=(target-eye).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP' if name in ('south-court','north-entry') else 'ORTHO';cam.data.lens=45 if name=='north-entry' else 38;cam.data.ortho_scale=scale;s.render.filepath=str(HERE/(name+'.png'));bpy.ops.render.render(write_still=True)
 return {name:{'eyeEastNorthUp':list(a),'targetEastNorthUp':list(b),'orthographicScale':c} for name,(a,b,c) in views.items()}
def export(profile):
 mobile=profile=='mobile';bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);mats=materials(mobile);g=Geometry();report=shell(g,mobile);parapets(g,mobile);report['cupolaCenters']=cupolas(g,mobile);gg=Geometry();report['entrances']=[entry(g,gg,mobile,True),entry(g,gg,mobile,False)];objects=g.build(mats,'Maseeh exterior');grounds=gg.build(mats,'Maseeh entry ground')
 for o in grounds:o['mitResidenceGround']=True
 objects+=grounds;collisiong=Geometry()
 for ids in F:collisiong.polygon('reveal',[V[i] for i in ids])
 coll=collisiong.build(mats,'Maseeh measured collision')[0];coll['mitResidenceWall']=True;coll['mitResidenceCollisionOnly']=True;objects.append(coll)
 for o in objects:o['mitResidenceId']='maseeh'
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];target=OUT/('maseeh-mobile.glb' if mobile else 'maseeh-full.glb')
 bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_apply=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_image_format='AUTO',export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_yup=True)
 compact_glb(target)
 count=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects);assert count<(60000 if mobile else 120000),count;assert target.stat().st_size<(4000000 if mobile else 8000000),target.stat().st_size
 coll.hide_set(True);coll.hide_render=True
 # A neutral local display ground is preview-only and never exported.
 bpy.ops.mesh.primitive_plane_add(size=1000,location=world(0,0,3.55));plane=bpy.context.object;plane.name='Preview ground - excluded from GLB';plane.data.materials.append(mats['paving'])
 cameras=setup_render(objects,mobile)
 if not mobile:bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'maseeh-full.blend'),check_existing=False)
 coords=[v.co for o in objects if not o.get('mitResidenceCollisionOnly') for v in o.data.vertices]
 report.update({'profile':profile,'triangles':count,'bytes':target.stat().st_size,'meshes':len(objects),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'cameras':cameras,'visibleBoundsEastNorthUp':{'min':[min(p[k] for p in coords) for k in range(3)],'max':[max(p[k] for p in coords) for k in range(3)]}});return report
if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 data={'building':'Maseeh Hall W1','source':SOURCE,'coordinates':'Blender east,north,up; glTF east,up,south. No additional translation.','surveyBoundsEastNorthUp':{'min':[min(p[k] for p in V) for k in range(3)],'max':[max(p[k] for p in V) for k in range(3)]},'roofHeight':ROOF,'sourceBottomIsClosureNotTerrain':True,'references':['https://news.mit.edu/2011/maseeh-hall-welcomed-0916','https://capitalprojects.mit.edu/projects/maseeh-hall-w1'],'inferences':['Window bays, dimensions, masonry ornament and cupola curvature are photo estimates, not as-built measurements.','Historical 2010 survey massing retained; north scroll gable and roof parapets restored from 2011 official photographs.','Doors are closed exterior geometry; no authored or accessible interior.','Offline renders are Blender diagnostic images, not game screenshots.']}
 data['revision']='2026-10-23 realism iteration: both entrance axes, forward south apron, masonry depth and continuous copper cap normals'
 data['inferences'][1]='Historical 2010 survey massing retained; both entrance scroll gables and stone axes are visible in 2011 official photographs. South fine carving is partly hidden by mature trees and inferred from the clearer north elevation.'
 data['remainingVisualDifferences']=['Fine heraldic carving, lettering, medallions and ornamental finial silhouettes are simplified; blank tablets are not exact replicas.','Facade-by-facade window pairing and room shade variation still use survey-bay inference where photographs are incomplete.','Copper aging and stone weathering are bounded procedural approximations, not scanned surfaces.','Runtime reflections, courtyard planting, iron boundary fence and paving are owned by the scene integration and require in-game visual acceptance.']
 data['full']=export('full');data['mobile']=export('mobile');(HERE/'metadata.json').write_text(json.dumps(data,indent=2));print(json.dumps({k:{q:v[q] for q in ('triangles','bytes','meshes','windowOpenings')} for k,v in data.items() if k in ('full','mobile')}))
