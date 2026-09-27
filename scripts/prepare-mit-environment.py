"""Read georeferenced GIS cartographic colors into conservative 2 m surface cells.
This classifies a map legend, not aerial imagery or surveyed vegetation points.
"""
import importlib,json,zipfile,io
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=120_000_000
m=importlib.import_module('prepare-campus-data')
origin=m.project(*m.CONFIG['mit']['center'])+np.array([731100,2902900])
step=2; axis=np.arange(-420,420,step); xx,zz=np.meshgrid(axis,axis)
water=np.zeros(xx.shape,dtype=bool);green=water.copy();road=water.copy()
for tile in ['F4','G4']:
 with zipfile.ZipFile(next((m.SOURCE/'mit'/tile).glob('*Groundplan*'))) as archive:
  world=list(map(float,archive.read(next(n for n in archive.namelist() if n.endswith('.jgw'))).decode().split()))
  im=Image.open(io.BytesIO(archive.read(next(n for n in archive.namelist() if n.lower().endswith('.jpg')))))
  pixels=np.asarray(im); good=np.ones(xx.shape,dtype=bool);w=good.copy();g=good.copy();r=good.copy()
  for dx,dz in [(0,0),(1,0),(0,1),(1,1),(.5,.5)]:
   px=np.rint((origin[0]+(xx+dx*step)/m.FT-world[4])/world[0]).astype(int)
   py=np.rint((origin[1]-(zz+dz*step)/m.FT-world[5])/world[3]).astype(int)
   valid=(px>=0)&(py>=0)&(px<im.width)&(py<im.height);good &= valid
   c=pixels[np.clip(py,0,im.height-1),np.clip(px,0,im.width-1),:3].astype(float)
   w &= np.linalg.norm(c-[184,210,227],axis=2)<13
   g &= (np.linalg.norm(c-[199,223,187],axis=2)<13)|(np.linalg.norm(c-[227,232,178],axis=2)<13)
   r &= (np.linalg.norm(c-[204,204,204],axis=2)<8)&(c.max(axis=2)-c.min(axis=2)<4)
  water |= w&good;green |= g&good;road |= r&good
  del pixels,im
def close(mask,radius):
 def shifted(a,dy,dx):
  padded=np.pad(a,radius,constant_values=False)
  return padded[radius+dy:radius+dy+a.shape[0],radius+dx:radius+dx+a.shape[1]]
 expanded=np.logical_or.reduce([shifted(mask,y,x) for y in range(-radius,radius+1) for x in range(-radius,radius+1)])
 return np.logical_and.reduce([shifted(expanded,y,x) for y in range(-radius,radius+1) for x in range(-radius,radius+1)])
water=close(water,2);green=close(green,1);road=close(road,1)
def runs(mask):
 result=[]
 for row in range(len(axis)):
  col=0
  while col<len(axis):
   if not mask[row,col]:col+=1;continue
   end=col+1
   while end<len(axis) and mask[row,end]:end+=1
   result.append([int(axis[col]),int(axis[row]),int((end-col)*step)])
   col=end
 return result
trees=[]
for row in range(4,len(axis)-4,7):
 for col in range(4,len(axis)-4,7):
  if green[row-2:row+3,col-2:col+3].all():trees.append([int(axis[col])+1,int(axis[row])+1])
result={'cellSize':step,'waterRuns':runs(water),'greenRuns':runs(green),'roadRuns':runs(road),'treeCandidates':trees[:120],
 'waterArea':int(water.sum()*step*step),'greenArea':int(green.sum()*step*step),'roadArea':int(road.sum()*step*step),
 'source':'Cambridge 2025 GISGroundplan JPG and JGW, F4/G4. Conservative map-color classification; not surveyed land-cover polygons or tree locations.'}
centres=[]
for row,z in enumerate(axis):
 if 270<=z<=410:
  candidates=axis[road[row] & (axis>-60) & (axis<65)]
  if len(candidates):centres.append([z+1,float(candidates.mean()+1)])
slope,intercept=np.polyfit(np.array(centres)[:,0],np.array(centres)[:,1],1)
result['bridge']={'start':[float(slope*236+intercept),236],'end':[float(slope*420+intercept),420],'width':18,'source':'Axis fitted to classified road cells over the river. Deck width, rails and supports are visual approximations.'}
(m.ROOT/'public/data/killian/environment.json').write_text(json.dumps(result,separators=(',',':')))
print({k:len(v) if isinstance(v,list) else v for k,v in result.items() if k!='source'})
