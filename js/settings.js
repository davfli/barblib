// Display + comfort settings.
//
// Two profiles — "day" and "bedtime" — each with its own theme, warm filter and
// dimming. The moon button switches profiles; an optional schedule switches
// automatically (a manual switch holds until the next scheduled change).

const KEY = 'reader.settings'

const DEFAULTS = {
  fontSize: 100,
  font: 'publisher',      // publisher | serif | sans | clear
  lineHeight: 1.5,
  width: 'normal',        // narrow | normal | wide
  justify: true,
  flow: 'paginated',
  fit: 'contain',
  wakeLock: false,
  mode: 'day',            // day | bedtime
  profiles: {
    day: { theme: 'light', warmth: 0, dim: 0 },
    bedtime: { theme: 'night', warmth: 45, dim: 20 },
  },
  schedule: { on: false, from: '21:30', to: '07:00' },
}

const listeners = new Set()
export const onChange = fn => listeners.add(fn)

function load() {
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { /* ignore */ }
  const s = { ...structuredClone(DEFAULTS), ...saved }
  s.profiles = { ...structuredClone(DEFAULTS.profiles), ...saved.profiles }
  s.schedule = { ...DEFAULTS.schedule, ...saved.schedule }
  // migrate v1 (single theme) and honour the OS dark preference on first run
  if (saved.theme && !saved.profiles) s.profiles.day.theme = saved.theme
  if (!localStorage.getItem(KEY) && matchMedia('(prefers-color-scheme: dark)').matches)
    s.profiles.day.theme = 'dark'
  delete s.theme
  return s
}

export const settings = load()

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* private mode */ }
}

/** Flat view of the settings handlers use: profile values merged in. */
export const effective = () => ({ ...settings, ...settings.profiles[settings.mode] })
export const profile = () => settings.profiles[settings.mode]

export function set(key, value) {
  if (['theme', 'warmth', 'dim'].includes(key)) profile()[key] = value
  else if (key.startsWith('schedule.')) settings.schedule[key.slice(9)] = value
  else settings[key] = value
  save()
  apply()
}

// ---------------- schedule ----------------
const minutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
function scheduledMode(now = new Date()) {
  const t = now.getHours() * 60 + now.getMinutes()
  const from = minutes(settings.schedule.from), to = minutes(settings.schedule.to)
  const inWindow = from <= to ? t >= from && t < to : t >= from || t < to
  return inWindow ? 'bedtime' : 'day'
}
let lastScheduled = null
function tickSchedule() {
  if (!settings.schedule.on) { lastScheduled = null; return }
  const m = scheduledMode()
  if (m !== lastScheduled) {
    lastScheduled = m
    if (settings.mode !== m) { settings.mode = m; save(); apply() }
  }
}

// ---------------- applying ----------------
const THEME_BG = { light: '#fffdf8', sepia: '#f4ead5', dark: '#1f1e1b', night: '#000000' }

function applyFilters() {
  const { warmth, dim } = profile()
  const w = warmth / 100
  // multiply-blend: cuts blue (and some green) light, like Night Light on Windows
  const warm = document.getElementById('warm-filter')
  warm.style.background = `rgb(255 ${Math.round(255 - 95 * w)} ${Math.round(255 - 210 * w)})`
  warm.style.opacity = w ? 1 : 0
  document.getElementById('dim-filter').style.opacity = (dim / 100) * 0.75
}

export function apply() {
  const theme = profile().theme
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.mode = settings.mode
  document.querySelector('meta[name=theme-color]').content = THEME_BG[theme] ?? THEME_BG.light
  applyFilters()
  updateWakeLock()
  for (const fn of listeners) fn(effective())
}

// ---------------- keep screen on ----------------
let wakeLock = null
let wantWake = false   // true while a book is open
export function setReading(on) { wantWake = on; updateWakeLock() }
export const wakeLockSupported = 'wakeLock' in navigator

async function updateWakeLock() {
  const should = wakeLockSupported && settings.wakeLock && wantWake && document.visibilityState === 'visible'
  if (should && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
    } catch { wakeLock = null }
  } else if (!should && wakeLock) {
    wakeLock.release().catch(() => {})
    wakeLock = null
  }
}

export function init() {
  if (settings.schedule.on) { lastScheduled = scheduledMode(); settings.mode = lastScheduled }
  apply()
  setInterval(tickSchedule, 30_000)
  document.addEventListener('visibilitychange', () => { tickSchedule(); updateWakeLock() })
}

/** Re-evaluate the schedule now (after its settings changed). */
export function resetSchedule() { lastScheduled = null; tickSchedule() }

export function toggleMode() {
  settings.mode = settings.mode === 'day' ? 'bedtime' : 'day'
  save()
  apply()
}
