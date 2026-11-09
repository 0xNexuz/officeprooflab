'use client';

import { useEffect, useState } from 'react';
import { Brand, Icon } from '@/components/Bits';
import { api, errorText } from '@/lib/api';

export default function SignIn() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new')) setMode('register');
    // Someone already signed in goes straight to their projects.
    api<{ user: unknown }>('/api/auth').then(result => { if (result.user) window.location.replace('/app'); }).catch(() => {});
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/auth', { json: { action: mode, username, password } });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(next && /^\/app(\/[\w\-\/]*)?$/.test(next) ? next : '/app');
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };

  const register = mode === 'register';
  return (
    <div className="auth">
      <main className="auth-main">
        <Brand />
        <div className="auth-box">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h1 className="op-rise">{register ? 'Create an account' : 'Sign in'}</h1>
            <p className="muted op-rise op-rise--2" style={{ fontSize: 17 }}>{register ? 'You get a first project straight away. Add test cases and send it files.' : 'Your projects, test cases and run history are where you left them.'}</p>
          </div>
          <form className="auth-form op-rise op-rise--3" onSubmit={submit}>
            <label className="field">Username
              <input className="op-input" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_\-]{3,32}" />
              {register && <span className="hint">3 to 32 letters, numbers, hyphens or underscores.</span>}
            </label>
            <label className="field">Password
              <input className="op-input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} />
              {register && <span className="hint">At least 12 characters.</span>}
            </label>
            {error && <p className="notice notice--error" role="alert">{error}</p>}
            <button className="op-btn" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', marginTop: 8 }}>{busy ? 'One moment' : register ? 'Create account' : 'Sign in'} <Icon.arrow /></button>
          </form>
          <p className="muted op-rise op-rise--4" style={{ fontSize: 15 }}>
            {register ? 'Already have an account? ' : 'New here? '}
            <button type="button" className="op-link" onClick={() => { setMode(register ? 'login' : 'register'); setError(''); }} style={{ border: 0, cursor: 'pointer', font: 'inherit', fontWeight: 700, color: '#0c0c0c', padding: '0 0 3px' }}>{register ? 'Sign in' : 'Create an account'}</button>
          </p>
        </div>
        <p className="tiny">Uploaded files stay private to your account.</p>
      </main>
      <aside className="auth-side">
        <div className="op-rise op-rise--2" style={{ width: '100%', maxWidth: 500 }}>
          <div className="op-art" style={{ transform: 'rotate(-2deg)' }}>
            <img src="/art/poster.webp" width={1600} height={2000} alt="The OfficeProof Lab artwork: a tipped laptop pours file tiles onto a crowd of ink-black files while a pixel-art Labrador inspects the one white file" />
          </div>
        </div>
      </aside>
    </div>
  );
}
