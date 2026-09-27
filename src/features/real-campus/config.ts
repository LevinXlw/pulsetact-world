// Initial viewing anchor only. Independently chosen approximation, not a surveyed route.
export const MIT_VIEW = { latitude:42.3592, longitude:-71.0926, ellipsoidHeight:-25 };
export type ViewMode = 'aerial' | 'close' | 'avatar';
export const viewSettings:Record<ViewMode,{distance:number;pitch:number}> = {
  aerial:{distance:260,pitch:.9}, close:{distance:90,pitch:.55}, avatar:{distance:16,pitch:.65},
};
export function degreesToRadians(value:number){return value*Math.PI/180;}
export function moveCalibrationAvatar(x:number,z:number,dx:number,dz:number,dt:number):[number,number]{
  const length=Math.hypot(dx,dz)||1,step=Math.min(Math.max(dt,0),.05)*3.5;
  return [Math.max(-12,Math.min(12,x+dx/length*step)),Math.max(-18,Math.min(18,z+dz/length*step))];
}
export function googleFailure(error:unknown):string {
  // Do not expose request URLs, API keys or raw provider responses in the UI.
  const text=error instanceof Error?error.message:String(error);
  if(/401|403|API_KEY|PERMISSION|denied|forbidden/i.test(text))return 'Google 拒绝了请求。请检查 Key、Map Tiles API、计费和网站来源限制。';
  if(/429|quota|RESOURCE_EXHAUSTED/i.test(text))return 'Google 请求配额不足。请检查配额和用量，稍后手动重试。';
  return '真实地图加载失败。请检查网络与 Google Cloud 配置，然后重试，或返回模拟校园。';
}
export function creditStrings(attributions:{type:string;value:unknown}[]):string[] {
  return [...new Set(attributions.filter(a=>a.type==='string'&&typeof a.value==='string').map(a=>String(a.value).trim()).filter(Boolean))].sort();
}
