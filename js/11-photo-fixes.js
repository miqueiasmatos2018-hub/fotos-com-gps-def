// ==========================================================================
// 11-photo-fixes.js
// Low-MP upscale, >30MB compression, duplicate-GPS spread, issues alert.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

window.upscaleLowMpPhotos = async function() {
  const TARGET_W = 8064;
  const TARGET_H = 4536;
  const lowPhotos = photos.filter(p => p.megapixels != null && p.megapixels < 12);
  if (!lowPhotos.length) return;

  const btn      = document.getElementById('mpUpscaleBtn');
  const progress = document.getElementById('mpUpscaleProgress');
  const bar      = document.getElementById('mpUpscaleBar');
  const label    = document.getElementById('mpUpscaleLabel');

  btn.disabled = true;
  progress.style.display = 'block';

  for (let i = 0; i < lowPhotos.length; i++) {
    const photo = lowPhotos[i];
    label.textContent = `${i + 1} / ${lowPhotos.length} — ${photo.name}`;
    bar.style.width = ((i / lowPhotos.length) * 100) + '%';

    await new Promise(resolve => {
      const img = new Image();
      img.onload = function() {
        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;

        // Scale to fit within 8064×4536 preserving aspect ratio
        const scaleW = TARGET_W / srcW;
        const scaleH = TARGET_H / srcH;
        const scale  = Math.min(scaleW, scaleH);
        const targetW = Math.round(srcW * scale);
        const targetH = Math.round(srcH * scale);

        const canvas = document.createElement('canvas');
        canvas.width  = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        // Use multi-step scaling for better quality when upscaling a lot
        let curW = srcW, curH = srcH;
        const steps = Math.ceil(Math.log2(Math.max(targetW / srcW, targetH / srcH)));
        let offscreen = document.createElement('canvas');
        offscreen.width = srcW; offscreen.height = srcH;
        offscreen.getContext('2d').drawImage(img, 0, 0);

        for (let s = 0; s < steps - 1; s++) {
          curW = Math.min(curW * 2, targetW);
          curH = Math.min(curH * 2, targetH);
          const tmp = document.createElement('canvas');
          tmp.width = curW; tmp.height = curH;
          tmp.getContext('2d').drawImage(offscreen, 0, 0, curW, curH);
          offscreen = tmp;
        }

        ctx.drawImage(offscreen, 0, 0, targetW, targetH);

        canvas.toBlob(blob => {
          if (!blob) { resolve(); return; }
          // Replace photo url and file
          URL.revokeObjectURL(photo.url);
          const newUrl  = URL.createObjectURL(blob);
          const newFile = new File([blob], photo.name, { type: 'image/jpeg' });
          photo.url         = newUrl;
          photo.file        = newFile;
          photo.megapixels  = (targetW * targetH) / 1_000_000;
          photo.imgWidth    = targetW;
          photo.imgHeight   = targetH;

          // Update thumbnail in sidebar
          const thumb = document.querySelector(`.photo-item[data-id="${photo.id}"] .photo-thumb`);
          if (thumb) thumb.src = newUrl;

          // Update mp-dot to green
          const dot = document.querySelector(`.photo-item[data-id="${photo.id}"] .mp-dot`);
          if (dot) {
            dot.classList.remove('low', 'unknown');
            dot.classList.add('ok');
            dot.title = `${photo.megapixels.toFixed(1)} MP — ${targetW}×${targetH}`;
          }

          // Update popup if open
          const m = markers[photo.id];
          if (m) m.setPopupContent(buildPhotoPopupHtml(photo));

          // Update detail panel if active
          if (activeId === photo.id) showDetail(photo);

          resolve();
        }, 'image/jpeg', 0.95);
      };
      img.onerror = resolve;
      img.src = photo.url;
    });
  }

  bar.style.width = '100%';
  label.textContent = `✓ ${lowPhotos.length} foto(s) redimensionada(s)`;
  btn.disabled = false;

  // Refresh the combined issues popup — updates counts, or auto-closes
  // if this was the last remaining issue.
  setTimeout(() => {
    progress.style.display = 'none';
    checkPhotoIssues();
  }, 900);
};

