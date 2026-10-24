"""Ray-check the final GLBs' actual stataGround meshes, without the generator.

The frozen reference below records the audited survey footprint and the agreed
12-tier / 36-step layout. It is a test fixture, not an as-built CAD claim.
No build module or generator self-test is imported. Scene/node transforms are
applied before a vertical-ray BVH is constructed from marked ground triangles.

Run with ordinary Python, or Blender --python-exit-code 1 --python this-file --
--output output/stata-reconstruction-20261022. Both asset profiles are checked.
"""
from pathlib import Path
import argparse
import bisect
import hashlib
import json
import math
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT/'output/stata-reconstruction-20261022'
ASSETS = ROOT/'public/assets/mit-stata'
HEIGHT_TOLERANCE = .025
PLATFORM_TOLERANCE = .08
MAX_WALK_STEP = .20
FACET_BOUNDARY_DISTANCE = .04
BASE_Z, INNER_Z, OUTER_Z = 2.438439846, 2.931939840, 8.555439949
PLATFORM_Z = 8.37254
ROWS, SUBSTEPS = 12, 3
AISLES = (.27, .70)
LANE_OFFSETS = (-.32, 0., .32)

# Frozen survey vertices, east/north metres. The inner and outer arcs have
# different angular spans; interpolating one common semicircle is incorrect.
INNER_XY = [(176.8616,265.3213),(175.6663,265.9906),(174.1447,266.2171),
            (172.4790,266.0706),(171.0589,265.5815),(169.9981,264.4911),
            (169.1320,262.9045),(168.9699,261.3340),(169.3139,259.9054),
            (170.0656,258.6819),(171.0988,257.4646),(172.7255,256.8921),
            (174.1245,256.8368),(175.2359,257.0578),(176.2428,257.6249)]
OUTER_XY = [(177.6564,278.0007),(173.3736,278.4654),(170.2105,278.2362),
            (166.5809,276.9916),(163.7226,275.0455),(161.1476,272.7985),
            (159.3122,270.2649),(157.7661,267.4509),(156.7558,263.5261),
            (156.9942,259.3327),(157.9509,255.3880),(159.7220,252.2202),
            (162.2123,249.2421),(164.9654,247.1151),(168.0143,245.8186),
            (170.9674,244.9535),(174.7919,244.9186)]
INNER_CENTER = (173.744766235,261.576232910)
OUTER_CENTER = (173.632629395,261.632934570)


def _reference_arc(points, center, s, polygon=False):
    angles = [math.atan2(p[1]-center[1],p[0]-center[0]) % math.tau for p in points]
    angle = angles[0]+s*(angles[-1]-angles[0])
    i = max(0,min(len(points)-2,bisect.bisect_right(angles,angle)-1))
    t = (angle-angles[i])/(angles[i+1]-angles[i])
    a,b = points[i],points[i+1]
    if polygon:
        return tuple(a[k]+(b[k]-a[k])*t for k in range(2))
    ra,rb = math.dist(a,center),math.dist(b,center)
    r = ra+(rb-ra)*t
    return center[0]+r*math.cos(angle),center[1]+r*math.sin(angle)


def _reference_xy(q, s):
    inner = _reference_arc(INNER_XY,INNER_CENTER,s)
    outer = _reference_arc(OUTER_XY,OUTER_CENTER,s)
    edge = _reference_arc(OUTER_XY,OUTER_CENTER,s,polygon=True)
    dx,dy = outer[0]-inner[0],outer[1]-inner[1]
    return (inner[0]+dx*q+(edge[0]-outer[0])*q**8,
            inner[1]+dy*q+(edge[1]-outer[1])*q**8)


def reference_position(q, s, across=0.):
    x,north = _reference_xy(q,s)
    # Offset along the curved tread, not perpendicular to an assumed radial
    # aisle: the inner and outer arc angular spans differ substantially.
    a,b = _reference_xy(q,s-.0001),_reference_xy(q,s+.0001)
    tx,ty = b[0]-a[0],b[1]-a[1]
    length = math.hypot(tx,ty)
    x += tx/length*across
    north += ty/length*across
    # Exported glTF and Three use east/up/south, not Blender east/north/up.
    return x,-north


def seating_height(row):
    return BASE_Z if row == 0 else INNER_Z+(OUTER_Z-INNER_Z)*(row-1)/(ROWS-1)


def step_height(step):
    row,sub = divmod(step,SUBSTEPS)
    low,high = seating_height(row),seating_height(row+1)
    return low+(high-low)*(sub+1)/SUBSTEPS


