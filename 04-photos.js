// ==========================================================================
// 04-photos.js
// Cached DOM nodes, file ingest, EXIF parsing, duplicate-GPS scan, sidebar list, rename.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

const fileInput    = document.getElementById('fileInput');
const photoList    = document.getElementById('photoList');
const detailPanel  = document.getElementById('detailPanel');
const detailRows   = document.getElementById('detailRows');
const _elStatTotal = document.getElementById('statTotal');
const _elStatGPS   = document.getElementById('statGPS');
const _elStatNoGPS = document.getElementById('statNoGPS');
const emptyState = document.getElementById('emptyState');
const progressFill = document.getElementById('progressFill');

// file input (hidden, triggered by map UI)
fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
  setTimeout(() => { e.target.value = ''; }, 100);
});

async function handleFiles(fileList) {
  const all = Array.from(fileList).filter(f =>
    f.type.startsWith('image/') ||
    /\.(jpe?g|jpg|png|gif|webp|tiff?|bmp|heic|heif)$/i.test(f.name)
  );
  if (!all.length) return;

  progressFill.style.width = '0%';

  // Show processing bar
  const procWrap  = document.getElementById('procBarWrap');
  const procFill  = document.getElementById('procBarFill');
  const procLabel = document.getElementById('procBarLabel');
  if (procWrap) procWrap.style.display = 'flex';
  if (procLabel) procLabel.textContent = `Lendo EXIF...`;

  // Phase 1: Read EXIF fast in parallel batches (no progress bar — very quick)
  const BATCH = 8;
  const pendingMarkers = [];

  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    await Promise.all(batch.map(async f => {
      try { await processFile(f, pendingMarkers); }
      catch(err) { console.error('processFile error:', err); }
    }));
    await new Promise(r => setTimeout(r, 0));
  }

  // Batch-add all markers at once
  if (pendingMarkers.length) addMarkersToActiveLayer(pendingMarkers);

  if (photos.some(p => p.lat != null)) {
    emptyState.style.display = 'none';
    document.getElementById('fitAllBtn').style.display = 'block';
    document.getElementById('clearBtn').style.display = 'block';
  }
  if (photos.length) document.getElementById('exportBar').classList.add('visible');

  updateStats();
  refreshDateTimeline();
  renderSortedList();

  // Phase 2: Track thumbnail generation — fire all, count completions
  if (procLabel) procLabel.textContent = `Gerando miniaturas 0 / ${all.length}...`;
  if (procFill)  procFill.style.width = '0%';

  // Register a callback on each photo's thumb completion
  // Update marker icon via Leaflet's setIcon (works even when marker is clustered/not in DOM)
  function applyThumbToMarker(photo) {
    const m = markers[photo.id];
    if (!m || !photo.thumbUrl) return;
    const newIcon = L.divIcon({
      className: '',
      html: `<div class="custom-marker-hitbox"><div class="custom-marker" id="marker-${photo.id}"><img src="${photo.thumbUrl}" alt=""></div></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -46]
    });
    m.setIcon(newIcon);
  }

  let thumbsDone = 0;
  const thumbTotal = all.length;

  const thumbPromises = photos.slice(-all.length).map(photo => new Promise(resolve => {
    if (photo.thumbUrl) {
      thumbsDone++;
      const pct = Math.round(thumbsDone / thumbTotal * 100);
      if (procFill)  procFill.style.width  = pct + '%';
      if (procLabel) procLabel.textContent  = `Miniaturas ${thumbsDone} / ${thumbTotal}...`;
      applyThumbToMarker(photo);
      resolve();
    } else {
      const check = setInterval(() => {
        if (photo.thumbUrl) {
          clearInterval(check);
          thumbsDone++;
          const pct = Math.round(thumbsDone / thumbTotal * 100);
          if (procFill)  procFill.style.width  = pct + '%';
          if (procLabel) procLabel.textContent  = `Miniaturas ${thumbsDone} / ${thumbTotal}...`;
          applyThumbToMarker(photo);
          resolve();
        }
      }, 100);
    }
  }));

  await Promise.all(thumbPromises);
  // Hide processing bar with a brief "done" flash
  if (procLabel) procLabel.textContent = `✓ ${all.length} foto${all.length > 1 ? 's' : ''} processada${all.length > 1 ? 's' : ''}`;
  if (procFill)  procFill.style.width = '100%';
  setTimeout(() => {
    if (procWrap) procWrap.style.display = 'none';
    if (procFill) procFill.style.width = '0%';
    progressFill.style.width = '0%';
  }, 1200);
  checkDuplicateGps();
}

const _knownDupKeys = new Set(); // track already-alerted duplicate coords

function checkDuplicateGps() {
  const withGps = photos.filter(p => p.lat != null && p.lng != null);
  if (withGps.length < 2) return;

  const seen = {};
  for (const p of withGps) {
    const key = `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
    if (!seen[key]) seen[key] = [];
    seen[key].push(p.id);
  }

  // Reset all GPS badges
  document.querySelectorAll('.photo-badge.dup-gps').forEach(el => {
    el.classList.remove('dup-gps');
    el.classList.add('gps');
  });

  let dupCount = 0;
  let newDupCount = 0;

  for (const [key, ids] of Object.entries(seen)) {
    if (ids.length > 1) {
      dupCount += ids.length;
      const isNew = !_knownDupKeys.has(key);
      if (isNew) newDupCount += ids.length;
      _knownDupKeys.add(key);
      ids.forEach(id => {
        const badge = document.querySelector(`.photo-item[data-id="${id}"] .photo-badge`);
        if (badge) { badge.classList.remove('gps'); badge.classList.add('dup-gps'); }
      });
    }
  }

  // Only show popup if there are NEW duplicates from this upload batch
  if (newDupCount === 0) return;

  const popup   = document.getElementById('dupGpsPopup');
  const countEl = document.getElementById('dupGpsCount');
  if (!popup || !countEl) return;

  countEl.textContent = newDupCount;
  popup.classList.add('show');
  setTimeout(() => popup.classList.remove('show'), 5000);
}

let _fileIdCounter = 0;
async function processFile(file, pendingMarkers) {
  const id = `${Date.now()}_${++_fileIdCounter}`;
  const url = URL.createObjectURL(file);

  let exif = {};
  let lat = null, lng = null;

  try {
    exif = await exifr.parse(file, {
      // All segments — critical for iPhone JPGs
      tiff:        true,
      exif:        true,
      gps:         true,
      ifd0:        true,
      ifd1:        true,
      interop:     true,
      xmp:         true,
      iptc:        false,
      jfif:        false,
      ihdr:        false,
      // Key options
      translateKeys:   true,
      translateValues: true,
      reviveValues:    true,
      sanitize:        true,
      mergeOutput:     true,
    }) || {};

    // exifr normalises GPS to .latitude / .longitude — but iPhone may also
    // expose GPSLatitude + GPSLatitudeRef as raw arrays, handle both
    if (exif.latitude != null && exif.longitude != null) {
      lat = exif.latitude;
      lng = exif.longitude;
    } else if (exif.GPSLatitude != null && exif.GPSLongitude != null) {
      const toDecimal = (arr, ref) => {
        const [d, m, s] = Array.isArray(arr) ? arr : [arr, 0, 0];
        const dec = d + m / 60 + s / 3600;
        return (ref === 'S' || ref === 'W') ? -dec : dec;
      };
      lat = toDecimal(exif.GPSLatitude,  exif.GPSLatitudeRef);
      lng = toDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
    }
  } catch (e) {
  }

  const photo = { id, file, url, name: file.name, lat, lng, exif, megapixels: null };
  photos.push(photo);

  // Size/GPS issues are known immediately (no image decode needed) — check
  // right away, before any DOM work below that could throw and skip past it.
  clearTimeout(window._issuesAlertTimer);
  window._issuesAlertTimer = setTimeout(() => { checkPhotoIssues(); }, 800);

  // Generate thumbnail in background — don't await, keeps processing fast
  const _mpImg = new Image();
  _mpImg.onload = function() {
    const mp = (_mpImg.naturalWidth * _mpImg.naturalHeight) / 1_000_000;
    photo.megapixels = mp;
    photo.imgWidth   = _mpImg.naturalWidth;
    photo.imgHeight  = _mpImg.naturalHeight;

    // Generate 80×80 JPEG thumb
    const TSIZE = 80;
    const tc = document.createElement('canvas');
    tc.width = tc.height = TSIZE;
    const tctx = tc.getContext('2d');
    const scale = Math.max(TSIZE / _mpImg.naturalWidth, TSIZE / _mpImg.naturalHeight);
    const tw = _mpImg.naturalWidth * scale, th = _mpImg.naturalHeight * scale;
    tctx.drawImage(_mpImg, (TSIZE - tw) / 2, (TSIZE - th) / 2, tw, th);
    photo.thumbUrl = tc.toDataURL('image/jpeg', 0.5);

    // Update sidebar thumb
    const thumbEl = document.querySelector(`.photo-item[data-id="${id}"] .photo-thumb`);
    if (thumbEl) thumbEl.src = photo.thumbUrl;

    // Update marker icon
    const markerImg = document.getElementById(`marker-${id}`)?.querySelector('img');
    if (markerImg) markerImg.src = photo.thumbUrl;

    // Update mp dot
    const dot = document.querySelector(`.photo-item[data-id="${id}"] .mp-dot`);
    if (dot) {
      dot.classList.remove('unknown');
      dot.classList.add(mp >= 12 ? 'ok' : 'low');
      dot.title = `${mp.toFixed(1)} MP — ${_mpImg.naturalWidth}×${_mpImg.naturalHeight}`;
    }
    clearTimeout(window._issuesAlertTimer);
    window._issuesAlertTimer = setTimeout(() => {
      checkPhotoIssues();
    }, 800);
  };
  _mpImg.onerror = () => {
    // MP couldn't be measured, but size/GPS checks don't depend on it —
    // make sure the alert still gets a chance to run.
    clearTimeout(window._issuesAlertTimer);
    window._issuesAlertTimer = setTimeout(() => { checkPhotoIssues(); }, 800);
  };
  _mpImg.src = url;

  addListItem(photo);

  if (lat != null) {
    if (pendingMarkers) {
      // Build marker now but don't add to map yet — will be batch-added
      const m = buildMarker(photo);
      markers[photo.id] = m;
      pendingMarkers.push(m);
    } else {
      addMarker(photo);
    }
  }
}

function refreshDateTimeline() {
  const container = document.getElementById('dateTimeline');
  if (!container) return;

  if (!photos.length) {
    container.innerHTML = '<div class="date-timeline-empty">NEHUMA FOTO ADICIONADA</div>';
    return;
  }

  // Group photos by date (YYYY-MM-DD), fallback to 'Unknown'
  const groups = {};
  for (const p of photos) {
    let key = 'Unknown date';
    const raw = p.exif?.DateTimeOriginal
             || p.exif?.CreateDate
             || p.exif?.DateTime
             || p.exif?.DateTimeDigitized
             || p.exif?.ModifyDate;
    if (raw) {
      let d = null;
      if (raw instanceof Date && !isNaN(raw)) {
        d = raw;
      } else if (typeof raw === 'string') {
        // "2024:05:31 14:22:01" or "2024-05-31T14:22:01"
        const m = raw.match(/(\d{4})[:\/\-](\d{2})[:\/\-](\d{2})/);
        if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
      }
      if (d && !isNaN(d)) {
        const y  = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        key = `${y}-${mo}-${dy}`;
      }
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  // Sort chronologically (Unknown last)
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === 'Unknown date') return 1;
    if (b === 'Unknown date') return -1;
    return b.localeCompare(a);
  });

  const maxCount = Math.max(...sortedKeys.map(k => groups[k].length));

  container.innerHTML = '';
  for (const key of sortedKeys) {
    const count = groups[key].length;
    const pct   = Math.round(count / maxCount * 100);

    // Format label
    let label = key;
    if (key !== 'Unknown date') {
      const [y, mo, d] = key.split('-');
      label = `${d}/${mo}/${y}`;
    }

    const row = document.createElement('div');
    row.className = 'date-group';
    row.dataset.date = key;
    row.innerHTML = `
      <span class="date-group-label">${label}</span>
      <div class="date-group-bar"><div class="date-group-fill" style="width:${pct}%"></div></div>
      <span class="date-group-count">${count}</span>
    `;

    // Click: scroll to and highlight first photo of that date in the list
    row.addEventListener('click', () => {
      document.querySelectorAll('.date-group').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const ids = groups[key].map(p => p.id);
      const firstItem = document.querySelector(`.photo-item[data-id="${ids[0]}"]`);
      if (firstItem) {
        firstItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // Briefly highlight all photos from that date
        ids.forEach(id => {
          const el = document.querySelector(`.photo-item[data-id="${id}"]`);
          if (el) {
            el.style.transition = 'background 0.2s';
            el.style.background = 'rgba(212,245,60,0.08)';
            setTimeout(() => { el.style.background = ''; }, 1200);
          }
        });
      }
    });

    container.appendChild(row);
  }
}

