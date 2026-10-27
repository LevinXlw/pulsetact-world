import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const run='output/bu-streets-20261027',archive='docs/screenshots/bu-streets-20261027';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const evidence={};
async function preserve(from,to){await mkdir(to.slice(0,to.lastIndexOf('/')),{recursive:true});await copyFile(from,to);evidence[to]=await sha(to);}
const reports={};
const loaderFix=await json(`${run}/mobile-loader-fix/summary.json`);
if(loaderFix.after.failed!==0||loaderFix.protectedAssets.passed!==true)throw Error('Mobile replacement bases failed verification');
for(const file of ['summary.json','before-regression.json','after-regression.json','protected-assets-after.json'])await preserve(`${run}/mobile-loader-fix/${file}`,`${archive}/mobile-loader-fix/${file}`);
for(const file of ['report.json','10-580-street.png'])await preserve(`${run}/mobile-stale/${file}`,`${archive}/mobile-stale/${file}`);
for(const phase of ['before','after','neutral','walk-west','walk-east','mobile']){
  const report=await json(`${run}/${phase}/report.json`);
  if(report.status!=='passed')throw Error(`Unverified phase: ${phase}`);
  reports[phase]=report;
  for(const file of await readdir(`${run}/${phase}`))if((file.endsWith('.png')&&file!=='failure.png')||file==='report.json')await preserve(`${run}/${phase}/${file}`,`${archive}/${phase}/${file}`);
}
const mobilePlay=await json(`${run}/playable-mobile/report.json`);
if(mobilePlay.status!=='passed')throw Error('Mobile gameplay check failed');
await preserve(`${run}/playable-mobile/report.json`,`${archive}/playable-mobile/report.json`);
for(const file of await readdir(`${run}/playable-mobile`))if(/(?:agganis|nickerson|fitrec|questrom|mobile-bu-hd).*\.png$/.test(file))await preserve(`${run}/playable-mobile/${file}`,`${archive}/playable-mobile/${file}`);
const tests=await json(`${run}/tests.json`);
if(!tests.success)throw Error('Focused tests did not pass');
await preserve(`${run}/tests.json`,`${archive}/tests.json`);
const build=await json(`${run}/build.json`);if(build.exitCode!==0)throw Error('Production build failed');
await preserve(`${run}/build.json`,`${archive}/build.json`);
const sourcePaths=[
 'src/features/world/bu-terrain.ts','src/features/world/bu-west-terrain-data.ts','src/features/world/bu-campus-streets.ts','src/features/world/bu-public-realm.ts',
 'src/features/world/bu-full-campus.ts','src/features/world/bu-full-layout.ts','src/features/world/bu-west-terrace.ts','src/features/world/bu-west-terrace-layout.ts','src/features/world/bu-560-commonwealth.ts','src/features/world/bu-580-commonwealth.ts','src/features/world/bu-566-commonwealth.ts','src/features/world/mobile-campus-build.ts',
 'scripts/prepare-bu-campus.mjs','scripts/prepare-bu-terrain.mjs','scripts/prepare-mobile-campus.mjs','scripts/capture-bu-comm-ave.mjs','scripts/check-bu-continuous.mjs',
 'assets-source/charles-bu/street-review-cameras-20261027.json','assets-source/charles-bu/questrom-frontage-walk-20261027.json','assets-source/charles-bu/terrain-west/terrain-samples.json',
 'src/features/world/mobile-campus.ts','scripts/prepare-boston-mobile-replacements.mjs','scripts/prepare-stata-base.mjs','scripts/prepare-mit-residences-base.py','scripts/check-bu-playable.mjs',
 'public/assets/mit-stata/boston-without-stata.glb','public/assets/mit-stata/boston-without-stata.json','public/assets/mit-residences/boston-without-residences.glb','public/assets/mit-residences/boston-without-residences.json','public/data/mobile/boston.replacements.json',
 'public/data/mobile/boston.glb','public/data/mobile/boston.json',
];
const sources={};for(const path of sourcePaths)sources[path]=await sha(path);
const metrics=await json('public/data/mobile/boston.json');
const standardAttempt=await json(run+'/standard-walk-attempt.json');await preserve(run+'/standard-walk-attempt.json',archive+'/standard-walk-attempt.json');
const record={assetId:'bu-streets-and-questrom-frontage-20261027',date:'2026-10-27',status:'阶段可试玩；完整实景真实感尚未验收通过',
 scope:['西区错误固定地形与路口人行道接缝','西区宿舍/球场台地的局部校准','Questrom对面580、566与560 Commonwealth的漏选修复与专属外部几何','560曲端入口与既有人行道之间的局部铺装','手机实际加载旧MIT整合包的派生同步修复','上述变更的移动导出和连续步行'],
 workTypes:['场地高程校准','道路装配修复','遗漏建筑补建','局部构件建模'],
 editableSource:'保留测绘原始数据、带来源的程序化模型及生成脚本；本轮未创建Blender母版。',
 referenceRecords:['assets-source/charles-bu/580-commonwealth/source-20261027.json','assets-source/charles-bu/566-commonwealth/source-20261027.json','assets-source/charles-bu/560-commonwealth/source-20261027.json','assets-source/charles-bu/west-road-terrain-20261027.json','assets-source/charles-bu/560-commonwealth/entry-apron-20261027.json'],
 visualReview:{identityAndMainVolumes:'三栋遗漏建筑的独立体块、580凸窗与灰顶、566阳台、560曲面玻璃已在正常运行图中确认。',remaining:'580窗/板比例及石带仍简化；566分户及底层窗列概括；560玻璃偏均匀。前场铺装、站台设施和相邻旧楼漏光尚待完善。'},
 sources,technical:{standardAttempt,mobileLoaderFix:loaderFix,tests:{passed:tests.numPassedTests,failed:tests.numFailedTests,suites:tests.testResults?.length,report:`${archive}/tests.json`},build,walkWest:reports['walk-west'].status,walkEast:reports['walk-east'].status,mobilePlay:mobilePlay.status},
 comparison:{method:'修改前/本轮版本保持水平位置、视场角、相对地面眼高和日光。地形修正后绝对相机及目标高度随新地面变化，故不是完全相同的世界坐标相机。',beforeViews:reports.before.views.map(v=>v.id),supplementalViews:reports.after.views.filter(v=>!reports.before.views.some(old=>old.id===v.id)).map(v=>v.id),kind:'固定检查图使用真实运行时资产加载器；walk与playable-mobile是完整游戏人物、HUD与输入检查；neutral仅临时替换建筑材质以检查几何。',photos:'实景参考保留原像素；照片与模型仅近似朝向，季节/相机不同。'},
 resources:{actualMobileBase:reports.mobile.setup.mobileBaseAsset,actualMobileAttachments:{stata:reports.mobile.setup.mobileBase,residences:reports.mobile.setup.mobileResidences,portico:reports.mobile.setup.mobilePortico},mobileDifference:'三栋新增建筑保留与完整源相同的几何和真实开口；这不是减面LOD。移动导出去除外部纹理，低档关闭动态阴影，既有次要建筑沿用旧分级。挡墙、地面与通行开口同步保留。',mobileExport:metrics,priorExport:{bytes:25723232,triangles:696841},increase:{bytes:metrics.bytes-25723232,triangles:metrics.triangles-696841},runtimeViews:reports.after.views.map(v=>({id:v.id,triangles:v.triangles,drawCalls:v.calls})),mobileViews:reports.mobile.views.map(v=>({id:v.id,triangles:v.triangles,drawCalls:v.calls})),device:'Chrome headless desktop and phone emulation; not a physical phone',performance:'未以浏览器模拟值宣称真机达到30 FPS。移动真机帧时间与显存仍待验证。'},
 gates:{G0:{status:'partial',note:'城市轮廓、USGS高程与BU官方实景/580平面图已保留；部分后立面、566商业入口和精细高程仍为推定。'},G1:{status:'partial',note:'补齐漏选体块、专属轮廓并修正西区整体标高；实际多机位和中性材质图已检查。场地局部与建筑未覆盖细节尚待精校。'},G2:{status:'partial',note:'新增建筑采用开口、窗框、楼板和退台/阳台构件；材质质感和店面细节仍未达到完整实景标准。'},G3:{status:'bounded runtime checks passed',note:'西区及Questrom对面实际连续步行、手机模拟加载和画质切换见对应报告。'},G4:{status:'partial',note:'源、导出hash和检查证据齐备；真机性能及完整视觉质量待继续。'}},
 remaining:['西区宿舍旧通用窗列、景观设施与入口构造仍需专属重建。','580/566店招、商业门厅、背面和精确窗框尺寸仍待更多实景校准。','USGS bare-earth数据不是建筑/台阶测量；局部平台修补属于有依据的场地重建，非原始测量。','标准画质自动步行曾超时，原因尚未完全隔离；省电档连续步行通过，不等于标准画质性能通过。','本轮为本地版本，未发布线上。'],evidence,
};
await writeFile('assets-source/charles-bu/streets-frontage-20261027.json',JSON.stringify(record,null,2)+'\n');
for(const address of ['580','566','560']){
 const path=`assets-source/charles-bu/${address}-commonwealth/source-20261027.json`,sourceRecord=await json(path);
 sourceRecord.runtimeReview={status:'阶段可试玩；完整实景真实感尚未验收通过',archive,normalMaterialViews:'after',neutralMaterialViews:'neutral',continuousWalk:reports['walk-east'].status,phoneEmulation:mobilePlay.status,actualMobileExport:{sha256:sources['public/data/mobile/boston.glb'],...metrics},visualLimit:record.visualReview.remaining};
 await writeFile(path,JSON.stringify(sourceRecord,null,2)+'\n');
}
const figure=(src,label)=>`<figure><img loading="lazy" src="${src}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
const pair=(id,title)=>`<section><h2>${title}</h2><div class="pair">${figure(`before/${id}.png`,'修改前')}${figure(`after/${id}.png`,'本轮版本')}</div></section>`;
const firstShot=phase=>Object.keys(evidence).find(p=>p.startsWith(`${archive}/${phase}/`)&&p.endsWith('.png')&&!p.includes('/00-'))?.slice(archive.length+1);
const refs='../../../assets-source/charles-bu';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BU 西区路面与 Questrom 对面街区 · 2026-10-27</title><style>body{margin:0;background:#ecebe5;color:#243b33;font:16px/1.65 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:21px}p{max-width:1100px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{display:block;width:100%;height:auto;background:#ddd}figcaption{padding:8px 0;color:#53635a}section{margin:36px 0}.status{background:#fff9e5;padding:16px 22px;border-left:4px solid #b89143}a{color:#285b50}@media(max-width:800px){.pair{grid-template-columns:1fr}main{padding:18px}}</style><main><h1>BU：西区路面与 Questrom 对面街区</h1><p class="status">阶段可试玩。修正西区错误高差和路面连接，补回580、566、560 Commonwealth。保持原有自然暖色。完整实景真实感仍未验收通过；这是本地检查记录。</p><p>前后图保持水平机位、视场角、相对地面眼高与日光。地形变更后，相机绝对高度随地面调整，不能视为完全相同的世界坐标机位。实景照片与模型仅近似朝向。</p>
${pair('03-west-comm-ave','西区 Commonwealth：消除旧地形造成的人工陡坡')}
${pair('02-west-babcock','Babcock Street：路缘、地面与宿舍接地')}
${pair('04-west-courtyard','西区宿舍与球场之间的场地关系')}
<section><h2>西区实景对照</h2><div class="pair">${figure(`${refs}/references/west-20261027/west-campus-exterior.jpg`,'BU官方照片：球场与宿舍平台存在真实高差')}${figure('after/01-west-overview.png','本轮全景；宿舍旧通用立面与景观仍需继续完善')}</div></section>
${pair('07-questrom-block','Questrom对面：补回遗漏的两栋高层和独立低层银行')}
<section><h2>580 Commonwealth 与相邻的 566 Kenmore Tower</h2><div class="pair">${figure(`${refs}/580-commonwealth/bu-housing-exterior.jpg`,'BU官方580实景；左侧可见566的侧墙及阳台')}${figure('after/10-580-street.png','本轮580：凸窗、折角、金属顶部与底层；左侧为566')}</div><div class="pair">${figure('after/11-580-corner.png','580转角近景')}${figure('after/12-566-street.png','566街景：独立的退台、阳台与水平楼板')}</div></section>
<section><h2>560：独立曲面低层银行</h2><div class="pair">${figure(`${refs}/560-commonwealth/bank-2019.jpg`,'2019实景：Boston Business Journal；现租户未核实，模型不带品牌文字')}${figure('after/13-560-bank.png','本轮：曲面玻璃、金属檐带、石材基座')}</div></section>
<div class="pair">${figure('after/15-560-entry.png','560曲端入口近景；不带未经确认的租户标识')}${figure('after/11-580-corner.png','580转角窗洞、玻璃退进与底层近景')}</div>
<section><h2>西区挡墙与步道近景</h2><div class="pair">${figure('after/14-west-retaining-wall.png','保留球场低地与宿舍高台；挡墙线和局部通道为照片/地图推定')}${figure('mobile/14-west-retaining-wall.png','手机版保留同一高差、挡墙和通行开口')}</div></section>
<section><h2>中性材质几何检查</h2><p>临时替换建筑材质，用于检查体块和凹凸；游戏正常配色见上图。</p><div class="pair">${figure('neutral/10-580-street.png','580与566体块关系')}${figure('neutral/12-566-street.png','566构件与退台')}</div></section>
<section><h2>手机版：修复旧整合包覆盖新BU资产</h2><p>原先手机优先加载旧MIT整城基础文件，BU仍显示旧方块。现在两级派生随Boston烘焙同步生成；下图是实际手机加载器的前后画面，保留同一低画质档。</p><div class="pair">${figure('mobile-stale/10-580-street.png','修复前：手机实际加载旧整合包')}${figure('mobile/10-580-street.png','修复后：手机实际加载新建筑')}</div></section>
<section><h2>实际游戏步行与移动端</h2><p>各路线仅在起点传送，后续使用鼠标与W/Shift连续行走。本轮完整游戏通行用省电档验证；标准画质自动步行曾异常缓慢，未作为通过项。手机为Chrome模拟，真机待验证。</p><div class="pair">${figure(firstShot('walk-west'),'西区：完整游戏步行')}${figure(firstShot('walk-east'),'Questrom对面：完整游戏步行')}</div><div class="pair">${figure('mobile/01-west-overview.png','手机资产：西区整体')}${figure('mobile/10-580-street.png','手机资产：580与566街面')}</div></section>
<p>剩余差距：西区旧立面和近景景观、580/566商业门厅及背面细节、真实玻璃与混凝土材质、移动真机性能。技术检查通过不能代替实景质量验收。</p><p><a href="${refs}/streets-frontage-20261027.json">来源、构建hash、资源与G0–G4记录</a> · <a href="https://www.bu.edu/housing/residence/central-campus-graduate-apartments/580-commonwealth-avenue/">BU 580官方资料</a> · <a href="https://www.bu.edu/meetatbu/files/2024/09/West-Campus-Exterior.jpg">BU西区照片来源</a></p></main></html>`;
await writeFile(`${archive}/review.html`,html);console.log(JSON.stringify({archive,evidence:Object.keys(evidence).length,tests:tests.numPassedTests,metrics}));
