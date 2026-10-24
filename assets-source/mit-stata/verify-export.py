"""Validate the exported assets, not just the generator's own data structures."""
from pathlib import Path
import argparse,json,struct,math,hashlib,sys
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,default=ROOT/'output/stata-reconstruction-20261022',help='Report directory containing baseline/files; relative paths use the repository root')
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ([] if '--python' in sys.argv else sys.argv[1:])
args=parser.parse_args(argv)
OUT=args.output if args.output.is_absolute() else ROOT/args.output

def read_glb(path):
    data=path.read_bytes()
    assert struct.unpack_from('<III',data)==(0x46546c67,2,len(data))
    size=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+size]),data[28+size:]

def values(doc,blob,i):
    acc=doc['accessors'][i];view=doc['bufferViews'][acc['bufferView']]
    count={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[acc['type']]
    component={5126:'f',5125:'I',5123:'H',5121:'B',5120:'b'}[acc['componentType']]
    fmt='<'+component*count;size=struct.calcsize(fmt)
    start=view.get('byteOffset',0)+acc.get('byteOffset',0)
    return [struct.unpack_from(fmt,blob,start+n*view.get('byteStride',size)) for n in range(acc['count'])]

report={'profiles':[],'unchangedBaseAssets':[],'status':'passed'}
manifest=json.loads((ROOT/'public/assets/mit-stata/manifest.json').read_text())
for name,budget in [('stata-full.glb',24_000_000),('stata-mobile.glb',8_000_000)]:
    path=ROOT/'public/assets/mit-stata'/name;doc,blob=read_glb(path)
    count=0;nonfinite=0;degenerate=0;out_of_range=0
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            pos=values(doc,blob,p['attributes']['POSITION']);idx=[x[0] for x in values(doc,blob,p['indices'])]
            nonfinite+=sum(not all(math.isfinite(c) for c in xyz) for xyz in pos)
            out_of_range+=sum(i<0 or i>=len(pos) for i in idx)
            for i in range(0,len(idx),3):
                a,b,c=[pos[j] for j in idx[i:i+3]]
                u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
                cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                if sum(x*x for x in cross)<1e-16:degenerate+=1
            count+=len(idx)//3
    normal_accessors=sorted({p['attributes']['NORMAL'] for mesh in doc['meshes'] for p in mesh['primitives'] if 'NORMAL' in p['attributes']})
    assert normal_accessors,f'{name}: missing exported normals'
    assert 'KHR_mesh_quantization' in doc.get('extensionsUsed',[]) and 'KHR_mesh_quantization' in doc.get('extensionsRequired',[]),f'{name}: quantized normals require KHR_mesh_quantization in used and required extensions'
    normal_count=0;normal_nonfinite=0;normal_range_errors=0;normal_unit_error=0.;normal_min=1.;normal_max=-1.
    for index in normal_accessors:
        acc=doc['accessors'][index];view=doc['bufferViews'][acc['bufferView']]
        assert acc['type']=='VEC3' and acc['componentType']==5120 and acc.get('normalized') is True,f'{name}: NORMAL accessor {index} must be normalized signed BYTE VEC3'
        assert view.get('byteStride')==4 and view.get('target')==34962,f'{name}: NORMAL accessor {index} must use a four-byte vertex stride'
        assert acc.get('byteOffset',0)%4==0 and view.get('byteOffset',0)%4==0,f'{name}: NORMAL accessor {index} is not four-byte aligned'
        assert acc.get('byteOffset',0)+acc['count']*4<=view['byteLength'],f'{name}: NORMAL accessor {index} exceeds its buffer view'
        for xyz in values(doc,blob,index):
            decoded=[max(c/127.,-1.) for c in xyz]
            normal_count+=1
            normal_nonfinite+=not all(math.isfinite(c) for c in decoded)
            normal_range_errors+=not all(-128<=raw<=127 and -1.<=c<=1. for raw,c in zip(xyz,decoded))
            normal_unit_error=max(normal_unit_error,abs(math.sqrt(sum(c*c for c in decoded))-1.))
            normal_min=min(normal_min,*decoded);normal_max=max(normal_max,*decoded)
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            if 'NORMAL' in p['attributes']:
                assert doc['accessors'][p['attributes']['NORMAL']]['count']==doc['accessors'][p['attributes']['POSITION']]['count'],f'{name}: normal/position count mismatch'
    assert normal_nonfinite==0 and normal_range_errors==0 and normal_unit_error<.01,f'{name}: invalid decoded normals: nonfinite={normal_nonfinite}, range={normal_range_errors}, max unit-length error={normal_unit_error}'
    normal_report={'accessors':len(normal_accessors),'vectors':normal_count,'componentType':'SIGNED_BYTE','normalized':True,'strideBytes':4,'extensionRequired':True,'decodedRange':[normal_min,normal_max],'nonfinite':normal_nonfinite,'rangeErrors':normal_range_errors,'maximumUnitLengthError':normal_unit_error}
    collision=[n for n in doc['nodes'] if n.get('extras',{}).get('stataCollisionOnly')]
    assert len(collision)==1 and collision[0]['extras']['stataWall']
    assert nonfinite==0 and out_of_range==0 and degenerate==0
    assert path.stat().st_size<=budget,f'{name}: {path.stat().st_size} bytes exceeds hard {budget}-byte asset budget'
    double_sided=[m for m in doc['materials'] if m.get('doubleSided',False)]
    rejected_double=[m.get('name','<unnamed>') for m in double_sided if not (
        m.get('name','').split('.')[0] in {'siteFoliage','siteMeadow'} and m.get('alphaMode')=='MASK'
        and 'baseColorTexture' in m.get('pbrMetallicRoughness',{}) and 0<m.get('alphaCutoff',.5)<1)]
    assert not rejected_double,f'{name}: only MASK cutout foliage may be double-sided; rejected {rejected_double}'
    profile=next(p for p in manifest['outputs'] if p['profile']==('mobile' if 'mobile' in name else 'desktop'))
    assert profile['windowsByPatch']['5']==32
    assert all(profile['windowsByPatch'].get(str(p),0)==0 for p in (117,139))
    assert profile['windowsByPatch']['32']==12 and profile['windowsByPatch']['26']==9
    report['profiles'].append({'asset':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'budgetBytes':budget,'quantizedNormals':normal_report,'allowedDoubleSidedCutoutFoliage':[m['name'] for m in double_sided],'triangles':count,'nonfiniteVertices':nonfinite,'invalidIndices':out_of_range,'zeroAreaTrianglesAfterFloat32Export':degenerate,'collisionMeshes':len(collision),'gatesFrontWindows':32,'blindGatesRoofCaps':True})
for name in ('campus-without-stata.glb','boston-without-stata.glb'):
    current=ROOT/'public/assets/mit-stata'/name
    previous=OUT/'baseline/files/public/assets/mit-stata'/name
    assert current.read_bytes()==previous.read_bytes()
    report['unchangedBaseAssets'].append(name)
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'geometry-check.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
