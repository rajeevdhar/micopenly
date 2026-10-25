import { useState } from 'react'
import { useStore } from '../store'
import { supabase } from '../lib/supabase'
import { AGE_MESSAGES, MIN_AGE, checkAge, parseBirthDate } from '../lib/age'

type Mode = 'login' | 'register' | 'forgot' | 'reset'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const LOCK_KEY = 'micopenly.age-lock'
let lockedInMemory = false

/** Once someone fails the age check, don't let them just retype a different year in this browser. */
const isLocked = () => {
  if (lockedInMemory) return true
  try { return localStorage.getItem(LOCK_KEY) === '1' } catch { return false }
}
const lock = () => {
  lockedInMemory = true
  try { localStorage.setItem(LOCK_KEY, '1') } catch { /* private mode: the in-memory flag still holds for this visit */ }
}

export default function AuthModal({ onClose, initialMode = 'login' }: { onClose: () => void; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [year, setYear] = useState('')
  const [underAge, setUnderAge] = useState(isLocked)
  const { login, register } = useStore()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      if (mode === 'login') {
        const err = await login(email, password)
        if (err) setError(err); else onClose()
      } else if (mode === 'register') {
        const birth = parseBirthDate(year, month, day)
        const gate = checkAge(birth)
        if (gate === 'too_young') { lock(); setUnderAge(true); setPassword(''); return }
        if (gate === 'invalid') { setError(AGE_MESSAGES.invalid); return }
        const err = await register(email, password, birth)
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
          {mode === 'register' && underAge ? (
            <p role="alert" className="text-sm border-2 border-ink bg-white px-3 py-3">{AGE_MESSAGES.locked}</p>
          ) : (<>
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
          {mode === 'register' && !notice && (
            <fieldset>
              <legend className="label">Date of birth</legend>
              <div className="grid grid-cols-[1fr_72px_88px] gap-2">
                <select className="field" aria-label="Month of birth" autoComplete="bday-month" required value={month} onChange={e => setMonth(e.target.value)}>
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input className="field" aria-label="Day of birth" placeholder="Day" inputMode="numeric" autoComplete="bday-day" required maxLength={2}
                  value={day} onChange={e => setDay(e.target.value.replace(/\D/g, ''))} />
                <input className="field" aria-label="Year of birth" placeholder="Year" inputMode="numeric" autoComplete="bday-year" required maxLength={4}
                  value={year} onChange={e => setYear(e.target.value.replace(/\D/g, ''))} />
              </div>
              <p className="text-xs text-mute mt-1.5">You must be {MIN_AGE} or older. We only use this to check your age and don’t save it.</p>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{error}</p>}
          {notice && <p role="status" className="text-sm border-2 border-ink px-3 py-2">{notice}</p>}
          {!notice && <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : title}</button>}
          </>)}
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