// Shrink photos over MAX_PHOTO_BYTES (30MB) down under that limit without
// visibly distorting them (aspect ratio is always preserved) and without
// ever dropping below MIN_PHOTO_MP (12MP). Tries reducing JPEG quality
// first — usually enough on its own — and only reduces dimensions if
// quality reduction alone isn't sufficient, stopping at the 12MP floor.
window.compressOverSizePhotos = async function() {
  const overPhotos = photos.filter(p => p.file && p.file.size > MAX_PHOTO_BYTES);
  if (!overPhotos.length) return;

  const btn      = document.getElementById('sizeCompressBtn');
  const progress = document.getElementById('sizeCompressProgress');
  const bar      = document.getElementById('sizeCompressBar');
  const label    = document.getElementById('sizeCompressLabel');

  btn.disabled = true;
  progress.style.display = 'block';

  // Try a JPEG quality at the given (possibly downscaled) dimensions and
  // return the resulting blob.
  function renderAt(img, w, h, quality) {
    return new Promise(resolve => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    });
  }

  for (let i = 0; i < overPhotos.length; i++) {
    const photo = overPhotos[i];
    label.textContent = `${i + 1} / ${overPhotos.length} — ${photo.name}`;
    bar.style.width = ((i / overPhotos.length) * 100) + '%';

    await new Promise(resolve => {
      const img = new Image();
      img.onload = async () => {
        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;

        // Never shrink dimensions below what's needed to stay at/above
        // the 12MP floor.
        const minScale = Math.min(1, Math.sqrt((MIN_PHOTO_MP * 1_000_000) / (srcW * srcH)));

        let bestBlob = null;
        let bestW = srcW, bestH = srcH;

        // 1) Try quality reduction alone, at full size, first.
        const qualitySteps = [0.9, 0.8, 0.7, 0.6, 0.5];
        for (const q of qualitySteps) {
          const blob = await renderAt(img, srcW, srcH, q);
          if (blob && (!bestBlob || blob.size < bestBlob.size)) { bestBlob = blob; bestW = srcW; bestH = srcH; }
          if (blob && blob.size <= MAX_PHOTO_BYTES) { bestBlob = blob; bestW = srcW; bestH = srcH; break; }
        }

        // 2) If still over budget, progressively downscale (never below
        // the 12MP floor), retrying a mid-range quality at each step.
        if (!bestBlob || bestBlob.size > MAX_PHOTO_BYTES) {
          let scale = 0.9;
          while (scale >= minScale) {
            const w = Math.round(srcW * scale);
            const h = Math.round(srcH * scale);
            const blob = await renderAt(img, w, h, 0.85);
            if (blob && (!bestBlob || blob.size < bestBlob.size)) { bestBlob = blob; bestW = w; bestH = h; }
            if (blob && blob.size <= MAX_PHOTO_BYTES) break;
            if (scale <= minScale) break;
            scale = Math.max(minScale, scale - 0.1);
          }
        }

        if (!bestBlob) { resolve(); return; }

        URL.revokeObjectURL(photo.url);
        const newUrl  = URL.createObjectURL(bestBlob);
        const newFile = new File([bestBlob], photo.name, { type: 'image/jpeg' });
        photo.url        = newUrl;
        photo.file       = newFile;
        photo.megapixels = (bestW * bestH) / 1_000_000;
        photo.imgWidth   = bestW;
        photo.imgHeight  = bestH;

        // Update thumbnail
        const thumb = document.querySelector(`.photo-item[data-id="${photo.id}"] .photo-thumb`);
        if (thumb) thumb.src = newUrl;

        // Update mp-dot (dimensions may have changed slightly)
        const dot = document.querySelector(`.photo-item[data-id="${photo.id}"] .mp-dot`);
        if (dot) {
          dot.classList.remove('low', 'unknown');
          dot.classList.add(photo.megapixels >= MIN_PHOTO_MP ? 'ok' : 'low');
          dot.title = `${photo.megapixels.toFixed(1)} MP — ${bestW}×${bestH}`;
        }

        // Update popup / detail panel if relevant
        const m = markers[photo.id];
        if (m) m.setPopupContent(buildPhotoPopupHtml(photo));
        if (activeId === photo.id) showDetail(photo);

        resolve();
      };
      img.onerror = resolve;
      img.src = photo.url;
    });
  }

  bar.style.width = '100%';
  label.textContent = `✓ ${overPhotos.length} foto(s) compactada(s)`;
  btn.disabled = false;

  setTimeout(() => {
    progress.style.display = 'none';
    checkPhotoIssues();
  }, 900);
};

// ─── RANDOMIZE DUPLICATE GPS ──────────────────────────────────────────────────
// Wire slider immediately (script runs after DOM is built)
(function wireDupSlider() {
  const slider = document.getElementById('dupGpsSlider');
  const valEl  = document.getElementById('dupGpsSliderVal');
  if (slider && valEl) {
    slider.addEventListener('input', () => { valEl.textContent = slider.value + 'm'; });
  } else {
    setTimeout(wireDupSlider, 200);
  }
})();

