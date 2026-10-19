// THE SHARED VIEWER BASE'S SHELL (docs/base/ui/shell.js; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md). A CLASSIC script,
// loaded right after the app's docs/game.js and before the page's module, so the theme, the stage backdrop and the view
// preferences apply before the first paint -- an ES module runs later and the page would flash. Everything game-specific
// comes from `window.VIEWER_GAME` (docs/game.js): the storage prefix, the theme list and its icons, the pane tabs.
// Moved here verbatim from GU's index.html (2026-10-18); no game name, id or storage key lives in this file.
(function () {
  var G = window.VIEWER_GAME || {};

  // ---- the About and Links modals, the view preferences, the pane tabs
  (function () {
    var am = document.getElementById("aboutModal");
    document.getElementById("aboutBtn").onclick = function () { am.classList.remove("hidden"); };
    document.getElementById("aboutClose").onclick = function () { am.classList.add("hidden"); };
    am.onclick = function (e) { if (e.target === am) am.classList.add("hidden"); };

    // View preferences live in their own key, like the theme does: they are app chrome,
    // not part of a saved set, and reading them in this early script means a hidden
    // notice or bar never flashes before the module finishes loading.
    var UI_KEY = G.storagePrefix + "-ui";
    var ui = { note: true, bar: true };
    try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch (_) {}
    var noteEl = document.getElementById("renderNote"),
        barEl = document.getElementById("bar"),
        barHome = barEl.parentNode,          // the render section it floats over
        barBtn = document.getElementById("barBtn"),
        header = barBtn.parentNode,
        setNote = document.getElementById("setNote");
    function paintUi() {
      noteEl.hidden = !ui.note;
      // Toggled off, the toolbar moves into the header rather than being hidden, so the
      // controls stay reachable. Moving the element keeps every handler the module binds
      // to fitBtn/spinBtn/orbitLock/wireBtn intact -- they are looked up by id, and the
      // nodes themselves never change.
      //
      // It lands to the LEFT of the toggle on purpose. The h1 carries flex:1, so every
      // control after it is right-anchored as one block: inserting BEFORE the toggle lets
      // the bar grow into the title's slack and leaves the toggle, Save / Save As / Open
      // and the icon buttons exactly where they were. Inserting after it shoves them all.
      if (ui.bar) barHome.appendChild(barEl);
      else header.insertBefore(barEl, barBtn);
      barBtn.classList.toggle("on", ui.bar);
      setNote.checked = !ui.note;
      try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) {}
    }
    paintUi();
    barBtn.onclick = function () { ui.bar = !ui.bar; paintUi(); };
    setNote.onchange = function () { ui.note = !setNote.checked; paintUi(); };

    // The sidebar's pane tabs (game.paneTabs: [tab id, pane id] pairs, the first the default; none, no tabs). GU's are
    // Hunter / Palico: Palicos differ enough -- two armour slots, no gender, their own base-cat parts -- that sharing
    // one panel stack would mean hiding half of it.
    (function(){
      var tabs = G.paneTabs || [];
      if (!tabs.length) return;
      function show(which){
        tabs.forEach(function(t){
          var on = t[0] === which;
          document.getElementById(t[0]).classList.toggle('on', on);
          document.getElementById(t[1]).hidden = !on;
        });
        try { localStorage.setItem(G.storagePrefix + '-tab', which); } catch (_) {}
      }
      tabs.forEach(function(t){ document.getElementById(t[0]).onclick = function(){ show(t[0]); }; });
      var saved = null;
      try { saved = localStorage.getItem(G.storagePrefix + '-tab'); } catch (_) {}
      show(tabs.some(function(t){ return t[0] === saved; }) ? saved : tabs[0][0]);
    })();

    var m = document.getElementById("linksModal");
    document.getElementById("linksBtn").onclick = function () { m.classList.remove("hidden"); };
    document.getElementById("linksClose").onclick = function () { m.classList.add("hidden"); };
    m.onclick = function (e) { if (e.target === m) m.classList.add("hidden"); };
  })();

  // ---- the theme engine
  // Theme system — the MH apps family's, installed from mhgu-fishing/docs/theme.js. Every shade
  // is derived from ONE chosen colour by moving only its lightness in HSL, so hue and
  // saturation are preserved and every derived surface stays "in family". That is why the
  // palette can be a list of bare hexes rather than a set of hand-built themes.
  //
  // THE PALETTE HAS ONE INVARIANT: every swatch holds white text and a white checkbox tick.
  // Both come off one number — the browser picks a checkbox tick itself, white below relative
  // luminance .1791 and black above, and white body text needs its ground at .1833 or below to
  // clear 4.5:1 — so the checkbox line is the stricter of the two. Every theme clears it, which
  // is why this app paints white text unconditionally and has no light-theme branch.
  //
  // A NEW COLOUR HAS TO CLEAR THAT. Do not add one without checking it, and keep this list
  // byte-identical to the other apps: the list lives in each app's docs/game.js (themes).
  (function () {
    const THEMES = G.themes;
    const KEY = G.storagePrefix + "-theme";
    const DEFAULT_HEX = G.themeDefault;

    // Backdrop override for the render area. The stage is normally darken(hex,.18) — the
    // Weapon Tree's factor — but these two are chroma-key colours, so a screenshot of the
    // model can be keyed out. They deliberately do NOT follow the theme: the whole point is a
    // flat, known value the keyer can pull. Everything else (sidebar, titlebar, panels) still
    // follows the theme, so only the surface being composited is overridden.
    //
    // Full-gun primaries, #00FF00 and #0000FF, chosen deliberately over the SMPTE-ish digital
    // greens and blues. Those key more forgivingly on real footage, where the backdrop is lit
    // cloth, but here the backdrop is a flat framebuffer value with no lighting on it at all,
    // so the reason to prefer them does not apply and a full channel is the easier pull.
    const STAGE_KEY = G.storagePrefix + "-stage";
    const STAGES = { theme: null, green: "#00FF00", blue: "#0000FF" };
    let stageMode = "theme";
    try { const v = localStorage.getItem(STAGE_KEY); if (v && v in STAGES) stageMode = v; } catch (e) {}
    const FALLBACK_ICON = G.themeIconFallback;

    const byHex = new Map(THEMES.map(t => [t.hex.toUpperCase(), t]));
    const monsterIcon = G.themeIcon;

    // A saved theme is a bare hex, so anyone sitting on a retired one keeps a colour that is no
    // longer in the list: it never picks up the change, and anything keyed off the hex stops
    // matching. Remap on read, not on write. Kept identical to the other apps rather than
    // trimmed to this app's own history, because a per-app map is one more thing to drift.
    const LEGACY_HEX = {
      '#C8A319': '#74631D', '#57470B': '#74631D', '#5E4D0C': '#74631D',           // Tigrex
      '#574916': '#74631D', '#68581A': '#74631D',
      '#F1D364': '#9C8328', '#B59417': '#9C8328', '#C39F19': '#9C8328',           // Rajang
      '#BEA031': '#9C8328',
      '#C65900': '#783E0F', '#FC933E': '#C7620E',                                 // Tetsucabra, Agnaktor
      '#68360D': '#783E0F', '#B5590D': '#C7620E',
      '#3A9B3F': '#39993E', '#2DAE85': '#279773',                                 // Rathian, Zinogre
      '#D84696': '#D4358C', '#CE79A8': '#C8679D',                                 // Mizutsune, Congalala
      '#B57C45': '#835A32', '#CFAA87': '#B17A47',                                 // Barroth, Bulldrome
      '#AEB5C1': '#7C879B',                                                       // Valstrax

    };
    const migrateHex = (h) => (h && LEGACY_HEX[h.toUpperCase()]) || h;

    const hexRgb = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
    const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
    const clamp01 = n => Math.max(0, Math.min(1, n));
    const rgbToHsl = ([r, g, b]) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const l = (max + min) / 2;
      if (d === 0) return [0, 0, l];
      const s = d / (1 - Math.abs(2 * l - 1));
      const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
        : max === g ? ((b - r) / d + 2) / 6
          : ((r - g) / d + 4) / 6;
      return [h, s, l];
    };
    const hslToRgb = ([h, s, l]) => {
      const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
      const hi = Math.floor(h * 6) % 6;
      const [r, g, b] = hi === 0 ? [c, x, 0] : hi === 1 ? [x, c, 0] : hi === 2 ? [0, c, x]
        : hi === 3 ? [0, x, c] : hi === 4 ? [x, 0, c] : [c, 0, x];
      return [r + m, g + m, b + m].map(v => clamp(v * 255));
    };
    // darken/lighten only nudge lightness, so every derived shade keeps the chosen
    // colour's hue and saturation.
    const darken = (rgb, f) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l * f)]); };
    const lighten = (rgb, t) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l + (1 - l) * t)]); };
    const css = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    // The complementary colour, the Bingo app's rule for its highlight (winColor): the hue
    // rotated a full 180 deg from the theme, saturation .95, the lightest shade from .60 down
    // that keeps white text at 4.5:1. The Reset button wears it (Raven, 2026-09-03:
    // "complementary colored, refer to Bingo App").
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const relLum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const WHITE = [255, 255, 255];
    function complement(c) {
      const hue = (rgbToHsl(c)[0] + 0.5) % 1;
      for (let l = 0.60; l >= 0.20; l -= 0.01) {
        const cand = hslToRgb([hue, 0.95, l]);
        if (contrast(cand, WHITE) >= 4.5) return cand;
      }
      return hslToRgb([hue, 0.95, 0.20]);
    }

    let current = DEFAULT_HEX;

    function applyTheme(hex) {
      const c = hexRgb(hex), r = document.documentElement.style;
      r.setProperty("--bg", css(darken(c, .70)));
      r.setProperty("--bg1", css(darken(c, .80)));
      r.setProperty("--bg2", css(darken(c, .95)));
      r.setProperty("--hover", css(darken(c, .30)));
      r.setProperty("--accent", css(darken(c, .70)));
      r.setProperty("--accent-hover", css(lighten(c, .40)));
      r.setProperty("--cta", css(complement(c)));
      // Weapon Trees' factor, verbatim — unless a chroma backdrop is overriding it.
      r.setProperty("--stage", STAGES[stageMode] || css(darken(c, .18)));
      r.setProperty("--text", "#ffffff");
      r.setProperty("--text-dim", "#fffffff5");
      r.setProperty("--line", "rgba(11, 8, 8, 0.12)");
      r.setProperty("--card", "rgba(255,255,255,0.05)");

      current = hex;
      try { localStorage.setItem(KEY, hex); } catch (e) { /* private mode */ }

      document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("sel", s.dataset.hex === hex));

      // Flat for a chroma key, textured for a theme colour. The canvas is transparent, so
      // .content is what shows and this is the only switch needed.
      document.documentElement.classList.toggle("chroma", stageMode !== "theme");
      const icon = document.querySelector(".title-icon");
      if (icon) {
        const t = byHex.get(hex.toUpperCase());
        icon.src = t ? monsterIcon(t.icon || t.name) : FALLBACK_ICON;
        icon.alt = t ? t.name : "";
      }
    }

    function renderSwatches() {
      const grid = document.getElementById("swatches");
      if (!grid) return;
      grid.textContent = "";
      for (const t of THEMES) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch" + (t.hex === current ? " sel" : "");
        b.dataset.hex = t.hex;
        b.style.background = t.hex;      // the tile IS the colour, as in every other app
        b.title = t.name;
        const img = document.createElement("img");
        img.className = "swatch-icon";
        img.alt = "";
        img.src = monsterIcon(t.icon || t.name);
        img.onerror = () => { img.onerror = null; img.src = FALLBACK_ICON; };
        const span = document.createElement("span");
        span.textContent = t.name;
        b.append(img, span);
        b.addEventListener("click", () => applyTheme(t.hex));
        grid.appendChild(b);
      }
    }

    let saved = DEFAULT_HEX;
    try { saved = migrateHex(localStorage.getItem(KEY)) || DEFAULT_HEX; } catch (e) { /* private mode */ }
    if (!byHex.has(saved.toUpperCase())) saved = DEFAULT_HEX;
    applyTheme(saved);
    renderSwatches();
    applyTheme(saved);   // re-run so the freshly drawn swatches get the `sel` marker

    const modal = document.getElementById("themeModal");
    document.getElementById("themeBtn").onclick = () => modal.classList.remove("hidden");
    const STAGE_BTN = { theme: "stgTheme", green: "stgGreen", blue: "stgBlue" };
    function setStage(mode) {
      stageMode = mode in STAGES ? mode : "theme";
      try { localStorage.setItem(STAGE_KEY, stageMode); } catch (e) { /* private mode */ }
      for (const m in STAGE_BTN) document.getElementById(STAGE_BTN[m]).classList.toggle("on", m === stageMode);
      applyTheme(current);   // re-derives --stage and repaints the scene
    }
    for (const m in STAGE_BTN) document.getElementById(STAGE_BTN[m]).onclick = () => setStage(m);
    setStage(stageMode);

    document.getElementById("themeClose").onclick = () => modal.classList.add("hidden");
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };
  })();

  // ---- the select-text restyle once the web font has loaded
