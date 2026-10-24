"""Measured Stata shell -> bounded, photo-informed exterior GLBs.

Coordinates remain the Cambridge GIS local metre frame. Window spacing and
cladding are authored from public photographs, not an as-built facade survey.
Run with Blender --background --python-exit-code 1 --python this-file.
"""
from pathlib import Path
import sys, json, math, struct, hashlib, time
from collections import defaultdict
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE))
from importlib import import_module
inspect=import_module('inspect-source')
OUT=ROOT/'public/assets/mit-stata'
TEX=ROOT/'assets-source/charles-bu/blender/textures'
V,F=inspect.read_source()
PATCHES=json.loads((HERE/'patches.json').read_text())

# Explicit major-volume assignments; small connected components inherit the
# nearest coplanar facade's family. Metal roofs are treated independently.
BRICK={3,4,5,6,8,9,10,11,12,13,14,15,16,18,21,25,26,27,30,31,32,33,34,36,39,40,41,43,46,48,50,56,66,67,78,82,95,97,98,99,117,124,139,163,164,201,211,223,232}
BRICK.difference_update({16,33,67,78,82,99,164})
SILVER={17,20,21,28,38,42,60,62,65,68,72,77,83,84,85,86,87,88,89,90,91,92,93,94,96,103,104,105,106,107,108,109,110,111,112,113,114,115,116,119,120,121,122,123,125,126,127,128,129,130,131,132,133,134,135,136,137,138,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162}
MATERIALS={
 'brick':((.43,.155,.068,1),.85,0,'brick'),
 'silver':((.78,.81,.82,1),.34,.57,None),
 'silverA':((.775,.805,.815,1),.36,.57,None),
 'silverB':((.795,.825,.835,1),.32,.57,None),
 'silverC':((.783,.813,.823,1),.38,.57,None),
 'zinc':((.40,.44,.43,1),.48,.62,None),
 'roof':((.18,.20,.19,1),.85,.05,'concrete'),
 'frame':((.69,.72,.73,1),.29,.58,None),
 'reveal':((.11,.12,.12,1),.72,.15,None),
 'glass':((.055,.095,.11,1),.17,.43,None),
 'glassShade':((.11,.145,.15,1),.22,.3,None),
 'paving':((.47,.43,.35,1),.86,0,'concrete'),
 'asphalt':((.075,.085,.085,1),.96,0,None),
 'curb':((.48,.50,.48,1),.9,0,'concrete'),
 'line':((.79,.70,.38,1),.88,0,None),
 'blue':((.06,.24,.34,1),.45,.55,None),
}
shape=import_module('shape-controls')
CORRECTED,SHAPE_CHANGES=shape.corrected_vertices(V,F,PATCHES,BRICK)
# Rooftop service boxes are blind, not another repeated office storey.
BLIND={117,124,139,163,201,211,223,232}
entries=import_module('entry-details')
court=import_module('courtyard-details')
amphitheater=import_module('amphitheater-details')
MATERIALS.update(court.MATERIALS)
site=import_module('site-details')
MATERIALS.update(site.SITE_MATERIALS)
terrace=import_module('courtyard-site')
MATERIALS.update(terrace.MATERIALS)
finishes=import_module('materials-realism')
MATERIALS=finishes.effective_material_spec(MATERIALS,glazing=True)
REPLACED_COURT_FACES=court.replaced_faces(V,F,PATCHES) | amphitheater.replaced_faces(V,F,PATCHES)
MIRROR={85,96,108,115,120,131,210,235,290,303,326,338,347,348,352,353,359,360,361,362,363,375,377,378,388,389,392,409,410,424,428,433,434,439,455}
twins=import_module('twins-controls')
REPLACED_ENTRY=entries.REPLACED_ENTRY_PATCHES
MAPPERS={p['id']:twins.mapper_for(p) or shape.giraffe_mapper(p,V,F,PATCHES) or shape.surface_mapper(p,V,CORRECTED,F) for p in PATCHES}

def glb(path):
 data=Path(path).read_bytes();n=struct.unpack_from('<I',data,12)[0]
 return json.loads(data[20:20+n]),data[28+n:]