window.closeDupGpsPopup = function() {
  document.getElementById('dupGpsPopup').classList.remove('show');
};

window.randomizeDupGps = function() {
  const meters = parseInt(document.getElementById('dupGpsSlider').value) || 5;

  // Find all groups of duplicate coords
  const withGps = photos.filter(p => p.lat != null && p.lng != null);
  const groups  = {};
  for (const p of withGps) {
    const key = `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  // 1 degree lat ≈ 111,320m; 1 degree lng ≈ 111,320 * cos(lat)
  let changed = 0;
  for (const ids of Object.values(groups)) {
    if (ids.length < 2) continue;
    // Keep first photo in place, randomize the rest
    for (let i = 1; i < ids.length; i++) {
      const photo = ids[i];
      pushUndo(photo);
      const angle   = Math.random() * 2 * Math.PI;
      const dist    = (Math.random() * 0.5 + 0.5) * meters; // between 50%-100% of max
      const dLat    = (dist * Math.cos(angle)) / 111320;
      const dLng    = (dist * Math.sin(angle)) / (111320 * Math.cos(photo.lat * Math.PI / 180));
      photo.lat += dLat;
      photo.lng += dLng;
      if (!photo.exif) photo.exif = {};
      photo.exif.latitude  = photo.lat;
      photo.exif.longitude = photo.lng;
      // Update marker
      const m = markers[photo.id];
      if (m) {
        m.setLatLng([photo.lat, photo.lng]);
        m.setPopupContent(buildPhotoPopupHtml(photo));
      }
      // Update sidebar coords
      const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
      if (item) {
        const coordEl = item.querySelector('.photo-coords');
        if (coordEl) coordEl.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
        const badge = item.querySelector('.photo-badge');
        if (badge) { badge.classList.remove('dup-gps'); badge.classList.add('gps'); }
      }
      changed++;
    }
  }

  closeDupGpsPopup();
  showToast(`⇄ <span class="accent">${changed}</span> fotos dispersadas até ${meters}m`);
  if (activeId) showDetail(photos.find(p => p.id === activeId));
};

// ─── PHOTO ISSUES ALERT (No GPS / Low MP / Over 30MB) ─────────────────────────
const MAX_PHOTO_BYTES = 30 * 1024 * 1024; // 30MB
const MIN_PHOTO_MP    = 12;

function checkPhotoIssues() {
  const noGps    = photos.filter(p => p.lat == null);
  const lowMp    = photos.filter(p => p.megapixels != null && p.megapixels < MIN_PHOTO_MP);
  const overSize = photos.filter(p => p.file && p.file.size > MAX_PHOTO_BYTES);

  const overlay  = document.getElementById('issuesAlertOverlay');
  const list     = document.getElementById('issuesAlertList');
  const upBtn    = document.getElementById('mpUpscaleBtn');
  const compBtn  = document.getElementById('sizeCompressBtn');
  if (!overlay || !list) return;

  if (!noGps.length && !lowMp.length && !overSize.length) {
    // Everything resolved (or nothing to report) — make sure it's closed.
    overlay.classList.remove('show');
    return;
  }

  const rows = [];
  if (noGps.length)    rows.push(`<div class="issues-alert-row"><span class="issues-alert-row-count">${noGps.length}</span><span class="issues-alert-row-label">foto${noGps.length > 1 ? 's' : ''} sem GPS</span></div>`);
  if (lowMp.length)    rows.push(`<div class="issues-alert-row"><span class="issues-alert-row-count">${lowMp.length}</span><span class="issues-alert-row-label">foto${lowMp.length > 1 ? 's' : ''} abaixo de 12mp</span></div>`);
  if (overSize.length) rows.push(`<div class="issues-alert-row"><span class="issues-alert-row-count">${overSize.length}</span><span class="issues-alert-row-label">foto${overSize.length > 1 ? 's' : ''} acima de 30mb</span></div>`);
  list.innerHTML = rows.join('');

  if (upBtn)   upBtn.style.display   = lowMp.length    ? '' : 'none';
  if (compBtn) compBtn.style.display = overSize.length ? '' : 'none';

  overlay.classList.add('show');
}

window.closeIssuesAlert = function(e) {
  if (e && e.target !== document.getElementById('issuesAlertOverlay') &&
      !e.target.classList.contains('issues-alert-close')) return;
  document.getElementById('issuesAlertOverlay').classList.remove('show');
};
