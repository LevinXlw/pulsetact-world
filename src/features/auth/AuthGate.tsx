import {createContext,useCallback,useContext,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowRight,Compass,Eye,EyeOff,Leaf,LoaderCircle,LogOut} from 'lucide-react';
import './auth.css';

type Session={authenticated:true;user:{username:string};expiresAt:number};
type GateState={status:'checking'}|{status:'signed-out';message?:string}|{status:'error';message:string}|{status:'signed-in';session:Session};
type AuthContextValue={username:string;logout:()=>Promise<void>;loggingOut:boolean;logoutError:string};
const AuthContext=createContext<AuthContextValue|null>(null);
const AUTH_EVENT_KEY='pulsetact:auth:event';

export function useAuth(){
  const auth=useContext(AuthContext);
  if(!auth)throw new Error('Authentication is not available.');
  return auth;
}

function sessionFrom(data:unknown):Session|null{
  if(!data||typeof data!=='object')return null;
  const value=data as Partial<Session>;
  return value.authenticated===true&&typeof value.user?.username==='string'&&typeof value.expiresAt==='number'&&Number.isFinite(value.expiresAt)&&value.expiresAt>Date.now()?value as Session:null;
}

function announce(kind:'login'|'logout'){
  // This event contains no session or credentials; every login is checked with the server.
  try{localStorage.setItem(AUTH_EVENT_KEY,JSON.stringify({kind,nonce:crypto.randomUUID()}));}catch{}
}

function CampusDrawing(){return <svg className="auth-campus-drawing" viewBox="0 0 680 280" fill="none" aria-hidden="true"><path d="M-30 234C100 168 182 228 325 199S570 144 710 204V280H-30Z" fill="#bac6aa"/><path d="M-30 266C160 223 249 264 390 216S610 202 710 229V280H-30Z" fill="#8d9f81"/><path d="M359 280L330 206H349L405 280" fill="#e9e7cb"/><g fill="#e1dfc3" stroke="#72846a" strokeWidth="2"><path d="M147 203V137H260V203M411 203V137H524V203"/><path d="M255 206V125H418V206Z"/><path d="M245 128L337 85L429 128Z"/><path d="M302 98V66H372V98"/><path d="M297 66C301 22 373 22 377 66Z"/></g><path d="M336 25V17M296 66H378M143 135H265M409 135H528" stroke="#72846a" strokeWidth="3"/><g fill="#71826e">{[166,196,226,437,467,497].map(x=><path key={x} d={`M${x} 151h10v16h-10zM${x} 178h10v16h-10z`}/>)}<path d="M315 171a22 22 0 0 1 44 0v35h-44Z"/></g><g stroke="#f3eed6" strokeWidth="9">{[275,297,376,398].map(x=><path key={x} d={`M${x} 137V203`}/>)}</g><path d="M255 206H420M251 213H425" stroke="#e8e3c9" strokeWidth="5"/><g stroke="#637b60" strokeWidth="4"><path d="M89 211V140M572 211V133M617 218V158"/></g><g fill="#91a580"><ellipse cx="89" cy="139" rx="36" ry="44"/><ellipse cx="572" cy="128" rx="41" ry="49"/><ellipse cx="617" cy="155" rx="28" ry="33"/></g><path d="M51 82C75 68 86 73 106 82M494 52C516 39 531 44 549 52" stroke="#fffaf0" strokeWidth="5" strokeLinecap="round"/></svg>;}

function LoginScreen({busy,onLogin,message}:{busy:boolean;onLogin:(username:string,password:string)=>Promise<string|undefined>;message?:string}){
  const [username,setUsername]=useState('tony'),[password,setPassword]=useState(''),[visible,setVisible]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setError('');
    const failure=await onLogin(username.trim(),password);
    if(failure){setPassword('');setError(failure);}
  }
  return <AuthShell><section className="auth-card" aria-labelledby="auth-title"><span className="auth-eyebrow">YOUR NEXT CHAPTER</span><h1 id="auth-title">欢迎回来，<br/>校园正在等你。</h1><p className="auth-introduction">登录你的账号，继续下一段漫游。</p><form onSubmit={submit} aria-busy={busy}><label htmlFor="auth-username">账号</label><input id="auth-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event=>{setUsername(event.target.value);setError('');}} required maxLength={80} disabled={busy}/><label htmlFor="auth-password">密码</label><div className="auth-password"><input id="auth-password" name="password" autoComplete="current-password" type={visible?'text':'password'} value={password} onChange={event=>{setPassword(event.target.value);setError('');}} required maxLength={256} disabled={busy} aria-describedby={error?'auth-error':undefined} aria-invalid={!!error}/><button type="button" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)} disabled={busy}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{error?<p className="auth-error" id="auth-error" role="alert">{error}</p>:message?<p className="auth-message" role="status">{message}</p>:null}<button className="auth-submit" type="submit" disabled={busy||!username.trim()||!password}>{busy?<><LoaderCircle className="auth-spinner" size={18}/>正在登录…</>:<>登录 <ArrowRight size={18}/></>}</button></form><p className="auth-save-note">你的校园位置与探索手册，保留在这台设备上。</p></section></AuthShell>;
}

function AuthShell({children}:{children:ReactNode}){return <main className="auth-page"><header className="auth-brand"><Leaf size={27}/><div><strong>pulsetact</strong><span>WORLD</span></div></header><div className="auth-layout"><section className="auth-landscape" aria-label="校园漫游"><span className="auth-eyebrow">WALK. NOTICE. DISCOVER.</span><h2>让好奇心，<br/>带你走一段路。</h2><p>从查尔斯河畔，到另一座校园。<br/>把每一次停留，写进自己的故事。</p><CampusDrawing/><div className="auth-destinations"><span>BOSTON</span><i/><span>MARYLAND</span><i/><span>PENN</span></div></section>{children}</div><footer className="auth-footer"><span>一段属于你的校园旅程</span><Compass size={17}/><span>A WALK OF YOUR OWN</span></footer></main>;}