function addListItem(photo) {
  const item = document.createElement('div');
  item.className = 'photo-item';
  item.dataset.id = photo.id;
  item.style.animationDelay = '0ms';

  const hasGPS = photo.lat != null;
  const coordText = hasGPS
    ? `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`
    : 'No GPS data';

  item.innerHTML = `
    <img class="photo-thumb" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="${photo.name}">
    <div class="photo-info">
      <div class="photo-name">
        <span class="photo-name-text" title="${photo.name}">${photo.name}</span>
        <button class="relocate-btn" title="Clicar no mapa para definir localização">🗺</button>
        <button class="rename-btn" title="Renomear">✎</button>
      </div>
      <div class="photo-coords ${hasGPS ? 'has-gps' : 'no-gps'}">${coordText}</div>
    </div>
    <div class="dot-group">
      <div class="dot-with-label">
        <div class="photo-badge ${hasGPS ? 'gps' : 'no-gps'}"></div>
        <span class="dot-label" style="color:var(--accent)">GPS</span>
      </div>
      <div class="dot-with-label">
        <div class="mp-dot unknown" title="Calculating…"></div>
        <span class="dot-label mp-label" style="color:var(--accent)">12MP</span>
      </div>
    </div>
  `;

  item.addEventListener('click', (e) => {
    if (e.target.classList.contains('rename-btn') || e.target.classList.contains('name-input')) return;
    selectPhoto(photo.id);
  });

  item.querySelector('.rename-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    startRename(photo.id, item);
  });

  item.querySelector('.relocate-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    selectPhoto(photo.id);
    startRelocateMode(photo.id);
  });

  // Double-click name text to rename
  item.querySelector('.photo-name-text').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(photo.id, item);
  });

  photoList.appendChild(item);
  // refreshMetaTab / refreshDateTimeline / renderSortedList
  // called once after all files load — not per file
}

