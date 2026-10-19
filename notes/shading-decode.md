# MH4U MaterialStd shading -- decode notes

Raven, 2026-10-18: "Decode 4U shading now". Order (the coordinator's): (1) how CBMaterialStd reaches the GPU, (2)
PS_MaterialStd's TexEnv0-5 chain, (3) the fragment lighting (LightEnv, the Rl / FR / SP LUT selectors), (4) the
tLutShininess / tLutFresnel contents, (5) the equipment-preview light setup. Every address here is in
`C:\MH4U-Extract\exefs\code.decompressed.bin` (base 0x100000) unless it says `lfx` (romfs
`system\ltshader\LtShaderPackage.lfx`, the shader package, MFX v52).

## Reusing this on another 3DS MT game (MH3U's 3DS build: same PICA200, MFX v52)

THE TOOLS take the game's files as arguments (the MH4U paths and addresses are only defaults):
  scripts/pica.py <file> [DVLE offset]            disassembles every DVLE in any file (game-free)
  scripts/tev_apply.py --exe X --lfx Y <mrl> [n]  runs the game's MaterialStd apply on a material and decodes it;
                                                  --apply / --find-cb / --find-tex / --clamp for another game's addresses
  scripts/lut_gen.py <mrl> --exe X --gen A        runs the game's LUT generator on a .mrl's LUT definitions
  scripts/sdl_lights.py <scheduler file>          prints a scheduler file's lights (the SDL format; game-free)
The CB parameter word and the technique's program are read from the lfx (tev_apply.param_word, technique_program).

GAME-FREE FACTS (the PICA200, 3dbrew; the MT formats as read here):
  * TEV: SOURCE / OPERAND / COMBINER / CONSTANT / SCALE per stage, six stages; UPDATE_BUFFER bits 8-11 / 12-15; the
    buffer lags a stage (stage i sees it as of stage i - 2); every stage clamps (tev_apply.py's header has the
    enumerations).
  * Fragment lighting: CONFIG0 (env config bits 4-7, Fresnel selector 2-3, clamp highlights 27), CONFIG1 (per-light
    shadow / spot / distance-attenuation disables 0-7 / 8-15 / 24-31, LUT disables 16-22), LUTINPUT_ABS (a set bit
    DISABLES abs for that input), LUTINPUT_SELECT, LUTINPUT_SCALE; per light 0x140 + 16 n: specular0, specular1,
    diffuse, ambient, then position (float16 x, y / z), spot direction, config (bit 0 directional).
  * A LUT read: entry floor(x x 256) (abs input) + delta x fraction; held as value x 4095, delta x 2048.
  * MT's material colour words: three 10-bit fields, 256 = 1.0 for diffuse / specular; the driver writes light byte x
    material word >> 8.
  * MFX v52 (lfx): header [3] records, [4] programs, [6] program table, [8] string table; program object +0x48 lighting
    words, +0x4c default fragment state (0x84), +0x50 lighting colours (0x14); technique record word 5 = first
    program; parameter word = (jamcrc(name) & 0xfffff) << 12 | record index.
  * .mrl: a texture entry with type hash 0 is a LUT definition (lut_gen.py's header).
  * Scheduler (SDL) files hold a scene's lights by name; uLight-family fields: mGroup, mAttr, mColor, mBalance, mDir,
    mRevColor (sdl_lights.py).

METHOD -> MH4U ADDRESS (repeat the method, read the new address):
| what | how it was found | MH4U |
|---|---|---|
| MaterialStd apply | the DTI name "nDraw::MaterialStd" -> its DTI -> the vtable its constructor stores -> vtable +0x3c (the function that looks up CBMaterialStd by its parameter word and writes 10-bit colours at material +0xf4) | 0x62a900 (vtable 0xe7ae6c, DTI 0x10e6ea4) |
| CB lookup, texture lookup | the apply's first calls: (material, parameter word) -> CB floats / bound texture | 0xcfafa4, 0xcfae80 |
| clamp vector | the literal the apply clamps colours against (a .bss vec4 set at boot to 1, 1, 1, 1) | 0x10e62d0 |
| material constructor | the code that copies program +0x4c / +0x50 into a new material | 0x638b78 (via 0xbfc4bc / 0xbfc4e8) |
| GL driver's lighting upload | search the code for the command header 0x803f0140 / 0x80bf0000 \| 0x140 + 16 n (a 12-word write to a light's registers) | 0xbf9780 |
| LUT generator | the material loader's texture loop, branch on a zero type hash -> the function switching on the definition's type | loop 0xbe6928, generator 0xbe7388, powf 0xd13778, curve 0xcde3fc, encoder 0x6359e4 |
| light colour split | uLight's vtable (from the "mBalance" property registration's class) slot 7, the move: reads +0x38 balance and +0x48 colour, writes packed words | 0x956ee4 (props 0x955bbc) |
| light register block | the only caller pattern packing float16 (exponent - 0x70) from mDir; called by the light-set builder | 0x955df8 |
| light-set builder | the caller of the register block that fills a 16-word environment and orders lights | 0x6bee18 |
| hemisphere -> SH | search the code for the float 0.282095 (Y00): it sits beside the hemisphere class; its projection constants 3.06998 / 5.31736 | 0x3a1fa0 -> 0x5a42ec (picked by 0x6c00e0) |
| a scene's light file | the format string "stage\%s\%s\sdl\%s-f" and any literal "...-f" path | stage 0x234208 (0x234048), player\char_make-f 0xb7ad90 / 0xbe0bb0 |
| units by name | the function holding "StageDataSet", "base01-InfiniteLight", ... as literals | 0x6c1080 |

