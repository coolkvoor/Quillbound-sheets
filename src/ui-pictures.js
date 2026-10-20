/* Quillbound Sheets — pictures on MPMB's buttons (portrait, symbol, companion picture). Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el, state } = U;
  // from the other screen files (all loaded before anything runs)
  const toast = (...a) => U.toast(...a);

  // ---------------------------------------------------------------- pictures (MPMB's portrait, symbol, companion picture)
  // A button's picture as an image URL, by the picture it shows (engine iconKey): one the user picked comes as it is;
  // MPMB's own icons and pictures added in Acrobat come as a one-page PDF (worker iconImage), drawn with pdf.js
  const iconCache = new Map();   // icon key -> object URL ('' when it can't be shown)
  let pdfjsP = null;
  // the site serves pdf.js itself (MPMB_PDFJS, build-single.js); the other builds load it from cdnjs
  const PDFJS = window.MPMB_PDFJS ? new URL(window.MPMB_PDFJS, location.href).href : 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  // The downloadable file carries pdf.js itself (build-single.js), so pictures show without a connection
  function bundledPdfjs() {
    const lib = document.getElementById('mpmb-pdfjs-src'), wsrc = document.getElementById('mpmb-pdfjs-worker-src');
    if (!lib || !wsrc) return null;
    if (!window.pdfjsLib) { const s = document.createElement('script'); s.textContent = lib.textContent; document.head.appendChild(s); }
    const L = window.pdfjsLib;
    if (!L || !L.GlobalWorkerOptions) throw new Error('pdf.js not loaded');
    // its worker from a blob URL, a data: URL when Chrome refuses blob workers on file:// pages, else in the page itself
    const code = wsrc.textContent;
    try { L.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); }
    catch (e) {
      try { L.GlobalWorkerOptions.workerPort = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(code)); }
      catch (e2) { const s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); }
    }
    return L;
  }
  function pdfjs() {
    if (!pdfjsP) { try { const L = bundledPdfjs(); if (L) pdfjsP = Promise.resolve(L); } catch (e) { return Promise.reject(e); } }
    if (!pdfjsP) pdfjsP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = () => {
        const L = window.pdfjsLib;
        if (!L || !L.GlobalWorkerOptions) { pdfjsP = null; reject(new Error('pdf.js not loaded')); return; }
        // a worker from another site can't be started directly: start one here that loads it
        try { L.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob(['importScripts("' + PDFJS + 'pdf.worker.min.js")'], { type: 'text/javascript' }))); }
        catch (e) { L.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; }
        resolve(L);
      };
      s.onerror = () => { pdfjsP = null; reject(new Error('pdf.js not loaded')); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  const b64Blob = (b64, mime) => { const t = atob(b64), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return new Blob([u], { type: mime }); };
  async function loadIcon(name) {
    const r = await state.worker.call('iconImage', { name });
    if (r.img) return URL.createObjectURL(b64Blob(r.img.data, r.img.mime));
    if (!r.pdf) return '';
    const L = await pdfjs();
    const doc = await L.getDocument({ data: r.pdf }).promise;
    try {
      const page = await doc.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(6, 640 / v1.width) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      // intent print: drawn straight away, also while the page is in the background (on screen pdf.js waits for frames)
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      return blob ? URL.createObjectURL(blob) : '';
    } finally { doc.destroy(); }
  }
  async function showIcon(n, snap) {
    const key = snap.exists && snap.icon ? snap.icon : '';
    if (n.dataset.key === key) return;
    n.dataset.key = key;
    const img = n.querySelector('img');
    let url = key ? iconCache.get(key) : '';
    if (url === undefined) {
      try { url = await loadIcon(snap.name); } catch (e) { url = ''; console.warn('Picture of ' + snap.name + ' not shown:', e); }
      iconCache.set(key, url);
    }
    if (n.dataset.key !== key) return;
    if (url) img.src = url; else img.removeAttribute('src');
  }
  // a picture button, as on the sheet (w × h: the button's proportions)
  const picture = (field, label, w, h, cls) => el('figure', { cls: 'pic' + (cls ? ' ' + cls : '') }, [
    el('button', { cls: 'pic-btn', type: 'button', 'data-mpmb': field, 'data-icon': field, 'data-title': label, 'aria-label': label + ': picture options', style: 'aspect-ratio: ' + w + ' / ' + h }, [el('img', { alt: label })]),
    el('figcaption', { text: label }),
  ]);
  // The image the user picks for MPMB ("Set any image/pdf file as Portrait"), made a sensible size for a sheet
  // (1600 px at most): JPEG, or PNG when it has see-through parts
  async function readPicture(file) {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, w, h);
    let alpha = false;
    if (!/jpe?g/i.test(file.type)) { const d = g.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; } }
    if (!alpha) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    const mime = alpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, mime, 0.9));
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), mime, data, w, h };
  }
  // the file picker opens straight away while the tap that started it still counts; otherwise after one more tap
  function pickPicture(label) {
    return new Promise((resolve) => {
      const dlg = $('#picpick'), input = $('#picpick-file');
      let done = false;
      const finish = async (file) => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        input.onchange = null; $('#picpick-cancel').onclick = null;
        if (!file) { resolve(null); return; }
        try { resolve(await readPicture(file)); } catch (e) { toast('That image couldn’t be read.'); resolve(null); }
      };
      input.value = '';
      input.onchange = () => finish(input.files && input.files[0]);
      $('#picpick-cancel').onclick = () => finish(null);
      $('#picpick-note').textContent = 'MPMB asks for a picture for ' + label + '. Any image works; it goes into the PDF with your character.';
      const active = navigator.userActivation ? navigator.userActivation.isActive : false;
      if (active) {
        // a picker closed without a file doesn't always send an event: coming back to the page without one is a cancel
        const back = () => { window.removeEventListener('focus', back); setTimeout(() => { if (!input.files || !input.files.length) finish(null); }, 600); };
        window.addEventListener('focus', back);
        input.click();
      } else dlg.showModal();
    });
  }

  Object.assign(U, {
    picture, showIcon, pickPicture, iconCache
  });
})();
