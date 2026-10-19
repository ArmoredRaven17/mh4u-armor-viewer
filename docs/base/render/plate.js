// The floating name plate (Raven, 2026-09-05: "in game, we have our name along with a weapon
// icon float above our hunters, this can be toggled to show our guild card names ... display
// the nameplate over the hunters head").
//
// What the game does (build/notes/nameplate.md, read from the executable): the plate is text
// in one colour, chosen from the hunter rank, with the weapon class's icon in front of the name
// as a glyph of the icon font, and a second line "(name)" under it. It is a HUD object: the game
// never sees the hunter from another angle, so its plate is flat on the screen. Here the hunter
// can be seen from anywhere, so the plate is a camera-facing sprite that keeps a constant size
// on screen (sizeAttenuation off, like a HUD label) and rides above the head joint; it is part
// of the scene, so it lands in screenshots and clips and goes through the effects like the rest.
//
// The plate's picture is painted on a 2D canvas at three times its screen size and shown
// through a CanvasTexture; the weapon glyph comes from ui/plate-icons.png (build-plate-icons.py
// cuts it from the game's font sheet, an intensity + alpha texture) and is multiplied by the
// rank colour, so its shading and dark outline survive the tint.
import * as THREE from 'three';

// The rank bands and their colours are the GAME's (game.guildInfo.hrBands: [{ hr, max, color, label }], each band's
// first rank `hr`, its last `max`; GU's are read from the executable, see docs/game.js). hrColor picks a rank's band.
export function hrColor(bands, hr){
  hr = Math.max(0, +hr || 0);
  return (bands.find(b => hr <= b.max) || bands[bands.length - 1]).color;
}

// the icon sheet's cell size (opts.iconCell; GU's ui/plate-icons.png: 24); a cell's index is the game's weapon enum
const ICON_CELL_DEFAULT = 24;

const S = 3;          // canvas pixels per screen pixel: crisp text after the sprite is minified
const NAME_PX = 20;   // the name's font size on screen
const SUB_PX = 15;    // the second line's
const ICON_PX = 24;   // the glyph's box on screen
const PAD_PX = 8;

