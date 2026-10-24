"""Photographic reconstruction of the two Vassar metal clusters.

The GIS cage locates the building, not its as-built envelope. Shared columns
describe leaned shoulders, undercuts and pitched crowns visible in Zahner's
finished-building photos. Dimensions are authored estimates, not measurements.
Split walls, roofs, window returns and collisions at the mapper's sections.
"""
from mathutils import Vector
UPPER={38,42,54,62,64,76,78}
LOWER={20,28}

# XY keys are shared source columns; sections are (source Z, delta X, delta Y).
# The last value is a crown-height change, ramped in only above Z=34.
_DESIGNS={
 (119.5900,319.1629): ([(4,0,0),(12,0,0),(16,-.15,.35),(27,-.45,.55),(29,-.65,.15),(31,-.35,.65),(42,-.65,1.15)],-.75),
 (119.7411,322.9950): ([(4,0,0),(12,0,0),(14,-.25,2.10),(22,-.60,1.90),(27,-.80,1.55),(29,-1.00,.60),(30.4,-.90,2.35),(35,-1.15,2.45),(42,-1.70,2.70)],.55),
 (124.4174,321.4297): ([(4,0,0),(12,0,0),(14,-.10,.60),(27,-.30,.25),(29,-.20,-.10),(30.4,.15,.55),(42,.35,.50)],-1.15),
 (127.0288,324.9641): ([(4,0,0),(12,0,0),(14,0,2.70),(22,-.25,2.35),(27,-.55,1.85),(29,-.65,.85),(30.4,-.10,3.25),(35,.50,2.90),(42,1.10,2.40)],3.55),
 (128.4308,319.4838): ([(4,0,0),(12,0,0),(14,0,.35),(27,-.10,.30),(30.4,-.25,.35),(42,-.50,-.25)],.25),
 # Intermediate points on the short bottom returns of the central ridge.
 (126.0900,323.6935): ([(4,0,0),(12,0,0),(14,-.04,1.94),(22,-.23,1.72),(27,-.46,1.28),(29,-.49,.51),(30.4,-.01,2.28),(42,.83,1.72)],1.85),
 (127.5110,323.0791): ([(4,0,0),(12,0,0),(14,0,1.89),(22,-.18,1.66),(27,-.39,1.32),(29,-.44,.66),(30.4,-.15,2.25),(42,.55,1.49)],2.41),
 # The separate, leaning shoulder behind the lower tapered apron.
 (129.4902,318.6190): ([(4,0,0),(13,0,0),(24,-.15,.45),(28,-.20,.75),(34,-.45,1.15),(44,-.65,1.30)],-2.40),
 (131.7468,320.7575): ([(4,0,0),(13,0,0),(24,-.02,1.10),(28,.02,1.35),(34,.10,1.75),(44,.20,2.10)],-1.85),
 (135.3756,324.1962): ([(4,0,0),(13,0,0),(24,.10,2.10),(28,.15,2.55),(34,.45,2.95),(44,.85,3.35)],-1.35),
 # The apron pinches between a fixed foot and a broader shoulder.
 (135.6521,330.0806): ([(4,0,0),(8,1.85,-3.15),(12,2.50,-4.10),(16,2.00,-3.25),(22,.80,-1.15),(27,.15,.70),(32,.15,.70)],0),
 # Dreyfoos: two-row skirt, drawn-back shaft, then a separate upper box.
 (56.8993,284.7378): ([(4,0,0),(10,0,0),(12,.40,.70),(15,1.25,2.19),(20,1.30,2.275),(23,.15,.26),(27,.10,.17),(30,-.25,-.44),(31.3,1.25,2.19),(36,1.00,1.75),(40,.35,.61)],2.30),
}
_STATE={}
_LEVELS=sorted({z for sections,_ in _DESIGNS.values() for z,_,_ in sections}|{18,24,28,32,34,38,39.9752,41.5,43.3351})
_A=Vector((56.899269104003906,284.73779296875,0))
_B=Vector((57.95856857299805,287.83709716796875,0))
_ALONG=(_B-_A).normalized()
_LENGTH=(_B-_A).length
_OUTWARD=Vector((-.9462564587593079,.32341742515563965,0))
_FOLD_T=.55
_FOLD_HEIGHT=[(4,0),(12,0),(15,.70),(20,1.10),(23,.30),(28,.60),(30,.65),(31.3,1.45),(36,1.30),(38,.65),(39.9752388,0),(44,0)]

def _interpolate(z,points):
 if z<=points[0][0]:return points[0][1:]
 for a,b in zip(points,points[1:]):
  if z<=b[0]:
   t=(z-a[0])/(b[0]-a[0])
   return tuple(a[i]+(b[i]-a[i])*t for i in range(1,len(a)))
 return points[-1][1:]

