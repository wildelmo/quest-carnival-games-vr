/**
 * settings — tiny persistent store for player-facing options (comfort
 * vignette, snap-turn angle, music). Values survive sessions via
 * localStorage; systems either read `settings.data.X` live each frame
 * (vignette, snap angle) or subscribe with onChange (music).
 */

const KEY = 'carnival.settings.v1';

const DEFAULTS = {
  vignette: true,   // comfort iris during smooth locomotion
  snapDeg: 30,      // snap-turn angle (30 or 45)
  music: true,      // bandstand ragtime on/off
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = {
  data: load(),
  _listeners: [],
  set(key, value) {
    this.data[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {}
    for (const fn of this._listeners) fn(key, value);
  },
  onChange(fn) { this._listeners.push(fn); },
};