## The shader package (lfx)

Header: 'MFX', version 0x34, 0x64, hash, 0x31c records, 0xa7, 0x6e DVLBs, 0x14cf8, 0x2845a, string table 0x23534,
shader binaries 0x28eb0. Records from 0x2c: [nameOff, classOff, kind | ..., index << 16, ...]; the loader is
0xbe59ac (checks 'MFX' / 0x34 / 0x64, relocates each record by kind: 1 = constant buffer, 3 = state / program, 8 / 10
= technique).

CBMaterialStd = record 0x126 (lfx 0x7cb0), 23 members from lfx 0x7cd4, 28-byte entries [nameOff, typeWord, flags, 0,
floatOffset << 8, annotationPtr, 0] (GU's mfx layout):

| float | member | UI annotation (Shift-JIS) |
|---|---|---|
| 0 | fMaterialStdEmission | "self-illumination" |
| 4 | fMaterialStdDiffuse | RGB diffuse colour, A transparency |
| 8 | fMaterialStdSpecular | RGB specular colour, A specular strength |
| 12 | fMaterialStdReflect | "mirror-reflection colour" |
| 16 | fMaterialStdAmbient | "ambient colour" |
| 20 | fMaterialStdAlbedoColor | "albedo colour" |
| 24 | fMaterialStdPreLightScale | "pre-lighting coefficient" |
| 28.. | bUVSphereMap, bFresnelEnable, bVertexOcclusion, bVertexAlpha, bVertexColorShadow, bAlbedoAlpha, iUVExtend, iAlbedoType, iSpecularMaskType, iSpecularMaskExType, iSpecularColorType, iReflectionType, bReflectionMask, bMirrorNormal, bEnvMap, bShadowMap | |

A material animation track's member word (GU's build-matanim.py layout): bits 22-31 the CB record, 12-21 the float
offset, 10-11 cols - 1, 8-9 rows - 1. 0x49800c01 = CBMaterialStd float 0 = fMaterialStdEmission; 0x4980cc01 = float
12 = fMaterialStdReflect.

PS_MaterialStd (record 0x252, lfx 0xf9dc) declares state blocks only (u16 list at lfx 0xfa28): DMP_TexEnv0-5
(0x1bf-0x1c4), tShadowMap, DMP_Sampler0-3, DMP_LightEnvShadow, tAlbedoMap, tExtendMap, DMP_Texture3, tProceduralMap,
DMP_LayerConfig1, DMP_LightEnvRl (0x1d7), DMP_LightEnvFR (0x1d9), DMP_LightEnvSP (0x1d8), tLutShininess,
DMP_LutSampler, tLutFresnel, DMP_FragmentMaterial (0x1c9), DMP_FragmentLighting (0x1c7), DMP_Fog. The DMP state
records (0x4c bytes each, e.g. DMP_TexEnv0 lfx 0xcbd4, DMP_FragmentMaterial lfx 0xcecc) carry a member count (word 5:
0xa0a TexEnv, 0x505 FragmentMaterial) and no values. The package holds no fragment program: its binaries are the 110
DVLBs (vertex / geometry shaders).

## Step 1 -- what is read