# The source contains T-junction vertices inside otherwise straight cage
# edges. They must use exact endpoint interpolation, not independent profiles.
_TOP_OVERRIDE={}
for key,a,b,top in [
 ((131.7468,320.7575),(129.4902,318.6190),(135.3756,324.1962),43.3351),
 ((126.0900,323.6935),(124.4174,321.4297),(127.0288,324.9641),41.8351),
 ((127.5110,323.0791),(127.0288,324.9641),(128.4308,319.4838),41.966),
]:
 e=Vector(b)-Vector(a);t=(Vector(key)-Vector(a)).dot(e)/e.length_squared
 da,ra=_DESIGNS[a];db,rb=_DESIGNS[b];zs=sorted({v[0] for v in da+db})
 sections=[]
 for z in zs:
  aa=_interpolate(z,da);bb=_interpolate(z,db)
  sections.append((z,aa[0]*(1-t)+bb[0]*t,aa[1]*(1-t)+bb[1]*t))
 _DESIGNS[key]=(sections,ra*(1-t)+rb*t);_TOP_OVERRIDE[key]=top

def _column_delta(control,z):
 if control is None or z<=4:return Vector((0,0,0))
 sections,roof,top=control
 dx,dy=_interpolate(z,sections)
 t=max(0,min(1,(z-34)/max(1,top-34)))
 return Vector((dx,dy,roof*t))

def _return_fold(point,roof=False):
 """Extra return facet continuous at both ends of the existing return wing."""
 q=Vector(point);r=q-_A;t=r.dot(_ALONG)/_LENGTH
 if not 0<t<1:return Vector((0,0,0))
 along=t/_FOLD_T if t<=_FOLD_T else (1-t)/(1-_FOLD_T)
 depth=1.
 if roof:
  signed=r.dot(_OUTWARD)
  if signed>1e-4 or signed<-2:return Vector((0,0,0))
  depth=max(0,1+signed/2)
 return _OUTWARD*(_interpolate(q.z,_FOLD_HEIGHT)[0]*along*depth)

def corrected_vertices(vertices,faces,patches,brick):
 """Prepare shared-column controls; keep actual masonry/glass joins fixed."""
 adjacency={};tops={}
 for p in patches:
  for f in p['faces']:
   for i in faces[f]:
    key=tuple(round(v,4) for v in vertices[i][:2])
    adjacency.setdefault(key,set()).add(p['id'])
    tops[key]=max(tops.get(key,-1e10),vertices[i][2])
 controls=[]
 for raw in vertices:
  key=tuple(round(v,4) for v in raw[:2]);design=_DESIGNS.get(key)
  controls.append((*design,_TOP_OVERRIDE.get(key,tops[key])) if design and not adjacency.get(key,set()).intersection(brick) else None)
 _STATE.clear();_STATE.update(controls=controls,vertices=vertices,faces=faces)
 result=[];moved=[]
 for i,raw in enumerate(vertices):
  q=Vector(raw)+_column_delta(controls[i],raw[2]);result.append(q)
  if (q-Vector(raw)).length>.001:moved.append({'vertex':i,'from':list(raw),'to':list(q)})
 return result,moved

def surface_mapper(p,vertices,corrected,faces):
 """Map a patch or {'faces':[f]} with height-evaluated shared-column weights."""
 controls=_STATE.get('controls')
 if controls is None:raise RuntimeError('Call corrected_vertices before surface_mapper')
 triangles=[];pid=p.get('id');fold=pid==67;roof_fold=False
 for f in p['faces']:
  ids=faces[f];a,b,c=(Vector(vertices[i]) for i in ids)
  e0=b-a;e1=c-a;n=e0.cross(e1).normalized()
  d00=e0.dot(e0);d01=e0.dot(e1);d11=e1.dot(e1);den=d00*d11-d01*d01
  if abs(den)>1e-12:triangles.append((a,e0,e1,n,d00,d01,d11,den,tuple(controls[i] for i in ids)))
 if not fold and not roof_fold and not any(any(t[-1]) for t in triangles):return None
 def map_point(point):
  q=Vector(point);best=None;score=1e20
  for a,e0,e1,n,d00,d01,d11,den,ctrls in triangles:
   r=q-a;d20=r.dot(e0);d21=r.dot(e1)
   v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den;u=1-v-w
   penalty=max(0,-u)+max(0,-v)+max(0,-w)
   if penalty<score:
    delta=sum((_column_delta(ctrl,q.z)*weight for ctrl,weight in zip(ctrls,(u,v,w))),Vector((0,0,0)))
    best=q+delta;score=penalty
    if penalty<1e-6:break
  if best is None:best=q
  if fold or roof_fold:best+=_return_fold(q,roof_fold)
  return best
 map_point.split_levels=_LEVELS
 if fold or roof_fold:
  map_point.split_planes=[(tuple(_ALONG),_A.dot(_ALONG)+t*_LENGTH) for t in (0,_FOLD_T,1)]
  if roof_fold:map_point.split_planes.extend((tuple(_OUTWARD),_A.dot(_OUTWARD)+d) for d in (-2,0))
 return map_point

def giraffe_mapper(p,vertices,faces,patches):
 """Compatibility: the unified surface mapper now owns Dreyfoos."""
 return None