def nearby_boundary_levels(q,aisle,lane):
    """Adjacent plateaus are valid only within 4cm of a nominal curved edge.

    Actual treads are chordal polygons. Dense samples beside a curved reference
    edge can land on the adjoining tread. The interior 15/50/85% samples remain
    strict, and misses or non-plateau heights are never excused by this rule.
    """
    boundary=round(q*36)
    if not 0<=boundary<=36:return []
    if math.dist(reference_position(q,aisle,lane),reference_position(boundary/36,aisle,lane))>FACET_BOUNDARY_DISTANCE:return []
    low=BASE_Z if boundary==0 else step_height(boundary-1)
    high=PLATFORM_Z if boundary==36 else step_height(boundary)
    return [(low,HEIGHT_TOLERANCE),(high,PLATFORM_TOLERANCE if boundary==36 else HEIGHT_TOLERANCE)]


def read_glb(path):
    data = path.read_bytes()
    if len(data)<20 or struct.unpack_from('<III',data)!=(0x46546c67,2,len(data)):
        raise ValueError('Invalid GLB header or total length')
    offset,doc,blob = 12,None,None
    while offset<len(data):
        size,kind = struct.unpack_from('<II',data,offset)
        offset+=8
        if size%4 or offset+size>len(data):
            raise ValueError('Invalid GLB chunk length')
        part=data[offset:offset+size]
        if kind==0x4e4f534a:doc=json.loads(part)
        elif kind==0x004e4942:blob=part
        offset+=size
    if doc is None or blob is None:raise ValueError('GLB JSON or binary chunk missing')
    return doc,blob,hashlib.sha256(data).hexdigest()


def accessor(doc,blob,index):
    a=doc['accessors'][index]
    if 'sparse' in a:raise ValueError('Sparse ground accessors are unsupported')
    v=doc['bufferViews'][a['bufferView']]
    if v.get('buffer',0)!=0:raise ValueError('Expected embedded buffer 0')
    width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    component={5126:'f',5125:'I',5123:'H',5121:'B',5122:'h',5120:'b'}[a['componentType']]
    fmt='<'+component*width;size=struct.calcsize(fmt);stride=v.get('byteStride',size)
    start=v.get('byteOffset',0)+a.get('byteOffset',0)
    if stride<size or start+(a['count']-1)*stride+size>len(blob):raise ValueError('Ground accessor exceeds buffer')
    return [struct.unpack_from(fmt,blob,start+i*stride) for i in range(a['count'])]


IDENTITY=tuple(tuple(float(i==j) for j in range(4)) for i in range(4))


def multiply(a,b):
    return tuple(tuple(sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)) for i in range(4))


def local_matrix(node):
    if 'matrix' in node:
        m=node['matrix']
        return tuple(tuple(m[r+4*c] for c in range(4)) for r in range(4))
    x,y,z,w=node.get('rotation',(0,0,0,1));s=node.get('scale',(1,1,1));t=node.get('translation',(0,0,0))
    r=((1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)),
       (2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)),
       (2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)))
    return tuple(tuple(r[i][j]*s[j] for j in range(3))+(t[i],) for i in range(3))+((0.,0.,0.,1.),)


def transform(m,p):
    return tuple(sum(m[i][j]*p[j] for j in range(3))+m[i][3] for i in range(3))


class GroundTriangle:
    def __init__(self,a,b,c,node):
        self.a,self.b,self.c,self.node=a,b,c,node
        self.bounds=(min(a[0],b[0],c[0]),min(a[2],b[2],c[2]),max(a[0],b[0],c[0]),max(a[2],b[2],c[2]))
        self.den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])

    def hit(self,x,z):
        a,b,c=self.a,self.b,self.c
        u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/self.den
        v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/self.den
        w=1-u-v
        if min(u,v,w)<-1e-6:return None
        y=u*a[1]+v*b[1]+w*c[1]
        return (y,self.node) if y<=100 else None


class GroundBVH:
    """Median-split X/Z AABB hierarchy specialized for downward ground rays."""
    def __init__(self,triangles):
        if not triangles:raise ValueError('No upward-facing stataGround triangles')
        self.bounds=(min(t.bounds[0] for t in triangles),min(t.bounds[1] for t in triangles),
                     max(t.bounds[2] for t in triangles),max(t.bounds[3] for t in triangles))
        self.children=None;self.triangles=None
        if len(triangles)<=24:self.triangles=triangles
        else:
            axis=0 if self.bounds[2]-self.bounds[0]>=self.bounds[3]-self.bounds[1] else 1
            ordered=sorted(triangles,key=lambda t:t.bounds[axis]+t.bounds[axis+2]);mid=len(ordered)//2
            self.children=(GroundBVH(ordered[:mid]),GroundBVH(ordered[mid:]))

    def ray(self,x,z):
        b=self.bounds
        if x<b[0]-1e-7 or x>b[2]+1e-7 or z<b[1]-1e-7 or z>b[3]+1e-7:return None
        hits=(child.ray(x,z) for child in self.children) if self.children else (t.hit(x,z) for t in self.triangles)
        return max((h for h in hits if h is not None),default=None,key=lambda h:h[0])


