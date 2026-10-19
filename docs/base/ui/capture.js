// CAPTURE for the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md): the screenshot
// (re-rendered at twice the pixel ratio, optionally over the backdrop), the clip recorder with its 3-second lead (a video,
// or a zip of numbered WebP / PNG frames, transparent), the stored-zip writer, and the two capture settings (Settings ->
// Capture), kept under the game's storage prefix + '-capture'. Moved verbatim from GU's index.html (2026-10-18).
// createCapture(game, ctx): ctx.captureName(ext) is the app's file name (GU: 'MHGU <hunter> <date>.<ext>').
import * as THREE from 'three';

export function createCapture(game, ctx){
  // A PNG of the render area (Raven, 2026-09-04). Three things it does that grabbing the
  // canvas as it stands would not:
  //   - re-renders first. The context is not preserveDrawingBuffer, so the buffer is only
  //     guaranteed readable inside the task that drew it; toDataURL is called on the same
  //     line for the same reason (toBlob's callback runs after the pixel ratio is restored).
  //   - renders at twice the screen's pixel ratio, capped at 4096 px on the longest side, so
  //     the file is worth sharing rather than a copy of the on-screen pixels.
  //   - hands the browser a Blob rather than the data URL, which downloads a large image
  //     without running into the limits on data-URL links.
  // The figure comes out cut out on transparency: the canvas is transparent and .content
  // paints the backdrop in CSS, so there is nothing behind the model to capture. Settings ->
  // Capture turns that around and composites the frame over the backdrop colour instead
  // (Raven, 2026-09-08: "Add a setting for screenshots to include or remove the background").
  // what a saved file is called: the figure on screen and the day, as Save As... names a set

  function saveBlob(blob, name){
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  // Capture settings (Raven, 2026-09-08: "Add a setting for screenshots to include or remove the
  // background", "Add a setting and code to allow a frame sequence or mp4 to be recorded with
  // clip recording"). Their own localStorage key, like the view preferences: they are app chrome,
  // not part of a saved set, so they do not ride in a hunter slot or a .json file.
  const CAP_KEY = game.storagePrefix + '-capture';
  const CLIP_MODES = ['mp4', 'webp', 'png'];
  const capture = { shotBg: false, clip: 'mp4' };
  try { Object.assign(capture, JSON.parse(localStorage.getItem(CAP_KEY) || '{}')); } catch (_) {}
  capture.shotBg = capture.shotBg === true;
  if (!CLIP_MODES.includes(capture.clip)) capture.clip = 'mp4';
  function saveCapture(){ try { localStorage.setItem(CAP_KEY, JSON.stringify(capture)); } catch (_) {} }
  // What the page paints behind the model: the flat chroma colour when a chroma backdrop is on,
  // which is what makes a clip keyable, and the stage colour otherwise. The canvas itself is
  // transparent, so this is the only place the backdrop exists.
  function backdropColor(){
    const content = document.querySelector('.content');
    return content ? getComputedStyle(content).backgroundColor : '#000';
  }
  // The figure drawn over that colour at the buffer's size: what a capture looks like when the
  // backdrop is asked for. A 2D canvas, since that is what both the screenshot encoder and the
  // recorder's stream read from.
  function flatten(el, w, h){
    const c = document.createElement('canvas');
    c.width = w || el.width; c.height = h || el.height;
    const cx = c.getContext('2d');
    cx.fillStyle = backdropColor();
    cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(el, 0, 0, c.width, c.height);
    return c;
  }

  // A zip of STORED entries, for the frame sequences below. Every frame is a WebP or a PNG and so
  // is already compressed; deflating it again would cost time and save nothing, so entries go in
  // with method 0 and any zip reader still opens them. Local header, central directory, end
  // record -- the minimum of the format. A 30 s clip is far inside the 65,535 entries and 4 GB
  // that would force zip64.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++){
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf){
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(entries){
    const enc = new TextEncoder(), body = [], dir = [];
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0, dirLen = 0;
    for (const e of entries){
      const name = enc.encode(e.name), crc = crc32(e.data), n = e.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true);
      lh.setUint16(26, name.length, true);
      body.push(new Uint8Array(lh.buffer), name, e.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      dir.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + n; dirLen += 46 + name.length;
    }
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);
    eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
    eo.setUint32(12, dirLen, true); eo.setUint32(16, off, true);
    return new Blob([...body, ...dir, new Uint8Array(eo.buffer)], { type: 'application/zip' });
  }

  const SHOT_TIP = 'Save a PNG of the render area';
  document.getElementById('shotBtn').onclick = () => {
    const btn = document.getElementById('shotBtn'), el = ctx.renderer.domElement;
    const prev = ctx.renderer.getPixelRatio();
    // the effects chain reallocates its targets at the bumped size, so it is capped a little lower
    const cap = (ctx.fx.active ? 3072 : 4096) / Math.max(el.clientWidth, el.clientHeight, 1);
    const ratio = Math.max(prev, Math.min(prev * 2, cap));
    const sz = ctx.renderer.getSize(new THREE.Vector2());
    let url;
    try {
      if (ratio !== prev){ ctx.renderer.setPixelRatio(ratio); ctx.fx.setSize(sz.x, sz.y, ratio, ctx.camPanel.lensState); }
      ctx.lightPanel.track(); ctx.head.position.copy(ctx.camera.position);
      ctx.renderFrame();
      url = (capture.shotBg ? flatten(el) : el).toDataURL('image/png');
    } finally {
      if (ratio !== prev){ ctx.renderer.setPixelRatio(prev); ctx.fx.setSize(sz.x, sz.y, prev, ctx.camPanel.lensState); }
    }
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    saveBlob(new Blob([buf], { type: 'image/png' }), ctx.captureName('png'));
    ctx.setIcon(btn, 'check'); ctx.setLabel(btn, 'Saved', SHOT_TIP);
    setTimeout(() => { ctx.setIcon(btn, 'camera'); ctx.setLabel(btn, 'Screenshot', SHOT_TIP); }, 1200);
  };

  // Short clips of the render area (Raven, 2026-09-04: "Since we can screenshot, we should be
  // able to do short clips"). MediaRecorder over the canvas's OWN stream, so a clip is the
  // render area alone -- no panels, no pointer, at the buffer's resolution, whatever the
  // window is doing. Anything longer is a screen recorder's job, which the chroma backdrops
  // and the hideable controls are already there for; this one stops itself at CLIP_MAX so a
  // forgotten recording cannot fill memory.
  // The recorder does not stream the WebGL canvas itself: streamed directly, the H.264 writer
  // produced no frames at all in testing while the same frames drawn into a 2D canvas encoded
  // fine, so every frame the loop renders is copied into recCanvas and THAT is what the
  // recorder streams. Two things come free with the copy. The backdrop: no encoder keeps the
  // canvas's alpha (VP9, VP8 and H.264 all come back opaque), so a clip of the transparent
  // canvas would be black mush where a screenshot is cleanly cut out -- the copy paints the
  // backdrop the page is painting behind the model first, the flat chroma colour when a
  // chroma backdrop is on (which is what makes a clip keyable) and the stage colour
  // otherwise. And the size: H.264 wants even dimensions, and the copy's size is fixed for the
  // length of the clip whatever the drawing buffer does.
  // A clip can also leave as a FRAME SEQUENCE, which is the only way to keep the alpha
  // (Raven, 2026-09-08: "Add a setting and code to allow a frame sequence or mp4 to be recorded
  // with clip recording"). No encoder this browser offers will write an alpha channel:
  // MediaRecorder emits none, and WebCodecs reports alpha:'keep' unsupported for VP8, VP9 and
  // AV1 alike, while H.264 has no alpha channel at all -- so a transparent clip has to leave as
  // stills, zipped and numbered, which every editor imports as an image sequence.
  // Encoding is the cost. One 0.9 MP WebP takes about 90 ms, far past a frame's budget, but
  // toBlob hands the work to the browser's own threads and several run at once: eight together
  // came back in 147 ms, about 18 ms a frame. So frames are queued with a bounded number in
  // flight and the render loop is never waited on. SEQ_FPS is 30 rather than 60 because that
  // measured throughput does not cover 60 at this size, and a frame is skipped rather than
  // queued when the encoder falls behind, so a long clip cannot grow without limit.
  const SEQ_FPS = 30, SEQ_INFLIGHT = 6;
  const CLIP_TIP = 'Record a clip of the render area';
  const recCanvas = document.createElement('canvas');
  let recCtx = null, recBackdrop = '#000', seq = null;
  function recFrame(){
    if (seq){ seqFrame(); return; }
    if (!recorder || !recCtx) return;
    recCtx.fillStyle = recBackdrop;
    recCtx.fillRect(0, 0, recCanvas.width, recCanvas.height);
    recCtx.drawImage(ctx.renderer.domElement, 0, 0, recCanvas.width, recCanvas.height);
  }
  // One frame of a sequence. The copy is CLEARED rather than painted, so what reaches the
  // encoder carries the canvas's own alpha; the backdrop setting is the screenshot's alone,
  // since a sequence exists to keep the cut-out.
  function seqFrame(){
    const s = seq;
    if (!s || s.done) return;
    const now = performance.now();
    if (s.next && now - s.last < 1000 / SEQ_FPS - 1) return;
    if (s.pending >= SEQ_INFLIGHT){ s.dropped++; return; }
    s.last = now;
    s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    s.ctx.drawImage(ctx.renderer.domElement, 0, 0, s.canvas.width, s.canvas.height);
    const i = s.next++;
    s.pending++;
    s.canvas.toBlob(b => { s.frames[i] = b || null; s.pending--; }, s.type, s.quality);
  }
  const CLIP_MAX = 30;
  // MP4 with H.264 wherever the browser can write it (Chrome 126 and later): it plays where a
  // WebM does not -- phones, Discord, the Windows viewer (Raven, 2026-09-04: "are we able to
  // make mp4"). WebM stays as the fallback, and the file's extension follows the container.
  const CLIP_TYPE = ['video/mp4;codecs=avc1.64001F', 'video/mp4;codecs=avc1', 'video/mp4',
                     'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const CLIP_EXT = CLIP_TYPE.startsWith('video/mp4') ? 'mp4' : 'webm';
  // Raven, 2026-09-05: "a timer that counts down ... next to the Record Button ... :30 -> :09
  // format ... When :00 is hit, have it flash a few times then revert back to :30 ... Have the
  // Record Button flash while recording. Add a 3s delay before the capture starts". The click
  // starts a REC_LEAD-second lead -- the timer counts :03 :02 :01 in amber and the button blinks
  // -- then the first frame is captured and the timer runs the clip down from :30; at :00 (or an
  // early Stop) the recorder stops, :00 flashes four times and the timer reads :30 again. A
  // second click during the lead cancels it.
  let recorder = null, recTimer = null, recStart = 0, recPre = null, recEndFx = null, clipMax = CLIP_MAX;
  const REC_LEAD = 3;
  {
    const btn = document.getElementById('clipBtn'), timer = document.getElementById('clipTimer');
    const showTime = (sec, cls) => {
      timer.textContent = ':' + String(Math.max(0, Math.min(99, Math.round(sec)))).padStart(2, '0');
      timer.className = 'clip-timer' + (cls ? ' ' + cls : '');
    };
    showTime(clipMax, '');
    if (!CLIP_TYPE || !recCanvas.captureStream){
      btn.hidden = true; timer.hidden = true;  // no recorder in this browser: no dead button
    } else {
      const rest = () => {
        clearInterval(recTimer); recTimer = null; recorder = null; seq = null;
        clearTimeout(recPre); recPre = null;
        ctx.setIcon(btn, 'rec'); ctx.setLabel(btn, 'Record', CLIP_TIP); btn.classList.remove('on', 'pre');
      };
      // the clip is over: :00 flashes, then the timer is :30 again and the button is Record
      const ended = () => {
        rest(); showTime(0, 'end'); clearTimeout(recEndFx);
        recEndFx = setTimeout(() => { showTime(clipMax, ''); recEndFx = null; }, 1900);
      };
      // The sequence's end: stop taking frames, let the encoders still in flight land, then zip
      // what came back. Frames are numbered from 1 so a reader orders them as an editor expects.
      const finishSeq = async () => {
        const s = seq;
        if (!s || s.done) return;
        s.done = true;
        clearInterval(recTimer); recTimer = null;
        ctx.setLabel(btn, 'Saving', 'Encoding the frames');
        const t0 = performance.now();
        while (s.pending > 0 && performance.now() - t0 < 60000)
          await new Promise(r => setTimeout(r, 100));
        seq = null;
        const frames = s.frames.filter(Boolean);
        if (!frames.length){
          ended();
          ctx.setLabel(btn, 'Nothing recorded', 'The render area produced no frames: keep the tab visible while recording');
          setTimeout(() => ctx.setLabel(btn, 'Record', CLIP_TIP), 2500);
          return;
        }
        const pad = Math.max(4, String(frames.length).length);
        const bufs = await Promise.all(frames.map(async (b, i) => ({
          name: 'frame_' + String(i + 1).padStart(pad, '0') + '.' + s.ext,
          data: new Uint8Array(await b.arrayBuffer())
        })));
        saveBlob(zipStore(bufs), ctx.captureName('zip'));
        ended();
        if (s.dropped)
          ctx.setLabel(btn, 'Saved', frames.length + ' frames, ' + s.dropped + ' skipped while encoding');
      };
      const start = () => {
        const chunks = [];
        const el = ctx.renderer.domElement;
        const w = Math.max(2, el.width & ~1), h = Math.max(2, el.height & ~1);
        // A frame sequence needs no MediaRecorder and no stream: the render loop hands frames
        // straight to the encoder through seqFrame, and the zip is built when the clip ends.
        if (capture.clip !== 'mp4'){
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          seq = { frames: [], pending: 0, next: 0, dropped: 0, done: false, last: 0,
                  canvas: c, ctx: c.getContext('2d'),
                  type: capture.clip === 'png' ? 'image/png' : 'image/webp',
                  ext: capture.clip === 'png' ? 'png' : 'webp',
                  quality: capture.clip === 'png' ? undefined : 0.92 };
          recFrame();
          recStart = performance.now();
          ctx.setIcon(btn, 'stop'); btn.classList.remove('pre'); btn.classList.add('on');
          const tickSeq = () => {
            const t = (performance.now() - recStart) / 1000;
            showTime(Math.ceil(clipMax - t), 'on');
            ctx.setLabel(btn, 'Stop', 'Recording ' + (seq ? seq.next : 0) + ' frames, ' + Math.floor(t) + 's of ' + clipMax + 's');
            if (t >= clipMax) finishSeq();
          };
          tickSeq(); recTimer = setInterval(tickSeq, 200);
          return;
        }
        recCanvas.width = w; recCanvas.height = h;
        recCtx = recCanvas.getContext('2d');
        recBackdrop = backdropColor();
        // 60 frames a second: the render loop draws on every animation frame, and a stance is
        // authored at 60, so the clip carries the animation as the viewer plays it
        recorder = new MediaRecorder(recCanvas.captureStream(60),
                                     { mimeType: CLIP_TYPE, videoBitsPerSecond: 16e6 });
        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: CLIP_TYPE.split(';')[0] });
          // A recording with no frames behind it (the tab hidden, the loop paused) comes back
          // as a few header bytes, and the MP4 writer as nothing at all: say so instead of
          // saving an empty file.
          if (blob.size < 2048){
            ended();
            ctx.setLabel(btn, 'Nothing recorded', 'The render area produced no frames: keep the tab visible while recording');
            setTimeout(() => ctx.setLabel(btn, 'Record', CLIP_TIP), 2500);
            return;
          }
          saveBlob(blob, ctx.captureName(CLIP_EXT));
          ended();
        };
        // a timeslice, so the muxer gets its data as it goes: the MP4 writer handed back an
        // empty file when everything arrived at stop
        recorder.start(250);
        recFrame();
        recStart = performance.now();
        ctx.setIcon(btn, 'stop'); btn.classList.remove('pre'); btn.classList.add('on');
        const tick = () => {
          const t = (performance.now() - recStart) / 1000;
          showTime(Math.ceil(clipMax - t), 'on');
          ctx.setLabel(btn, 'Stop', 'Recording, ' + Math.floor(t) + 's of ' + clipMax + 's');
          if (t >= clipMax && recorder) recorder.stop();
        };
        tick(); recTimer = setInterval(tick, 200);
      };
      btn.onclick = () => {
        if (recorder){ recorder.stop(); return; }               // onstop -> ended()
        if (seq){ finishSeq(); return; }
        if (recPre){ rest(); showTime(clipMax, ''); return; }    // a click during the lead cancels it
        clearTimeout(recEndFx); recEndFx = null;
        const t0 = performance.now();
        btn.classList.add('pre'); ctx.setIcon(btn, 'stop');
        ctx.setLabel(btn, 'Starting', 'Recording starts in ' + REC_LEAD + ' s; click to cancel');
        const lead = () => {
          const left = REC_LEAD - (performance.now() - t0) / 1000;
          if (left > 0){ showTime(Math.ceil(left), 'pre'); recPre = setTimeout(lead, 100); }
          else { recPre = null; start(); }
        };
        lead();
      };
      window.__view = window.__view || {};   // the app may not have made its debug hook yet (MH3U)
      window.__view.clip = {
        state: () => recorder ? 'on' : (recPre ? 'pre' : (recEndFx ? 'end' : 'idle')),
        text: () => timer.textContent, cls: () => timer.className + ' | ' + btn.className,
        setMax: n => { clipMax = Math.max(1, +n || CLIP_MAX); if (!recorder && !recPre) showTime(clipMax, ''); },
        click: () => btn.onclick(),
        seq: () => seq ? { frames: seq.next, pending: seq.pending, dropped: seq.dropped, ext: seq.ext } : null
      };
    }
  }

  // The two capture settings, wired to Settings -> Capture. They live here rather than in the
  // early script because the clip's own container decides what the video option can be called.
  {
    const bg = document.getElementById('setShotBg'), fmt = document.getElementById('setClipFmt'),
          hint = document.getElementById('setClipHint');
    const vid = fmt.querySelector('option[value="mp4"]');
    vid.textContent = (CLIP_EXT === 'mp4' ? 'MP4 video' : 'WebM video') + ', no transparency';
    if (!CLIP_TYPE){ vid.disabled = true; if (capture.clip === 'mp4') capture.clip = 'webp'; }
    const paint = () => {
      bg.checked = capture.shotBg;
      fmt.value = capture.clip;
      hint.textContent = capture.clip === 'mp4'
        ? 'One video file, with the backdrop baked in. No video format here can carry transparency.'
        : 'A zip of numbered frames at ' + SEQ_FPS + ' a second, transparent, for import as an image sequence.';
    };
    paint();
    bg.onchange = () => { capture.shotBg = bg.checked; saveCapture(); paint(); };
    fmt.onchange = () => {
      capture.clip = CLIP_MODES.includes(fmt.value) ? fmt.value : 'mp4';
      saveCapture(); paint();
    };
    window.__view = window.__view || {};
    window.__view.capture = {
      state: () => Object.assign({}, capture),
      set: o => { Object.assign(capture, o || {}); saveCapture(); paint(); return Object.assign({}, capture); }
    };
  }

  return {
    recFrame
  };
}