export function createPlate(opts){
  opts = opts || {};
  const font = opts.font || "'MHFU', 'Segoe UI', system-ui, sans-serif";
  const ICON_CELL = opts.iconCell || ICON_CELL_DEFAULT;
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 4;
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  // A canvas texture keeps the GPU storage it was first given, so a plate that grew (a title
  // line added, a longer name) uploaded into the old size and the old picture stayed on screen.
  // The texture is remade whenever the canvas changes size.
  let tex = null, mat = null;
  function freshTexture(){
    if (tex) tex.dispose();
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    if (mat){ mat.map = tex; mat.needsUpdate = true; }
    return tex;
  }
  // Drawn over everything (AlwaysDepth) but still WRITING depth where it is opaque, so the
  // depth of field takes the plate at the head's depth rather than as far background.
  mat = new THREE.SpriteMaterial({ map: freshTexture(), transparent: true, sizeAttenuation: false, toneMapped: false,
                                   depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, alphaTest: 0.05 });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0);          // the anchor is the plate's bottom middle
  sprite.renderOrder = 1000;
  sprite.frustumCulled = false;
  sprite.visible = false;
  sprite.name = 'namePlate';

  const icons = new Image();
  let iconsReady = false;
  icons.onload = () => { iconsReady = true; painted = ''; repaint(); };
  if (opts.iconUrl) icons.src = opts.iconUrl;

  let spec = null, painted = '', fontReady = false;
  if (document.fonts && document.fonts.load){
    document.fonts.load('bold ' + (NAME_PX * S) + 'px ' + font).then(() => { fontReady = true; painted = ''; repaint(); }).catch(() => {});
  }

  function repaint(){
    if (!spec) return;
    const key = JSON.stringify(spec) + '|' + iconsReady + '|' + fontReady;
    if (key === painted) return;
    painted = key;
    const line1 = String(spec.line1 || ''), line2 = String(spec.line2 || ''), color = spec.color || '#ffffff';
    const hasIcon = iconsReady && Number.isInteger(spec.icon) && spec.icon >= 0;
    const f1 = 'bold ' + (NAME_PX * S) + 'px ' + font, f2 = 'bold ' + (SUB_PX * S) + 'px ' + font;
    ctx.font = f1; const w1 = ctx.measureText(line1).width;
    ctx.font = f2; const w2 = line2 ? ctx.measureText(line2).width : 0;
    const icon = hasIcon ? ICON_PX * S : 0, gap = hasIcon ? 5 * S : 0, pad = PAD_PX * S;
    const h1 = Math.round(NAME_PX * 1.3 * S), h2 = line2 ? Math.round(SUB_PX * 1.3 * S) : 0;
    const W = Math.ceil(Math.max(icon + gap + w1, w2) + 2 * pad), H = h1 + h2 + 2 * pad;
    const resized = canvas.width !== W || canvas.height !== H;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);                // a same-size repaint would otherwise keep the old text
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    // line 1: the glyph, then the name
    const x0 = (W - (icon + gap + w1)) / 2, y1 = pad + h1 / 2;
    if (hasIcon){
      off.width = off.height = icon;
      const o = off.getContext('2d');
      o.clearRect(0, 0, icon, icon);
      o.drawImage(icons, spec.icon * ICON_CELL, 0, ICON_CELL, ICON_CELL, 0, 0, icon, icon);
      o.globalCompositeOperation = 'multiply';        // colour x the glyph's intensity: the shading and the dark outline stay
      o.fillStyle = color; o.fillRect(0, 0, icon, icon);
      o.globalCompositeOperation = 'destination-in';  // and the glyph's own alpha is the shape again
      o.drawImage(icons, spec.icon * ICON_CELL, 0, ICON_CELL, ICON_CELL, 0, 0, icon, icon);
      o.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 2.5 * S;
      ctx.drawImage(off, x0, y1 - icon / 2);
      ctx.drawImage(off, x0, y1 - icon / 2);          // twice: a solid dark rim, like the outlined text
      ctx.restore();
    }
    ctx.font = f1; ctx.lineWidth = 4 * S; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(line1, x0 + icon + gap, y1); ctx.fillStyle = color; ctx.fillText(line1, x0 + icon + gap, y1);
    if (line2){
      const y2 = pad + h1 + h2 / 2, x2 = (W - w2) / 2;
      ctx.font = f2; ctx.lineWidth = 3.5 * S;
      ctx.strokeText(line2, x2, y2); ctx.fillText(line2, x2, y2);
    }
    if (resized) freshTexture(); else tex.needsUpdate = true;
  }

  // The sprite's scale is in a screen-relative unit when size attenuation is off: the quad's
  // height in clip space is scale.y * projection[1][1], i.e. scale.y / tan(fov / 2) for a
  // perspective camera and scale.y / halfHeight for an orthographic one. So for a plate of
  // `px` screen pixels in a view `viewH` pixels tall: scale.y = 2 px / viewH * tan(fov / 2).
  function update(cam, viewH){
    if (!spec || !viewH) return;
    const k = cam.isOrthographicCamera ? (cam.top - cam.bottom) / 2 : Math.tan(THREE.MathUtils.DEG2RAD * cam.fov / 2);
    const px = canvas.height / S;
    const sy = 2 * px / viewH * k;
    sprite.scale.set(sy * canvas.width / canvas.height, sy, 1);
  }

  return {
    sprite,
    paint(s){ spec = s; repaint(); },
    update,
    setVisible(v){ sprite.visible = !!v; },
    size(){ return { w: canvas.width / S, h: canvas.height / S }; },   // on screen, pixels
    dispose(){ if (tex) tex.dispose(); mat.dispose(); }
  };
}
