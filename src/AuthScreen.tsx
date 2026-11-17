import { useState } from 'react';
import { api, setAuthToken } from './lib/api';
import { Gamepad2, LockKeyhole, Mail, UserRound, ArrowRight, ShieldCheck } from 'lucide-react';

type Account = { id:string; name:string; email:string };
export default function AuthScreen({ onAuthenticated }:{onAuthenticated:(user:Account)=>void}) {
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {
      const result=await api.post<{token:string;user:Account}>('/api/auth/'+mode,{email,password,...(mode==='register'?{name}: {})});
      localStorage.setItem('ludo-live-session',result.data.token);
      localStorage.setItem('ludo-live-player-id',result.data.user.id);
      localStorage.setItem('ludo-live-player-name',result.data.user.name);
      setAuthToken(result.data.token);
      onAuthenticated(result.data.user);
    } catch(e) { setError(e instanceof Error?e.message:'Could not sign in. Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="account-screen">
    <div className="account-glow account-glow-one"/><div className="account-glow account-glow-two"/>
    <section className="account-card">
      <div className="account-brand"><span><Gamepad2 size={25}/></span><div><b>LUDO LIVE</b><small>PLAY TOGETHER. ANYWHERE.</small></div></div>
      <div className="account-heading"><div className="account-lock"><ShieldCheck size={22}/></div><p className="account-eyebrow">YOUR PLAYER IDENTITY</p><h1>{mode==='login'?'Welcome back':'Create your player account'}</h1><p>{mode==='login'?'Sign in to keep your profile, friends and progress with you.':'One account for your player profile, friends and match progress.'}</p></div>
      <form className="account-form" onSubmit={submit}>
        {mode==='register'&&<label><span>PLAYER NAME</span><div><UserRound size={17}/><input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={18} required placeholder="Your display name"/></div></label>}
        <label><span>EMAIL ADDRESS</span><div><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com"/></div></label>
        <label><span>PASSWORD</span><div><LockKeyhole size={17}/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={mode==='register'?10:1} maxLength={128} required autoComplete={mode==='login'?'current-password':'new-password'} placeholder={mode==='register'?'At least 10 characters':'Your password'}/></div>{mode==='register'&&<small>Use at least 10 characters, including letters and numbers.</small>}</label>
        {error&&<div className="account-error" role="alert">{error}</div>}
        <button className="account-submit" disabled={busy}>{busy?'PLEASE WAIT…':mode==='login'?'SIGN IN':'CREATE ACCOUNT'} <ArrowRight size={17}/></button>
      </form>
      <p className="account-switch">{mode==='login'?"New to Ludo Live?":"Already have an account?"} <button type="button" onClick={()=>{setMode(mode==='login'?'register':'login');setError('');}}>{mode==='login'?'Create account':'Sign in'}</button></p>
      <p className="account-privacy"><LockKeyhole size={13}/> Passwords are securely hashed. Never share your password with other players.</p>
    </section>
  </main>;
}
