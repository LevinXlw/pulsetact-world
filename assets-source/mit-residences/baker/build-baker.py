"""Baker House: surveyed outline with photograph-informed exterior details.
Run: blender --background --python-exit-code 1 --python this-file.
Blender XYZ = east, north, up metres; exported glTF = east, up, south.
"""
from pathlib import Path
import bpy,bmesh,json,math,random,struct,sys
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from collections import defaultdict,Counter
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[2]; OUT=ROOT/'public/assets/mit-residences'
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if '--out-dir' in ARGS:OUT=Path(ARGS[ARGS.index('--out-dir')+1])
OUT.mkdir(parents=True,exist_ok=True)
SRC=json.loads((HERE/'source-geometry.json').read_text()); V=[Vector(v) for v in SRC['vertices']]; F=SRC['faces']
BASE=min(v.z for v in V); ROOF=22.6447399542799
UP=Vector((0,0,1)); RNG=random.Random(72819)

def boundary(level):
    fs=[f for f in F if all(abs(V[j].z-level)<.001 for j in f)]
    edges=Counter(tuple(sorted((f[i],f[(i+1)%len(f)]))) for f in fs for i in range(len(f)))
    adj=defaultdict(list)
    for (a,b),n in edges.items():
        if n==1:adj[a].append(b);adj[b].append(a)
    rem=set(adj);loops=[]
    while rem:
        start=min(rem);ids=[start];prev=None;now=start
        while True:
            ns=[j for j in adj[now] if j!=prev];nxt=ns[0]
            if nxt==start:break
            ids.append(nxt);prev,now=now,nxt
        loops.append(ids);rem.difference_update(ids)
    return loops

class Geo:
    def __init__(self):self.g=defaultdict(lambda:{'v':[],'f':[],'uv':[]})
    def poly(self,m,ps,uv=None):
        ps=[Vector(p) for p in ps]
        if len(ps)<3:return
        if uv is None:
            norm=(ps[1]-ps[0]).cross(ps[2]-ps[0]);a=max(range(3),key=lambda k:abs(norm[k]));axes=(0,1) if a==2 else ((0,2) if a==1 else (1,2));uv=[(p[axes[0]]/12,p[axes[1]]/6) for p in ps]
        g=self.g[m];o=len(g['v']);g['v']+=list(map(tuple,ps));g['uv']+=uv
        for i in range(1,len(ps)-1):
            if (ps[i]-ps[0]).cross(ps[i+1]-ps[0]).length>1e-8:g['f'].append((o,o+i,o+i+1))
    def cap(self,m,ps):
        for tri in tessellate_polygon([[Vector(p) for p in ps]]):self.poly(m,[ps[i] for i in tri] if isinstance(tri[0],int) else tri)
    def box(self,m,c,u,v,w,h,d):
        c=Vector(c);u=Vector(u)*w/2;v=Vector(v)*h/2;n=u.cross(v).normalized()*d/2
        ps=[c+u*a+v*b+n*k for k in (-1,1) for b in (-1,1) for a in (-1,1)]
        for f in ((0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)):self.poly(m,[ps[i] for i in f])
    def cyl(self,m,c,r,h,segments=16):
        c=Vector(c);a=[c+Vector((r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),0)) for i in range(segments)]
        for p,q in zip(a,a[1:]+a[:1]):self.poly(m,[p,q,q+UP*h,p+UP*h])
        self.cap(m,[p+UP*h for p in a])
    def lathe(self,m,c,profile,segments=20):
        c=Vector(c)
        for (r0,z0),(r1,z1) in zip(profile,profile[1:]):
            for i in range(segments):
                a=i*math.tau/segments;b=(i+1)*math.tau/segments
                self.poly(m,[c+Vector((r0*math.cos(a),r0*math.sin(a),z0)),c+Vector((r0*math.cos(b),r0*math.sin(b),z0)),c+Vector((r1*math.cos(b),r1*math.sin(b),z1)),c+Vector((r1*math.cos(a),r1*math.sin(a),z1))])
    def objects(self,mats,prefix):
        result=[]
        for m,g in self.g.items():
            me=bpy.data.meshes.new(prefix+' '+m);me.from_pydata(g['v'],[],g['f']);me.update()
            if m in ('brick','roof','paver'):
                uv=me.uv_layers.new(name='UVMap')
                for p in me.polygons:
                    for li in p.loop_indices:uv.data[li].uv=g['uv'][me.loops[li].vertex_index]
            bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
            ob=bpy.data.objects.new(prefix+' '+m,me);bpy.context.collection.objects.link(ob);me.materials.append(mats[m]);result.append(ob)
        return result

def make_texture(size,kind):
    rng=np.random.default_rng(918214);yy,xx=np.mgrid[0:size,0:size];x=xx/size*12;y=yy/size*6
    # 225 × 75 mm coursing, worn 7–10 mm joints and water-struck faces.
    # Low-frequency warping changes each brick edge without changing scale.
    wx=x+.0017*np.sin(y*71+x*31)+.0008*np.cos(y*291-x*17)
    wy=y+.0012*np.sin(x*42+y*14)
    row=np.floor(wy/.075).astype(int);col=np.floor((wx+(row%2)*.1125)/.225).astype(int)
    variations=rng.normal(0,.09,(83,57));val=variations[row%83,col%57]
    bx=np.mod(wx+(row%2)*.1125,.225);by=np.mod(wy,.075)
    edge=np.minimum.reduce([bx,.225-bx,by,.075-by]);mortar=np.clip((.0055-edge)/.0035,0,1)
    noise=rng.normal(0,.009,(size,size));weather=.026*np.sin(x*1.23+y*1.7)+.017*np.sin(x*3.2-y*.8)
    facegrain=.017*np.sin(x*169+y*71)*np.sin(y*237-x*38)+noise
    if kind=='color':
        rgba=np.ones((size,size,4),dtype=np.float32)
        tint=rng.uniform(-.025,.025,(83,57))[row%83,col%57]
        for k,base in enumerate((.52,.355,.279)):
            rgba[:,:,k]=np.clip((base*(1+val+weather+facegrain)+(tint if k==0 else -tint*.35))*(1-mortar)+(.36,.325,.287)[k]*mortar,0,1)
    elif kind=='normal':
        relief=(1-mortar)*(.0032+val*.002)+facegrain*.0012
        dy,dx=np.gradient(relief,6/size,12/size);norm=np.sqrt(dx*dx+dy*dy+1)
        rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,0]=.5-dx/norm*.5;rgba[:,:,1]=.5-dy/norm*.5;rgba[:,:,2]=.5+.5/norm
    elif kind=='roughness':
        rough=np.round(np.clip(.79+val*.28+facegrain*.2+mortar*.09,.59,.97)*64)/64
        rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=rough[:,:,None]
    img=bpy.data.images.new('Baker seeded waterstruck brick '+kind,width=size,height=size);img.pixels.foreach_set(rgba.ravel());ext='jpg' if kind=='color' else 'png';img.filepath_raw=str(HERE/f'brick-{kind}-{size}.{ext}');img.file_format='JPEG' if kind=='color' else 'PNG';img.save();img.pack();return img