def accessor(doc,data,index):
 a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
 n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
 fmt={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']]
 size=struct.calcsize(fmt)*n;start=v.get('byteOffset',0)+a.get('byteOffset',0)
 return [struct.unpack_from('<'+fmt*n,data,start+i*v.get('byteStride',size)) for i in range(a['count'])]
def terrain_tree():
 vs=[];fs=[]
 for source in ('public/data/campuses/mit/campus.glb','public/data/killian/detail.glb'):
  doc,data=glb(ROOT/source)
  for m in doc['meshes']:
   for p in m['primitives']:
    name=doc['materials'][p.get('material',0)].get('name','')
    if source.endswith('detail.glb'):
     if name not in ('grass','pavement','steps','road','arterial','porticoFloor','courtCurb'):continue
    elif 'building' in name.lower():continue
    pos=accessor(doc,data,p['attributes']['POSITION']);ids=[x[0] for x in accessor(doc,data,p['indices'])] if 'indices' in p else list(range(len(pos)))
    off=len(vs);vs.extend((x,-z,y) for x,y,z in pos);fs.extend(tuple(off+ids[i+j] for j in range(3)) for i in range(0,len(ids),3))
 return BVHTree.FromPolygons(vs,fs,all_triangles=True)
TERRAIN=terrain_tree()
def height(x,y):
 hit=TERRAIN.ray_cast(Vector((x,y,100)),Vector((0,0,-1)),150)[0]
 return hit.z if hit else 2.6

class Geometry:
 def __init__(self):self.groups=defaultdict(lambda:{'v':[],'f':[],'uv':[]});self.mapper=None
 def polygon(self,mat,points,uv=None):
  if len(points)<3:return
  if uv is None:
   n=(Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0]));axis=max(range(3),key=lambda k:abs(n[k]))
   axes=(0,1) if axis==2 else ((0,2) if axis==1 else (1,2))
   scale=(2.3,1.2) if mat=='brick' else (2,2)
   uv=[(p[axes[0]]/scale[0],p[axes[1]]/scale[1]) for p in points]
  if self.mapper:
   planes=[((0,0,1),z) for z in getattr(self.mapper,'split_levels',[])]+list(getattr(self.mapper,'split_planes',[]))
   for normal,offset in planes:
    normal=Vector(normal);signed=[normal.dot(Vector(p))-offset for p in points]
    if min(signed)<-1e-4 and max(signed)>1e-4:
     # Both desktop and mobile follow the same curved section. Interpolate
     # UVs at each cut rather than stretching a single tall source triangle.
     for side in (-1,1):
      part=[];part_uv=[]
      for i,a in enumerate(points):
       j=(i+1)%len(points);b=points[j];da=signed[i]*side;db=signed[j]*side
       ina,inb=da<=0,db<=0
       if ina:part.append(a);part_uv.append(uv[i])
       if ina!=inb:
        t=da/(da-db);crossing=Vector(a).lerp(Vector(b),t);crossing-=normal*((normal.dot(crossing)-offset)/normal.length_squared);part.append(crossing);part_uv.append(tuple(uv[i][k]+(uv[j][k]-uv[i][k])*t for k in range(2)))
      if len(part)>=3:self.polygon(mat,part,part_uv)
     return
   points=[self.mapper(p) for p in points]
  g=self.groups[mat];off=len(g['v']);g['v'].extend(tuple(p) for p in points)
  g['uv'].extend(uv)
  for i in range(1,len(points)-1):
   if (Vector(points[i])-Vector(points[0])).cross(Vector(points[i+1])-Vector(points[0])).length_squared>1e-14:g['f'].append((off,off+i,off+i+1))
 def box(self,mat,center,u,v,n,w,h,d):
  c=Vector(center);u=Vector(u)*w/2;v=Vector(v)*h/2;n=Vector(n)*d/2
  points=[c+u*a+v*b+n*s for s in (-1,1) for b in (-1,1) for a in (-1,1)]
  for ids in ((0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)):self.polygon(mat,[points[i] for i in ids])
 def build(self,mats,prefix='Stata'):
  objects=[]
  for name,g in self.groups.items():
   if not g['f']:continue
   mesh=bpy.data.meshes.new(prefix+' '+name);mesh.from_pydata(g['v'],[],g['f']);mesh.update()
   uv=mesh.uv_layers.new(name='UVMap')
   for face in mesh.polygons:
    for loop in face.loop_indices:uv.data[loop].uv=g['uv'][mesh.loops[loop].vertex_index]
   # The authored polygon soup shares many positions. Welding before export
   # preserves per-loop UVs and sharp face normals, while letting glTF reuse
   # terrain vertices instead of serializing each triangle three times.
   bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);bm.to_mesh(mesh);bm.free();mesh.update()
   if name in ('gold','mirror','silver','silverA','silverB','silverC') or 'ground' in prefix:
    for face in mesh.polygons:face.use_smooth=True
    # Height-varying metal skins are curved between the deliberate fold lines.
    # Smooth triangulation diagonals without rounding the architectural creases.
    mesh.set_sharp_from_angle(angle=math.radians(14 if name.startswith('silver') else 32))
   obj=bpy.data.objects.new(prefix+' '+name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(mats[name]);objects.append(obj)
  return objects

def make_materials(mobile):
 return finishes.make_materials(MATERIALS,TEX,mobile,glazing=True)

def dot(a,b):return sum(x*y for x,y in zip(a,b))
def tri_inside(q,t):
 signs=[]
 for i in range(3):
  a,b=t[i],t[(i+1)%3];signs.append((b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0]))
 return min(signs)>-1e-5 or max(signs)<1e-5