VERTEX SIDE (read; scripts/pica.py disassembles the DVLEs). Of the CB colours only fMaterialStdAmbient (c29) and
fMaterialStdPreLightScale (c28) are vertex uniforms (DVLEs lfx 0x2c288, 0x2d208, 0x31254; with bMaterialStdVertexAlpha,
UVSphereMap, ShadowMap, EnvMap, MirrorNormal). In VS lfx 0x2c288 the vertex colour o1 is:
  * with vertex colours (bIAVertexColor): v = vertexColour / 255 (c93.w); v / (1.000992 - v) (c93.z) -- an expansion
    so a byte can carry values above 1 -- times fMaterialStdPreLightScale; alpha from the vertex with
    bMaterialStdVertexAlpha;
  * else with bIAUVUnique: fMaterialStdAmbient, flat;
  * else: 0.5 (c94.x) x dot(fSHCoef[i], (normal, 1)) -- spherical-harmonics ambient.
Shader constants: c92 (0, 1/2pi, 3, 0.25), c93 (2, 3.05e-5, 1.000992, 1/255), c94 (0.5, 1/127, 0, 1), c95 (1, 0, 0, 0).

FRAGMENT SIDE, the hardware half (read): the GL driver's lighting upload (0xbf98f4..0xbf9b7c) holds the material colours
as packed 10-bit words [ambient, emission, diffuse, specular0, specular1] and writes, per light i, register 0x140 + 16i
= light colour 0 x material specular0, 0x141 + 16i = colour 1 x specular1, 0x142 + 16i = colour 2 x diffuse, 0x143 +
16i = colour 3 x ambient; the global ambient = emission + ambient x scene ambient. The driver's uniform table is
0xe43b5c ({id, count, GL type, name}; dmp_FragmentMaterial.emission id 0x34, ambient 0x35, diffuse 0x36, specular0
0x37, specular1 0x38); its init 0xd14798.

THE ENGINE (partly read): the engine's 67 fixed-function uniform names, 0xe39824 (1-60 dmp_TexEnv[0-5] fields, 61-62
dmp_Texture[2/3].texcoord, 62-66 dmp_FragmentMaterial emission / ambient / diffuse / specular0 / specular1). The
program link 0xbe52d8 gets a GL location for every uniform a program declares and matches the name against that list,
writing the index into the uniform's descriptor (bits 14-20; flags +0x14 |= 2 for a TexEnv field, |= 4 for a material
colour). The per-draw command builder 0xbf6c38 walks the descriptors: bits 0-4 CB slot, 5-13 float offset, 14-20 the
target, 28-31 type; three CB words pack into one byte-colour register. The MRL material's state word 7 (0x84800000 on
the glow material, 0x88800000 on the blade's `_add_`) is a per-material feature word, not yet decoded.

## Step 1 -- READ (2026-10-18): how CBMaterialStd reaches the GPU

