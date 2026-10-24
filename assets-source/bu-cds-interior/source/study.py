"""Adapted geometry source for the independent CDS 1F/2F game interior.

Imported by ../build.py; run that builder to produce game assets.
Forked from the reviewed independent study; not an as-built survey.
All authoring coordinates below are Three.js metres: +X east, +Z south, +Y up.
Blender converts (x,y,z) to (x,-z,y); glTF export restores the documented frame.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
HELPERS = REPO / 'assets-source/charles-bu/blender'
sys.path.insert(0, str(HELPERS))
from refine_cds import _Parts
from glb_finish import repair_zero_tangents

spec = importlib.util.spec_from_file_location('bu_materials', HELPERS / 'build-samples.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

LEVEL = 5.6
OUTLINE = [(-21.0312,-21.0312),(14.0208,-21.0312),(14.0208,-.268),
           (55.308,-.268),(55.308,19.068),(4.692,19.068),
           (4.692,14.0208),(-21.0312,14.0208)]
VOIDS = {'grand-stair': [6.70,31.0,11.72,19.068],
         'butterfly': [10.5,26.7,.2,11.0]}
LAYERS = ['floor-1', 'floor-2', 'floor-2-slab', 'stairs', 'ceiling', 'shell-lower', 'shell-upper', 'roof']
BATCHES = defaultdict(_Parts)
COUNTS = Counter()
MATERIALS = {}
COLLECTIONS = {}
OBJECTS = []


def xyz(p):
    return (p[0], -p[2], p[1])


def batch(layer, finish):
    return BATCHES[(layer,finish)]


def box(layer, finish, name, center, size, bevel=.008, yaw=0):
    target = batch(layer,finish)
    start = len(target.vertices)
    target.box(name, xyz(center), (size[0],size[2],size[1]), bevel)
    if yaw:
        cx,cz=center[0],center[2]
        c,s=math.cos(yaw),math.sin(yaw)
        for i in range(start,len(target.vertices)):
            x,by,h=target.vertices[i]
            dx,dz=x-cx,-by-cz
            target.vertices[i]=(cx+c*dx-s*dz,-(cz+s*dx+c*dz),h)
    COUNTS[name]+=1


def tube(layer, finish, name, a, b, radius=.022):
    batch(layer,finish).cylinder(name,xyz(a),xyz(b),radius,.001)
    COUNTS[name]+=1


def prism(layer, finish, name, ring, bottom, top):
    """Closed extruded polygon, including true curved landing segments."""
    bm=bmesh.new()
    verts=[bm.verts.new(xyz((x,bottom,z))) for x,z in ring]
    verts += [bm.verts.new(xyz((x,top,z))) for x,z in ring]
    n=len(ring)
    bm.faces.new(list(reversed(verts[:n])))
    bm.faces.new(verts[n:])
    for i in range(n):
        j=(i+1)%n
        bm.faces.new([verts[i],verts[j],verts[j+n],verts[i+n]])
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    batch(layer,finish)._append(bm,name,0)
    COUNTS[name]+=1


def strip(layer, finish, name, points, heights, width, top_offset, bottom_offset):
    """Closed strip follows a path; miter joins keep guard faces continuous."""
    sides=[]
    for i,p in enumerate(points):
        before=Vector(points[max(0,i-1)])
        after=Vector(points[min(len(points)-1,i+1)])
        tangent=(after-before).normalized()
        normal=Vector((-tangent.y,tangent.x))
        sides.append((Vector(p)+normal*width/2,Vector(p)-normal*width/2))
    bm=bmesh.new()
    verts=[]
    for i,pair in enumerate(sides):
        for h in (heights[i]+bottom_offset,heights[i]+top_offset):
            for p in pair:
                verts.append(bm.verts.new(xyz((p.x,h,p.y))))
    for i in range(len(points)-1):
        a,b=4*i,4*(i+1)
        for ids in [(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)]:
            bm.faces.new([verts[j] for j in ids])
    bm.faces.new([verts[i] for i in (0,1,3,2)])
    end=4*(len(points)-1)
    bm.faces.new([verts[end+i] for i in (0,2,3,1)])
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    batch(layer,finish)._append(bm,name,0)
    COUNTS[name]+=1


def point_inside(x,z):
    return (-21.0312<=x<=14.0208 and -21.0312<=z<=14.0208) or (4.692<=x<=55.308 and -.268<=z<=19.068)


def slab(layer, level, voids=None, thickness=.24, finish='floor-concrete'):
    cuts=voids or {}
    xs=sorted(set([p[0] for p in OUTLINE]+[v for r in cuts.values() for v in r[:2]]))
    zs=sorted(set([p[1] for p in OUTLINE]+[v for r in cuts.values() for v in r[2:]]))
    for x0,x1 in zip(xs,xs[1:]):
        for z0,z1 in zip(zs,zs[1:]):
            x,z=(x0+x1)/2,(z0+z1)/2
            if not point_inside(x,z):
                continue
            if any(r[0]<x<r[1] and r[2]<z<r[3] for r in cuts.values()):
                continue
            box(layer,finish,layer+' · slab cell',(x,level-thickness/2,z),(x1-x0,thickness,z1-z0),0)


def chair(layer,x,z,base=0,yaw=0,red=False):
    finish='red-upholstery' if red else 'oak-wood'
    box(layer,finish,'study chair seat',(x,base+.46,z),(.48,.065,.46),.018,yaw)
    # Seat back offset rotates with the chair.
    dx,dz=-math.sin(yaw)*.205,math.cos(yaw)*.205
    box(layer,finish,'study chair back',(x+dx,base+.74,z+dz),(.48,.43,.055),.018,yaw)
    c,s=math.cos(yaw),math.sin(yaw)
    for px,pz in [(-.18,-.16),(.18,-.16),(-.18,.16),(.18,.16)]:
        lx,lz=x+c*px-s*pz,z+s*px+c*pz
        tube(layer,'black-metal','chair leg',(lx,base+.025,lz),(lx,base+.43,lz),.017)


def table(layer,x,z,width=2.4,depth=1.0,base=0,chairs=True):
    box(layer,'oak-wood','shared table top',(x,base+.75,z),(width,.075,depth),.018)
    for dx in (-width/2+.18,width/2-.18):
        for dz in (-depth/2+.14,depth/2-.14):
            box(layer,'black-metal','table leg',(x+dx,base+.36,z+dz),(.045,.72,.045),.002)
    if chairs:
        for dx in (-width*.27,width*.27):
            chair(layer,x+dx,z+depth/2+.4,base,0)
            chair(layer,x+dx,z-depth/2-.4,base,math.pi)


def bench(layer,x,z,width,base=0,red=True):
    box(layer,'oak-wood','timber bench',(x,base+.22,z),(width,.44,.62),.014)
    if red:
        box(layer,'red-upholstery','red seat pad',(x,base+.463,z),(width-.12,.046,.52),.014)
    for dx in (-width*.32,width*.32):
        box(layer,'black-metal','bench foot',(x+dx,base+.055,z),(.10,.11,.45),.004)


def rail(layer,a,b,height=1.05):
    tube(layer,'stainless-metal','handrail',(a[0],a[1]+height,a[2]),(b[0],b[1]+height,b[2]),.025)
    length=math.hypot(b[0]-a[0],b[2]-a[2])
    n=max(1,math.ceil(length/1.5))
    for i in range(n+1):
        t=i/n
        p=tuple(a[j]+(b[j]-a[j])*t for j in range(3))
        tube(layer,'stainless-metal','rail post',p,(p[0],p[1]+height,p[2]),.019)


def grand_stair():
    # 12 shallow seating terraces, each contains two short treads and a deep
    # resting tread. Both counts and metric dimensions are authored estimates.
    x=30.0
    heights=[]
    positions=[]
    for i in range(36):
        run=(.36,.36,1.20)[i%3]
        top=(i+1)*LEVEL/36
        box('stairs','floor-concrete','grand walking tread',(x-run/2,top/2,13.04),(run,top,2.08),.003)
        heights.append(top)
        positions.append(x-run/2)
        x-=run
    for i in range(12):
        top=(i+1)*LEVEL/12
        mid=30-(i+.5)*1.92
        box('stairs','floor-concrete','grand seating terrace',(mid,top/2,16.69),(1.92,top,4.62),.004)
        # Loose timber seat units sit on gray landings; the broad base is not wood.
        box('stairs','oak-wood','terrace timber bench',(mid-.40,top+.22,16.75),(.76,.44,3.78),.014)
        for z in (15.78,17.70):
            box('stairs','red-upholstery','terrace red pad',(mid-.40,top+.463,z),(.64,.046,1.68),.014)
    rail('stairs',(30,0,11.94),(6.96,LEVEL,11.94))
    # Top landing belongs to the first→second connection, not a floating prop.
    box('stairs','floor-concrete','grand upper landing',(5.92,LEVEL-.12,15.5),(2.08,.24,7.0),.003)
    # As-built photos leave the window edge open. Do not invent a continuous
    # timber guard wall between the seats and the south curtain wall.


def butterfly_stair():
    start=Vector((14.1,8.5)); corner=Vector((23.1,-.1)); end=Vector((24,10.65))
    u=(corner-start).normalized(); v=(end-corner).normalized()
    angle=math.acos(max(-1,min(1,u.dot(v))))
    radius=1.8
    trim=radius*math.tan(angle/2)
    t1=corner-u*trim; t2=corner+v*trim
    center=t1+Vector((-u.y,u.x))*radius
    a0=math.atan2(t1.y-center.y,t1.x-center.x)
    a1=math.atan2(t2.y-center.y,t2.x-center.x)
    while a1<a0: a1+=math.tau
    curve=[center+Vector((math.cos(a0+(a1-a0)*i/24),math.sin(a0+(a1-a0)*i/24)))*radius for i in range(25)]
    flight_width=1.90
    def flight(a,b,y0,y1,label):
        length=(b-a).length
        heading=math.atan2((b-a).y,(b-a).x)
        n=18
        for i in range(n):
            p=a+(b-a)*((i+.5)/n)
            top=y0+(y1-y0)*(i+1)/n
            # Closed shallow slab under each tread; deeper stringer joins them.
            box('stairs','floor-concrete',label+' tread',(p.x,top-.10,p.y),(length/n+.004,.20,flight_width),.003,heading)
        strip('stairs','black-metal',label+' structural undertray',[a,b],[y0,y1],flight_width,-.12,-.34)
        return [a,b],[y0,y1]
    flight(start,t1,0,LEVEL/2,'butterfly lower flight')
    flight(t2,end,LEVEL/2,LEVEL,'butterfly upper flight')
    # Annular rounded landing with real inner/outer radius and finite thickness.
    inner,outer=radius-flight_width/2,radius+flight_width/2
    for i in range(24):
        aa=a0+(a1-a0)*i/24; bb=a0+(a1-a0)*(i+1)/24
        ring=[tuple(center+Vector((math.cos(a),math.sin(a)))*r) for a,r in [(aa,inner),(aa,outer),(bb,outer),(bb,inner)]]
        prism('stairs','floor-concrete','butterfly curved landing segment',ring,LEVEL/2-.24,LEVEL/2)
    path=[start,t1,*curve[1:-1],t2,end]
    heights=[0,LEVEL/2,*([LEVEL/2]*(len(curve)-2)),LEVEL/2,LEVEL]
    for side in (-1,1):
        guard=[]; lining=[]
        for i,p in enumerate(path):
            before=path[max(0,i-1)]; after=path[min(len(path)-1,i+1)]
            tangent=(after-before).normalized(); normal=Vector((-tangent.y,tangent.x))
            guard.append(tuple(p+normal*side*(flight_width/2+.065)))
            lining.append(tuple(p+normal*side*(flight_width/2-.003)))
        strip('stairs','black-metal','butterfly thick black parapet',guard,heights,.13,1.18,-.28)
        strip('stairs','oak-wood','butterfly timber inner face',lining,heights,.012,1.13,-.16)
    box('stairs','floor-concrete','butterfly lower landing',(start.x,-.12,start.y),(2.5,.24,2.1),.003)
    box('stairs','floor-concrete','butterfly upper landing',(24,LEVEL-.12,11.5),(3.0,.24,1.70),.003)
    # The study stops at the second-floor landing. No invented third-floor run
    # crosses the separate collaborative stair or pretends to be documented.
    return {'lowerLanding':[float(start.x),0,float(start.y)],'turnLanding':[float(center.x),LEVEL/2,float(center.y)],'upperLanding':[24,LEVEL,11.5],
            'firstTangent':[float(t1.x),LEVEL/2,float(t1.y)],'secondTangent':[float(t2.x),LEVEL/2,float(t2.y)],
            'width':flight_width,'turnRadius':radius,'treadsPerFlight':18,'guardThickness':.13}


def glazing():
    # Curtain-wall positions follow the study envelope, not fabricated rooms.
    for level,layer in [(0,'shell-lower'),(LEVEL,'shell-upper')]:
        top=LEVEL-.18
        for edge in range(len(OUTLINE)):
            a=Vector(OUTLINE[edge]); b=Vector(OUTLINE[(edge+1)%len(OUTLINE)])
            delta=b-a; length=delta.length; yaw=math.atan2(delta.y,delta.x)
            n=max(1,round(length/2.35))
            for i in range(n):
                p=a+delta*((i+.5)/n)
                # South entrances remain actual holes at ground level.
                entry=level==0 and abs(p.y-19.068)<.01 and (abs(p.x-31.0)<1.6 or abs(p.x-44.1)<1.6)
                if not entry:
                    box(layer,'glass','transparent envelope pane',(p.x,level+top/2,p.y),(length/n-.08,top,.018),0,yaw)
                for t in (i/n,):
                    q=a+delta*t
                    box(layer,'stainless-metal','envelope mullion',(q.x,level+top/2,q.y),(.07,top,.12),.003,yaw)
            mid=(a+b)/2
            for h in (.06,top):
                box(layer,'stainless-metal','envelope rail',(mid.x,level+h,mid.y),(length,.07,.12),.003,yaw)
    for x,z in [(-19,-18),(12,-18),(-19,8),(2,8),(8,8),(29,1),(40,1),(51,1),(40,17.8),(52,17.8)]:
        for level,layer in [(0,'floor-1'),(LEVEL,'floor-2')]:
            box(layer,'white-paint','structural column',(x,level+(LEVEL-.24)/2,z),(.46,LEVEL-.24,.46),.008)


def public_rooms():
    # Service core is an honest closed context mass, not invented office detail.
    for level,layer in [(0,'floor-1'),(LEVEL,'floor-2')]:
        box(layer,'white-paint','service core context',(0,level+2.4,-7.0),(13.8,4.8,14.0),.01)
        for x in (-3.25,.1,3.45):
            box(layer,'stainless-metal','elevator door context',(x,level+1.12,.015),(1.50,2.24,.055),.005)
            box(layer,'black-metal','elevator center seam',(x,level+1.12,.048),(.018,2.24,.012),.001)
        # East classroom partitions are intentionally schematic, transparent.
        wall_height=4.9 if level else 3.3
        for x in (35.5,47.0):
            box(layer,'glass','classroom glazed boundary',(x,level+wall_height/2,4.65),(.024,wall_height,9.6),0)
            for z in (.1,3.2,6.4,9.2):
                box(layer,'stainless-metal','classroom partition frame',(x,level+wall_height/2,z),(.05,wall_height,.06),.002)
        if not level:
            for x in (31.2,41.2,51.0):table(layer,x,4.0,2.0,.85,level)
        else:
            # Three teaching-room envelopes face a shared southern corridor.
            # Each has a real unglazed door opening; no room numbers are claimed.
            box(layer,'glass','classroom west boundary',(28.8,level+wall_height/2,4.65),(.024,wall_height,9.6),0)
            for x0,x1,door in [(28.8,35.5,33.85),(35.5,47,44.65),(47,55.2,52.85)]:
                for a,b in [(x0,door-.55),(door+.55,x1)]:
                    if b>a:
                        box(layer,'glass','classroom corridor glazing',((a+b)/2,level+wall_height/2,9.45),(b-a,wall_height,.024),0)
                box(layer,'glass','classroom door transom',(door,level+(2.35+wall_height)/2,9.45),(1.1,wall_height-2.35,.024),0)
                for x in (x0,door-.55,door+.55,x1):
                    box(layer,'stainless-metal','classroom corridor jamb',(x,level+wall_height/2,9.45),(.055,wall_height,.07),.002)
                for h in (2.35,wall_height):
                    box(layer,'stainless-metal','classroom corridor head',((x0+x1)/2,level+h,9.45),(x1-x0,.055,.07),.002)
                box(layer,'white-paint','classroom teaching board',((x0+x1)/2,level+1.75,.12),(min(3.0,x1-x0-1.5),1.35,.07),.006)
            for x in (31.7,39.2,43.2,50.1,53.2):
                for z in (2.2,5.4):table(layer,x,z,2.0,.85,level)
    # Café wall, equipment recess and timber counter face are photo-supported;
    # module count, furniture positions and lengths remain design estimates.
    box('floor-1','black-metal','cafe back wall',(-9.75,2.15,-6.4),(.25,4.3,14.0),.006)
    box('floor-1','oak-wood','cafe counter carcass',(-12.1,.52,-5.9),(1.05,1.04,12.3),.01)
    box('floor-1','black-metal','cafe counter top',(-12.1,1.075,-5.9),(1.16,.08,12.45),.009)
    for i in range(94):
        box('floor-1','oak-wood','cafe vertical timber slat',(-12.65,.53,-12+i*.13),(.045,1.0,.054),.003)
    for z in (-9.1,-6.9,-4.7):
        box('floor-1','black-metal','cafe menu display',(-10.04,2.66,z),(.045,.63,1.74),.005)
        box('floor-1','screen-slate','cafe menu screen face',(-10.065,2.66,z),(.004,.55,1.65),.001)
        # Abstract non-legible screen hierarchy, not invented current menu text.
        box('floor-1','warm-diffuser','menu heading mark',(-10.069,2.85,z-.36),(.003,.026,.68),0)
        for i in range(5):
            box('floor-1','warm-diffuser','menu line mark',(-10.069,2.77-i*.068,z-.32),(.003,.012,.61-(i%3)*.075),0)
            box('floor-1','warm-diffuser','menu price mark',(-10.069,2.77-i*.068,z+.58),(.003,.012,.13),0)
    box('floor-1','stainless-metal','espresso equipment',(-11.5,1.43,-8),(1.0,.63,1.5),.04)
    for z in (-8.4,-7.9,-7.4):
        tube('floor-1','black-metal','coffee group',(-12.05,1.35,z),(-12.25,1.35,z),.045)
    box('floor-1','white-paint','cafe white payment block',(-13.20,.57,-11.7),(1.35,1.14,1.85),.015)
    box('floor-1','black-metal','payment terminal stem',(-13.35,1.21,-11.68),(.14,.14,.14),.004)
    box('floor-1','screen-slate','payment terminal',(-13.43,1.34,-11.68),(.12,.22,.34),.006)
    for z in (-9.5,-9.25,-6.0,-5.75,-2.9,-2.65):
        tube('floor-1','white-paint','cafe paper cup',(-12.35,1.12,z),(-12.35,1.27,z),.055)
        tube('floor-1','black-metal','cafe cup lid',(-12.35,1.27,z),(-12.35,1.282,z),.058)
    for z in (-12.5,-.2):
        box('floor-1','white-paint','cafe timber wall backing',(-9.93,2.2,z),(.06,4.4,1.7),.002)
        for i in range(14):
            box('floor-1','oak-wood','cafe full-height slat',(-10.02,2.2,z-.8+i*.12),(.06,4.4,.045),.002)
    # Seating uses repeatable furniture types; locations are not a seat census.
    for x,z,w in [(-16,3.4,2.0),(-15,8.4,2.4),(-7,11.7,3.0),(-1,11.3,3.0),(-15,11.3,2.4),(37.5,14.8,2.4),(47,14.8,2.4)]:
        table('floor-1',x,z,w)
    bench('floor-1',-18.5,12.4,3,0,True)
    bench('floor-1',-12,12.5,2.5,0,True)
    for x,z in [(-16,-12),(-16,-7),(-16,-2)]:
        table('floor-1',x,z,1.4,.8,0,False)
        chair('floor-1',x-.9,z,0,-math.pi/2)
        chair('floor-1',x+.9,z,0,math.pi/2)
    # Second-floor public Spark/lab collaboration to west, simple room edges to east.
    for x,z in [(-15,-12),(-15,-5),(-14,5),(-5,10),(-14,11.3),(2,11.3),(39,14),(48,14)]:
        table('floor-2',x,z,3.2,1.15,LEVEL)
    box('floor-2','white-paint','collaboration writable wall',(-8,LEVEL+1.25,-16),(.12,2.5,6.0),.006)
    # Guardrails around exposed upper-level voids stop at circulation landings.
    for a,b in [((10.5,LEVEL,.2),(26.7,LEVEL,.2)),((10.5,LEVEL,.2),(10.5,LEVEL,11)),
                ((26.7,LEVEL,.2),(26.7,LEVEL,11)),((10.5,LEVEL,11),(22.4,LEVEL,11)),
                ((31.0,LEVEL,11.72),(31.0,LEVEL,19.0)),((6.7,LEVEL,11.72),(22.35,LEVEL,11.72)),
                ((25.65,LEVEL,11.72),(31.0,LEVEL,11.72))]:
        rail('floor-2',a,b)


def ceiling():
    # Slats grouped in material batches. The atrium and stair void remain open.
    for i in range(377):
        x=-20.8+i*.2
        zmin=-20.8 if x<13.8 else 0
        zmax=13.8 if x<4.692 else 18.8
        intervals=[(zmin,zmax)]
        for r in VOIDS.values():
            if r[0]-.2<x<r[1]+.2:
                updated=[]
                for lo,hi in intervals:
                    if lo<r[2]:updated.append((lo,min(hi,r[2]-.2)))
                    if hi>r[3]:updated.append((max(lo,r[3]+.2),hi))
                intervals=updated
        for lo,hi in intervals:
            if hi-lo>.06:
                box('ceiling','oak-wood','ceiling timber slat',(x,LEVEL-.34,(lo+hi)/2),(.08,.17,hi-lo),.003)
    # Linear fixtures only where a ceiling exists; no emissive illumination hack.
    for x,z,length in [(-18,-5,20),(-9,10,14),(2,7,13),(32,8,13),(43,9,13),(53,9,13)]:
        box('ceiling','warm-diffuser','linear light diffuser',(x,LEVEL-.44,z),(.075,.035,length),.003)
    # The collaborative stair is double-height: its visible overhead timber
    # slats belong below the upper roof, not across the open second-floor void.
    for i in range(377):
        x=-20.8+i*.2
        zmin=-20.8 if x<13.8 else 0
        zmax=13.8 if x<4.692 else 18.8
        intervals=[(zmin,zmax)]
        r=VOIDS['butterfly']
        if r[0]-.2<x<r[1]+.2:
            intervals=[(zmin,r[2]-.2),(r[3]+.2,zmax)]
        for lo,hi in intervals:
            if hi-lo>.06:
                box('ceiling','oak-wood','upper ceiling timber slat',(x,10.58,(lo+hi)/2),(.08,.17,hi-lo),.003)
    slab('roof',10.9,{'atrium-upper-cut':VOIDS['butterfly']},.2,'white-paint')


def make_materials():
    palettes={
        'floor-concrete':('concrete',(.60,.60,.575),.84,0),
        'oak-wood':('wood',(.64,.46,.27),.58,0),
        'black-metal':('frame',(.018,.023,.027),.42,.15),
        'stainless-metal':('steel',(.36,.38,.39),.31,.72),
        'white-paint':('paint',(.79,.785,.75),.85,0),
        'red-upholstery':('fabric',(.50,.012,.022),.88,0),
        'warm-diffuser':('diffuser',(.94,.87,.68),.6,0),
        'screen-slate':('screen',(.035,.065,.08),.56,0),
        'glass':('glass',(.71,.82,.84),.14,0),
    }
    textures={family:{kind:HELPERS/'textures'/f'{family}-{kind}.png' for kind in ('basecolor','normal','orm')} for family in ('wood','concrete','metal')}
    for key,(family,tint,rough,metal) in palettes.items():
        source=bpy.data.materials.new(f'{key} {family}')
        source.diffuse_color=(*tint,1)
        mat=shared.finish_material(source,textures,'cds-interior-study')
        mat.name=key+' · interior study'
        bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        bsdf.inputs['Metallic'].default_value=metal
        if family not in ('wood','concrete'):
            for link in list(bsdf.inputs['Roughness'].links):mat.node_tree.links.remove(link)
            bsdf.inputs['Roughness'].default_value=rough
        if key=='glass':
            bsdf.inputs['Alpha'].default_value=.12
            mat.diffuse_color=(*tint,.12)
            mat.surface_render_method='DITHERED'
            mat.use_backface_culling=False
        MATERIALS[key]=mat


def patch_glb(path):
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+length]);binary=bytearray(data[28+length:])
    byname={m.name:m for m in MATERIALS.values()}
    for item in doc.get('materials',[]):
        source=byname[item['name']]
        alpha=.12 if item['name'].startswith('glass') else 1
        item.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=list(source['bu_base_tint'])+[alpha]
        item['alphaMode']='BLEND' if alpha<1 else 'OPAQUE'
        item['emissiveFactor']=[0,0,0]
        item['doubleSided']=alpha<1
    repaired=repair_zero_tangents(doc,binary)
    blob=json.dumps(doc,separators=(',',':')).encode();blob+=b' '*((-len(blob))%4)
    result=struct.pack('<III',0x46546C67,2,28+len(blob)+len(binary))+struct.pack('<II',len(blob),0x4E4F534A)+blob+struct.pack('<II',len(binary),0x004E4942)+binary
    path.write_bytes(result)
    return repaired,doc


def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    make_materials()
    for name in LAYERS:
        empty=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(empty)
        empty['study_layer']=name
        COLLECTIONS[name]=empty
    slab('floor-1',0)
    slab('floor-2-slab',LEVEL,VOIDS)
    grand_stair()
    butterfly=butterfly_stair()
    public_rooms()
    glazing()
    ceiling()
    details=[]
    for (layer,finish),parts in BATCHES.items():
        if not parts.vertices:continue
        name=f'{layer} · {finish}'
        obj=parts.mesh(MATERIALS[finish],bpy.context.scene.collection,name)
        obj.parent=COLLECTIONS[layer]
        obj['study_layer']=layer
        obj['source_status']='Authored dimensioned study; not a measured as-built model'
        if layer=='floor-2-slab':
            obj['level_metres']=LEVEL
            obj['voidRects']=json.dumps(VOIDS)
        obj['semantic_counts']=json.dumps(dict(Counter(r['kind'] for r in parts.records)))
        # Remove unrelated refinement helper tags from this new independent study.
        for key in ('bu_refinement','bu_detail_source'):
            if key in obj:del obj[key]
        # Cylinder end caps are n-gons. Triangulate those before glTF tangent
        # construction, preserving the silhouette and all quads elsewhere.
        bm=bmesh.new();bm.from_mesh(obj.data)
        ngons=[f for f in bm.faces if len(f.verts)>4]
        if ngons:bmesh.ops.triangulate(bm,faces=ngons)
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        shared.metre_uv(obj)
        obj.data.calc_loop_triangles()
        OBJECTS.append(obj)
        details.append({'name':name,'layer':layer,'material':finish,'triangles':len(obj.data.loop_triangles),'components':len(parts.records)})
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.scene.unit_settings.scale_length=1
    bpy.context.scene.world.color=(.12,.14,.17)
    # Save editable meshes and packed read-only-reused textures, no baked camera.
    for img in bpy.data.images:
        if img.source=='FILE' and img.filepath:img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'cds-interior-preview.blend'))
    bpy.ops.object.select_all(action='SELECT')
    target=HERE/'cds-interior-preview.glb'
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_apply=True,
        export_yup=True,export_texcoords=True,export_normals=True,export_tangents=True,
        export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    repaired,doc=patch_glb(target)
    points=[(v.co.x,v.co.z,-v.co.y) for o in OBJECTS for v in o.data.vertices]
    bounds={'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]}
    manifest={
        'id':'cds-interior-preview','version':3,'status':'Independent design study — not gameplay or as-built survey',
        'coordinateFrame':{'units':'metres','axes':{'x':'east/right','y':'up','z':'south/Commonwealth Avenue'},'origin':'Original CDS local source frame, first-floor finish y=0'},
        'levels':{'floor-1':0,'floor-2':LEVEL,'roof':10.9,'status':'estimated, not surveyed'},
        'outlineXZ':OUTLINE,'voidsXZ':VOIDS,'bounds':bounds,'layers':LAYERS,
        'anchors':{'mainEntry':[31,0,18.8],'eastEntry':[44.1,0,18.8],'cafe':[-14,1.3,-5.9],
            'grandStairLower':[30.0,0,13.04],'grandStairUpper':[5.92,LEVEL,15.5],
            'grandSeating':[18.5,2.8,16.7],'butterflyLower':butterfly['lowerLanding'],
            'butterflyTurn':butterfly['turnLanding'],'butterflyUpper':butterfly['upperLanding'],
            'secondFloorWest':[-10,LEVEL,9],'secondFloorEast':[41,LEVEL,13]},
        'grandStair':{'rise':LEVEL,'run':23.04,'treadCount':36,'treadRise':LEVEL/36,'treadRunsRepeating':[.36,.36,1.2],
            'seatTerraceCount':12,'walkingLaneZ':[12,14.08],'seatTerraceZ':[14.38,19.0],'direction':'east-low to west-high','allMetricDimensions':'estimated'},
        'butterfly':butterfly,
        'semanticCounts':dict(COUNTS),'batches':details,'triangles':sum(d['triangles'] for d in details),
        'meshCount':len(OBJECTS),'materialCount':len(doc.get('materials',[])),'imageCount':len(doc.get('images',[])),
        'glb':{'path':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'tangentRepairs':repaired},
        'references':'../references/catalog.json',
        'estimates':['Floor heights and outer study envelope; western south edge is extended beyond current approximate game shell',
          'Exact door, service core and interior partition locations','Stair width, tread count, landing radius and bench positions',
          'Furniture and light-fixture counts, geometry and PBR values','Menu-screen graphic placeholders; no current menu text or price claims'],
        'supportedByEvidence':['West café, central core/atrium, south collaboration zone, east teaching context from DPIR 2019 Figs 2-12/2-13',
          'Separate east-low/west-high collaborative stair and central butterfly stair from BU architect interview',
          'Gray seat terraces, timber benches/red pads, timber slat café and ceilings, black/timber rounded stair guards from 2023 as-built photos'],
        'notModeled':['Upper floors, private offices and service interiors','Working elevators','Game collisions or navigation','Measured current room boundaries'],
        'inspection':{'defaultHide':['floor-2','floor-2-slab','shell-upper','roof','ceiling'],
            'firstFloorCloseHide':['floor-2','floor-2-slab','shell-upper','roof'],
            'upperStairContinuation':'Truncated at second-floor landing; continuation above is not modeled'}
    }
    (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('CDS_INTERIOR_RESULT '+json.dumps({'meshCount':len(OBJECTS),'triangles':manifest['triangles'],'bounds':bounds,'glb':manifest['glb']}),flush=True)


if __name__=='__main__':
    raise SystemExit('Run assets-source/bu-cds-interior/build.py, not this geometry-source module.')
