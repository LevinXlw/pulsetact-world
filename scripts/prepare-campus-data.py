"""Build local glTF scenes from the verified Cambridge ZIPs. Requires Pillow and numpy.
No network access. Coordinates: EPSG:2249 US survey feet -> local east/up/south metres.
"""
from pathlib import Path
import csv, io, json, math, struct, zipfile
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets-source/cambridge-gis'
FT = 1200 / 3937

def project(lat, lon):
    # EPSG:2249, NAD83 / Massachusetts Mainland, GRS80 Lambert conformal conic.
    a, e = 6378137, math.sqrt(2 / 298.257222101 - (1 / 298.257222101) ** 2)
    def m(p): return math.cos(p) / math.sqrt(1 - e * e * math.sin(p) ** 2)
    def t(p): return math.tan(math.pi / 4 - p / 2) / ((1-e*math.sin(p))/(1+e*math.sin(p))) ** (e/2)
    p1, p2, p0, p = map(math.radians, [42.6833333333333,41.7166666666667,41,lat])
    n = math.log(m(p1)/m(p2))/math.log(t(p1)/t(p2))
    f = m(p1)/(n*t(p1)**n)
    rho, rho0 = a*f*t(p)**n, a*f*t(p0)**n
    theta = n*math.radians(lon+71.5)
    return np.array([(200000+rho*math.sin(theta))/FT-731100,
                     (750000+rho0-rho*math.cos(theta))/FT-2902900])

def obj(data, origin):
    vertices, faces = [], []
    for line in data.decode().splitlines():
        if line.startswith('v '):
            x,y,z = map(float,line.split()[1:4]); vertices.append([(x-origin[0])*FT,z*FT,-(y-origin[1])*FT])
        elif line.startswith('f '):
            ids = [int(p.split('/')[0]) for p in line.split()[1:]]
            ids = [i-1 if i>0 else len(vertices)+i for i in ids]
            if len(ids)!=3: raise ValueError('Source contains a non-triangle face; explicit triangulation required')
            faces.append(ids)
    return np.array(vertices,dtype=np.float32), np.array(faces,dtype=np.int32)

def write_glb(path, pieces, texture):
    doc = {'asset':{'version':'2.0','generator':'Pulsetact Cambridge local converter'},'scene':0,
           'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}], 'meshes':[{'primitives':[]}],
           'buffers':[{'byteLength':0}],'bufferViews':[],'accessors':[],
           'materials':[{'name':'Cambridge buildings (untextured)','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.74,.72,.65,1],'metallicFactor':0,'roughnessFactor':.92}},
                        {'name':'2025 orthophotography','doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':1}}],
           'textures':[{'source':0}], 'images':[]}
    binary = bytearray()
    def view(raw):
        while len(binary)%4: binary.append(0)
        offset=len(binary); binary.extend(raw)
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)})
        return len(doc['bufferViews'])-1
    def accessor(array, kind):
        array=np.asarray(array,dtype='<f4'); v=view(array.tobytes())
        doc['accessors'].append({'bufferView':v,'componentType':5126,'count':len(array),'type':kind,'min':array.min(axis=0).tolist(),'max':array.max(axis=0).tolist()})
        return len(doc['accessors'])-1
    for vertices, material in pieces:
        triangles=vertices.reshape(-1,3,3)
        normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
        lengths=np.linalg.norm(normals,axis=1); normals/=np.maximum(lengths[:,None],1e-10)
        attrs={'POSITION':accessor(vertices,'VEC3'),'NORMAL':accessor(np.repeat(normals,3,axis=0),'VEC3')}
        if material==1:
            # glTF uses top-left image coordinates (Three's GLTFLoader sets flipY=false).
            uv=np.column_stack(((vertices[:,0]+RADIUS)/(2*RADIUS),(vertices[:,2]+RADIUS)/(2*RADIUS)))
            attrs['TEXCOORD_0']=accessor(uv,'VEC2')
        doc['meshes'][0]['primitives'].append({'attributes':attrs,'material':material})
    doc['images']=[{'bufferView':view(texture),'mimeType':'image/jpeg'}]
    while len(binary)%4: binary.append(0)
    doc['buffers'][0]['byteLength']=len(binary)
    js=json.dumps(doc,separators=(',',':')).encode()
    js+=b' '*((-len(js))%4)
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(binary))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary)

RADIUS=420
CONFIG={
 'mit':{'center':[42.35915,-71.09205],'tiles':['F4','G4'],'spawn':[42.35865,-71.09185],
        'points':{'mit-killian':[42.35865,-71.09185],'mit-dome':[42.35938,-71.09205],'mit-corridor':[42.35935,-71.09105]}},
 'harvard':{'center':[42.37430,-71.11635],'tiles':['E3'],'spawn':[42.37412,-71.11668],
        'points':{'harvard-yard':[42.37412,-71.11668],'harvard-widener':[42.37394,-71.11650],'harvard-memorial':[42.37462,-71.11610]}}}

