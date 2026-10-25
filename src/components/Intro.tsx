import { useState } from 'react'

const KEY = 'micopenly.intro-dismissed'
const wasDismissed = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

/** One short card for first-time visitors: what this is, and that anyone can add or fix a listing. */
export default function Intro({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  const [hidden, setHidden] = useState(wasDismissed)
  if (hidden) return null
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1') } catch { /* fine: it just shows again next visit */ } }

  return (
    <section aria-label="About MicOpenly" className="relative border-2 border-ink bg-white p-3 pr-12">
      <button onClick={dismiss} aria-label="Dismiss this introduction" className="absolute top-1 right-1 w-11 h-11 text-2xl leading-none text-mute hover:text-ink">×</button>
      <h2 className="text-base leading-tight">Find an open mic near you</h2>
      <p className="mt-1 text-sm text-mute">
        Comedy, music, poetry and more, kept up to date by the people who go. Something wrong or missing? Fix it or add it.
      </p>
      {canAdd && <button className="btn btn-primary mt-2" onClick={onAdd}>+ Add an open mic</button>}
    </section>
  )
}