def inside(q,triangles):return any(tri_inside(q,t) for t in triangles)
def clip(poly,axis,value,keep_less):
 out=[]
 for i,a in enumerate(poly):
  b=poly[(i+1)%len(poly)];da=(a[axis]-value)*(1 if keep_less else -1);db=(b[axis]-value)*(1 if keep_less else -1)
  ina,inb=da<=1e-8,db<=1e-8
  if ina:out.append(a)
  if ina!=inb:
   t=da/(da-db);out.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
 return out
def subtract(poly,rect):
 remaining=poly;out=[]
 for axis,value,less in ((0,rect[0],True),(0,rect[2],False),(1,rect[1],True),(1,rect[3],False)):
  if len(remaining)<3:break
  piece=clip(remaining,axis,value,less)
  if len(piece)>2:out.append(piece)
  remaining=clip(remaining,axis,value,not less)
 return out

def family_for(p):
 n=p['normal'];x,y,z=p['center']
 if p['id'] in MIRROR:return 'mirror'
 if p['id'] in (23,82):return 'glass'
 if p['id'] in (54,62,64,76):return 'silver'
 if n[2]>.25 and 54<x<67 and 285<y<295 and 8<z<15:return 'blue'
 if n[2]>.95:return 'roof'
 if p['id'] in BRICK:return 'brick'
 if p['id'] in SILVER:return 'silver'
 if abs(n[2])>.25:return 'silver'
 # Low Student Street wings are predominantly brick, with glazed openings.
 if p['bounds']['max'][2]<14 and y<310:return 'brick'
 return 'silver'

def facade_frame(p):
 n=Vector(p['normal']).normalized();u=Vector((-n.y,n.x,0)).normalized();v=n.cross(u).normalized();o=Vector(p['center'])
 tris=[[(dot(Vector(V[i])-o,u),dot(Vector(V[i])-o,v)) for i in F[f]] for f in p['faces']]
 return o,u,v,n,tris