function startRename(id, item) {
  const photo = photos.find(p => p.id == id);
  if (!photo) return;

  const nameEl = item.querySelector('.photo-name');
  const nameText = item.querySelector('.photo-name-text');
  const renameBtn = item.querySelector('.rename-btn');

  // Already editing
  if (nameEl.querySelector('.name-input')) return;

  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = photo.name;
  input.maxLength = 80;

  nameText.style.display = 'none';
  renameBtn.style.display = 'none';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim() || photo.name;
    pushUndo(photo);
    photo.name = newName;

    nameText.textContent = newName;
    nameText.title = newName;
    nameText.style.display = '';
    renameBtn.style.display = '';
    input.remove();

    // Update popup if marker exists
    if (markers[id]) {
      const exif = photo.exif || {};
      const rows = [
        ['Coordinates', `${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}`],
        (exif.DateTimeOriginal || exif.CreateDate) ? ['Data', formatDate(exif.DateTimeOriginal || exif.CreateDate)] : null,
        exif.Make ? ['Camera', `${exif.Make || ''} ${exif.Model || ''}`.trim()] : null,
        toNum(exif.FocalLength) ? ['Distancia Focal', `${toNum(exif.FocalLength).toFixed(1)}mm`] : null,
        exif.ISO ? ['ISO', exif.ISO] : null,
        toNum(exif.ExposureTime) ? ['Exposure', `1/${Math.round(1/toNum(exif.ExposureTime))}s`] : null,
      ].filter(Boolean);
      const rowsHtml = rows.map(([k, v]) => `<div class="popup-row">${k} <span>${v}</span></div>`).join('');
      markers[id].setPopupContent(`
        <div class="popup-content">
          <div class="popup-name">${newName}</div>
          ${rowsHtml}
        </div>
      `);
    }

    // Refresh detail panel if this photo is active
    if (activeId == id) showDetail(photo);

    showToast(`Renamed to <span class="accent">${newName}</span>`);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') {
      nameText.style.display = '';
      renameBtn.style.display = '';
      input.remove();
    }
  });
  input.addEventListener('blur', commit);
}
