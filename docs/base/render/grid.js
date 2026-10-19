// FLOOR GRID: lines on the monster's floor, one a metre apart and a heavier one every ten. Raven, 2026-09-18: "Can
// we have a grid for the floor of the render space? Make it toggle-able in the camera settings." A measuring aid of
// the viewer's own, not anything the game draws.
//
// AND THE OTHER FIVE SIDES OF THE BOX. Raven, 2026-09-23, on Khezu: "The wall and ceiling don't need to be too
// complex, we are simply making a box... We hide the wall and ceiling, when we need to display a monster on the wall,
// we show the wall grid, if we need a ceiling we show the ceiling." A monster that clings to a wall or hangs from a
// ceiling is playing a motion that assumes a surface there, and with only a floor the viewer shows it in mid-air.
// The same grid draws all three: what changes is the plane it lies in, which is two world-space axes and an offset.
// The wall is not only a backdrop -- render/shells.js's stage stand-in answers wall queries against a plane the
// viewer supplies, and Khezu's ground lightning stops at one, as the ROM stops it.
//
// The lines are worked out per pixel from the world position, not drawn as geometry, so they stay one pixel wide
// at a glancing angle, and a set of cells fades out as it shrinks toward a few pixels instead of shimmering. They
// are fixed in the world: with the monster held in place the grid sits still under it, and with the hold off the
// lines slide under a walking monster, showing its travel. The patch they are drawn on follows the monster and
// fades out at a radius set by its size, so a Konchu and a Dalamadur both get a floor with no edge in sight.
// The lines take the opposite of the backdrop -- white on a dark stage, black on a light one or a chroma key --
// since the canvas is transparent and the backdrop is CSS the grid cannot see.
import * as THREE from 'three';

const MINOR = 1, MAJOR = 10;              // metres per cell
const MINOR_ALPHA = 0.16, MAJOR_ALPHA = 0.34;
const REACH_K = 4, RADIUS_MIN = 15, RADIUS_MAX = 500;
const FADE_START = 0.45;                  // of the radius

const VERT = /* glsl */`
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec2 uCentre;
uniform float uRadius;
uniform vec3 uU;                  // the plane's two world axes: the floor's are x and z, a wall's are its own two
uniform vec3 uV;
varying vec3 vWorld;
// coverage of the lines of a grid with the given cell: 1 on a line, 0 a pixel or more away from one; the lines
// are width pixels wide, and the whole set fades out as a cell narrows toward a few pixels
float lines(vec2 p, float cell, float width){
  vec2 c = p / cell;
  vec2 d = max(fwidth(c), vec2(1e-6));
  vec2 g = abs(fract(c - 0.5) - 0.5) / d / width;
  float on = 1.0 - min(min(g.x, g.y), 1.0);
  return on * (1.0 - smoothstep(0.12, 0.3, max(d.x, d.y)));
}
void main(){
  vec2 p = vec2(dot(vWorld, uU), dot(vWorld, uV));
  float a = max(lines(p, ${MINOR.toFixed(1)}, 1.0) * ${MINOR_ALPHA.toFixed(2)},
                lines(p, ${MAJOR.toFixed(1)}, 1.5) * ${MAJOR_ALPHA.toFixed(2)});
  a *= 1.0 - smoothstep(uRadius * ${FADE_START.toFixed(2)}, uRadius, length(p - uCentre));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

// THE PLANES THE BOX IS MADE OF. `floor` and `ceiling` lie flat and are placed by a height; `wallX` is perpendicular
// to world x and `wallZ` to world z, each placed by its own coordinate. `u` and `v` are the two world axes the lines
// run along, `n` the plane's normal, and `along` which component of the centre point slides the patch along the
// plane with the monster (the floor and ceiling take both; a wall takes its own two).
const PLANES = {
  floor:   { rx: -Math.PI / 2, ry: 0,             u: [1, 0, 0], v: [0, 0, 1], axis: 'y', along: ['x', 'z'] },
  ceiling: { rx:  Math.PI / 2, ry: 0,             u: [1, 0, 0], v: [0, 0, 1], axis: 'y', along: ['x', 'z'] },
  wallX:   { rx: 0,            ry: Math.PI / 2,   u: [0, 0, 1], v: [0, 1, 0], axis: 'x', along: ['z', 'y'] },
  wallZ:   { rx: 0,            ry: 0,             u: [1, 0, 0], v: [0, 1, 0], axis: 'z', along: ['x', 'y'] },
};

// floor(): the world y the grid lies at. centre(out): the point its patch is centred under (x and z are used).
// reach(): the monster's horizontal half-size, which sets the patch's radius. All three are read every frame.
export function createFloorGrid(opts){ return createGrid({ ...opts, kind: 'floor', at: opts.floor }); }

// the same grid in any of the box's planes. `at()` gives the plane's own coordinate (a height for the floor and
// ceiling, an x or z for a wall) in world units, read every frame like the floor's.
export function createGrid({ scene, kind = 'floor', at, floor, centre, reach }){
  const P = PLANES[kind];
  if (!P) throw new Error('grid: no plane ' + kind);
  at = at || floor;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uCentre: { value: new THREE.Vector2() }, uRadius: { value: 50 },
                uU: { value: new THREE.Vector3(...P.u) }, uV: { value: new THREE.Vector3(...P.v) } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    // pulled toward the camera, so it lies on top of a background's ground at the same height instead of fighting it
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = kind + '-grid';
  mesh.rotation.set(P.rx, P.ry, 0);
  mesh.renderOrder = -997;                 // after a background's sky and ground, before the monster's translucency
  mesh.frustumCulled = false;
  mesh.visible = false;
  const c = new THREE.Vector3();
  let backdropAt = -Infinity;
  const backdrop = document.querySelector('.content');
  mesh.onBeforeRender = () => {
    const y = at ? at() : 0;
    if (centre) centre(c); else c.set(0, 0, 0);
    const r = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, REACH_K * (reach ? reach() : 5)));
    // the patch slides along its own plane with the monster and sits at the plane's own coordinate
    if (Number.isFinite(y)){
      const p = { x: c.x, y: c.y, z: c.z };
      p[P.axis] = y;
      mesh.position.set(p.x, p.y, p.z);
    }
    mesh.scale.set(r, r, 1);
    mesh.updateMatrixWorld();
    material.uniforms.uCentre.value.set(c[P.along[0]], c[P.along[1]]);
    material.uniforms.uRadius.value = r;
    // the backdrop's brightness, looked at once a second: a theme or a chroma key can change it at any time
    const now = performance.now();
    if (backdrop && now - backdropAt > 1000){
      backdropAt = now;
      const m = getComputedStyle(backdrop).backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3){
        const lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
        material.uniforms.uColor.value.setScalar(lum < 0.5 ? 1 : 0);
      }
    }
  };
  scene.add(mesh);
  return {
    set(on){ mesh.visible = !!on; },
    get on(){ return mesh.visible; },
    info(){ return { kind, on: mesh.visible, at: +mesh.position[P.axis].toFixed(3), y: +mesh.position.y.toFixed(3),
                     radius: +material.uniforms.uRadius.value.toFixed(2),
                     centre: [+mesh.position.x.toFixed(2), +mesh.position.y.toFixed(2), +mesh.position.z.toFixed(2)],
                     colour: material.uniforms.uColor.value.r ? 'white' : 'black' }; },
  };
}
