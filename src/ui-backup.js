/* Quillbound Sheets — keeping characters safe: storage Chrome keeps for good, and a copy of each character in a folder.
   Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el, state } = U;
  // from app.js (loaded after this file; only called once things run)
  const idbGet = (...a) => U.idbGet(...a), idbPut = (...a) => U.idbPut(...a), toast = (...a) => U.toast(...a);

  // The autosave lives in the browser's storage, which Chrome may clear when the phone is low on space unless the
  // app's storage is kept for good (navigator.storage.persist; Chrome decides, without asking: installed apps get it).
  // A backup folder (File System Access, Chrome on Android 132+ and on PCs) holds each character as its PDF, as
  // Download PDF writes it, so a character survives clearing Chrome's data and opens in Acrobat or in the app.
  const DIR_KEY = 'backupDir';
  // Writing the PDF takes seconds (5 s on the PC for a 27 MB sheet) and MPMB waits meanwhile, so a backup runs when the
  // user leaves the app (switches away or closes it), or after this long without a change
  const QUIET_MS = 5 * 60000;
  const OLD_DAYS = 7;              // remind when the last copy of a changed character is older than this
  const canPickFolder = () => typeof window.showDirectoryPicker === 'function';
  let dir = null;                  // the folder's handle (kept in IndexedDB, survives restarts)
  let allowed = false;             // Chrome may ask again for permission after a restart
  let persisted = null, timer = 0, running = false, asked = false;
  let dirty = false;               // this character changed since its last copy
  // Without folder access (Brave turns it off, as do Firefox and Safari) a copy takes the user's taps: Save a copy
  // writes the PDF, then Send to… (the share sheet: Drive, email, Files) or Download. Two taps, because the share
  // sheet only opens right after a tap and writing the PDF takes seconds.
  let copy = null;                 // { key, name, blob }: the copy written for this character, until it changes
  let brave = false;               // navigator.brave.isBrave(), to say why there's no folder
  const canShare = (file) => { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; } };
  const backupKey = () => 'backup:' + state.charKey;

  async function keepStorage() {
    if (!navigator.storage || !navigator.storage.persist) { persisted = null; return; }
    try { persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { persisted = false; }
  }
  async function permission(ask) {
    if (!dir) return false;
    try {
      const opts = { mode: 'readwrite' };
      let p = dir.queryPermission ? await dir.queryPermission(opts) : 'granted';
      if (p === 'prompt' && ask && dir.requestPermission) p = await dir.requestPermission(opts);
      allowed = p === 'granted';
    } catch (e) { allowed = false; }
    return allowed;
  }
  // "<character> - <sheet file>.pdf" (also Download PDF's name). Never the sheet file's own name, so a backup can't
  // overwrite the sheet in the same folder; a sheet opened from a backup keeps its backup's name.
  function fileName() {
    const who = U.shown(state.snap.get('PC Name')).trim() || 'Unnamed character';
    let base = (state.fileName || 'sheet').replace(/\.pdf$/i, '');
    if (base.startsWith(who + ' - ')) base = base.slice(who.length + 3);
    return (who + ' - ' + base).replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 180) + '.pdf';
  }
  // a copy was made (here, or by Download PDF): remember when, per character
  async function noteBackup(how, file) {
    if (!state.charKey) return;
    if (how !== 'folder') dirty = false;
    await idbPut(backupKey(), { at: Date.now(), how, file });
    render();
  }

  async function backupNow(byUser) {
    clearTimeout(timer); timer = 0;
    if (!dir || !state.worker || !state.charKey || state.tourSample) return false;   // never a backup of the tour's sample
    if (running || state.changing) { schedule(); return false; }
    if (!(await permission(byUser))) { render(); if (!asked && !byUser) { asked = true; toast('Backups need your OK again: Settings → Backups'); } return false; }
    running = true;
    const key = state.charKey, worker = state.worker;
    render('Writing the backup…');
    try {
      const res = await worker.call('savePdf', {});
      if (state.charKey !== key) return false;
      const name = fileName();
      const fh = await dir.getFileHandle(name, { create: true });
      const out = await fh.createWritable();
      await out.write(new Blob([res.bytes], { type: 'application/pdf' }));
      await out.close();
      await noteBackup('folder', name);
      dirty = false;
      if (byUser) toast('Backed up as ' + name);
      return true;
    } catch (e) {
      render('The backup didn’t work: ' + (e && e.message || e));
      return false;
    } finally { running = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => backupNow(false), QUIET_MS); }
  // after each autosave (app.js saveNow): back up once the character has been left alone for a while
  function afterSave() { dirty = true; if (copy) { copy = null; render(); } if (dir && allowed) schedule(); }
  function onHidden() { if (document.visibilityState === 'hidden' && dirty && dir && allowed && !running) backupNow(false); }

  async function chooseFolder() {
    try {
      const h = await window.showDirectoryPicker({ id: 'mpmb-backups', mode: 'readwrite' });
      dir = h; allowed = true; asked = false;
      await idbPut(DIR_KEY, h);
      render();
      if (state.worker) backupNow(true);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      render('This browser didn’t let the app use a folder (' + (e && e.message || e) + ').');
    }
  }
  // no folder: write the copy, then the user sends it somewhere or downloads it
  async function makeCopy() {
    if (!state.worker || !state.charKey || running) return;
    running = true;
    const key = state.charKey;
    $('#backup-copy').disabled = true;
    render('Writing the copy…');
    try {
      const res = await state.worker.call('savePdf', {});
      if (state.charKey !== key) return;
      copy = { key, name: fileName(), blob: new Blob([res.bytes], { type: 'application/pdf' }) };
      render('The copy is ready: send it somewhere safe (Google Drive, email, Files) or download it.');
    } catch (e) {
      render('Writing the copy didn’t work: ' + (e && e.message || e));
    } finally { running = false; $('#backup-copy').disabled = false; }
  }
  async function shareCopy() {
    if (!copy) return;
    const file = new File([copy.blob], copy.name, { type: 'application/pdf' });
    try {
      await navigator.share({ files: [file], title: copy.name });
      await noteBackup('shared', copy.name);
      toast('Sent ' + copy.name);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      render('Sending didn’t work here (' + (e && e.message || e) + '). Download it instead.');
    }
  }
  async function downloadCopy() {
    if (!copy) return;
    const a = el('a', { href: URL.createObjectURL(copy.blob), download: copy.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    await noteBackup('download', copy.name);
    toast('Downloaded ' + copy.name);
  }
  async function stopBackups() {
    clearTimeout(timer); timer = 0;
    dir = null; allowed = false;
    await U.idbDel(DIR_KEY);
    render();
  }

  const ago = (t) => {
    const d = (Date.now() - t) / 86400000;
    return d < 1 / 24 ? 'just now' : d < 1 ? Math.round(d * 24) + ' h ago' : Math.round(d) + (Math.round(d) === 1 ? ' day ago' : ' days ago');
  };
  async function render(msg) {
    const card = $('#backup-card');
    if (!card) return;
    $('#storage-kept').textContent = persisted === null ? 'This browser doesn’t say whether it keeps the app’s storage.'
      : persisted ? 'Kept for good: the browser won’t clear the characters saved in the app on its own.'
        : 'Not kept for good yet: the browser may clear the app’s saved characters when the device runs low on space. Installing the app usually changes that. Keep a backup.';
    const last = state.charKey ? await idbGet(backupKey()) : null;
    const lines = [];
    if (copy && copy.key !== state.charKey) copy = null;
    if (!canPickFolder()) lines.push((brave ? 'Brave turns off folder access for websites' : 'This browser can’t write to a folder') + ', so the app can’t back up by itself here. Save a copy now and then and keep it somewhere safe' + (brave ? ', or use the app in Chrome for automatic backups.' : '.'));
    else if (!dir) lines.push('No backup folder yet. Pick one, and the app writes each character into it as a PDF, when you leave the app (switch away or close it) and after five minutes without a change.');
    else lines.push('Backing up into the folder “' + dir.name + '”' + (allowed ? '.' : ', once you allow it again.'));
    if (state.charKey) lines.push(last ? 'This character: last copy ' + ago(last.at) + (last.file ? ' (' + last.file + ')' : '') + '.' : 'This character has no copy yet.');
    if (msg) lines.push(msg);
    $('#backup-state').textContent = lines.join(' ');
    $('#backup-pick').hidden = !canPickFolder();
    $('#backup-pick').textContent = dir ? 'Choose another folder' : 'Choose a backup folder';
    $('#backup-pick').classList.toggle('primary', !dir);
    $('#backup-allow').hidden = !dir || allowed;
    $('#backup-now').hidden = !dir || !allowed || !state.worker;
    $('#backup-stop').hidden = !dir;
    const noFolder = !canPickFolder() && !!state.worker && !!state.charKey;
    $('#backup-copy').hidden = !noFolder;
    $('#backup-copy').classList.toggle('primary', !copy);
    $('#backup-share').hidden = !noFolder || !copy || !canShare(new File([], copy.name, { type: 'application/pdf' }));
    $('#backup-download').hidden = !noFolder || !copy;
  }

  // when a character opens: keep the storage, pick up the folder, and remind when the last copy is old
  async function onOpen() {
    await keepStorage();
    if (!dir && canPickFolder()) { const h = await idbGet(DIR_KEY); if (h && h.kind === 'directory') dir = h; }
    if (dir) await permission(false);
    render();
    const last = await idbGet(backupKey());
    const changed = !!state.savedAt && (!last || state.savedAt > last.at);
    dirty = changed;
    const old = !last || Date.now() - last.at > OLD_DAYS * 86400000;
    if (changed && old && !(dir && allowed)) {
      const stamp = 'mpmb-backup-reminded';
      let shownToday = false;
      try { shownToday = localStorage.getItem(stamp) === new Date().toDateString(); localStorage.setItem(stamp, new Date().toDateString()); } catch (e) { /* no storage */ }
      if (!shownToday) setTimeout(() => toast(last ? 'Last copy of this character: ' + ago(last.at) + '. Settings → Backups' : 'This character has no backup yet: Settings → Backups'), 1500);
    }
  }

  function wireBackup() {
    if (!$('#backup-card')) return;
    $('#backup-pick').addEventListener('click', chooseFolder);
    $('#backup-allow').addEventListener('click', async () => { if (await permission(true)) { asked = false; render(); backupNow(true); } else render('Not allowed.'); });
    $('#backup-now').addEventListener('click', () => backupNow(true));
    $('#backup-stop').addEventListener('click', stopBackups);
    $('#backup-copy').addEventListener('click', makeCopy);
    $('#backup-share').addEventListener('click', shareCopy);
    $('#backup-download').addEventListener('click', downloadCopy);
    try { if (navigator.brave && navigator.brave.isBrave) navigator.brave.isBrave().then((b) => { brave = !!b; render(); }, () => {}); } catch (e) { /* not Brave */ }
    document.addEventListener('visibilitychange', onHidden);
    keepStorage().then(() => render());
  }

  Object.assign(U, { wireBackup, backupOnOpen: onOpen, backupAfterSave: afterSave, noteBackup, renderBackup: render, pdfFileName: fileName });
})();