def exported_ground(doc,blob):
    nodes=doc.get('nodes',[]);triangles=[];ground_nodes=[];skipped=0
    scenes=doc.get('scenes',[])
    if not scenes:raise ValueError('No active glTF scene')
    roots=scenes[doc.get('scene',0)].get('nodes',[])
    def visit(index,parent,ancestors):
        nonlocal skipped
        if index in ancestors:raise ValueError('Cycle in glTF node hierarchy')
        n=nodes[index];world=multiply(parent,local_matrix(n))
        if not all(math.isfinite(c) for row in world for c in row):raise ValueError('Nonfinite node transform')
        if 'mesh' in n:
            mesh=doc['meshes'][n['mesh']]
            marked=n.get('extras',{}).get('stataGround') is True or mesh.get('extras',{}).get('stataGround') is True
            if marked:
                ground_nodes.append({'index':index,'name':n.get('name',mesh.get('name','<unnamed>'))})
                for p in mesh['primitives']:
                    if p.get('mode',4)!=4:raise ValueError('Ground primitive is not TRIANGLES')
                    pos=[transform(world,v) for v in accessor(doc,blob,p['attributes']['POSITION'])]
                    if not all(math.isfinite(c) for v in pos for c in v):raise ValueError('Nonfinite transformed ground position')
                    idx=[x[0] for x in accessor(doc,blob,p['indices'])] if 'indices' in p else list(range(len(pos)))
                    if len(idx)%3 or any(i<0 or i>=len(pos) for i in idx):raise ValueError('Invalid ground index buffer')
                    for k in range(0,len(idx),3):
                        a,b,c=[pos[i] for i in idx[k:k+3]]
                        u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
                        normal=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
                        length=math.sqrt(sum(t*t for t in normal))
                        # A downward ray must hit a front-facing walkable top,
                        # never a reversed underside or a vertical rail face.
                        if length<1e-10 or normal[1]/length<.5:
                            skipped+=1;continue
                        triangles.append(GroundTriangle(a,b,c,index))
        for child in n.get('children',[]):visit(child,world,ancestors|{index})
    for index in roots:visit(index,IDENTITY,set())
    if not ground_nodes:raise ValueError('No active scene mesh is tagged stataGround')
    return GroundBVH(triangles),ground_nodes,len(triangles),skipped