export function AuthGate({children}:{children:ReactNode}){
  const [state,setState]=useState<GateState>({status:'checking'}),[loginBusy,setLoginBusy]=useState(false),[loggingOut,setLoggingOut]=useState(false),[logoutError,setLogoutError]=useState('');
  const request=useRef<{sequence:number;controller:AbortController|null}>({sequence:0,controller:null});
  const stateRef=useRef(state);stateRef.current=state;
  const busyRef=useRef(false);
  const begin=useCallback(()=>{
    request.current.controller?.abort();const controller=new AbortController();
    const sequence=++request.current.sequence;request.current.controller=controller;
    return {controller,sequence};
  },[]);
  const check=useCallback(async()=>{
    if(busyRef.current)return;
    const {controller,sequence}=begin();const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(sequence!==request.current.sequence)return;
      if(response.status===401){setState({status:'signed-out',message:stateRef.current.status==='signed-in'?'登录已过期，请重新登录。':undefined});return;}
      if(!response.ok)throw new Error();
      const session=sessionFrom(await response.json());
      if(sequence!==request.current.sequence)return;
      if(!session)throw new Error();
      setState({status:'signed-in',session});
    }catch{
      if(sequence===request.current.sequence)setState({status:'error',message:'暂时无法连接登录服务，请检查连接后重试。'});
    }finally{clearTimeout(timer);}
  },[begin]);
  useEffect(()=>{
    void check();
    const focus=()=>{if(!document.hidden)void check();};
    const storage=(event:StorageEvent)=>{
      if(event.key!==AUTH_EVENT_KEY||!event.newValue)return;
      try{
        const notice=JSON.parse(event.newValue);
        if(notice.kind==='logout'){request.current.sequence++;request.current.controller?.abort();busyRef.current=false;setLoginBusy(false);setLoggingOut(false);setLogoutError('');setState({status:'signed-out',message:'账号已在另一个页面退出。'});}
        else if(notice.kind==='login')void check();
      }catch{}
    };
    const timer=setInterval(()=>{if(!document.hidden&&stateRef.current.status==='signed-in')void check();},60000);
    window.addEventListener('focus',focus);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',focus);
    return()=>{request.current.sequence++;request.current.controller?.abort();clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',focus);};
  },[check]);
  const expiresAt=state.status==='signed-in'?state.session.expiresAt:null;
  useEffect(()=>{
    if(expiresAt===null)return;
    const timer=setTimeout(()=>{
      // Expiry must close the gate even if a logout request is still pending.
      request.current.sequence++;request.current.controller?.abort();busyRef.current=false;
      setLoginBusy(false);setLoggingOut(false);setLogoutError('');
      setState({status:'signed-out',message:'登录已过期，请重新登录。'});
    },Math.min(Math.max(0,expiresAt-Date.now()),2147483647));
    return()=>clearTimeout(timer);
  },[expiresAt]);

  async function login(username:string,password:string):Promise<string|undefined>{
    if(busyRef.current)return;
    busyRef.current=true;setLoginBusy(true);const {controller,sequence}=begin();const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:controller.signal});
      const data=await response.json();if(sequence!==request.current.sequence)return;
      if(!response.ok)return typeof data?.error==='string'?data.error:'登录暂时不可用，请稍后再试。';
      const session=sessionFrom(data);if(!session)throw new Error();
      setLogoutError('');setState({status:'signed-in',session});announce('login');
    }catch{if(sequence===request.current.sequence)return '暂时无法连接登录服务，请稍后再试。';}
    finally{clearTimeout(timer);if(sequence===request.current.sequence){busyRef.current=false;setLoginBusy(false);}}
  }
  async function logout(){
    if(busyRef.current)return;
    busyRef.current=true;setLoggingOut(true);setLogoutError('');const {controller,sequence}=begin();const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
      if(sequence!==request.current.sequence)return;
      if(!response.ok&&response.status!==401)throw new Error();
      setState({status:'signed-out'});announce('logout');
    }catch{if(sequence===request.current.sequence)setLogoutError('暂时未能退出，请检查连接后重试。');}
    finally{clearTimeout(timer);if(sequence===request.current.sequence){busyRef.current=false;setLoggingOut(false);}}
  }
  if(state.status==='signed-in')return <AuthContext.Provider value={{username:state.session.user.username,logout,loggingOut,logoutError}}>{children}</AuthContext.Provider>;
  if(state.status==='signed-out')return <LoginScreen busy={loginBusy} onLogin={login} message={state.message}/>;
  return <AuthShell><section className="auth-card auth-status" aria-live="polite">{state.status==='checking'?<><LoaderCircle className="auth-spinner" size={30}/><h1>正在准备你的旅程</h1><p>正在确认登录状态…</p></>:<><Compass size={30}/><h1>稍等一下</h1><p role="alert">{state.message}</p><button className="auth-submit" onClick={()=>{setState({status:'checking'});void check();}}>重新连接 <ArrowRight size={18}/></button></>}</section></AuthShell>;
}

export function LogoutButton({beforeLogout,className=''}:{beforeLogout?:()=>void;className?:string}){
  const {logout,loggingOut,logoutError}=useAuth();
  return <><button className={`auth-logout ${className}`} disabled={loggingOut} onClick={()=>{beforeLogout?.();void logout();}}><LogOut size={15}/>{loggingOut?'正在退出…':'退出登录'}</button>{logoutError&&<p className="auth-error" role="alert">{logoutError}</p>}</>;
}
