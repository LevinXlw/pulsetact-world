import {mkdir,writeFile} from 'node:fs/promises';
const endpoint='https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Water_Features/FeatureServer/8';
const q=new URLSearchParams({f:'json',where:'1=1',geometry:JSON.stringify({xmin:-71.138,ymin:42.345,xmax:-71.08,ymax:42.365,spatialReference:{wkid:4326}}),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',outSR:'4326',returnGeometry:'true',geometryPrecision:'7',maxAllowableOffset:'0.000015'});
const response=await fetch(`${endpoint}/query?${q}`);if(!response.ok)throw new Error(`River source ${response.status}`);
const data=await response.json();if(data.error)throw new Error(JSON.stringify(data.error));
await mkdir('assets-source/charles-bu',{recursive:true});
await writeFile('assets-source/charles-bu/massgis-hydrography.json',JSON.stringify({source:endpoint,reference:'https://www.mass.gov/info-details/massgis-data-massdep-hydrography-125000',retrieved:new Date().toISOString(),...data}));
console.log(data.features.map(f=>({attributes:f.attributes,rings:f.geometry?.rings?.map(r=>r.length)})));
