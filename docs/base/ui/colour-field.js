// THE COLOUR FIELD of the shared viewer base (Raven, 2026-10-18: "add a field that shows the hex code of the color like we
// did with armor pigments" / "the text field shows the colors now ... I like it"): a hex text field that shows its colour
// as its background. paintField(el, hex, text) paints it (hex null: hatched, nothing to show); wireField(el, onCommit, onSnap)
// makes it editable the armour rows' way: one click selects it for copying; #abc or #aabbcc (with or without #) commits,
// anything else snaps back (onSnap repaints).
export function paintField(el, hex, text){
  if (!el || document.activeElement === el) return;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  el.value = text != null ? text : (m ? '#' + m[1].toUpperCase() : '');
  el.style.backgroundColor = m ? '#' + m[1] : '';
  el.classList.toggle('none', !m);
  const v = m ? parseInt(m[1], 16) : 0;
  el.classList.toggle('light', !!m && (0.2126 * (v >> 16 & 255) + 0.7152 * (v >> 8 & 255) + 0.0722 * (v & 255)) > 140);
}
export function parseHex(t){
  let v = String(t || '').trim();
  if (v && v[0] !== '#') v = '#' + v;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map(c => c + c).join('');
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}
export function wireField(el, onCommit, onSnap){
  if (!el) return;
  el.onfocus = () => el.select();
  el.onclick = () => { if (el.selectionStart === el.selectionEnd) el.select(); };
  el.onchange = () => { const h = parseHex(el.value); el.blur(); if (h) onCommit(h); else onSnap(); };
  el.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); el.onchange(); } };
}