// Once MHFU has swapped in, Chrome still draws each select's text too low, its bottom clipped,
// until the select is restyled: zooming the page does it, a repaint does not. A font-family round
// trip restyles them; the serif step is styled but never laid out. Kept out of the module so it is
// armed before the module's first await.
if (document.fonts) document.fonts.load('1em MHFU').then(() => {
  const selects = document.querySelectorAll('select');
  selects.forEach(s => { s.style.fontFamily = 'serif'; });
  selects.forEach(s => getComputedStyle(s).fontFamily);
  selects.forEach(s => { s.style.fontFamily = ''; });
}, () => {});

  // ---- the wheel over a closed dropdown, and the sidebar accordion (moved from the module, 2026-10-18)
  // the panes the accordion scopes to: game.paneTabs' panes, as a selector ('' = the whole document)
  const PANES = (G.paneTabs || []).map(function (t) { return '#' + t[1]; }).join(', ');
  // THE WHEEL STEPS A DROPDOWN, CLOSED. The Monster Viewer's control, brought over as it is
  // (its index.html, commit f10d041). Raven there, 2026-09-23: "Is it possible to have scrollable dropdown menus?",
  // "what the user wants is to be able to somehow scroll through the items", "Without needing to go into the drop down".
  // This engine does nothing with the wheel over a closed <select>, so one notch moves the selection by one option here
  // -- disabled entries and the group headings skipped, and clamped at both ends rather than wrapping, so a flick cannot
  // jump from the last monster to the first. The panel does not scroll under the pointer while it happens, which is what
  // makes the gesture readable: the wheel is either moving the list or moving the panel, never both.
  //   THE CHANGE FIRES WHEN THE WHEEL SETTLES (STEP_HOLD). Each of these dropdowns does real work -- a monster mounts a
  // model, a clip loads a pose -- so a flick through ten of them would otherwise start ten loads and keep only the last.
  // The control shows every step as it goes; the work runs once, on the one the wheel stopped at.
  //   ONE STEP PER NOTCH. A mouse notch arrives as a single event of 100 px or so -- the size differs by mouse and by
  // system -- so any event that big is one item, whatever the number says: three notches move three, never seven. A
  // trackpad and a high-resolution wheel instead send a stream of small ones, which would race through the list an item
  // per event, so those are added up and take a step every STEP_PX of travel. The tally is dropped when the pointer moves
  // to another dropdown or the wheel rests (STEP_REST).
  {
    const STEP_HOLD = 140, STEP_PX = 50, NOTCH = 50, STEP_REST = 400;
    const LINE = 16, PAGE = 400;                 // deltaMode 1 is lines, 2 is pages
    let stepTimer = null, stepping = null, acc = 0, accSel = null, accAt = 0;
    const fire = () => {
      stepTimer = null;
      const sel = stepping; stepping = null;
      if (sel && sel.isConnected) sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    addEventListener('wheel', e => {
      const sel = e.target && e.target.closest && e.target.closest('select');
      // a list box (size > 1) or a multiple select scrolls as a list of its own: leave those alone
      if (!sel || sel.disabled || sel.multiple || sel.size > 1 || !sel.options.length) return;
      e.preventDefault();                        // the panel stays where it is, whether or not this moves the list
      const now = performance.now();
      if (accSel !== sel || now - accAt > STEP_REST) acc = 0;
      accSel = sel; accAt = now;
      const d = (e.deltaY || 0) * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? PAGE : 1);
      let steps;
      // a notch: an event counted in lines or pages is one by definition, and in pixels one that carries a notch's travel
      if (e.deltaMode !== 0 || Math.abs(d) >= NOTCH){ steps = Math.sign(d); acc = 0; }
      else { acc += d; steps = Math.trunc(acc / STEP_PX); acc -= steps * STEP_PX; }
      if (!steps) return;
      const dir = Math.sign(steps);
      let i = sel.selectedIndex;
      for (let n = Math.abs(steps); n > 0; n--){
        let next = i;
        for (let k = i + dir; k >= 0 && k < sel.options.length; k += dir){
          const o = sel.options[k];
          if (o.disabled || (o.parentElement && o.parentElement.disabled)) continue;
          next = k; break;
        }
        if (next === i) break;                   // that end of the list
        i = next;
      }
      if (i === sel.selectedIndex) return;
      sel.selectedIndex = i;
      if (stepping && stepping !== sel) fire();   // the pointer moved to another dropdown mid-flick
      stepping = sel;
      clearTimeout(stepTimer);
      stepTimer = setTimeout(fire, STEP_HOLD);
    }, { passive: false, capture: true });
  }

  // Collapsible sidebar panels, matching the sibling apps -- but as an ACCORDION:


  // opening one closes the rest, so the sidebar never grows past the viewport.
  // Clicking the open panel still closes it, leaving all of them shut.
  // LOCKED UNTIL THE MODEL IS IN (game.panelsUntilReady; Raven, 2026-10-19: "Have the panels closed by default and
  // non-openable until the model loads in"): every panel starts shut and its head does nothing while the page carries
  // the class 'booting'; the app sends `document.dispatchEvent(new Event('viewer-ready'))` once its model is drawn,
  // which unlocks them. An app that does not set the flag keeps its markup's open panel, as before.
  const LOCK = !!G.panelsUntilReady;
  if (LOCK){
    document.body.classList.add('booting');
    document.querySelectorAll('.panel').forEach(p => p.dataset.open = 'false');
    document.addEventListener('viewer-ready', () => document.body.classList.remove('booting'), { once: true });
  }
  document.querySelectorAll('.panel-head').forEach(h => {
    h.onclick = () => {
      if (document.body.classList.contains('booting')) return;
      const p = h.parentElement;
      const wasOpen = p.dataset.open === 'true';
      const pane = (PANES && p.closest(PANES)) || document;
      pane.querySelectorAll('.panel').forEach(o => o.dataset.open = 'false');
      p.dataset.open = wasOpen ? 'false' : 'true';
    };
  });
  // Start with a single panel open PER PANE (game.paneTabs' panes; none: the document). Scoping this to the document
  // closed GU's Palico Equipment panel, because the hunter's is first in the markup and won. The markup
  // now opens only Equipment in each pane, so this is a safety net and nothing moves on load
  // (Raven, 2026-09-03: the Hunter panel showed open, then clamped shut).
  (() => {
    for (const pane of (PANES ? document.querySelectorAll(PANES) : [document])){
      const open = [...pane.querySelectorAll('.panel')].filter(p => p.dataset.open === 'true');
      open.slice(1).forEach(p => p.dataset.open = 'false');
    }
  })();
})();
