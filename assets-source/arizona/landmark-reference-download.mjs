import fs from 'node:fs/promises';
const folder='assets-source/arizona';
await fs.mkdir(folder,{recursive:true});
const files=[
 ['landmark-old-main.jpg','https://businessaffairs.arizona.edu/sites/default/files/2025-03/OldMain_2015-2.jpg'],
 ['landmark-old-main-preservation.pdf','https://businessaffairs.arizona.edu/sites/default/files/2025-03/UA_Old_Main_Pres_Plan_2011_web.pdf'],
 ['landmark-eller-header.jpg','https://eller.arizona.edu/sites/default/files/Visit-Header-Short2.jpg'],
 ['landmark-eller-floor-1.png','https://eller.arizona.edu/sites/default/files/2025-08/mcclelland-1st-floor.png'],
 ['landmark-enr2-court.jpg','https://cdn.uanews.arizona.edu/s3fs-public/2025-09/ENR2-Building-3.jpg'],
 ['landmark-enr2-fins.jpg','https://cdn.uanews.arizona.edu/s3fs-public/2025-09/ENR2-Building-2.jpg'],
];
for(const [name,url]of files){try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(String(response.status));const data=Buffer.from(await response.arrayBuffer());await fs.writeFile(`${folder}/${name}`,data);console.log(name,data.byteLength);}catch(error){console.error(name,error.message);process.exitCode=1;}}