THE APPLY: nDraw::MaterialStd's vtable (0xe7ae6c) +0x3c = 0x62a900 (decompiled through Ghidra headless, scripts in
C:\Tools\ghidra_scripts\Decomp4U.java). It finds the material's CBMaterialStd (0xcfafa4(material, 0x16a5b126)) and
writes the material's FRAGMENT STATE at material +0x70. Laid out as the PICA's registers: six combiner (TEV) stages of
0x14 bytes from material +0x7c -- SOURCE, OPERAND, COMBINER, CONSTANT COLOR (RGBA bytes), SCALE -- so stage n's
constant colour is material +0x88 + 0x14 n; then the fragment-lighting material colours, five packed words of three
10-bit fields (R 20-29, G 10-19, B 0-9) at +0xf4 ambient, +0xf8 emission, +0xfc diffuse, +0x100 specular0, +0x104
specular1 (the GL driver's own order, 0xbf98f4: global ambient = emission + ambient x scene ambient; per light
specular0 / specular1 / diffuse / ambient x the light's colours).

| CBMaterialStd member | goes to | scale (0x62ae64.. constants) |
|---|---|---|
| Emission rgb | lighting EMISSION (+0xf8) | min(x * 0.5, 1) * 255 |
| Diffuse rgb | lighting DIFFUSE (+0xfc) | min(x, 1) * 256 |
| Diffuse a | TEV stage 5 constant ALPHA (+0xef) | min(x, 1) * 255 |
| Specular rgb | lighting SPECULAR1 (+0x104) | min(x, 1) * 256 |
| Specular a | TEV stage 2 constant ALPHA (+0xb3) | min(x, 1) * 255 |
| Reflect rgba | TEV stage 3 constant COLOR (+0xc4..0xc7) | min(x, 1) * 255 |
| Ambient rgb | lighting AMBIENT (+0xf4) x256, and TEV stage 1 constant RGB (+0x9c..0x9e) x255 | min(x, 1) |
| AlbedoColor rgba | TEV stage 0 constant COLOR (+0x88..0x8b) | min(x, 1) * 255; also the colour-by-type setter vtable +0x20 = 0x62a1d0 |
| Ambient, PreLightScale | also VERTEX uniforms c29 / c28 (the vertex colour, above) | |

(the clamp vector 0x10e62d0 = (1, 1, 1, 1), set at boot.) specular0 (+0x100) is not written by the apply.
THE SWITCHES: iAlbedoType -> stage 0 RGB (0x62a2bc); iSpecularMaskType / ExType -> stage 0 alpha (0x62b63c);
iSpecularColorType / iReflectionType / bReflectionMask -> stages 3 and 4 (0x62a45c); bVertexColorShadow, bAlbedoAlpha,
bVertexAlpha, bVertexOcclusion, bFresnelEnable flip nibbles of stages 1, 2, 4 (material +0x90, +0x98, +0xb8, +0xc0,
+0xd4); a bound tShadowMap with bMirrorNormal sets +0x70 bit 13. Read in step 2 against the PICA's TEV encoding.

SO THE TWO CHARGE BLADE MEMBERS: fMaterialStdEmission is the fragment lighting's EMISSION (added to the lit colour,
x 0.5 first); fMaterialStdReflect is the CONSTANT COLOUR of TEV stage 3 (what that stage does with it is step 2).

SUPERSEDED (kept for the trail): which CBMaterialStd member feeds which dmp_FragmentMaterial colour / TexEnv constant (the package's
per-program uniform lists name dmp_FragmentMaterial only for the ocean programs, lfx 0x2288c / 0x22a4c / 0x22c0c);
nDraw::MaterialStd (DTI 0x10e6ea4, registered 0xd515c0, vtable 0xe7ae6c) is generic. Ghidra headless (C:\Tools,
project C:\Tools\ghidra_proj4u, Temurin 21) is analysing the executable for the decompile.

## Steps 2 and 3 -- READ (2026-10-18): the TEV chain and the fragment lighting

THE DEFAULTS ARE PACKAGE DATA. The lfx header +0x10 = 167 programs, table at lfx 0x14cf8; the loader 0xbe59ac relocates
each program object's +0x1c (code), +0x3c (uniform names), +0x40 (CB / texture bindings), +0x48 (lighting registers,
0x18 bytes), +0x4c (fragment state, 0x84 bytes), +0x50 (lighting colours, 0x14 bytes). The material constructor
0x638b78 copies +0x4c / +0x50 into the material (through 0xbfc4bc / 0xbfc4e8: technique record +0x14 = first program
index, + pass). TMaterialStd (lfx 0x13948): word 5 = 0x1f -> programs 31 (BG pass, VS_MaterialStdBG + PS_MaterialStd)
and 32 (Obj pass, VS_MaterialStdObj + PS_MaterialStd); both carry the same fragment defaults (lfx 0x17378 / 0x17570).