def add_window(g,local,rect,family,index,mobile=False,door=False):
 o,u,v,n,_=local;x0,y0,x1,y1=rect;w=x1-x0;h=y1-y0
 mapper=g.mapper;g.mapper=None
 center=o+u*((x0+x1)/2)+v*((y0+y1)/2)
 center=mapper(center) if mapper else center
 original_u,original_v,original_n=u,v,n
 if family in ('silver','mirror'):
  edge_a=o+u*x0+v*((y0+y1)/2);edge_b=o+u*x1+v*((y0+y1)/2)
  tangent=(mapper(edge_b)-mapper(edge_a)) if mapper else edge_b-edge_a
  u=Vector((tangent.x,tangent.y,0)).normalized();v=Vector((0,0,1));n=u.cross(v).normalized()
 def at(x,y,d):
  original=o+original_u*x+original_v*y+original_n*d
  if family in ('silver','mirror') and d>0:
   # The boxed glazing stays upright while its back meets the inclined skin.
   # This produces the wedge returns visible in Zahner's close-up photographs.
   return center+u*(x-(x0+x1)/2)+v*(y-(y0+y1)/2)+n*d
  return mapper(original) if mapper else original
 # Deep box windows, especially characteristic on the metal-clad fragments.
 front=.08 if family=='brick' else .42+(index%3)*.075
 if door:front=.05
 back=-.10 if family=='brick' else -.015;frame=.075 if family=='brick' else .10
 # Four reveal returns, visible at an oblique walking view.
 corners=[(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
 for i in range(4):
  a,b=corners[i],corners[(i+1)%4];cuts={0.,1.}
  if mapper:
   # Split the back edge wherever the original survey triangulation crosses
   # the opening. Its transformed edge is piecewise straight, not one chord.
   dx,dy=b[0]-a[0],b[1]-a[1]
   for tri in local[-1]:
    for j,c in enumerate(tri):
     d=tri[(j+1)%3];ex,ey=d[0]-c[0],d[1]-c[1];den=dx*ey-dy*ex
     if abs(den)<1e-8:continue
     rx,ry=c[0]-a[0],c[1]-a[1];t=(rx*ey-ry*ex)/den;s=(rx*dy-ry*dx)/den
     if 1e-5<t<1-1e-5 and -1e-5<s<1+1e-5:cuts.add(t)
   for level in getattr(mapper,'split_levels',[]):
    if abs(dy*original_v.z)>1e-8:
     t=(level-o.z-a[1]*original_v.z)/(dy*original_v.z)
     if 1e-5<t<1-1e-5:cuts.add(t)
   for plane_normal,offset in getattr(mapper,'split_planes',[]):
    plane_normal=Vector(plane_normal);pa=o+original_u*a[0]+original_v*a[1];pb=o+original_u*b[0]+original_v*b[1]
    da=plane_normal.dot(pa)-offset;db=plane_normal.dot(pb)-offset
    if abs(da-db)>1e-8:
     t=da/(da-db)
     if 1e-5<t<1-1e-5:cuts.add(t)
  ts=sorted(cuts)
  for ta,tb in zip(ts,ts[1:]):
   aa=(a[0]+(b[0]-a[0])*ta,a[1]+(b[1]-a[1])*ta);bb=(a[0]+(b[0]-a[0])*tb,a[1]+(b[1]-a[1])*tb)
   side=[at(*aa,front),at(*bb,front),at(*bb,back),at(*aa,back)]
   # Recessed brick jambs face into the opening. A projecting metal box has
   # exterior cheeks, facing OUT of the box; the same winding would cull them.
   if family in ('silver','mirror'):side.reverse()
   g.polygon('reveal' if family=='brick' else 'frame',side)
 glass='glassShade' if index%7==0 and not door else 'glass'
 glass_depth=back+.003 if family=='brick' else front-.035
 # A closed shallow room cavity gives transparent exterior glazing actual
 # depth. It is deliberately not a navigable or documented interior model.
 # Keep the cavity in the upright window frame even on folded silver walls.
 cavity_depth=glass_depth-(.48 if mobile else .82)
 def pocket(x,y,d):return center+u*(x-(x0+x1)/2)+v*(y-(y0+y1)/2)+n*d
 g.polygon('room',[pocket(x0,y0,cavity_depth),pocket(x1,y0,cavity_depth),pocket(x1,y1,cavity_depth),pocket(x0,y1,cavity_depth)])
 for i in range(4):
  a,b=corners[i],corners[(i+1)%4]
  g.polygon('room',[at(*a,glass_depth-.008),at(*b,glass_depth-.008),pocket(*b,cavity_depth),pocket(*a,cavity_depth)])
 # Partial roller shades give a quiet occupied-building variation, not
 # randomly lit emissive windows. Their exact interior positions are authored.
 if index%5 in (0,2):
  shade_bottom=y1-h*(.28 if index%5==0 else .53)
  g.polygon('blind',[pocket(x0+.035,shade_bottom,glass_depth-.13),pocket(x1-.035,shade_bottom,glass_depth-.13),pocket(x1-.035,y1-.025,glass_depth-.13),pocket(x0+.035,y1-.025,glass_depth-.13)])
 g.polygon(glass,[at(x0,y0,glass_depth),at(x1,y0,glass_depth),at(x1,y1,glass_depth),at(x0,y1,glass_depth)])
 if mobile:
  for r in ((x0,y0,x0+frame,y1),(x1-frame,y0,x1,y1),(x0,y0,x1,y0+frame),(x0,y1-frame,x1,y1),(x0+w/2-frame/2,y0,x0+w/2+frame/2,y1)):
   a,b,c,d=r;g.polygon('frame',[at(a,b,front),at(c,b,front),at(c,d,front),at(a,d,front)])
 else:
  for cx,cy,ww,hh in ((x0+frame/2,(y0+y1)/2,frame,h),(x1-frame/2,(y0+y1)/2,frame,h),((x0+x1)/2,y0+frame/2,w,frame),((x0+x1)/2,y1-frame/2,w,frame),((x0+x1)/2,(y0+y1)/2,frame*.8,h)):
   g.box('frame',at(cx,cy,front-.025),u,v,n,ww,hh,.075)
  g.box('frame',at((x0+x1)/2,y0-.025,front+.025),u,v,n,w+.12,.075,.22)
 if door:
  g.box('frame',at((x0+x1)/2,y0+2.5,front),u,v,n,w,.085,.08)
  for sign in (-1,1):g.box('frame',at((x0+x1)/2+sign*.15,y0+1.2,front+.08),u,v,n,.032,.62,.05)
 g.mapper=mapper

def build_shell(g,mobile):
 consumed=set();windows=[];material_areas=defaultdict(float)
 for p in PATCHES:
  family=family_for(p);material_areas[family]+=p['area'];consumed.update(p['faces'])
  remaining=[f for f in p['faces'] if f not in REPLACED_COURT_FACES]
  if not remaining:continue
  if len(remaining)!=len(p['faces']):p={**p,'faces':remaining}
  if p['id'] in REPLACED_ENTRY:continue
  g.mapper=MAPPERS[p['id']]
  if abs(p['normal'][2])>.25 or p['area']<12:
   for f in p['faces']:g.polygon(family,[V[i] for i in F[f]])
   continue
  local=facade_frame(p);o,u,v,n,tris=local
  all2=[q for tri in tris for q in tri];xmin=min(q[0] for q in all2);xmax=max(q[0] for q in all2);ymin=min(q[1] for q in all2);ymax=max(q[1] for q in all2)
  width=xmax-xmin;height_=ymax-ymin
  if family=='glass':
   for tri in tris:g.polygon('glass',[o+u*x+v*y for x,y in tri])
   bands=[]
   for i in range(math.ceil(width/1.35)+1):
    x=xmin+i*1.35;bands.append((x-.04,ymin,x+.04,ymax))
   for i in range(math.ceil(height_/2)+1):
    y=ymin+i*2;bands.append((xmin,y-.045,xmax,y+.045))
   for a,b,c,d in bands:
    for tri in tris:
     poly=tri
     for axis,value,less in ((0,a,False),(0,c,True),(1,b,False),(1,d,True)):
      if len(poly)<3:break
      poly=clip(poly,axis,value,less)
     if len(poly)>=3:g.polygon('frame',[o+u*x+v*y+n*.065 for x,y in poly])
   continue
  rects=[];doors=[]
  if width>2.05 and height_>3.5 and p['id'] not in BLIND:
   pitch=3.55 if family=='brick' else 3.2
   cols=max(1,int(width/pitch));step=width/cols
   if p['id'] in (26,32):cols=3;step=width/cols
   if p['id'] in (34,41):cols=1;step=width
   if p['id']==33:cols=2;step=width/2
   ww=min(1.65,step-.85)
   # Real facade rhythm is an estimate from photos; global floor levels align.
   levels=[4.15,9.65,15.15,19.05,22.95,26.85,30.75,34.65]
   if family=='silver' and p['bounds']['max'][2]>41:levels.append(38.55)
   if p['id'] in (32,34):levels=[25.0,28.9,32.8,36.7]
   if p['id'] in (33,67):levels=[15.15,19.05,23.3,27.3,31.6,35.5,39.0]
   if p['id'] in (42,54,62,64,76):levels=[15.15,19.05,22.95,26.6,31.0,35.1,38.8]
   if family=='mirror':levels=[10.1]
   for floor,sill in enumerate(levels):
    yy=(sill-o.z)/v.z
    for col in range(cols):
     xx=xmin+(col+.5)*step
     hh=2.8 if family=='mirror' else (2.30 if floor>1 else 2.6)
     rect=(xx-ww/2,yy,xx+ww/2,yy+hh)
     if any(rect[0]<d[2]+.2 and rect[2]>d[0]-.2 and rect[1]<d[3]+.2 and rect[3]>d[1]-.2 for d in doors):continue
     margin=.28
     if not all(inside((x,y),tris) for x in (rect[0]-margin,rect[2]+margin) for y in (rect[1]-margin,rect[3]+margin)):continue
     rects.append(rect);windows.append({'patch':p['id'],'center':list(o+u*xx+v*(yy+hh/2)),'width':ww,'height':hh,'family':family})
  for tri in tris:
   pieces=[tri]
   for r in rects:
    # Spatial rejection avoids fragmenting triangles nowhere near a window.
    next_=[]
    for poly in pieces:
     if max(q[0] for q in poly)<=r[0] or min(q[0] for q in poly)>=r[2] or max(q[1] for q in poly)<=r[1] or min(q[1] for q in poly)>=r[3]:next_.append(poly)
     else:next_.extend(subtract(poly,r))
    pieces=next_
   for poly in pieces:
    scale=(2.3,1.2) if family=='brick' else (2,2)
    if family=='silver' and not mobile:
     # Subtle flat-seam sheet variation; each panel is still actual facade
     # geometry with window openings, never a texture hiding a solid wall.
     for ix in range(math.floor(min(q[0] for q in poly)/1.1),math.ceil(max(q[0] for q in poly)/1.1)):
      for iy in range(math.floor(min(q[1] for q in poly)/1.8),math.ceil(max(q[1] for q in poly)/1.8)):
       cell=poly
       for axis,value,less in ((0,ix*1.1,False),(0,(ix+1)*1.1,True),(1,iy*1.8,False),(1,(iy+1)*1.8,True)):
        if len(cell)<3:break
        cell=clip(cell,axis,value,less)
       if len(cell)>=3:
        mat=('silver','silverA','silverB','silverC')[(ix*19+iy*7+p['id'])%4]
        g.polygon(mat,[o+u*x+v*y for x,y in cell],[(x/scale[0],(o.z+y*v.z)/scale[1]) for x,y in cell])
    else:g.polygon(family,[o+u*x+v*y for x,y in poly],[(x/scale[0],(o.z+y*v.z)/scale[1]) for x,y in poly])
  for i,r in enumerate(rects):add_window(g,local,r,family,p['id']+i,mobile,door=r in doors)
  # Subtle actual panel joints on silver planes; avoids uniform white plastic.
  if family=='silver' and not mobile:
   for x in [xmin+1.3*i for i in range(1,int(width/1.3))]:
    for y in [ymin+2.7*i for i in range(int(height_/2.7))]:
     ya,yb=y+.05,min(y+2.65,ymax-.1)
     if yb<=ya:continue
     if not all(inside(q,tris) for q in ((x-.007,ya),(x+.007,yb))):continue
     if any(r[0]-.1<x<r[2]+.1 and r[1]-.1<yb and r[3]+.1>ya for r in rects):continue
     g.polygon('zinc',[o+u*(x-.007)+v*ya+n*.004,o+u*(x+.007)+v*ya+n*.004,o+u*(x+.007)+v*yb+n*.004,o+u*(x-.007)+v*yb+n*.004])
 for f,ids in enumerate(F):
  if f not in consumed and f not in REPLACED_COURT_FACES:
   g.mapper=twins.mapper_for({'faces':[f]}) or shape.surface_mapper({'faces':[f]},V,CORRECTED,F)
   a,b,c=[Vector(V[i]) for i in ids];normal=(b-a).cross(c-a).normalized();center=(a+b+c)/3;family='roof' if normal.z>.95 else 'silver'
   if normal.z>.25 and 54<center.x<67 and 285<center.y<295 and 8<center.z<15:family='blue'
   if 116<center.x<140 and 246<center.y<272 and 8.4<center.z<19.5:family='mirror'
   g.polygon(family,[V[i] if g.mapper else CORRECTED[i] for i in ids])
 g.mapper=None
 counts=defaultdict(int)
 for w in windows:counts[str(w['patch'])]+=1
 return {'windows':len(windows),'windowList':windows,'windowsByPatch':dict(counts),'materialAreas':dict(material_areas),'correctedSourceVertices':len(SHAPE_CHANGES)}

def strip(g,path,width,mat,lift=.035):
 def conform(xy,depth=0):
  z=[height(r.x,r.y)+lift for r in xy]
  # Retain terrain ridges inside a coarse quad, including the small gate apron
  # hill and the old street edge. Refine only cells that would cut into them.
  if depth<3:
   for t,s in ((.5,.5),(.25,.25),(.75,.75),(.25,.75),(.75,.25),(.5,0),(.5,1),(0,.5),(1,.5)):
    r=xy[0]+(xy[1]-xy[0])*t+(xy[3]-xy[0])*s
    interpolated=(z[0]*(1-t)+z[1]*(t-s)+z[2]*s) if t>=s else (z[0]*(1-s)+z[2]*t+z[3]*(s-t))
    if height(r.x,r.y)+lift>interpolated+.012:
     a,b,c,d=xy;ab=(a+b)/2;bc=(b+c)/2;cd=(c+d)/2;da=(d+a)/2;mid=(a+b+c+d)/4
     for cell in ((a,ab,mid,da),(ab,b,bc,mid),(mid,bc,c,cd),(da,mid,cd,d)):conform(cell,depth+1)
     return
  g.polygon(mat,[(r.x,r.y,h) for r,h in zip(xy,z)])
 for a,b in zip(path,path[1:]):
  a,b=Vector(a),Vector(b);d=b-a;length=d.length;tangent=d.normalized();side=Vector((-tangent.y,tangent.x))*width/2
  steps=max(1,math.ceil(length/.5));columns=max(1,math.ceil(width/.5))
  for i in range(steps):
   p,q=a+d*i/steps,a+d*(i+1)/steps
   for j in range(columns):
    start,end=side*(2*j/columns-1),side*(2*(j+1)/columns-1);xy=[p+start,q+start,q+end,p+end]
    conform(xy)

def add_ground(g):
 # Vassar's street corridor follows the actual oblique north frontage. The
 # existing orthophoto/DEM stays intact; these are thin sampled finish surfaces.
 path=[(43,305),(64,313),(88,323),(112,334),(138,344),(165,355),(178,360)]
 strip(g,path,10.5,'asphalt',.06)
 for shift,mat,width,lift in ((-7.7,'paving',4.7,.075),(-5.55,'curb',.22,.105)):
  p=[]
  for i,a in enumerate(path):
   d=Vector(path[min(i+1,len(path)-1)])-Vector(path[max(0,i-1)]);d.normalize();n=Vector((-d.y,d.x));p.append(Vector(a)+n*shift)
  strip(g,p,width,mat,lift)
 # Two surveyed-massing approach aprons, not interior entry portals.
 strip(g,[(62,304),(59,294)],6.3,'paving',.09)
 strip(g,[(141,338),(131,330)],5.2,'paving',.09)
 for a,b in zip(path,path[1:]):
  a,b=Vector(a),Vector(b);d=b-a
  for t in range(0,int(d.length),8):
   strip(g,[a+d.normalized()*t,a+d.normalized()*min(t+3,d.length)],.10,'line',.075)

def export(profile):
 mobile=profile=='mobile';bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 mats=terrace.configure_courtyard_materials(site.configure_site_materials(make_materials(mobile),mobile),mobile);shell=Geometry();report=build_shell(shell,mobile);entries.build_entries(shell,mobile,PATCHES,facade_frame,height)
 report['courtyard']=court.add_pisa(shell,mobile)
 amph=Geometry();report['amphitheater']=amphitheater.add_amphitheater(amph,mobile)
 amph_ground=Geometry()
 for name,section in amph.groups.items():
  for face in section['f']:
   ps=[Vector(section['v'][i]) for i in face];normal=(ps[1]-ps[0]).cross(ps[2]-ps[0]).normalized()
   target=amph_ground if name in ('curb','paving') and normal.z>.5 else shell
   target.polygon(name,ps,[section['uv'][i] for i in face])
 report['roofCopings']=court.add_roof_copings(shell,V,F,PATCHES,MAPPERS,family_for)
 site_result=site.add_site_details(shell,height,mobile);report['site']=site_result['report']
 terrace_result=terrace.add_courtyard(shell,V,F,PATCHES,mobile);report['terrace']=terrace_result['report']
 objects=shell.build(mats);site.configure_site_objects(objects)
 ground=Geometry();add_ground(ground);ground_objs=ground.build(mats,'Stata ground')
 for o in ground_objs:o['stataGround']=True
 objects.extend(ground_objs)
 site_ground=site_result['groundGeometry'].build(mats,'Stata garden ground')
 for o in site_ground:o['stataGround']=True
 objects.extend(site_ground)
 amph_ground_objs=amph_ground.build(mats,'Stata amphitheater ground')
 for o in amph_ground_objs:o['stataGround']=True
 objects.extend(amph_ground_objs)
 terrace_ground=terrace_result['groundGeometry'].build(mats,'Stata terrace ground')
 for o in terrace_ground:o['stataGround']=True
 objects.extend(terrace_ground)
 collision_geometry=Geometry();face_patches={f:p['id'] for p in PATCHES for f in p['faces']}
 for f,ids in enumerate(F):
  if f in REPLACED_COURT_FACES:continue
  collision_geometry.mapper=MAPPERS[face_patches[f]] if f in face_patches else (twins.mapper_for({'faces':[f]}) or shape.surface_mapper({'faces':[f]},V,CORRECTED,F))
  collision_geometry.polygon('reveal',[V[i] if collision_geometry.mapper else CORRECTED[i] for i in ids])
 collision_geometry.mapper=None
 proxy=Geometry();court.add_pisa(proxy,True)
 for section in list(proxy.groups.values())+list(site_result['wallGeometry'].groups.values())+list(amph.groups.values())+list(terrace_result['wallGeometry'].groups.values()):
  dest=collision_geometry.groups['reveal'];off=len(dest['v']);dest['v'].extend(section['v']);dest['uv'].extend(section['uv']);dest['f'].extend(tuple(i+off for i in face) for face in section['f'])
 collision=collision_geometry.build(mats,'Stata corrected shell collision only')[0]
 collision['stataWall']=True;collision['stataCollisionOnly']=True;objects.append(collision)
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 target=OUT/('stata-mobile.glb' if mobile else 'stata-full.glb')
 bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=False,export_materials='EXPORT',export_image_format='AUTO',export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_yup=True)
 # The baked grayscale tiles retain the explicit linear architectural tint.
 doc,data=glb(target)
 for m in doc.get('materials',[]):
  name=m['name'].split('.')[0]
  if name in MATERIALS:m['pbrMetallicRoughness']['baseColorFactor']=MATERIALS[name][0]
 # Hidden collision raycasts need positions and indices only. Remove the
 # unused normal/UV streams, then compact their unreferenced buffer views.
 for node in doc['nodes']:
  if node.get('extras',{}).get('stataCollisionOnly'):
   for primitive in doc['meshes'][node['mesh']]['primitives']:
    primitive['attributes']={key:value for key,value in primitive['attributes'].items() if key=='POSITION'}
 # KHR_mesh_quantization permits normalized signed-byte normals, padded to a
 # 4-byte vertex stride. Positions/UVs stay exact Float32; no decoder download
 # or mesh simplification is needed on mobile. Three's loader supports this
 # native attribute format. Enforce an angular error bound before publishing.
 normal_accessors=sorted({p['attributes']['NORMAL'] for mesh in doc['meshes'] for p in mesh['primitives'] if 'NORMAL' in p['attributes']})
 normal_error=0.
 for index in normal_accessors:
  normals=accessor(doc,data,index);packed_normals=bytearray()
  for xyz in normals:
   quantized=[max(-127,min(127,round(component*127))) for component in xyz]
   a,b=Vector(xyz),Vector(quantized)
   if a.length_squared>0 and b.length_squared>0:normal_error=max(normal_error,math.degrees(a.angle(b)))
   packed_normals.extend(struct.pack('<bbbx',*quantized))
  assert normal_error<.5,f'Quantized normal error exceeded bound: {normal_error}'
  data+=b'\0'*((-len(data))%4);offset=len(data);data+=packed_normals
  view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(packed_normals),'byteStride':4,'target':34962})
  acc=doc['accessors'][index];acc.update({'bufferView':view,'byteOffset':0,'componentType':5120,'normalized':True});acc.pop('min',None);acc.pop('max',None)
 for key in ('extensionsUsed','extensionsRequired'):
  if 'KHR_mesh_quantization' not in doc.setdefault(key,[]):doc[key].append('KHR_mesh_quantization')
 report['normalQuantization']={'componentType':'BYTE normalized','stride':4,'maximumAngularErrorDegrees':normal_error,'positions':'unchanged Float32'}
 used_accessors=sorted({a for mesh in doc['meshes'] for primitive in mesh['primitives'] for a in [*primitive['attributes'].values(),primitive['indices']]})
 accessor_map={old:new for new,old in enumerate(used_accessors)}
 doc['accessors']=[doc['accessors'][old] for old in used_accessors]
 for mesh in doc['meshes']:
  for primitive in mesh['primitives']:
   primitive['attributes']={key:accessor_map[value] for key,value in primitive['attributes'].items()}
   primitive['indices']=accessor_map[primitive['indices']]
 used_views=sorted({a['bufferView'] for a in doc['accessors']}|{im['bufferView'] for im in doc.get('images',[])})
 view_map={old:new for new,old in enumerate(used_views)};packed=bytearray();views=[]
 for old in used_views:
  view=doc['bufferViews'][old];start=view.get('byteOffset',0);packed.extend(b'\0'*((-len(packed))%4));offset=len(packed)
  packed.extend(data[start:start+view['byteLength']]);views.append({**view,'byteOffset':offset})
 for a in doc['accessors']:a['bufferView']=view_map[a['bufferView']]
 for im in doc.get('images',[]):im['bufferView']=view_map[im['bufferView']]
 doc['bufferViews']=views;doc['buffers'][0]['byteLength']=len(packed);data=bytes(packed)
 encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);data+=b'\0'*((-len(data))%4)
 target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data)
 tris=sum(len(o.data.polygons) if all(len(p.vertices)==3 for p in o.data.polygons) else sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
 report.update({'profile':profile,'bytes':target.stat().st_size,'triangles':tris,'meshes':len(objects),'images':len(doc.get('images',[])),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
 if not mobile:
  # Keep the editable Blender source visually consistent with the GLB's
  # texture * baseColorFactor. Export remains the simple standard glTF graph.
  for name,m in mats.items():
   image=m.node_tree.nodes.get('Stata basecolor')
   if image:
    tint=m.node_tree.nodes.new('ShaderNodeMixRGB');tint.name='Architectural tint';tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[2].default_value=MATERIALS[name][0]
    m.node_tree.links.new(image.outputs['Color'],tint.inputs[1]);m.node_tree.links.new(tint.outputs[0],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
   for node in m.node_tree.nodes:
    if node.type=='TEX_IMAGE' and node.image:node.image.pack()
  collision.hide_set(True);collision.hide_render=True
  bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'stata-full.blend'),check_existing=False)
  collision.hide_set(False);collision.hide_render=False
 report.pop('windowList',None)
 return report

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 reports=[export('desktop'),export('mobile')]
 manifest={
  'building':'MIT Stata Center / Building 32',
  'revision':'Whole-building exterior reconstruction, 2026-10-22',
  'createdUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'source':'Cambridge 3D GIS CAM_EXP00-RH2O7-V8A8B (aerial survey 2018-04-12)',
  'sourceTriangles':len(F),'sourceSha256':hashlib.sha256((HERE/'source.obj').read_bytes()).hexdigest(),
  'coordinates':'MIT local east/up/south metres; survey placement retained at identity transform',
  'outputs':reports,
  'reconstructed':['Gates and Dreyfoos folded metal silhouettes, waist transitions and crowns',
   'Twins curved cladding, recessed glazing with closed visual window cavities',
   'Yellow Pisa tower, polished courtyard wing, roof copings and service canopies',
   'Survey-anchored stepped amphitheater with two pedestrian stair aisles',
   'Courtyard paving and lawn islands; Vassar berms, planting and five trees'],
  'limitations':['Facade controls, windows, stair tier count and landscape detail are estimated from photographs, not construction dimensions.',
   'The published MIT Gehry CAD directory returned HTTP 403; no original CAD was acquired or used.',
   'Hidden structure, roof equipment and unphotographed surfaces retain simplified geometry. This is not a measured as-built replica.',
   'Window cavities and the vehicle passage are visual exterior details, not a playable interior or new pedestrian entrance.',
   'Street elevation is sampled to the existing campus DEM; the surrounding MIT buildings retain their existing assets.'],
  'references':['https://listart.mit.edu/art-artists/ray-maria-stata-center-2004',
   'https://web.mit.edu/facilities/construction/completed/stata.html','https://azahner.com/projects/mit-stata/',
   'https://www.csail.mit.edu/about/stata-center','https://en.hydrotechmembrane.ca/projects/mit-stata-center',
   'https://rvsn.csail.mit.edu/stata/']}
 (HERE/'shape-corrections.json').write_text(json.dumps({'method':'Shared source vertex cage; photo-authored coordinates, not surveyed facade positions','changes':SHAPE_CHANGES},indent=2),encoding='utf-8')
 for path in (HERE/'build-manifest.json',OUT/'manifest.json'):path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 print('STATA_BUILD '+json.dumps(reports),flush=True)
if __name__=='__main__':main()
