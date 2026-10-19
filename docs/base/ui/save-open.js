// SAVE / SAVE AS / OPEN for the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md).
// Where the File System Access API exists, Save writes back to the file you opened or last saved to, and only Save As
// prompts; elsewhere both download and Open uses the hidden <input type=file>. Moved verbatim from GU's index.html
// (2026-10-18). THE SCHEMA IS THE APP'S (pluggable): ctx.currentSet() builds the set, ctx.isSet(d) says whether a parsed
// file is one, ctx.applySet(d) puts it on screen -- so every set file an app has written opens as before.
// game.setFileName / game.setFileLabel name the default file and its type in the picker.

export function createSaveOpen(game, ctx){
  // Save / Save As / Open.
  // Where the File System Access API exists, Save writes back to the file you opened or
  // last saved to, and only Save As prompts. Where it does not, both fall back to a plain
  // download and Open falls back to the hidden <input type=file> -- so the buttons behave
  // the same way, they just cannot silently overwrite.
  const HAS_FS = typeof window.showSaveFilePicker === 'function';
  let fileHandle = null, fileName = game.setFileName || 'set.json';
  const saveBtn = document.getElementById('saveBtn'),
        saveAsBtn = document.getElementById('saveAsBtn'),
        openBtn = document.getElementById('openBtn');

  function flash(btn, msg){
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => btn.textContent = orig, 1600);
  }
  function setJson(){ return JSON.stringify(ctx.currentSet(), null, 2); }
  function download(text){
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }
  async function writeHandle(h, text){
    const w = await h.createWritable();
    await w.write(text); await w.close();
  }
  async function saveAs(){
    const text = setJson();
    if (!HAS_FS) { download(text); flash(saveAsBtn, 'Saved'); return; }
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: game.setFileLabel || 'Set', accept: { 'application/json': ['.json'] } }]
      });
      await writeHandle(h, text);
      fileHandle = h; fileName = h.name;
      flash(saveAsBtn, 'Saved');
    } catch (e) { if (e && e.name !== 'AbortError') flash(saveAsBtn, 'Failed'); }
  }
  saveBtn.onclick = async () => {
    const text = setJson();
    if (!fileHandle) { await saveAs(); return; }      // nothing open yet -> ask where
    try { await writeHandle(fileHandle, text); flash(saveBtn, 'Saved'); }
    catch (e) { if (e && e.name !== 'AbortError') flash(saveBtn, 'Failed'); }
  };
  saveAsBtn.onclick = saveAs;

  openBtn.onclick = async () => {
    if (!HAS_FS) { document.getElementById('importFile').click(); return; }
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: game.setFileLabel || 'Set', accept: { 'application/json': ['.json'] } }]
      });
      const text = await (await h.getFile()).text();
      fileHandle = h; fileName = h.name;
      await loadSet(text, openBtn);
    } catch (e) { if (e && e.name !== 'AbortError') flash(openBtn, 'Failed'); }
  };
  document.getElementById('importFile').addEventListener('change', function(){
    const file = this.files[0]; this.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => loadSet(e.target.result, openBtn);
    reader.readAsText(file);
  });

  async function loadSet(text, btn){
    try {
      const d = JSON.parse(text);
      if (!d || !ctx.isSet(d)) throw new Error('not a set');
      await ctx.applySet(d);
    } catch (e) {
      console.error('loadSet', e);
      if (!btn) throw e;                 // the harness has no button; let the caller see it
      const orig = btn.textContent;
      btn.textContent = 'Invalid file!';
      setTimeout(() => btn.textContent = orig, 2000);
    }
  }

  return {
    loadSet
  };
}