def verify_asset(path):
    doc,blob,sha=read_glb(path)
    bvh,nodes,count,skipped=exported_ground(doc,blob)
    errors=[];failed=0;samples=0;misses=0;worst=0.;boundary_matches=0;hit_nodes=set();aisle_reports=[]
    def check(label,x,z,expected,tolerance=HEIGHT_TOLERANCE,alternatives=()):
        nonlocal failed,samples,misses,worst,boundary_matches
        samples+=1;hit=bvh.ray(x,z)
        targets=[(expected,tolerance)]+list(alternatives)
        error=None if hit is None else min(abs(hit[0]-target) for target,_ in targets)
        accepted=hit is not None and any(abs(hit[0]-target)<=limit for target,limit in targets)
        if accepted and abs(hit[0]-expected)>tolerance:boundary_matches+=1
        if hit is not None:hit_nodes.add(hit[1]);worst=max(worst,error)
        else:misses+=1
        if not accepted:
            failed+=1
            if len(errors)<96:errors.append({'sample':label,'x':x,'z':z,'expectedHeight':expected,'boundaryAlternatives':[target for target,_ in alternatives],'hitHeight':None if hit is None else hit[0],'heightError':error})
        return hit
    for aisle in AISLES:
        aisle_max_rise=aisle_max_drop=0.;distinct=set();start_failed=failed
        for lane in LANE_OFFSETS:
            # Three points along every tread, across three walking lanes.
            for step in range(ROWS*SUBSTEPS):
                for phase in (.15,.5,.85):
                    x,z=reference_position((step+phase)/36,aisle,lane)
                    check(f'aisle {aisle} lane {lane} step {step+1} phase {phase}',x,z,step_height(step))
            previous=None
            for i in range(360):
                q=(i+.5)/360;step=int(q*36);x,z=reference_position(q,aisle,lane)
                hit=check(f'continuous aisle {aisle} lane {lane} q {q:.5f}',x,z,step_height(step),alternatives=nearby_boundary_levels(q,aisle,lane))
                if hit is not None:
                    actual_step=min(range(36),key=lambda k:abs(hit[0]-step_height(k)))
                    if abs(hit[0]-step_height(actual_step))<=HEIGHT_TOLERANCE:distinct.add(actual_step)
                    if previous is not None:
                        delta=hit[0]-previous
                        aisle_max_rise=max(aisle_max_rise,delta);aisle_max_drop=max(aisle_max_drop,-delta)
                        at_platform=math.dist((x,z),reference_position(1.,aisle,lane))<=FACET_BOUNDARY_DISTANCE
                        if delta>MAX_WALK_STEP or delta < (-MAX_WALK_STEP if at_platform else -HEIGHT_TOLERANCE):
                            failed+=1
                            if len(errors)<96:errors.append({'sample':'continuous stair discontinuity','aisle':aisle,'lane':lane,'q':q,'delta':delta})
                    previous=hit[0]
                else:previous=None
            # Test the actual stage and courtyard transitions as a continuous
            # path too; a correct isolated stair floating above ground fails.
            for qa,qb in ((-.06,.04),(.96,1.06)):
                previous=None
                for i in range(60):
                    q=qa+(i+.5)*(qb-qa)/60
                    expected=BASE_Z if q<0 else PLATFORM_Z if q>1 else step_height(min(35,int(q*36)))
                    tolerance=PLATFORM_TOLERANCE if q>1 else HEIGHT_TOLERANCE
                    x,z=reference_position(q,aisle,lane)
                    hit=check(f'transition aisle {aisle} lane {lane} q {q:.5f}',x,z,expected,tolerance,nearby_boundary_levels(q,aisle,lane))
                    if hit is not None and previous is not None and abs(hit[0]-previous)>MAX_WALK_STEP:
                        failed+=1
                        if len(errors)<96:errors.append({'sample':'stage/platform transition discontinuity','aisle':aisle,'q':q,'delta':hit[0]-previous})
                    previous=None if hit is None else hit[0]
        if len(distinct)!=36:
            failed+=1
            if len(errors)<96:errors.append({'sample':'missing stair levels','aisle':aisle,'missingSteps':[i+1 for i in range(36) if i not in distinct]})
        aisle_reports.append({'aisleFraction':aisle,'distinctVerifiedSteps':len(distinct),'maximumSampledRise':aisle_max_rise,
                              'maximumSampledDrop':aisle_max_drop,'failedChecks':failed-start_failed})
    check('stage center',INNER_CENTER[0],-INNER_CENTER[1],BASE_Z)
    # Regression for the exported 1.55cm gap found at the second aisle's
    # courtyard joint. These are fixed world coordinates, not generator output
    # or the curve-boundary tolerance path above. Every point needs the final
    # stair's actual upward-facing ground surface after the source-corner fix.
    seam_a=(159.6592331290793,-252.3644782372887)
    seam_b=(159.64571730538785,-252.35681424151034)
    for i in range(31):
        t=i/30;x=seam_a[0]+(seam_b[0]-seam_a[0])*t;z=seam_a[1]+(seam_b[1]-seam_a[1])*t
        check(f'outer source-corner seam regression {i}',x,z,OUTER_Z)
    return {'asset':path.name,'sha256':sha,'status':'failed' if failed else 'passed',
            'groundNodes':nodes,'groundNodesHit':[n for n in nodes if n['index'] in hit_nodes],
            'bvhUpwardGroundTriangles':count,'excludedVerticalDownwardOrDegenerateTriangles':skipped,
            'raySamples':samples,'fixedWorldSeamRegressionSamples':31,'rayMisses':misses,'maximumHeightError':worst,'facetBoundarySamplesMatchedToAdjacentLevel':boundary_matches,'failedChecks':failed,
            'aisles':aisle_reports,'errors':errors}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=DEFAULT_OUTPUT)
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ([] if '--python' in sys.argv else sys.argv[1:])
    args=parser.parse_args(argv);out=args.output if args.output.is_absolute() else ROOT/args.output
    report={'status':'passed','method':'Final GLB binary positions and indices; active-scene world transforms; only stataGround tags; upward-triangle vertical-ray BVH',
            'reference':'Frozen survey arc points and audited 12-tier/36-step photo-guided layout, no generator import',
            'heightToleranceMetres':HEIGHT_TOLERANCE,'platformToleranceMetres':PLATFORM_TOLERANCE,'maximumWalkingStepMetres':MAX_WALK_STEP,
            'adjacentPlateauAllowedOnlyWithinBoundaryMetres':FACET_BOUNDARY_DISTANCE,'profiles':[]}
    for name in ('stata-full.glb','stata-mobile.glb'):
        try:result=verify_asset(ASSETS/name)
        except Exception as exc:result={'asset':name,'status':'failed','error':str(exc)}
        report['profiles'].append(result)
        if result['status']!='passed':report['status']='failed'
    out.mkdir(parents=True,exist_ok=True)
    (out/'amphitheater-ground-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':
    raise SystemExit(main())

