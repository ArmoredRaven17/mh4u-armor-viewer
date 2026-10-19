// A TRUE RGB SELECTION for the shared viewer base (Raven, 2026-10-18: "The Color Board is pretty close to RGB, but I
// find it lacks in some ways compared to a true RGB selection"): R, G and B each as a slider and a number box (0-255),
// a hex field, the browser's own colour input (its wheel or square), and a swatch, all four in step. Used by the
// pigment selector's RGB..., the colour rows' RGB... and the strip row's RGB option (base/ui/pigment.js, colour-rows.js,
// hunter-panel.js).
//   createRgbPicker({ value, native, onInput, onCommit }) -> { el, set(hex), get() }
//   value     the starting '#rrggbb'
//   native    an existing <input type="color"> to adopt as the picker's own (the app may already hold it by id)
//   onInput   hex -> every change, live while a slider moves
//   onCommit  hex -> a finished change (a slider let go, a box or the hex field changed, the native picker closed)
const clamp = v => Math.max(0, Math.min(255, Math.round(+v || 0)));
const toHex = rgb => '#' + rgb.map(v => clamp(v).toString(16).padStart(2, '0')).join('');
const fromHex = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()) || /^#?([0-9a-f]{3})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
};

export function createRgbPicker(opts){
  opts = opts || {};
  let rgb = fromHex(opts.value) || [192, 192, 192];
  const el = document.createElement('div'); el.className = 'rgbx';
  const rows = ['R', 'G', 'B'].map((n, i) => {
    const row = document.createElement('div'); row.className = 'rgbx-row';
    row.innerHTML = '<span class="rgbx-n">' + n + '</span><input type="range" min="0" max="255" step="1">' +
      '<input type="number" min="0" max="255" step="1">';
    el.appendChild(row);
    const [range, num] = row.querySelectorAll('input');
    range.title = num.title = n + ' (0-255)';
    range.oninput = () => { rgb[i] = clamp(range.value); paint(range); fire(false); };
    range.onchange = () => fire(true);
    num.oninput = () => { if (num.value === '') return; rgb[i] = clamp(num.value); paint(num); fire(false); };
    num.onchange = () => { rgb[i] = clamp(num.value); paint(); fire(true); };
    return { range, num };
  });
  const foot = document.createElement('div'); foot.className = 'row gap rgbx-foot';
  const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'rgbx-hex'; hex.maxLength = 7;
  hex.spellcheck = false; hex.title = 'Hex (#rrggbb)';
  const native = opts.native || document.createElement('input');
  native.type = 'color'; native.classList.add('rgb-input'); native.hidden = false; native.title = native.title || 'Pick a color';
  const chip = document.createElement('span'); chip.className = 'chip';
  foot.appendChild(hex); foot.appendChild(native); foot.appendChild(chip);
  el.appendChild(foot);
  hex.onchange = () => { const v = fromHex(hex.value); if (v) rgb = v; paint(); if (v) fire(true); };
  hex.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); hex.onchange(); hex.blur(); } };
  native.oninput = () => { const v = fromHex(native.value); if (v){ rgb = v; paint(native); fire(false); } };
  native.onchange = () => fire(true);
  // every control from the colour, except the one the user is moving
  function paint(except){
    rows.forEach((r, i) => {
      if (r.range !== except) r.range.value = String(rgb[i]);
      if (r.num !== except) r.num.value = String(rgb[i]);
      r.range.style.setProperty('--rgbx-track', 'linear-gradient(to right,' +
        toHex(rgb.map((v, k) => k === i ? 0 : v)) + ',' + toHex(rgb.map((v, k) => k === i ? 255 : v)) + ')');
    });
    const h = toHex(rgb);
    if (document.activeElement !== hex) hex.value = h.toUpperCase();
    if (native !== except) native.value = h;
    chip.style.background = h;
  }
  function fire(done){
    const h = toHex(rgb);
    if (done) { if (opts.onCommit) opts.onCommit(h); }
    else if (opts.onInput) opts.onInput(h);
  }
  paint();
  return {
    el,
    set(h){ const v = fromHex(h); if (v){ rgb = v; paint(); } },
    get(){ return toHex(rgb); }
  };
}
