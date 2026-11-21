import { useEffect, useState } from 'react';
import { api, setAuthToken } from './lib/api';
import { Gamepad2, LockKeyhole, Mail, UserRound, ArrowRight, ShieldCheck } from 'lucide-react';

type Account = { id:string; name:string; email:string };
type Mode = 'login' | 'register' | 'forgot' | 'reset';

export default function AuthScreen({ onAuthenticated }:{onAuthenticated:(user:Account)=>void}) {
  const [mode,setMode]=useState<Mode>('login');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [verificationPending,setVerificationPending]=useState(false);
  const [actionToken,setActionToken]=useState('');

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const verify=params.get('verifyEmail');
    const reset=params.get('resetPassword');
    if(verify){
      setBusy(true);
      api.post<{user:Account}>('/api/auth/verify-email',{token:verify})
        .then(result=>{
          setNotice('Email verified successfully. Your player account is ready. Sign in to continue.');
          setEmail(result.data.user.email || '');
          setMode('login');
          window.history.replaceState({},'',window.location.pathname);
        })
        .catch(e=>setError(e instanceof Error?e.message:'This verification link is invalid or expired.'))
        .finally(()=>setBusy(false));
    } else if(reset){
      setActionToken(reset);
      setMode('reset');
      setNotice('Choose a new password for your LUDO LIVE account.');
      window.history.replaceState({},'',window.location.pathname);
    }
  },[]);

  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      if(mode==='forgot'){
        const result=await api.post<{message:string}>('/api/auth/password/forgot',{email});
        setNotice(result.data.message || 'If an eligible account matches that address, a reset link will be sent.');
      } else if(mode==='reset'){
        const result=await api.post<{message:string}>('/api/auth/password/reset',{token:actionToken,password});
        setNotice(result.data.message || 'Password updated. Sign in with your new password.');
        setPassword('');
        setMode('login');
      } else {
        const result=await api.post<{token?:string;user:Account;verificationRequired?:boolean;message?:string}>('/api/auth/'+mode,{email,password,...(mode==='register'?{name}: {})});
        if(mode==='register' && result.data.verificationRequired){
          setVerificationPending(true);
          setNotice(result.data.message || 'Check your inbox for your verification link. You can keep playing as a guest until verification is complete.');
          return;
        }
        if(!result.data.token) throw new Error('The sign-in response did not include a session. Please try again.');
        localStorage.setItem('ludo-live-session',result.data.token);
        localStorage.setItem('ludo-live-player-id',result.data.user.id);
        localStorage.setItem('ludo-live-player-name',result.data.user.name);
        setAuthToken(result.data.token);
        onAuthenticated(result.data.user);
      }
    } catch(e) { setError(e instanceof Error?e.message:'Could not complete that request. Please try again.'); }
    finally { setBusy(false); }
  }

  async function resendVerification(){
    setBusy(true);setError('');setNotice('');
    try{
      const result=await api.post<{message:string}>('/api/auth/verification/resend',{email});
      setNotice(result.data.message || 'If that address has a pending verification, a new link will be sent.');
    }catch(e){setError(e instanceof Error?e.message:'Could not request another verification email.');}
    finally{setBusy(false);}
  }

  const title=mode==='register'?'Create your player account':mode==='forgot'?'Recover your account':mode==='reset'?'Choose a new password':'Welcome back';
  const description=mode==='register'?'One account for your player profile, friends and match progress.':mode==='forgot'?'We will send a password-reset link if the address belongs to an eligible account.':mode==='reset'?'Use a new password with at least 10 characters, including letters and numbers.':'Sign in to keep your profile, friends and progress with you.';

  return <main className="account-screen">
    <div className="account-glow account-glow-one"/><div className="account-glow account-glow-two"/>
    <section className="account-card">
      <div className="account-brand"><span><Gamepad2 size={25}/></span><div><b>LUDO LIVE</b><small>PLAY TOGETHER. ANYWHERE.</small></div></div>
      <div className="account-heading"><div className="account-lock"><ShieldCheck size={22}/></div><p className="account-eyebrow">YOUR PLAYER IDENTITY</p><h1>{title}</h1><p>{description}</p></div>
      {notice&&<div className="account-notice" role="status">{notice}</div>}
      {verificationPending&&<div className="account-verification"><p>Didn't receive the email?</p><button type="button" disabled={busy||!email} onClick={resendVerification}>{busy?'PLEASE WAIT…':'RESEND VERIFICATION EMAIL'}</button></div>}
      <form className="account-form" onSubmit={submit}>
        {mode==='register'&&<label><span>PLAYER NAME</span><div><UserRound size={17}/><input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={18} required placeholder="Your display name"/></div></label>}
        {mode!=='reset'&&<label><span>EMAIL ADDRESS</span><div><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com"/></div></label>}
        {(mode==='login'||mode==='register'||mode==='reset')&&<label><span>{mode==='reset'?'NEW PASSWORD':'PASSWORD'}</span><div><LockKeyhole size={17}/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={mode==='register'||mode==='reset'?10:1} maxLength={128} required autoComplete={mode==='login'?'current-password':'new-password'} placeholder={mode==='login'?'Your password':'At least 10 characters'}/></div>{(mode==='register'||mode==='reset')&&<small>Use at least 10 characters, including letters and numbers.</small>}</label>}
        {error&&<div className="account-error" role="alert">{error}</div>}
        <button className="account-submit" disabled={busy}>{busy?'PLEASE WAIT…':mode==='login'?'SIGN IN':mode==='register'?'CREATE ACCOUNT':mode==='forgot'?'SEND RESET LINK':'UPDATE PASSWORD'} <ArrowRight size={17}/></button>
      </form>
      <p className="account-switch">
        {mode==='login'?<>New to Ludo Live? <button type="button" onClick={()=>{setMode('register');setError('');setNotice('');setVerificationPending(false);}}>Create account</button></>:mode==='register'?<>Already have an account? <button type="button" onClick={()=>{setMode('login');setError('');setNotice('');setVerificationPending(false);}}>Sign in</button></>:<>Remembered your password? <button type="button" onClick={()=>{setMode('login');setError('');setNotice('');}}>Back to sign in</button></>}
      </p>
      {mode==='login'&&<p className="account-switch"><button type="button" onClick={()=>{setMode('forgot');setError('');setNotice('');}}>Forgot password?</button></p>}
      <p className="account-privacy"><LockKeyhole size={13}/> Passwords are securely hashed. Never share your password with other players.</p>
    </section>
  </main>;
}