def mats(mobile):
    spec={'brick':((.52,.355,.279),.86,0),'tile':((.48,.27,.185),.76,0),'roof':((.105,.12,.13),.89,0),'roofSeam':((.125,.14,.15),.84,0),'stone':((.57,.55,.48),.81,0),'coping':((.39,.42,.42),.58,.3),'frame':((.66,.67,.63),.35,.47),'frameLip':((.73,.735,.69),.3,.5),'reveal':((.24,.185,.145),.93,0),'gasket':((.035,.041,.04),.78,0),'glass':((.37,.46,.48),.14,.12),'glassLight':((.46,.53,.53),.21,.08),'shade':((.70,.68,.59),.95,0),'shadeDark':((.44,.45,.41),.95,0),'room':((.22,.23,.21),.96,0),'roomWarm':((.31,.27,.21),.96,0),'door':((.255,.13,.055),.67,0),'dark':((.055,.067,.062),.8,0),'paving':((.45,.43,.38),.95,0),'collision':((0,0,0),1,0)}
    spec['paver']=((.42,.23,.16),.88,0);spec['soil']=((.115,.086,.057),.99,0)
    out={}
    for key,(rgb,rough,metal) in spec.items():
        mat=bpy.data.materials.new('Baker '+key);mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;mat.diffuse_color=(*rgb,1);out[key]=mat
    size=512 if mobile else 1024
    for key in ('glass','glassLight'):
        p=out[key].node_tree.nodes.get('Principled BSDF');p.inputs['Alpha'].default_value=.43;p.inputs['IOR'].default_value=1.51
        out[key].surface_render_method='DITHERED'
    for kind in ('color','normal','roughness'):
        img=make_texture(size,kind);n=out['brick'].node_tree.nodes.new('ShaderNodeTexImage');n.image=img
        if kind=='color':out['brick'].node_tree.links.new(n.outputs['Color'],out['brick'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
        elif kind=='normal':
            img.colorspace_settings.name='Non-Color';nm=out['brick'].node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.8;out['brick'].node_tree.links.new(n.outputs['Color'],nm.inputs['Color']);out['brick'].node_tree.links.new(nm.outputs['Normal'],out['brick'].node_tree.nodes.get('Principled BSDF').inputs['Normal'])
        else:
            img.colorspace_settings.name='Non-Color';out['brick'].node_tree.links.new(n.outputs['Color'],out['brick'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'])
    # Bituminous roofing has broad weathering and narrow lap seams rather
    # than the former uniform gray fill; no additional geometry is required.
    rs=256 if mobile else 512;yy,xx=np.mgrid[0:rs,0:rs];rx=xx/rs*12;ry=yy/rs*6;rr=np.random.default_rng(414)
    rv=.013*np.sin(rx*.77+ry*.31)+.008*np.cos(ry*1.6-rx*.42)+rr.normal(0,.005,(rs,rs));seam=(np.mod(rx,1.2)<.018)*.018
    pixels=np.ones((rs,rs,4),dtype=np.float32)
    for k,v in enumerate((.145,.16,.165)):pixels[:,:,k]=np.clip(v+rv-seam,.08,.23)
    im=bpy.data.images.new('Baker weathered roof',width=rs,height=rs);im.pixels.foreach_set(pixels.ravel());im.filepath_raw=str(HERE/f'roof-color-{rs}.png');im.file_format='PNG';im.save();im.pack()
    tex=out['roof'].node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;out['roof'].node_tree.links.new(tex.outputs['Color'],out['roof'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    # Separate approximately 180 x 90 mm paving units: the facade's courses
    # must not be stretched across the horizontal entrance court.
    ps=256 if mobile else 512;yy,xx=np.mgrid[0:ps,0:ps];px=xx/ps*4.86;py=yy/ps*4.86
    pr=np.random.default_rng(241024);row=np.floor(py/.09).astype(int);col=np.floor((px+(row%2)*.09)/.18).astype(int)
    pv=pr.normal(0,.045,(56,29))[row%56,col%29];gx=np.mod(px+(row%2)*.09,.18);gy=np.mod(py,.09)
    edge=np.minimum.reduce([gx,.18-gx,gy,.09-gy]);joint=np.clip((.0028-edge)/.002,0,1)
    grain=pr.normal(0,.004,(ps,ps));relief=(1-joint)*(.0012+pv*.001)+grain*.0005
    dy,dx=np.gradient(relief,4.86/ps,4.86/ps);nn=np.sqrt(dx*dx+dy*dy+1)
    for kind in ('color','normal'):
        rgba=np.ones((ps,ps,4),dtype=np.float32)
        if kind=='color':
            for k,c in enumerate((.52,.31,.235)):rgba[:,:,k]=np.clip((c*(1+pv)+grain)*(1-joint)+(.42,.30,.245)[k]*joint,0,1)
        else:rgba[:,:,0]=.5-dx/nn*.5;rgba[:,:,1]=.5-dy/nn*.5;rgba[:,:,2]=.5+.5/nn
        im=bpy.data.images.new('Baker court pavers '+kind,width=ps,height=ps);im.pixels.foreach_set(rgba.ravel());ext='jpg' if kind=='color' else 'png';im.filepath_raw=str(HERE/f'court-{kind}-{ps}.{ext}');im.file_format='JPEG' if kind=='color' else 'PNG';im.save();im.pack()
        nt=out['paver'].node_tree;tex=nt.nodes.new('ShaderNodeTexImage');tex.image=im;bsdf=nt.nodes.get('Principled BSDF')
        if kind=='color':nt.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
        else:
            im.colorspace_settings.name='Non-Color';nm=nt.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.65;nt.links.new(tex.outputs['Color'],nm.inputs['Color']);nt.links.new(nm.outputs['Normal'],bsdf.inputs['Normal'])
    return out

class PathLine:
    def __init__(self,points):
        self.ps=[Vector((p[0],p[1],0)) for p in points];self.ds=[0]
        for p,q in zip(self.ps,self.ps[1:]):self.ds.append(self.ds[-1]+(q-p).length)
        self.length=self.ds[-1]
    def at(self,s,z=0,depth=0):
        s=max(0,min(self.length,s));i=next((i for i in range(len(self.ds)-1) if self.ds[i+1]>=s),len(self.ds)-2);p,q=self.ps[i:i+2];u=(q-p).normalized();n=Vector((u.y,-u.x,0));return p+u*(s-self.ds[i])+UP*z+n*depth
    def rect(self,g,m,a,b,z0,z1,depth=0):
        if z1<=z0+.0001 or b<=a+.0001:return
        cuts=[a]+[d for d in self.ds[1:-1] if a<d<b]+[b]
        for x,y in zip(cuts,cuts[1:]):
            g.poly(m,[self.at(x,z0,depth),self.at(y,z0,depth),self.at(y,z1,depth),self.at(x,z1,depth)],[(x/12,z0/6),(y/12,z0/6),(y/12,z1/6),(x/12,z1/6)])

def window(g,path,a,b,z,h,mobile,seed):
    dep=.28
    # Real metal sashes remain planar even where their surrounding masonry
    # follows the serpentine facade. This also removes false curved mullions.
    path=PathLine([path.at(a),path.at(b)]);a=0;b=path.length
    # The exterior opening contains masonry, a deep jamb, a metal extrusion,
    # a separate glazing sheet and an obscured backing. The backing is an
    # exterior shading proxy, not an invented accessible room interior.
    g.poly('reveal',[path.at(a,z),path.at(a,z, -dep),path.at(a,z+h,-dep),path.at(a,z+h)])
    g.poly('reveal',[path.at(b,z),path.at(b,z+h),path.at(b,z+h,-dep),path.at(b,z,-dep)])
    g.poly('reveal',[path.at(a,z),path.at(b,z),path.at(b,z,-dep),path.at(a,z,-dep)])
    g.poly('reveal',[path.at(a,z+h),path.at(a,z+h,-dep),path.at(b,z+h,-dep),path.at(b,z+h)])
    fw=.065;back=.69;randomness=random.Random(seed*157+int(path.ps[0].x*41))
    room='roomWarm' if seed%3==0 else 'room'
    path.rect(g,room,a,b,z,z+h,-back)
    if not mobile:
        for x,y in [(a,a+.035),(b-.035,b)]:path.rect(g,'gasket',x,y,z,z+h,-dep+.01)
    for side in (a,b):g.poly(room,[path.at(side,z,-dep),path.at(side,z,-back),path.at(side,z+h,-back),path.at(side,z+h,-dep)])
    g.poly(room,[path.at(a,z+h,-dep),path.at(b,z+h,-dep),path.at(b,z+h,-back),path.at(a,z+h,-back)])
    # Most photographs show the cream roller blinds at differing heights.
    if seed%7!=1:
        shadeheight=h*randomness.choice([.16,.28,.37,.48,.65,.82])
        path.rect(g,'shadeDark' if seed%5==0 else 'shade',a+.05,b-.05,z+h-shadeheight,z+h-.04,-.48)
    path.rect(g,'glassLight' if seed%5==0 else 'glass',a+.035,b-.035,z+.035,z+h-.035,-dep+.014)
    def bar(x0,x1,z0,z1,front=-.165,depth=.095):
        rear=front-depth
        path.rect(g,'frame',x0,x1,z0,z1,front)
        if mobile:
            if front>-.18:
                if z1-z0>x1-x0:
                    xx=x1 if (x0+x1)<a+b else x0
                    g.poly('frame',[path.at(xx,z0,rear),path.at(xx,z0,front),path.at(xx,z1,front),path.at(xx,z1,rear)])
                else:
                    zz=z1 if z0+z1<2*z+h else z0
                    g.poly('frame',[path.at(x0,zz,rear),path.at(x1,zz,rear),path.at(x1,zz,front),path.at(x0,zz,front)])
        else:
            for xx in (x0,x1):g.poly('frame',[path.at(xx,z0,rear),path.at(xx,z0,front),path.at(xx,z1,front),path.at(xx,z1,rear)])
        if not mobile:
            for zz in (z0,z1):g.poly('frame',[path.at(x0,zz,rear),path.at(x1,zz,rear),path.at(x1,zz,front),path.at(x0,zz,front)])
            if x1-x0>z1-z0:path.rect(g,'frameLip',x0,x1,z1-.012,z1,front+.009)
            else:path.rect(g,'frameLip',x0,x0+.012,z0,z1,front+.009)
    for x,y in [(a,a+fw),(b-fw,b)]:bar(x,y,z,z+h)
    for zz in [z,z+h-fw]:bar(a+fw,b-fw,zz,zz+fw)
    # A wide sash has a narrow fixed side light; tall dining glazing also
    # retains its taller transom instead of inheriting the dormitory sash.
    transom=z+h*(.70 if h>2 else .43)
    if b-a>1.38:
        mull=a+(b-a)*(.29 if seed%3 else .5);bar(mull-.025,mull+.025,z+fw,z+h-fw,front=-.19,depth=.07)
        bar(mull+.025,b-fw,transom,transom+.045,front=-.183,depth=.075)
    else:bar(a+fw,b-fw,transom,transom+.045,front=-.183,depth=.075)
    # A solid sloped sill casts a distinct drip shadow beyond the brick face.
    aa=a-.055;bb=b+.055
    ps=[path.at(aa,z-.02,-.29),path.at(bb,z-.02,-.29),path.at(bb,z-.055,.14),path.at(aa,z-.055,.14),path.at(aa,z-.13,.13),path.at(bb,z-.13,.13)]
    g.poly('stone',ps[:4]);g.poly('stone',[ps[3],ps[2],ps[5],ps[4]])
    if not mobile:
        g.poly('stone',[ps[0],ps[3],ps[4],path.at(aa,z-.11,-.29)]);g.poly('stone',[ps[1],path.at(bb,z-.11,-.29),ps[5],ps[2]])

def wall(g,points,z0,z1,mobile,material='brick',windows=True,bottom=None,pitch=2.8,wide=1.52,rows=None):
    p=PathLine(points);L=p.length
    if L<.05:return
    if rows is None:rows=[(BASE+1.85+i*3.02,1.42) for i in range(6)]
    # Sloping stair underside uses narrow columns clipped against its plane.
    count=max(1,round(L/pitch));actual=L/count
    def panel(a,b,low,high):
        if b-a<.0001 or high-low<.0001:return
        if bottom and low<max(bottom(a/L),bottom(b/L)):
            za=max(low,bottom(a/L));zb=max(low,bottom(b/L))
            if max(za,zb)<high:g.poly(material,[p.at(a,za),p.at(b,zb),p.at(b,high),p.at(a,high)],[(a/12,za/6),(b/12,zb/6),(b/12,high/6),(a/12,high/6)])
        else:p.rect(g,material,a,b,low,high)
    for j in range(count):
        a=j*actual;b=(j+1)*actual;wa=(a+b-wide)/2;wb=(a+b+wide)/2
        if not windows or actual<wide+.06:wa=wb=(a+b)/2
        zbot=max(z0,bottom(a/L),bottom(b/L)) if bottom else z0
        prev=z0
        rowset=rows
        if bottom:
            # The lowest windows climb with the stair flights, while the
            # horizontal communal bands remain above them (MIT north photos).
            low=max(zbot+.22,BASE+.9+math.floor((zbot-BASE)/.6)*.6)
            rowset=[(low,1.42)]+[(s,h) for s,h in rows if s>low+2.1]
        for ri,(sill,h) in enumerate(rowset):
            if sill<zbot+.13 or sill+h>z1-.32:continue
            panel(a,b,prev,sill)
            panel(a,wa,sill,sill+h);panel(wb,b,sill,sill+h)
            if wb>wa:window(g,p,wa,wb,sill,h,mobile,j+ri*17)
            prev=sill+h
        panel(a,b,prev,z1)
    if bottom:
        # Continuous dark underside, with the actual low-rise core behind it.
        for j in range(count):
            a=j*actual;b=(j+1)*actual;za=max(z0,bottom(a/L));zb=max(z0,bottom(b/L));g.poly('tile',[p.at(a,za),p.at(b,zb),p.at(b,zb,-4.2),p.at(a,za,-4.2)])
        inside=[p.at(s,0,-4.2) for s in p.ds];wall(g,inside,BASE,z1,mobile,'brick',True,pitch=2.5,wide=1.55)
    # Roof upstand / metal cap follow original footprint.
    p.rect(g,'coping',0,L,z1,z1+.17,.015)
    for a,b in zip(p.ds,p.ds[1:]):g.poly('coping',[p.at(a,z1+.17,.04),p.at(b,z1+.17,.04),p.at(b,z1+.17,-.25),p.at(a,z1+.17,-.25)])
    return p

def chaikin(points):
    pts=[Vector(p) for p in points]
    for _ in range(2):
        out=[pts[0]]
        for a,b in zip(pts,pts[1:]):out.extend([a*.75+b*.25,a*.25+b*.75])
        out.append(pts[-1]);pts=out
    return pts

ENTRY_ORIGIN=(V[83]+V[86])*.5
ENTRY_U=Vector((V[86].x-V[83].x,V[86].y-V[83].y,0)).normalized()
ENTRY_N=Vector((ENTRY_U.y,-ENTRY_U.x,0))
def entry_point(s,d,h=0):
    return Vector((ENTRY_ORIGIN.x,ENTRY_ORIGIN.y,BASE+h))+ENTRY_U*s+ENTRY_N*d
def entry_world(s,d,h=0):
    p=entry_point(s,d,h);return [round(p.x,6),round(p.z,6),round(-p.y,6)]
ENTRY_TERRAIN=json.loads((HERE/'entry-terrain.json').read_text())['triangles']
def cross2(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def terrain_plane(tri,s,d):
    a,b,c=tri;area=cross2(a,b,c)
    u=cross2((s,d),b,c)/area;v=cross2(a,(s,d),c)/area;w=1-u-v
    return u*a[2]+v*b[2]+w*c[2],min(u,v,w)
def terrain_y(s,d):
    hits=[terrain_plane(t,s,d) for t in ENTRY_TERRAIN if abs(cross2(*t))>1e-8]
    hit=next((h for h,w in hits if w>=-1e-5),None)
    if hit is None:raise ValueError(f'Entrance point outside snapshotted terrain: {s},{d}')
    return hit
ENTRY_FOOT_Y=max(terrain_y(s,3.05) for s in (-2.2,0,2.2))+.025
ENTRY_DOOR_Y=ENTRY_FOOT_Y+.6
ENTRY_RAISE=ENTRY_DOOR_Y-(BASE+.55)
def clip_to_triangle(poly,tri):
    tri=tri if cross2(*tri)>0 else tri[::-1]
    for a,b in zip(tri,tri[1:]+tri[:1]):
        result=[]
        for p,q in zip(poly,poly[1:]+poly[:1]):
            hp=cross2(a,b,p);hq=cross2(a,b,q)
            if hp>=-1e-7:result.append(p)
            if (hp>1e-7 and hq< -1e-7) or (hp< -1e-7 and hq>1e-7):
                k=hp/(hp-hq);result.append((p[0]+(q[0]-p[0])*k,p[1]+(q[1]-p[1])*k))
        poly=result
        if not poly:break
    return poly

def split_polygon(poly,a,b,keep_inside=True):
    out=[]
    for p,q in zip(poly,poly[1:]+poly[:1]):
        hp=cross2(a,b,p)*(1 if keep_inside else -1);hq=cross2(a,b,q)*(1 if keep_inside else -1)
        if hp>=-1e-8:out.append(p)
        if hp*hq< -1e-14:
            k=hp/(hp-hq);out.append((p[0]+(q[0]-p[0])*k,p[1]+(q[1]-p[1])*k))
    return out
def triangles2d(poly):
    pts=[Vector((s,d,0)) for s,d in poly]
    return [[tuple((pts[i] if isinstance(i,int) else i)[:2]) for i in t] for t in tessellate_polygon([pts])]
def subtract_triangle(poly,tri):
    if max(p[0] for p in poly)<min(p[0] for p in tri) or min(p[0] for p in poly)>max(p[0] for p in tri) or max(p[1] for p in poly)<min(p[1] for p in tri) or min(p[1] for p in poly)>max(p[1] for p in tri):return [poly]
    tri=tri if cross2(*tri)>0 else tri[::-1];out=[]
    for a,b in zip(tri,tri[1:]+tri[:1]):
        piece=split_polygon(poly,a,b,False)
        if len(piece)>2:out.append(piece)
        poly=split_polygon(poly,a,b)
        if len(poly)<3:break
    return out

def entry_local(x,z):
    v=Vector((x-ENTRY_ORIGIN.x,-z-ENTRY_ORIGIN.y,0));return (v.dot(ENTRY_U),v.dot(ENTRY_N))
COURT_PLAN=json.loads((HERE/'entry-plan.json').read_text())
COURT_OUTER=[entry_local(*p) for p in COURT_PLAN['outerXZ']]
TREE_ISLAND=[entry_local(*p) for p in COURT_PLAN['treeIslandXZ']]
LONG_WALL=[(-15.07,18.65),(-12.30,18.92),(-12.12,18.88),(-3.46,7.79),(-3.39,7.60),(-3.36,5.96),(-3.45,5.78),(-5.26,4.41)]
LEFT_BED=[(-5.42,4.6),(-3.58,5.96),(-3.62,7.60),(-12.38,18.70),(-14.85,18.43),(-11.75,12.0),(-8.25,6.5),(-6.15,6.05)]
RIGHT_BED=[(4.95,-2.2),(9.4,-2.2),(9.4,.16),(5.1,.16)]

def north_court(materials,mobile):
    """Photograph-informed entrance court, distinct from surveyed building.

    s is right when facing the door; d is northeast/outward. The unobstructed
    central route and unequal raised beds follow the MIT Guide photograph.
    No vegetation or broad replacement terrain is exported by this model.
    """
    ground=Geo();walls=Geo();detail=Geo()
    def flat(g,mat,poly,h):
        pts=[entry_point(s,d,h(s,d) if callable(h) else h) for s,d in poly]
        # Tessellate first so concave court pieces cannot cross the beds.
        for tri in tessellate_polygon([pts]):
            ps=[pts[i] for i in tri] if isinstance(tri[0],int) else tri
            if (ps[1]-ps[0]).cross(ps[2]-ps[0]).z<0:ps=list(reversed(ps))
            g.poly(mat,ps,[((p-Vector((ENTRY_ORIGIN.x,ENTRY_ORIGIN.y,0))).dot(ENTRY_U)/4.86,(p-Vector((ENTRY_ORIGIN.x,ENTRY_ORIGIN.y,0))).dot(ENTRY_N)/4.86) for p in ps] if mat=='paver' else None)
    def rect(g,mat,a,b,c,d,h):flat(g,mat,[(a,c),(b,c),(b,d),(a,d)],h)
    def box(g,mat,a,b,c,d,z0,z1):
        rect(g,mat,a,b,c,d,z1)
        for p,q in [((a,c),(b,c)),((b,c),(b,d)),((b,d),(a,d)),((a,d),(a,c))]:
            length=math.dist(p,q);g.poly(mat,[entry_point(*p,z0),entry_point(*q,z0),entry_point(*q,z1),entry_point(*p,z1)],[(0,z0/6),(length/12,z0/6),(length/12,z1/6),(0,z1/6)])
    def height(s,d):return terrain_y(s,d)-BASE+.025
    def paving(poly):
        # Clip every convex paving patch to the original terrain triangles.
        # This preserves slopes and prevents a broad chord clipping the lawn.
        for tri in ENTRY_TERRAIN:
            if abs(cross2(*tri))<1e-8:continue
            cut=clip_to_triangle(poly,tri)
            if len(cut)>2:flat(ground,'paver',cut,lambda s,d:terrain_plane(tri,s,d)[0]-BASE+.025)
    # Subtract planting areas and the stair/landing footprint before projecting.
    # No buried paving sits beneath soil, and no triangle spans the tree island.
    pieces=triangles2d(COURT_OUTER)
    annex=[entry_local(V[i].x,-V[i].y) for i in boundary(7.2447399543)[0]]
    for hole in [TREE_ISLAND,LEFT_BED,RIGHT_BED,[(-2.2,-.08),(2.2,-.08),(2.2,3.45),(-2.2,3.45)],annex]:
        for cut in triangles2d(hole):pieces=[part for piece in pieces for part in subtract_triangle(piece,cut)]
    for piece in pieces:paving(piece)
    # Four solid continuous risers, with a level top landing at the existing
    # raised door threshold. There are no floating stair plates or lawn gaps.
    for k in range(4):
        front=3.05-k*.31;back=front-.31;top=ENTRY_FOOT_Y-BASE+(k+1)*.15
        box(ground,'stone',-2.2,2.2,back,front,0,top)
        if not mobile:box(detail,'coping',-2.16,2.16,front-.045,front-.028,top-.018,top-.011)
    box(ground,'stone',-2.2,2.2,-.08,1.81,0,ENTRY_DOOR_Y-BASE)
    flat(ground,'paver',[(-2.2,3.05),(2.2,3.05),(2.2,3.45),(-2.2,3.45)],lambda s,d:(ENTRY_FOOT_Y-BASE)*(3.45-d)/.4+height(s,3.45)*(d-3.05)/.4)
    def border(g,mat,path,width,top,cap=False,closed=False):
        ps=[Vector((s,d,0)) for s,d in path];normals=[]
        for i,p in enumerate(ps):
            a=ps[(i-1)%len(ps)] if closed or i else ps[0];b=ps[(i+1)%len(ps)] if closed or i<len(ps)-1 else ps[-1]
            tangent=(b-a).normalized();normals.append(Vector((-tangent.y,tangent.x,0))*width/2)
        pairs=list(zip(range(len(ps)-1),range(1,len(ps))))+([(len(ps)-1,0)] if closed else [])
        for i,j in pairs:
            a,b=ps[i],ps[j];n0,n1=normals[i],normals[j];quad=[a-n0,b-n1,b+n1,a+n0];poly=[(p.x,p.y) for p in quad]
            h=lambda s,d:top(s,d) if callable(top) else top
            flat(g,mat,poly,h)
            for p,q in zip(poly,poly[1:]+poly[:1]):
                hp,hq=h(*p),h(*q);lo=min(hp,hq)-.07 if cap else min(terrain_y(*p),terrain_y(*q))-BASE-.04;length=math.dist(p,q)
                g.poly(mat,[entry_point(*p,lo),entry_point(*q,lo),entry_point(*q,hq),entry_point(*p,hp)],[(0,lo/6),(length/12,lo/6),(length/12,hq/6),(0,hp/6)])
    # Source-GIS wall centerline, with photograph-based 300 mm brick thickness.
    # Its original top elevation is retained; the model no longer has a broad
    # featureless white strip where the planted retaining wall should be.
    border(walls,'brick',LONG_WALL,.30,3.73024-BASE)
    border(walls,'brick',LONG_WALL,.34,3.77024-BASE,cap=True)
    flat(ground,'soil',LEFT_BED,3.55-BASE)
    # The short bed beside the stairs is a separate planted terrace, with a
    # 600 mm front wall, rather than an invented symmetric twin of the long bed.
    border(walls,'brick',[(5.1,.32),(9.4,.32),(9.4,-2.2)],.30,3.76-BASE)
    flat(ground,'soil',RIGHT_BED,3.58-BASE)
    # Low concrete edging follows the tree-island plan and preserves its open
    # circulation on the east/door side. Soil follows the existing ground.
    border(ground,'stone',TREE_ISLAND,.14,lambda s,d:height(s,d)+.07,closed=True)
    for piece in triangles2d(TREE_ISLAND):
        for tri in ENTRY_TERRAIN:
            cut=clip_to_triangle(piece,tri)
            if len(cut)>2:flat(ground,'soil',cut,lambda s,d:terrain_plane(tri,s,d)[0]-BASE+.045)
    # Thin ground-flush edging at the slanted street boundary.
    street=[entry_local(*p) for p in COURT_PLAN['streetEdgeXZ']]
    # Amherst's concrete sidewalk belongs to the scene. Do not run a straight
    # curb across the independently planted island where it meets that walk.
    ground_obs=ground.objects(materials,'Baker north court ground')
    wall_obs=walls.objects(materials,'Baker north court retaining wall')
    detail_obs=detail.objects(materials,'Baker north court stair nosing')
    for ob in ground_obs:
        # The general manifold normal pass can choose the underside for open
        # paving/soil sheets and open-bottom stair solids. Walkable faces must
        # explicitly point upward in Blender (therefore +Y in glTF).
        bm=bmesh.new();bm.from_mesh(ob.data);bm.normal_update()
        bmesh.ops.reverse_faces(bm,faces=[f for f in bm.faces if f.normal.z<-.5]);bm.to_mesh(ob.data);bm.free();ob.data.update()
        ob['mitResidenceGround']=True;ob['bakerNorthCourt']=True
    for ob in wall_obs:ob['mitResidenceWall']=True;ob['bakerNorthCourt']=True
    return ground_obs+wall_obs+detail_obs

def create(mobile):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    materials=mats(mobile);g=Geo();ring=boundary(ROOF)[0]
    start=ring.index(198);end=ring.index(226)
    southids=ring[start:end+1];south=[V[j] for j in southids]
    # Keep the long west straight and east straight; subdivide only the survey's curved elbow points.
    curve=chaikin(south[1:-1]);south=[south[0]]+curve+[south[-1]]
    newring=[V[j] for j in ring[:start]]+south+[V[j] for j in ring[end+1:]]
    g.cap('roof',[Vector((p.x,p.y,ROOF)) for p in newring])
    wall(g,south,BASE,ROOF,mobile,pitch=2.72,wide=1.42)
    # North/east/west edges stay tied directly to survey. Two north arms hang over the entrance side.
    other=ring[end:]+ring[:start+1]
    for a,b in zip(other,other[1:]):
        stair=(a,b) in ((133,136),(137,139))
        bottom=(lambda t:BASE+4.2+(1-t)*9.5) if (a,b)==(133,136) else ((lambda t:BASE+4.2+t*9.5) if (a,b)==(137,139) else None)
        center=(a,b)==(136,137)
        wall(g,[V[a],V[b]],BASE,ROOF,mobile,'tile' if stair or center else 'brick',True,bottom=bottom,pitch=1.52 if stair or center else 2.75,wide=1.33 if stair or center else 1.48)
    # Keep source measured rooftop rooms and annexes, but supply actual glazing where visible.
    for lev in [24.3447399543,24.5447399543,26.3447399543,24.4447399543,25.6447399543,7.2447399543,7.7447399543,8.6447399543,8.1447399543]:
        for ids in boundary(lev):
            pts=[V[i] for i in ids];area=sum(p.x*q.y-q.x*p.y for p,q in zip(pts,pts[1:]+pts[:1]))
            if area<0:pts.reverse()
            floor=ROOF if lev>20 else BASE
            if lev>25:floor=24.54474 if lev>26 else 24.44474
            if abs(lev-8.64474)<.1:floor=4.74474
            g.cap('roof',[Vector((p.x,p.y,lev)) for p in pts])
            for p,q in zip(pts,pts[1:]+pts[:1]):
                row=[(floor+.4,max(.65,lev-floor-1.05))] if lev<10 else []
                north_entry=abs(lev-7.24474)<.1
                door_edge=north_entry and abs((p.x+q.x)/2+293.61)<.2 and abs((p.y+q.y)/2+251.20)<.2
                if north_entry:row=[(ENTRY_DOOR_Y,2.6)] if door_edge else [(BASE+1.2,1.35)]
                wall(g,[p,q],floor,lev,mobile,'brick' if north_entry else 'stone',True,pitch=5 if door_edge else 2.65,wide=2.3 if door_edge else (2.15 if lev<10 else 1.1),rows=row)
                if lev>20 and (q-p).length>4 and q.x>p.x:
                    roofwall=PathLine([p,q]);mid=roofwall.length/2
                    roofwall.rect(g,'dark',mid-.45,mid+.45,floor+.7,floor+1.17,.01)
                    for zz in [floor+.72+i*.085 for i in range(6)]:roofwall.rect(g,'coping',mid-.45,mid+.45,zz,zz+.025,.04)
                if door_edge:
                    entry=PathLine([p,q]);mid=entry.length/2
                    entry.rect(g,'door',mid-1.08,mid+1.08,ENTRY_DOOR_Y,BASE+3.1+ENTRY_RAISE,-.22)
                    for cx in [mid-.55,mid+.55]:
                        entry.rect(g,'glass',cx-.34,cx+.34,BASE+1.5+ENTRY_RAISE,BASE+2.85+ENTRY_RAISE,-.205)
                        entry.rect(g,'frame',cx+.3,cx+.34,BASE+1.2+ENTRY_RAISE,BASE+1.6+ENTRY_RAISE,-.16)
                    u=(q-p).normalized();c=entry.at(mid,BASE+3.45+ENTRY_RAISE,.8)
                    g.box('coping',c,u,UP,5.4,.25,2.1)
                    for side in (-1,1):g.box('coping',entry.at(mid+side*2.08,ENTRY_DOOR_Y+1.45,1.5),u,UP,.16,2.9,.16)
    # Low dining terrace below the double-height limestone pavilion.
    dining=[Vector((-323.11,-284.07,BASE)),Vector((-303.65,-294.54,BASE)),Vector((-294.4,-279.14,BASE)),Vector((-310.07,-270.34,BASE))]
    g.cap('roof',[Vector((p.x,p.y,4.74474)) for p in dining])
    for p,q in zip(dining,dining[1:]+dining[:1]):wall(g,[p,q],BASE,4.74474,mobile,'stone',True,pitch=2.8,wide=2.0,rows=[(BASE+.25,1.35)])
    # Aalto's moon-garden rooflights are distinctive clustered circular roof elements.
    o=Vector((-315.44,-284.77,8.64474));u=Vector((10.74,-6.44,0)).normalized();v=Vector((6.31,11.05,0)).normalized()
    for ix in range(5):
        for iy in range(5):
            c=o+u*(1.35+ix*2.25)+v*(1.45+iy*2.1)
            seg=12 if mobile else 20
            g.cyl('coping',c,.44,.065,seg);g.cyl('stone',c+UP*.06,.23,.22,seg)
            g.lathe('stone',c,[(.23,.22),(.39,.30),(.43,.40),(.36,.53),(.20,.61),(0,.64)],seg)
            if not mobile:
                # White angled light guards are visible in the roof photograph.
                g.box('frameLip',c+v*.4+UP*.7,u,UP,.055,.6,.055)
                g.box('frameLip',c+v*.15+UP*.99,u,v,.055,.55,.055)
    # Rooftop pergolas and chimney heads, retained in both silhouette LODs.
    for center,angle,w in [((-344.7,-303.5,24.34474),.95,6.1),((-310.5,-264.8,24.44474),.45,9.2),((-269.5,-258.3,24.44474),-.52,11.0)]:
        c=Vector(center);u=Vector((math.cos(angle),math.sin(angle),0));n=Vector((-u.y,u.x,0))
        for k in range(7):g.box('stone',c+u*((k/6-.5)*w)+n*1.1,u,n,.15,3.1,.17)
        for s in (-1,1):g.box('stone',c+u*s*w/2+n*2.2-UP*1,u,UP,.16,2.0,.16)
    for pos in [(-333,-286),(-319,-268),(-279,-260)]:
        c=Vector((*pos,ROOF));g.cyl('coping',c,.28,.8,10);g.cyl('coping',c+UP*.8,.45,.18,10)
    # Fine tapered props beneath the high ends of the hanging staircases.
    for a,b in [(133,136),(137,139)]:
        pa=PathLine([V[a],V[b]]);t=.07 if a==133 else .93;c=pa.at(pa.length*t,BASE+9.2,-.65)
        u=(pa.ps[-1]-pa.ps[0]).normalized();n=Vector((u.y,-u.x,0));low=c-UP*2.2;top=c+UP*2.2
        g.poly('stone',[low-u*.09,low+u*.09,top+u*.42,top-u*.42])
        g.poly('stone',[low+n*.12,low-u*.09,top-u*.42,top+n*.42])
    obs=g.objects(materials,'Baker')+north_court(materials,mobile)
    for ob in obs:ob['mitResidence']='baker';ob['exteriorOnly']=True
    # Simplified measured shell is collision-only; runtime hides it but raycasts its actual envelope.
    me=bpy.data.meshes.new('Baker collision survey');me.from_pydata([tuple(p) for p in V],[],F);me.update();co=bpy.data.objects.new('Baker collision only',me);bpy.context.collection.objects.link(co);me.materials.append(materials['collision']);co['mitResidenceWall']=True;co['mitResidenceCollisionOnly']=True;co['mitResidence']='baker';co.hide_render=True
    return obs,co

def look(cam,pt):cam.rotation_euler=(Vector(pt)-cam.location).to_track_quat('-Z','Y').to_euler()
def setup_render():
    s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=48;s.cycles.use_denoising=True;s.render.resolution_x=1600;s.render.resolution_y=1000;s.render.resolution_percentage=100;s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.69,.77,.87,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.65;s.view_settings.view_transform='AgX'
    bpy.ops.object.light_add(type='SUN',location=(-330,-350,100));sun=bpy.context.object;sun.rotation_euler=(.55,-.35,-.8);sun.data.energy=2.6;sun.data.angle=.12
    # Offline inspection backdrop only. It is created after GLB export and is
    # intentionally absent from both game assets, which use real campus terrain.
    bpy.ops.mesh.primitive_plane_add(size=350,location=(-300,-280,BASE-.01));plane=bpy.context.object;plane.name='PREVIEW ONLY neutral ground - excluded from GLB';plane['previewOnly']=True
    matte=bpy.data.materials.new('Preview neutral ground');matte.diffuse_color=(.36,.39,.37,1);plane.data.materials.append(matte)
    bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.clip_end=600;cam.data.type='ORTHO';cam.data.ortho_scale=126;cam.location=(-284,-407,77);look(cam,(-302,-279,13))
    return s,cam

def inspect_glb(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);tris=sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes'] for p in m['primitives']);calls=sum(len(m['primitives']) for m in d['meshes']);return {'bytes':len(raw),'triangles':tris,'drawCalls':calls,'meshes':len(d['meshes'])}

def compact_normals(path):
    """Losslessly keep positions/UVs/indices, quantize only unit normals.

    KHR_mesh_quantization is natively supported by the repository GLTFLoader.
    Four-byte aligned signed bytes bound angular error below half a degree.
    This keeps the extra window profiles within practical delivery budgets.
    """
    raw=path.read_bytes();jn=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+jn]);bn=struct.unpack_from('<I',raw,20+jn)[0];blob=raw[28+jn:28+jn+bn]
    normal_ids={p['attributes']['NORMAL'] for m in d['meshes'] for p in m['primitives'] if 'NORMAL' in p['attributes']};replace={}
    for aid in normal_ids:
        a=d['accessors'][aid];vi=a['bufferView'];view=d['bufferViews'][vi]
        assert a['componentType']==5126 and a['type']=='VEC3'
        assert sum(x.get('bufferView')==vi for x in d['accessors'])==1
        stride=view.get('byteStride',12);offset=view.get('byteOffset',0)+a.get('byteOffset',0);buf=bytearray()
        for i in range(a['count']):
            v=struct.unpack_from('<3f',blob,offset+i*stride);q=[max(-127,min(127,round(x*127))) for x in v];buf.extend(struct.pack('<3bB',*q,0))
        replace[vi]=bytes(buf);a['componentType']=5120;a['normalized']=True;a['byteOffset']=0;a.pop('min',None);a.pop('max',None);view['byteStride']=4
    packed=bytearray()
    for i,view in enumerate(d['bufferViews']):
        data=replace.get(i,blob[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]);packed.extend(b'\0'*((-len(packed))%4));view['byteOffset']=len(packed);view['byteLength']=len(data);packed.extend(data)
    for key in ('extensionsUsed','extensionsRequired'):
        if 'KHR_mesh_quantization' not in d.setdefault(key,[]):d[key].append('KHR_mesh_quantization')
    d['buffers'][0]['byteLength']=len(packed);j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);packed.extend(b'\0'*((-len(packed))%4))
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(packed))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(packed),b'BIN\0')+packed)

stats={};cameras={
 'south-overview':{'eye':[-284,-407,77],'target':[-302,-279,13],'scale':122},
 'north-stairs':{'eye':[-308,-164,51],'target':[-302,-275,13],'scale':113},
 'south-west':{'eye':[-409,-351,57],'target':[-302,-279,13],'scale':124},
 'window-close':{'eye':[-290,-304,4.37134],'target':[-291,-277,11.5],'scale':31,'perspective':True},
 'north-entry-walk':{'eye':[-277,-230,4.37134],'target':[-294,-251,8.5],'scale':31,'perspective':True},
 'north-court-detail':{'eye':list(entry_point(-1,25,4.8)),'target':list(entry_point(0,5,1.25)),'scale':31,'perspective':True},
 'north-court-plan':{'eye':list(entry_point(0,6,35)),'target':list(entry_point(0,6,0)),'scale':41},
}
for mobile in (False,True):
    obs,co=create(mobile);suffix='mobile' if mobile else 'full';path=OUT/f'baker-{suffix}.glb'
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs+[co]:ob.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_image_format='AUTO')
    compact_normals(path)
    stats[suffix]=inspect_glb(path)
    if not mobile:
        s,cam=setup_render()
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'baker-full.blend'),compress=True)
        for name,c in cameras.items():
            if '--entry-render' in ARGS and name not in ('north-entry-walk','north-court-detail','north-court-plan'):continue
            cam.location=c['eye'];cam.data.type='PERSP' if c.get('perspective') else 'ORTHO';cam.data.lens=48;cam.data.ortho_scale=c['scale'];look(cam,c['target']);s.render.filepath=str(HERE/(name+'.png'));bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'baker-mobile.blend'),compress=True)