scripts/tev_apply.py runs the game's apply (0x62a900) in unicorn on those defaults with a material's own CBMaterialStd
(stubbing 0xcfafa4 -> the CB, 0xcfae80 -> no shadow texture) and decodes the result with 3dbrew's TEV encoding
(SOURCE 0 vertex colour, 1 fragment primary, 2 fragment secondary, 3-6 texture 0-3, 13 buffer, 14 constant, 15
previous; texture units by PS_MaterialStd's order: 0 shadow map, 1 albedo, 2 extend map, 3 procedural). Header: word 1
= GPUREG_TEXENV_UPDATE_BUFFER (0xf700: RGB buffer from stages 0-2, alpha from 0-3; stage i reads the latest
buffer-updating stage <= i-2). For a MaterialStd with all switches 0 (the glow materials):

| stage | RGB | alpha |
|---|---|---|
| 0 | albedo x const (AlbedoColor) | const.a (AlbedoColor.a) |
| 1 | (const.a + const (Ambient)) x vertex colour -- with bVertexColorShadow, src0 = fragment secondary .a (shadow) | prev |
| 2 | (prev + fragment primary) x buffer (= stage 0) | prev x const.a (Specular.a) |
| 3 | fragment secondary .a (Fresnel) x const (Reflect) | albedo .a |
| 4 | (prev + fragment secondary) x buffer.a (= stage 2 alpha, Specular.a) | const.a |
| 5 | (prev + buffer (= stage 2)) x prev.a | buffer.a (stage 3) x const.a (Diffuse.a) |

So: RGB = albedo * AlbedoColor * (vertexColour + primary) + Specular.a * (Fresnel * Reflect + secondary); alpha =
albedo.a * Diffuse.a. (Constants are 8-bit; adds clamp at 1.)

THE FRAGMENT LIGHTING (program +0x48, the PICA registers, 3dbrew layouts):
  CONFIG0 0x880b041d: shadow factor on; Fresnel selector 3 (FR LUT into primary AND secondary alpha); light
  environment config 1 (FR, RR, SP, DA available; RR serves R, G and B); shadow attenuates primary, secondary and
  alpha; shadow map texture unit 0; clamp highlights on.
  CONFIG1 0x00070000: D0 and D1 off; FR, RR on; spot, shadow and distance attenuation on for every light.
  LUTINPUT_ABS 0x22 (abs off for D0, D1); LUTINPUT_SELECT 0x2400: SP on -L.P, FR on N.V, RR on N.H; LUTINPUT_SCALE 0
  (all 1x); word 5 0x00ff1fff not identified.
  So per light: primary += (light ambient x material ambient + light diffuse x material diffuse x max(L.N, 0)) x
  spot x distance x shadow; secondary += light specular1 x material specular1 (fMaterialStdSpecular) x RR(N.H)
  (tLutShininess) x [L.N > 0] x spot x distance x shadow (specular0 = 0: D0 is unavailable in config 1 and the
  material's specular0 is 0); primary starts at emission + ambient x scene ambient; both alphas = FR(N.V) (tLutFresnel).
  Default lighting colours (program +0x50): ambient 0, emission 0, diffuse 256, specular0 0, specular1 256.

## Step 4 -- READ (2026-10-18): the LUTs (tLutShininess / tLutFresnel)

No LUT file exists in any archive: a .mrl texture entry with type hash 0 IS a LUT definition. The material loader's
texture loop (0xbe6928, entries 0x4c apart) hands entry + 0xc to the generator 0xbe7388 and makes a LUT texture of the
result (0x6360b0, kind 1 -> 0x633770 -> 0x633e8c; the PICA encoding 0x6359e4: value x 4095, delta x 2048). The
definition: { type, format 13, width 512, height 1, p0, p1, p2, -, u16 x[8] at +0x20, u16 y[8] at +0x30 }. The table
is 256 values at x = i / 256 plus 256 deltas, each value p0 + clamp(v, 0, 1) * (p1 - p0), with
  type 0  v = p2;  type 1  v = x;  types 2 and 3  v = pow(x, p2) (0xd13778 is powf: run against Python's);
  type 4  v = p2 + (1 - p2) * pow(1 - x, 5) (Schlick, F0 = p2);  type 5  a cubic curve through 8 knots (x, y = u16 /
  65535, 0xffff = 1.0; 0xcde3fc, tangents from the neighbouring knots).
scripts/lut_gen.py runs 0xbe7388 itself on any .mrl's definitions. Seen: blade001 shininess type 2 pow(x, 16), Fresnel
type 4 Schlick F0 0.01; gaxe_sld_power_up_red shininess type 5 (1.0 at N.H = 0, 0 by 0.125), Fresnel type 5 (0.98 at
N.V = 0 falling to 0.1 by N.V = 0.56: a rim).


## Step 5 -- READ (2026-10-18): the light setup (character preview and villages)

WHERE THE LIGHTS COME FROM. Lights are scheduler units in a scene's "-f" scheduler file (type 4c0db839; layout and a
dumper in scripts/sdl_lights.py). A stage's set is stage\vNN\vNNaNN\sdl\vNNaNN-f (path 0x234208, loaded by
0x234048); the game finds the units by name (0x6c1080: StageDataSet, base01-InfiniteLight, base02-InfiniteLight,
base01-HemiSphereLight, MhFilter, ColorFog). The ONLY light file outside the stages is player\char_make-f
(core_title.arc; path 0xb7ad90 / 0xbe0bb0). Two scenes load it: 0xb7ab14 (vtable 0xe6c108, which also reads the
hunter's appearance bytes) and 0xbe09b0 (called from 0xbe00f8; it also builds that scene's camera: eye (0, 60, 305),
target (0, 93, 0), FOV 42, near 50, far 100000, constants 0xbe0bd4..). Neither scene's class name is read yet. No
separate equipment-preview light file exists: the item box is in the village, which uses its own stage set.

player\char_make-f (the character-creation light; the viewer's model):
  base01-InfiniteLight   Draw 1, mGroup 1, mColor (1.1, 1.1, 1.1), mBalance 0, mDir (0.3762, 0.3312, 0.8654)
  base01-HemiSphereLight Draw 1, mGroup 1, mAttr 2, mColor (0.1, 0.1, 0.1), mRevColor (0.4, 0.4, 0.4),
                         mDir (0.1874, 0.1475, 0.9711)
  BloomFilter (threshold 0.5, colour 0.7), ColorCorrectFilter (type 2 factor 0.53, type 5 factor 0.55,
  ToneCurveRGB (0.3333, 0.95, 0)) -- post filters, their maths not read.
  No base02, no CameraLight, no ambient light.
Villages (first key; Draw 0 lights omitted): v01 base01 (1.5, 1.44, 1.2) dir (-0.5, 0.866, 0), hemi (0.25) / rev
(0.685, 0.577, 0.415) dir (-0.5, 0.866, 0); v02 base01 (1.287, 1.183, 1.183) dir (-0.383, 0.866, 0.3214), hemi (0.1)
/ (0.48, 0.336, 0.32); v03 base01 1.5 dir (-0.6964, 0.7071, 0.1228), hemi 0.3 / (0.4, 0.5, 0.6); v04 base01 1.3
dir (0.5417, 0.7071, -0.4545), hemi 0.5 / (0.32, 0.4, 0.48). Every village also has CameraLight (0.08) in group
0xff01. StageDataSet (registered 0x33a028) holds Light[0..2] = the weather states' colour overrides
(lightN-inf1/inf2-Color/Balance, lightN-hemi-Color/RevColor).

THE CLASSES. uLight (properties 0x955bbc): +0x30 bits 0-10 = mAttr (getter 0xd02128, setter 0x9564dc), bits 11-13 =
light type (1 infinite, 2 point, 3 spot), bits 16+ = mPriority; +0x34 mGroup (a model draws a light when
mGroup & its mLightGroup); +0x38 mBalance; +0x48 mColor. uInfiniteLight (vtable 0xe60d88, ctor 0x362730: type 1,
mAttr 8) adds +0x3c ShadowGroup0 and +0xe0 mDir. uHemiSphereLight (properties 0x3a1f18) adds +0xe0 mRevColor and
+0xf0 mDir; its category (vtable +0x38 = 0xce368c) is 3.

COLOUR -> REGISTERS. 0x956ee4 (every uLight's move) splits mColor by mBalance b:
  k = 1 - |b| / 2;  diffuse = mColor * (1 + b) * k / 2;  specular0 = specular1 = mColor * (1 - b) * k / 2;
  ambient = 0; each channel min(x, 1) * 255 into packed words at +0x58 spec0, +0x5c spec1, +0x60 diffuse, +0x64
  ambient (constants 0x9571a8..: 1, 0.5, 2, 0, 255). At b = 0 a light's diffuse and specular are each half its mColor
  (char_make: 1.1 -> 0.55 -> 140).
0x955df8 builds the light's register block (0x140 + 16i onward): for type 1 the position words are mDir rotated into
view space (0x5de5b8 = the view matrix; skipped when mAttr bit 4), packed as float16, and CONFIG bit 0 (directional)
set: so mDir points TOWARDS the light (PICA directional lights take L = the position vector). mAttr bit 1 = not a
hardware light (the hemisphere's mAttr 2). The light-set builder 0x6bee18 takes, for a model's group, first the
unsorted lights (list +0x44), then point lights by priority within range (list +0x3c), up to the model's maximum;
per light, mAttr bits 0 / 1 / 2 ENABLE shadow / spot / distance attenuation (CONFIG1 is the XOR with 0xff00ffff), so
the infinite light (mAttr 8) has none of the three. The scene ambient (word 1) is the AMBIENT word of the group's
uAmbientLight (list +0x5c) -- neither char_make nor the villages has one, so it is 0 and the fragment primary starts
at the material's emission only. The driver (0xbf9780) then multiplies the light words by the material's (above).

THE HEMISPHERE IS THE VERTEX SHADER'S SH AMBIENT, not a GPU light. 0x6c00e0 picks the group's uHemiSphereLight and
calls 0x3a1fa0: mDir rotated into view space, then 0x5a42ec projects it (C = mColor, R = mRevColor; constants
0x5a43fc..: 0, sqrt(3 pi) 3.06998, 3 sqrt(pi) 5.31736, 0.5) to SH bands 0-1: L00 = (C + R) / 2 * 5.31736, L1 = (C -
R) / 2 * 3.06998 * (-d.y, d.z, -d.x); 0x3a1fa0 scales by 0.282095 / 0.325735 / 0.078848 (0x3a21b8) and stores per
channel fSHCoef = ((C - R) / 2 * d, 0.75 * (C + R)) at hemi +0x100 / +0x110 / +0x120 (R, G, B). So with the VS's 0.5:
  vertex colour = 0.375 * (C + R) + 0.25 * (C - R) * (N . d)
(char_make: 0.1875 - 0.075 * (N . d): 0.1125 facing the light's side, 0.2625 facing away). Without a hemisphere in the
group the scene default (draw context +0x10 -> +0x448) is used -- not read.

SO, FOR ONE CHARACTER-PREVIEW FRAGMENT (char_make, a MaterialStd, all switches 0):
  vtx = 0.375 (C + R) + 0.25 (C - R) (N . dh)                    hemisphere, per vertex
  primary = emission' + diffuseL x matDiffuse x max(N . L, 0)    diffuseL = 0.55, emission' = min(Emission x 0.5, 1)
  secondary = spec1L x matSpecular x RR(N . H) x [N . L > 0]     spec1L = 0.55, RR = tLutShininess
  RGB = albedo x AlbedoColor x (vtx + primary) + Specular.a x (FR(N . V) x Reflect + secondary)
UNREAD: the two scenes' class names; the default SH when no hemisphere; the post filters' maths; CameraLight
(uCameraLight, villages only); lighting word 5 0x00ff1fff.

## The render path (2026-10-18): built, an option, generic lighting the default

scripts/build_shading.py -> docs/shading.json (4.2 MB): runs the game's apply (0x62a900, tev_apply.py, one emulator
for every run) on all 23,054 nDraw::MaterialStd materials materials.json lists (class 0x5fb0ebe4; the 72
MaterialConstant and 196 class-0x3c8994e1 materials keep the generic path) and pools the result: 36 TEV programs, 30
LUTs (257 samples from 0xbe7388 itself), per material the six constants, the five lighting colour words, the LUT
indices (every material binds both tLutShininess and tLutFresnel), the tExtendMap slot (10,889 materials) and the
char_make light set. No program reads texture 0 (shadow) or texture 3 in a live argument (checked over the pool).

docs/render/shade4u.js chains onto the base material (piece.js attach4u), so masks, colours and visibility still act
on it, and switches by a uniform (Lighting -> "Game shading (MH4U, in progress)", off by default, remembered per
browser): the SH vertex colour, the PICA fragment lighting (registers floor(light8 x material10 / 256)), the LUT reads
(entry + delta x fraction, quantised x4095 / x2048), the TEV program generated per pool entry with the buffer's
one-stage delay (stage 5 reads stage 2's RGB and stage 3's alpha, as decoded), on encoded texels. fMaterialStd-
AlbedoColor = TEV 0's constant takes the unit's colour (applyColours -> setAlbedoColour4u). Mapless additive
materials (hidden on the generic path) draw on this one: an unbound albedo samples black, and Specular.a x (Fresnel x
Reflect + specular) can still add.

NOT YET IN IT: the CB glows (the stand-ins drive the generic material only, so with the option on they do not show);
material animations (CB writes into Emission / Reflect need the register mapping above: emission min(x x 0.5, 1) x 255
into the primary, Reflect into TEV 3's constant); 8-bit combiner precision; per-unit texture coordinates (every unit
samples the mesh's one UV set; TEXUNIT word 0x2200 vs 0x200 says tex2 takes its own coordinates on the extend-map
programs); vertex alpha (taken as 1); the post filters.
TEXTURE 2's COORDINATES (read 2026-10-18 from the vertex shader, pica.py on lfx 0x2c288): the VS has bIAUVExtend (b13)
and fUVTransform2 (c35-c36), so the extend map takes the mesh's SECOND UV set (UV extend) through fUVTransform2 --
which is what TEXUNIT_CONFIG 0x200 (tex2 on its own coordinates) says on the extend-map programs. The shipped glbs
carry TEXCOORD_0 only, so the render path samples the extend map at the first UV set until the converter keeps the
second.

## The Charge Blade's glows on the render path (2026-10-18): the stand-ins removed

MATERIAL ANIMATION, the format (read from the files; build_shading.py clips_of): .mrl material record word 14 = the
animation set's offset; set = u32 clip count, u32 clip offsets; clip = u32 frames, u16 flags (bit 1 = starts by
itself), u16, u32 data offset, u32 name hash, then u32 track offsets up to the data; track = u32 CB parameter word,
u32 kind | key count << 8, u32 member word (bits 12-21 the float offset), keys of u32 frame + 4 floats (kind 0x11).
Taken: the CBMaterialStd kind-0x11 tracks on Emission (float 0) and Reflect (float 12), for the Charge Blade's
models and the two glow materials. Not taken (counts over the Charge Blade's models): CB 0x6c801109 kind 0x16 float 8
(40) and float 0 (2), CBMaterialStd kind 0x11 float 4 = Diffuse (40, on 20 blades' and shields' auto clip f05cf980),
CBMaterialStd kind 0x21 float 20 (2); over all armour and weapons more kinds exist (0x16 key size 24, 0x21, 0x6, 0x26,
CB 0xfd5f7129).
THE REGISTERS each taken key reaches were checked against the emulated apply for every key: Emission -> emission word
min(x x 0.5, 1) x 255 (truncated), Reflect -> TEV 3 constant min(x, 1) x 255 per byte.
THE SWAP (0xb06ce0, read): for each of the model's materials whose colour type is in the mask (9: types 0, 3) and whose
class matches, copy tLutFresnel (0x5dec11ae) and tLutShininess (0xb9981aa) bindings and the whole CBMaterialStd
(0x16a5b126; memcpy 0x10eb24) from the glow material, re-run the apply (vtable +0x3c), and hand over the glow's
animation set (0x637f2c: up to four slots, clip index +0x48, flags +0x4a, frame +0x4c = 0.0; the clips with flag bit 1
start). The model keeps its albedo and extend maps. CHECKED: the apply over each of the 207 Charge Blade type-0/3
materials' built state with the glow's CB gives exactly the glow material's own fragment state and colours, so the
render path switches those materials to the glow entry (shading.json cbGlow; both colours share TEV program 36).
THE GAUGE MATERIAL (0x2d6b98(blade, 30)): the first type-30 material in .mrl order with an animation set (shading.json
anim / mi); 0xb47f84 plays its clip 1 at level 1 and clip 0 from level 2, by index (61 blades: Reflect loops
2ffb1360 / 059ea070; 2 blades: 60-frame Emission loops 0477097d / de83fe17).
UNREAD: the clip stepper (frames taken at the engine's 60 units a second, keys as linear); what the colour-type writes
do to a swapped CB (taken: the unit's colour still lands on TEV 0 every frame, as 0xb0a2c0 runs each frame).
IN ANY LIGHTING (2026-10-19; Raven: "The GU Viewer shows them in any lighting ... use the GU app as a guide"). GU lays
its coat's emission and reflection over the standard material (base material.js setMaterialOverride; the gauge layer is
its sphere-map x Reflect overlay). 4U has no sphere map: its reflection term is the Fresnel table times Reflect. So with
Game shading OFF the same TEV program runs with the game's lights taken out (vertex colour 0, no light diffuse or
specular; primary = the emission word, both alphas = FR(|N.V|)), which leaves exactly the material's own glow:
  glow program 36 (Shield Charge):  albedo x AlbedoColor x emission' + Specular.a (0.498) x FR x Reflect, ADDED over the
                                    generic lit colour (u4Gen 1);
  gauge layer program 18:           albedo x AlbedoColor x emission' + extend map x Reflect, alpha Reflect.a (the pulse),
                                    as the additive layer's own output (u4Gen 2).
Nothing new is needed from the game: every input is a read value (the clips, the glow CB, the LUTs).