def build(campus, config):
    out=ROOT/'public/data/campuses'/campus; out.mkdir(parents=True,exist_ok=True)
    origin=project(*config['center'])
    def local(ll):
        p=(project(*ll)-origin)*FT
        return [round(float(p[0]),3),round(float(-p[1]),3)]
    ground, buildings, models=[],[],[]
    mosaic=Image.new('RGB',(4096,4096),'#a8b5ab')
    for tile in config['tiles']:
        folder=SOURCE/campus/tile
        with zipfile.ZipFile(next(folder.glob('*Bulding*'))) as z:
            catalog=list(csv.DictReader(io.StringIO(z.read('catalog/catalog.csv').decode('utf-8-sig'))))
            paths={n.split('/')[-2].removesuffix('_OBJ'):n for n in z.namelist() if n.lower().endswith('.obj')}
            for row in catalog:
                try: p=local([float(row['Center_Lat']),float(row['Center_Long'])])
                except (ValueError,KeyError): continue
                if max(map(abs,p))>RADIUS-30: continue
                name=paths.get(row['Model_ID'])
                if not name: continue
                v,f=obj(z.read(name),origin)
                if not len(f): continue
                buildings.append(v[f].reshape(-1,3))
                models.append({'id':row['Model_ID'],'name':row['Name'],'tile':tile,'position':p,'triangles':len(f)})
        with zipfile.ZipFile(next(folder.glob('*Terrain*'))) as z:
            v,f=obj(z.read(next(n for n in z.namelist() if n.lower().endswith('.obj'))),origin)
            triangles=v[f]
            keep=np.all(np.abs(triangles[:,:,[0,2]])<=RADIUS,axis=(1,2))
            ground.append(triangles[keep].reshape(-1,3))
        with zipfile.ZipFile(next(folder.glob('*Ortho*'))) as z:
            world=list(map(float,z.read(next(n for n in z.namelist() if n.endswith('.jgw'))).decode().split()))
            im=Image.open(io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith('.JPG')))))
            # Worldfile pixels are center-referenced; use pixel edges for crop and georegistration.
            west=world[4]-world[0]/2; north=world[5]-world[3]/2
            left=(west-731100-origin[0])*FT; top=-(north-2902900-origin[1])*FT
            width=im.width*world[0]*FT; height=-im.height*world[3]*FT
            x0=max(-RADIUS,left); y0=max(-RADIUS,top); x1=min(RADIUS,left+width); y1=min(RADIUS,top+height)
            box=((x0-left)/width*im.width,(y0-top)/height*im.height,(x1-left)/width*im.width,(y1-top)/height*im.height)
            dest=tuple(round((v+RADIUS)/(2*RADIUS)*4096) for v in (x0,y0,x1,y1))
            patch=im.crop(box).resize((dest[2]-dest[0],dest[3]-dest[1]),Image.Resampling.LANCZOS)
            mosaic.paste(patch,dest[:2])
    texture=io.BytesIO(); mosaic.save(texture,format='JPEG',quality=88)
    mosaic.resize((1600,1600),Image.Resampling.LANCZOS).save(out/'overview.jpg',quality=87)
    b=np.concatenate(buildings); g=np.concatenate(ground)
    assert np.isfinite(b).all() and np.isfinite(g).all()
    write_glb(out/'campus.glb',[(b,0),(g,1)],texture.getvalue())
    manifest={'campus':campus,'radius':RADIUS,'originStatePlaneFeet':(origin+np.array([731100,2902900])).tolist(),
              'spawn':local(config['spawn']),'points':{k:local(v) for k,v in config['points'].items()},
              'buildingCount':len(models),'buildingTriangles':len(b)//3,'terrainTriangles':len(g)//3,
              'modelBytes':(out/'campus.glb').stat().st_size,'models':models,
              'source':'City of Cambridge GIS / CyberCity 3D; orthophotography: Nearmap 2025',
              'years':{'buildings':2023,'terrain':2018,'orthophoto':2025},
              'coordinates':'EPSG:2249, US survey feet; local east/up/south in metres; height NAVD88',
              'usage':'Local evaluation; commercial redistribution permission not confirmed.'}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{campus}: {len(models)} buildings, {len(b)//3} building triangles, {len(g)//3} terrain triangles, {manifest["modelBytes"]:,} bytes',flush=True)

if __name__=='__main__':
    for campus,config in CONFIG.items(): build(campus,config)
