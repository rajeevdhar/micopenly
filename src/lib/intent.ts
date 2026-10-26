// "Add your open mic" links: https://…/?add=1 takes a host straight to the add form.
// If they have to create an account first, the intent is remembered for a day so it still works
// after they confirm their email (which may open in a new tab).

export const ADD_PARAM = 'add'
const STORE_KEY = 'micopenly.add-intent'
const TTL_MS = 24 * 60 * 60 * 1000

/** True for ?add, ?add=1, ?add=true, ?add=yes. Anything else (including add=0) is false. */
export function wantsToAdd(search: string): boolean {
  const params = new URLSearchParams(search)
  if (!params.has(ADD_PARAM)) return false
  const v = (params.get(ADD_PARAM) ?? '').trim().toLowerCase()
  return v === '' || v === '1' || v === 'true' || v === 'yes'
}

/** The same address without the add parameter, so a refresh doesn't trigger it again. Other parts are kept. */
export function withoutAddParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search)
  params.delete(ADD_PARAM)
  const rest = params.toString()
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`
}

/** Minimal storage shape so this can be tested without a browser. */
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function rememberAdd(store: Store | null, now: number = Date.now()): void {
  try { store?.setItem(STORE_KEY, String(now)) } catch { /* private mode: the link still works in this tab */ }
}

/** Is there an unexpired remembered intent? Does not clear it. */
export function hasRememberedAdd(store: Store | null, now: number = Date.now()): boolean {
  try {
    const raw = store?.getItem(STORE_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at) || now - at > TTL_MS || at > now + 60_000) { store?.removeItem(STORE_KEY); return false }
    return true
  } catch { return false }
}

export function clearRememberedAdd(store: Store | null): void {
  try { store?.removeItem(STORE_KEY) } catch { /* nothing to do */ }
}

/** localStorage if the browser allows it, else null. */
export function browserStore(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
