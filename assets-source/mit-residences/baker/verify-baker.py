"""Read exported binaries, enforce budgets and collider contract, record bounds."""
from pathlib import Path
import json,struct,math
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
metadata=json.loads((HERE/'metadata.json').read_text())
result={}
for lod,limit,trilimit in [('full',8_000_000,120_000),('mobile',4_000_000,60_000)]:
    p=ROOT/f'public/assets/mit-residences/baker-{lod}.glb';raw=p.read_bytes()
    assert raw[:4]==b'glTF';size=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+size])
    assert len(raw)<limit
    tris=sum(d['accessors'][pr['indices']]['count']//3 for mesh in d['meshes'] for pr in mesh['primitives'])
    assert tris<trilimit
    calls=sum(len(m['primitives']) for m in d['meshes']);assert calls<40
    assert metadata['outputs'][lod]=={'bytes':len(raw),'triangles':tris,'drawCalls':calls,'meshes':len(d['meshes'])}
    assert 'KHR_mesh_quantization' in d.get('extensionsRequired',[])
    for m in d['meshes']:
        for pr in m['primitives']:
            n=d['accessors'][pr['attributes']['NORMAL']]
            assert n['componentType']==5120 and n['normalized'] and d['bufferViews'][n['bufferView']]['byteStride']==4
    collision=[n for n in d['nodes'] if n.get('extras',{}).get('mitResidenceCollisionOnly')]
    assert len(collision)==1 and collision[0]['extras']['mitResidenceWall'] is True
    ground=[n for n in d['nodes'] if n.get('extras',{}).get('mitResidenceGround')]
    retaining=[n for n in d['nodes'] if n.get('extras',{}).get('mitResidenceWall') and not n.get('extras',{}).get('mitResidenceCollisionOnly')]
    assert len(ground)>=3 and len(retaining)>=1
    assert all(n['extras'].get('bakerNorthCourt') for n in ground+retaining)
    blob=raw[28+size:]
    def read_acc(i):
        a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];dim={'VEC3':3,'SCALAR':1}[a['type']];fmt={5126:'f',5123:'H',5125:'I'}[a['componentType']];stride=v.get('byteStride',struct.calcsize('<'+fmt*dim));start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+fmt*dim,blob,start+k*stride) for k in range(a['count'])]
    ground_triangles=[]
    for node in ground:
        for pr in d['meshes'][node['mesh']]['primitives']:
            ps=read_acc(pr['attributes']['POSITION']);idx=[v[0] for v in read_acc(pr['indices'])]
            ground_triangles.extend([ps[idx[k+j]] for j in range(3)] for k in range(0,len(idx),3))
    def ray_ground(x,z):
        heights=[]
        for a,b,c in ground_triangles:
            normal_y=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])
            if normal_y<=1e-9:continue
            det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
            if abs(det)<1e-9:continue
            u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det;v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det;w=1-u-v
            if min(u,v,w)>-1e-5:heights.append(u*a[1]+v*b[1]+w*c[1])
        return max(heights) if heights else None
    entry_checks=[]
    for p in metadata['northCourt']['groundProbePoints']:
        x,y,z=p['world'];actual=ray_ground(x,z);assert actual is not None and abs(actual-y)<.003,(p,actual)
        entry_checks.append({'label':p['label'],'expectedY':y,'actualY':actual})
    minv=[math.inf]*3;maxv=[-math.inf]*3
    for m in d['meshes']:
        for pr in m['primitives']:
            a=d['accessors'][pr['attributes']['POSITION']]
            assert all(math.isfinite(n) for n in a['min']+a['max'])
            minv=[min(minv[i],a['min'][i]) for i in range(3)];maxv=[max(maxv[i],a['max'][i]) for i in range(3)]
    assert abs(minv[1]-2.6713399)<.001
    assert -352<minv[0]<-348 and -251<maxv[0]<-249
    result[lod]={'bytes':len(raw),'triangles':tris,'drawCalls':calls,'boundsMin':minv,'boundsMax':maxv,'colliderExtras':collision[0]['extras'],'groundMeshCount':len(ground),'retainingWallMeshCount':len(retaining),'northCourtGroundProbes':entry_checks,'embeddedImageCount':len(d.get('images',[])),'metadataMatchesBinary':True,'quantizedNormalsAligned':True}
(HERE/'verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
