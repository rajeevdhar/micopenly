import { useState } from 'react'
import { useStore } from '../store'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'register' | 'forgot' | 'reset'

export default function AuthModal({ onClose, initialMode = 'login' }: { onClose: () => void; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const { login, register } = useStore()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      if (mode === 'login') {
        const err = await login(email, password)
        if (err) setError(err); else onClose()
      } else if (mode === 'register') {
        const err = await register(email, password)
        if (err) setError(err); else setNotice('Check your email to confirm your account, then sign in.')
      } else if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (err) setError(err.message); else setNotice(`If ${email} has an account, a reset link is on its way.`)
      } else {
        const { error: err } = await supabase.auth.updateUser({ password })
        if (err) setError(err.message); else { useStore.setState({ needsPasswordReset: false }); onClose() }
      }
    } finally { setBusy(false) }
  }

  const title = { login: 'Sign in', register: 'Create account', forgot: 'Reset password', reset: 'Choose a new password' }[mode]
  const needsEmail = mode !== 'reset'
  const needsPassword = mode !== 'forgot'

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && mode !== 'reset') onClose() }}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="text-lg">{title}</h2>
          {mode !== 'reset' && <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>}
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {needsEmail && (
            <div>
              <label className="label" htmlFor="auth-email">Email</label>
              <input id="auth-email" className="field" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          )}
          {needsPassword && (
            <div>
              <label className="label" htmlFor="auth-pw">{mode === 'reset' ? 'New password' : 'Password'}</label>
              <input id="auth-pw" className="field" type="password" required minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{error}</p>}
          {notice && <p role="status" className="text-sm border-2 border-ink px-3 py-2">{notice}</p>}
          {!notice && <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : title}</button>}
          {mode !== 'reset' && (
            <div className="flex justify-between text-xs text-mute">
              {mode === 'login'
                ? <><button type="button" className="underline" onClick={() => { setMode('register'); setError(''); setNotice('') }}>Create account</button>
                    <button type="button" className="underline" onClick={() => { setMode('forgot'); setError(''); setNotice('') }}>Forgot password?</button></>
                : <button type="button" className="underline" onClick={() => { setMode('login'); setError(''); setNotice('') }}>Back to sign in</button>}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