metadata={'id':'baker','name':'Baker House / W7','axes':'Blender east,north,up; glTF east,up,south; identity runtime transform','source':SRC['source'],'sourceBounds':{'x':[min(p.x for p in V),max(p.x for p in V)],'z':[-max(p.y for p in V),-min(p.y for p in V)],'y':[BASE,max(p.z for p in V)]},'groundY':BASE,'mainRoofY':ROOF,'diningRoofY':8.64474,'floorSpacingM':3.02,'windowRecessM':.28,'scope':'Exterior only; no modeled accessible interior','sources':[{'url':'https://baker.mit.edu/about/','use':'six floors, serpentine river frontage, suspended stairs, dining pavilion'}, {'url':'https://listart.mit.edu/art-artists/baker-house-1949','use':'north stair tile cladding and window grouping'}, {'url':'https://news.mit.edu/2012/residential-hall-security-review-report','local':'references/north-mit-news.jpg','use':'north stair underside and glazing'}, {'local':'output/design/mit-20261021/references/baker.webp','use':'south shape, window proportions, roofing, dining skylights'}],'camerasBlender':cameras,'approachPoints':[{'label':'North entry approach, approximate','x':-290,'y':BASE,'z':247},{'label':'Memorial Drive facade viewpoint','x':-304,'y':BASE,'z':308}],'assumptions':['Window bay widths, frames, pergola dimensions and rooflight counts approximated from photographs.','Measured source supports overall outline and elevation; south curved elbows are smoothed within the source footprint tolerance.','North stair bottom slopes are photo-informed reconstruction; invisible original measured collision envelope intentionally blocks exterior entry.'],'outputs':stats}
metadata.update({'revision':'2026-10-23-realism-1','qualityStatus':'Stage iteration; offline model inspected, in-game visual acceptance still required','changes':['Planar three-dimensional aluminium frame extrusions, asymmetric sash lights and solid sloped projecting sills.','Separate semitransparent glass, recessed shading backing and varied roller blinds; no accessible interior is claimed.','225 x 75 mm water-struck brick coursing with warped mortar edges, normal relief and an independent roughness map.','North stair lower window sequence follows rising flights; source main envelope and base elevation retained.','Moon Garden light scoops have bell profiles, stems, flashing bases and full-detail guards.','Roof weathering and lap seams; unsupported repetitive rooftop room windows replaced with limited service vents.'],'lodPolicy':{'full':'Complete outer frame extrusions, highlight lips, gasket strips, sill end caps and rooflight guards.','mobile':'Preserves silhouette, recess, glazing, blind depth, frame inner return and sloped sill; omits narrow highlight lips, gaskets, sill ends and rooflight guards.'},'exportOptimization':'Only unit normals are quantized to aligned normalized signed bytes using KHR_mesh_quantization; positions, UVs and collision geometry are preserved.','knownGaps':['Individual room window positions and some north-brick opening groups remain photograph-informed approximations, not an exact facade survey.','Terracotta tile joints and limestone surface aging are not yet individually resolved.','Glass uses PBR alpha blending with a shallow shading backing; the runtime environment must supply reflections and lighting, and full physical transmission is not modeled.','North entrance appendage retains the survey volume; detailed as-built lobby footprint remains uncertain.','Landscaping, sidewalk, terrain and scene lighting are outside this building-only source and require the integrated scene review.'],'offlineEvidence':{'before':'before-realism/','after':['south-overview.png','north-stairs.png','south-west.png','window-close.png','north-entry-walk.png'],'kind':'Actual Blender model renders with a neutral preview ground, excluded from both GLBs.'}})
metadata['sources'].append({'url':'https://mitguidetoresidences.mit.edu/sites/default/files/header-background/7676815734_894a64a1c9_o.jpg','local':'assets-source/mit-residences/references/baker-mit-guide.jpg','use':'North stair stepped glazing and entrance canopy/door details'})
roots=[{'id':'long-bed-east','sd':[-10,13],'height':3.55},{'id':'long-bed-entry','sd':[-6,8],'height':3.55},{'id':'short-bed','sd':[7,-1],'height':3.58}]
for root in roots:root['world']=entry_world(*root['sd'],root['height']-BASE)
island_s,island_d=entry_local(-295.5,243.4)
roots.append({'id':'central-tree-island','sd':[island_s,island_d],'height':terrain_y(island_s,island_d)+.045,'world':entry_world(island_s,island_d,terrain_y(island_s,island_d)+.045-BASE)})
ground_probes=[{'label':'Door landing','world':entry_world(0,.75,ENTRY_DOOR_Y-BASE)}]
for k in range(4):ground_probes.append({'label':f'Riser {k+1} from toe','world':entry_world(0,3.05-k*.31-.155,ENTRY_FOOT_Y-BASE+(k+1)*.15)})
for d in (4,8,12):ground_probes.append({'label':f'Paved approach d={d}','world':entry_world(0,d,terrain_y(0,d)+.025-BASE)})
ground_probes.extend({'label':r['id']+' soil','world':r['world']} for r in roots)
court={'basis':COURT_PLAN['basis'],'uncertainty':COURT_PLAN['uncertainty'],'terrainSource':'entry-terrain.json, snapshotted original 2025 orthophotography triangles','surfaceLiftM':.025,'outerXZ':COURT_PLAN['outerXZ'],'treeIslandXZ':COURT_PLAN['treeIslandXZ'],'streetEdgeXZ':COURT_PLAN['streetEdgeXZ'],'longWallWorld':[entry_world(s,d,3.77024-BASE) for s,d in LONG_WALL],'plantingPolygons':[{'id':'long-bed','world':[entry_world(s,d,3.55-BASE) for s,d in LEFT_BED]},{'id':'short-bed','world':[entry_world(s,d,3.58-BASE) for s,d in RIGHT_BED]},{'id':'central-tree-island','world':[entry_world(s,d,terrain_y(s,d)+.045-BASE) for s,d in TREE_ISLAND]}],'plantingRootPoints':roots,'doorThresholdWorld':entry_world(0,0,ENTRY_DOOR_Y-BASE),'doorRaiseM':ENTRY_RAISE,'stepCount':4,'stepRiseM':.15,'stepGoingM':.31,'stepWidthM':4.4,'stairsFootWorld':entry_world(0,3.05,ENTRY_FOOT_Y-BASE),'groundProbePoints':ground_probes,'extras':{'ground':'mitResidenceGround:true','retainingWalls':'mitResidenceWall:true','siteMarker':'bakerNorthCourt:true','buildingCollider':'mitResidenceCollisionOnly:true and mitResidenceWall:true'}}
(HERE/'entry-layout.json').write_text(json.dumps(court,indent=2))
metadata['northCourt']=court;metadata['revision']='2026-10-24-north-entry';metadata['changes'].extend(['North entry brick court clipped exactly to existing terrain triangles, with the separate central tree island and oblique Amherst street edge.','Measured retaining-wall centerline rebuilt as brick with a cap; unequal raised planting beds retain ground/wall collision roles.','Four solid 150 mm risers, top landing and aligned door/canopy elevation above the actual campus terrain.'])
metadata['knownGaps'][-1]='Trees and shrubs are supplied by the integrated scene. Street-side court and planted-island boundaries are orthophoto estimates; original building and measured wall centerlines are retained. Game-level contact and lighting still require integrated review.'
metadata['lodPolicy']['full']+=' North entrance court, soil, retaining walls and continuous steps are fully present.'
metadata['lodPolicy']['mobile']+=' Same north court ground and wall geometry; only narrow stair nosing detail is omitted.'
metadata['offlineEvidence']['after'].extend(['north-court-detail.png','north-court-plan.png']);metadata['offlineEvidence']['beforeNorthCourt']='before-entry-20261024/'
metadata['sources'].append({'local':'assets-source/mit-residences/references/baker-north-entry-registered.png','use':'Registered orthophotography: oblique street edge, forecourt paving and separate planting island'})
(HERE/'metadata.json').write_text(json.dumps(metadata,indent=2));print(json.dumps(stats,indent=2))
