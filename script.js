import { EMBEDDED_KML, EMBEDDED_KML_NAME } from './kml-data.js';

const exifr = window.exifr;

// exifr can return rational numbers as {numerator,denominator} objects
function toNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && 'numerator' in val) return val.numerator / val.denominator;
  if (Array.isArray(val) && val.length === 2) return val[0] / val[1];
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// MAP INIT
const map = L.map('map', {
  center: [20, 0],
  zoom: 2,
  zoomControl: true,
  attributionControl: false,
  rotate: true,
  bearing: 0
});

L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
  maxZoom: 21,
  attribution: '© Google'
}).addTo(map);

const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  spiderfyDistanceMultiplier: 1.2,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  disableClusteringAtZoom: 19,
  animateAddingMarkers: false
});
map.addLayer(clusterGroup);

// Spiderfy cluster on hover so overlapping markers spread apart
let _spiderfyTimer = null;
clusterGroup.on('clustermouseover', function(e) {
  _spiderfyTimer = setTimeout(() => e.layer.spiderfy(), 180);
});
clusterGroup.on('clustermouseout', function(e) {
  clearTimeout(_spiderfyTimer);
  e.layer.unspiderfy();
});

// ─── ORIENTATION LAYERS ──────────────────────────────────────────────────────
const _orientLayers = {
  cities: L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    { attribution: '© CartoDB', opacity: 0.9, pane: 'overlayPane', zIndex: 400 }
  ),
  roads: L.tileLayer(
    'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', opacity: 0.0 } // placeholder
  ),
  hybrid: L.tileLayer(
    'https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}',
    { attribution: '© Google', opacity: 0.9, maxZoom: 21 }
  )
};

// Use OpenStreetMap for roads — reliable and has BR highway numbers
_orientLayers.roads = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution: '© OpenStreetMap', opacity: 0.35, maxZoom: 21 }
);

const _orientActive = { cities: false, roads: false, hybrid: false };

// Enable hybrid by default
_orientLayers.hybrid.addTo(map);
_orientActive.hybrid = true;
document.getElementById('checkHybrid').textContent = '●';
document.getElementById('checkHybrid').style.color = 'var(--accent)';

window.toggleOrientLayer = function(key) {
  const isOn = _orientActive[key];
  const check = document.getElementById('checkCities'.replace('Cities', key.charAt(0).toUpperCase() + key.slice(1)));
  const checkEl = document.getElementById('check' + key.charAt(0).toUpperCase() + key.slice(1));

  if (isOn) {
    map.removeLayer(_orientLayers[key]);
    _orientActive[key] = false;
    if (checkEl) { checkEl.textContent = '○'; checkEl.style.color = '#888'; }
  } else {
    _orientLayers[key].addTo(map);
    _orientActive[key] = true;
    if (checkEl) { checkEl.textContent = '●'; checkEl.style.color = 'var(--accent)'; }
  }
};

clusterGroup.on('clusterclick', function(e) {
  const bounds = e.layer.getBounds();
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18, animate: true });
});

// Strategy: try WMS first (INDE GeoServer), fall back to ArcGIS FeatureServer GeoJSON
// The WMS server may block cross-origin requests; the FeatureServer has confirmed public CORS.

const DNIT_WMS_URL  = 'https://geoservicos.inde.gov.br/geoserver/DNIT/ows';
const DNIT_FS_URL   = 'https://pamgia.ibama.gov.br/server/rest/services/BasesSincronizadas/line_rodovias_federais_dnit_l/FeatureServer/0/query';

const layerCfg = {
  snv: {
    label: 'Rodovias Federais (SNV)',
    desc: 'Sistema Nacional de Viação',
    wmsName: 'SNV202407A',          // correct layer name from INDE
    layer: null, active: false, method: null
  },
  pnv: {
    label: 'Rodovias (OSM Transport)',
    desc: 'OpenStreetMap transport layer',
    wmsName: null,
    layer: null, active: false, method: 'osm'
  },
  sat: {
    label: 'Satélite (Esri)',
    desc: 'Imagens de satélite Esri',
    wmsName: null,
    layer: null, active: false, method: 'sat'
  }
};

// Try loading WMS tile — if first tile errors, switch to GeoJSON fallback
async function tryWmsOrFallback(id) {
  const cfg = layerCfg[id];
  const chk = document.getElementById('chk-' + id);
  const status = document.getElementById('status-' + id);

  setStatus(id, 'carregando...', true);

  const wmsLayer = L.tileLayer.wms(DNIT_WMS_URL, {
    layers: cfg.wmsName,
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    opacity: 0.85
  });

  let resolved = false;

  const onLoad = () => {
    if (resolved) return;
    resolved = true;
    cfg.layer = wmsLayer;
    cfg.method = 'wms';
    wmsLayer.addTo(map);
    setStatus(id, '● WMS ativo', false);
  };

  const onError = async () => {
    if (resolved) return;
    resolved = true;
    // WMS blocked — try ArcGIS FeatureServer GeoJSON
    setStatus(id, 'WMS bloqueado, carregando dados...', true);
    try {
      const params = new URLSearchParams({
        where: '1=1', outFields: 'vl_br,sg_uf,nm_tipo_tr',
        f: 'geojson', resultRecordCount: 2000,
        geometryType: 'esriGeometryPolyline', outSR: 4326
      });
      const resp = await fetch(DNIT_FS_URL + '?' + params);
      if (!resp.ok) throw new Error('FeatureServer error');
      const geojson = await resp.json();
      cfg.layer = L.geoJSON(geojson, {
        style: { color: '#3b82f6', weight: 1.5, opacity: 0.75 }
      }).addTo(map);
      cfg.method = 'geojson';
      setStatus(id, '● GeoJSON ativo', false);
    } catch(e) {
      setStatus(id, '✕ servidor indisponível', false);
      chk.classList.remove('on');
      cfg.active = false;
    }
  };

  // Test the WMS by creating a temporary single tile request
  const testImg = new Image();
  const bbox = '-8900000,-1500000,-8800000,-1400000'; // Brazil area in mercator
  const testUrl = `${DNIT_WMS_URL}?service=WMS&version=1.1.1&request=GetMap&layers=${cfg.wmsName}&bbox=${bbox}&width=64&height=64&srs=EPSG:3857&format=image/png&transparent=true`;
  testImg.onload = onLoad;
  testImg.onerror = onError;
  setTimeout(() => { if (!resolved) onError(); }, 6000); // 6s timeout
  testImg.src = testUrl;
}

function setStatus(id, text, loading) {
  const el = document.getElementById('status-' + id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('loading', loading);
}

window.toggleLayer = function(id) {
  const cfg = layerCfg[id];
  const chk = document.getElementById('chk-' + id);

  if (cfg.active) {
    // Turn off
    if (cfg.layer) {
      if (cfg.method === 'wms' || cfg.method === 'sat' || cfg.method === 'osm') {
        map.removeLayer(cfg.layer);
      } else if (cfg.method === 'geojson') {
        map.removeLayer(cfg.layer);
      }
      cfg.layer = null;
    }
    cfg.active = false;
    chk.classList.remove('on');
    setStatus(id, '', false);
    return;
  }

  // Turn on
  cfg.active = true;
  chk.classList.add('on');

  // Built-in tile layers (no WMS needed)
  if (id === 'pnv') {
    cfg.layer = L.tileLayer('https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=anonymous', {
      // Fallback to a free transport-style tile
      errorTileUrl: ''
    });
    // Use a known-free transport layer instead
    cfg.layer = L.tileLayer(
      'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      { opacity: 0.6, maxZoom: 19 }
    ).addTo(map);
    cfg.method = 'osm';
    setStatus(id, '● ativo (OSM Humanitário)', false);
    return;
  }

  if (id === 'sat') {
    cfg.layer = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      { opacity: 0.85, maxZoom: 21, attribution: '© Google' }
    ).addTo(map);
    cfg.method = 'sat';
    setStatus(id, '● satélite ativo', false);
    return;
  }

  // SNV: try WMS → fallback GeoJSON
  tryWmsOrFallback(id);
};

window.toggleLayerPanel = function() {
  const list = document.getElementById('layerList');
  const arrow = document.getElementById('layerArrow');
  list.classList.toggle('open');
  arrow.classList.toggle('open');
};

let _kmlCollapseTimer = null;
window._scheduleKmlPanelCollapse = function() {
  if (_kmlCollapseTimer) clearTimeout(_kmlCollapseTimer);
  _kmlCollapseTimer = setTimeout(() => {
    const list  = document.getElementById('layerList');
    const arrow = document.getElementById('layerArrow');
    if (list && list.classList.contains('open')) {
      list.classList.remove('open');
      arrow.classList.remove('open');
    }
    _kmlCollapseTimer = null;
  }, 2000);
};

// STATE
const photos = [];
const markers = {};
let activeId = null;

// ─── DEBOUNCE HELPER ──────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const _refreshMetaTabDebounced = debounce(() => refreshMetaTab(), 120);
const _updateStatsDebounced    = debounce(() => updateStats(),     60);

// ─── LAZY THUMBNAIL LOADER ────────────────────────────────────────────────────
const _thumbObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const imgEl = e.target;
      const src   = imgEl.dataset.src;
      if (!src) return;
      delete imgEl.dataset.src;
      _thumbObserver.unobserve(imgEl);
      generateThumb(src, dataUrl => { imgEl.src = dataUrl; });
    }
  });
}, { rootMargin: '200px' });

function observeThumb(el) {
  const img = el.querySelector('.photo-thumb');
  if (img && img.dataset.src) _thumbObserver.observe(img);
}

const _undoStack = [];
const MAX_UNDO = 50;

function _snapshotPhoto(photo) {
  return {
    id:   photo.id,
    name: photo.name,
    lat:  photo.lat,
    lng:  photo.lng,
    exif: JSON.parse(JSON.stringify(photo.exif || {}))
  };
}

function pushUndo(photo) {
  _undoStack.push(_snapshotPhoto(photo));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
}

function _applySnapshot(snap) {
  const photo = photos.find(p => p.id === snap.id);
  if (!photo) return;

  photo.name = snap.name;
  photo.lat  = snap.lat;
  photo.lng  = snap.lng;
  photo.exif = snap.exif;

  // Update marker position
  const m = markers[photo.id];
  if (m) {
    if (photo.lat != null && photo.lng != null) {
      m.setLatLng([photo.lat, photo.lng]);
      m.setPopupContent(buildPhotoPopupHtml(photo));
    }
  }

  // Update sidebar list item
  const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
  if (item) {
    const nameEl  = item.querySelector('.photo-name-text');
    const coordEl = item.querySelector('.photo-coords');
    const badge   = item.querySelector('.photo-badge');
    if (nameEl)  { nameEl.textContent = photo.name; nameEl.title = photo.name; }
    if (coordEl) {
      if (photo.lat != null) {
        coordEl.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
        coordEl.className = 'photo-coords has-gps';
      } else {
        coordEl.textContent = 'No GPS data';
        coordEl.className = 'photo-coords no-gps';
      }
    }
    if (badge) badge.className = `photo-badge ${photo.lat != null ? 'gps' : 'no-gps'}`;
  }

  // Update detail panel if active
  if (activeId === photo.id) showDetail(photo);
  _refreshMetaTabDebounced();
  refreshDateTimeline();
  _updateStatsDebounced();
  showToast('↩ Undo');
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (_undoStack.length === 0) { showToast('Nothing to undo'); return; }
    const snap = _undoStack.pop();
    _applySnapshot(snap);
  }

  // Skip all shortcuts if typing in an input
  if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  if (document.activeElement && document.activeElement.isContentEditable) return;

  // Delete / Backspace: remove selected photo
  if ((e.key === 'Delete' || e.key === 'Backspace') && activeId != null) {
    e.preventDefault();
    const idx   = photos.findIndex(p => p.id === activeId);
    const photo = photos[idx];
    if (!photo) return;

    // Select adjacent photo before removing
    const listIds   = [...document.querySelectorAll('.photo-item[data-id]')].map(el => el.dataset.id);
    const listIdx   = listIds.indexOf(String(activeId));
    const nextListId = listIds[listIdx + 1] || listIds[listIdx - 1] || null;

    // Remove marker
    const m = markers[photo.id];
    if (m) { clusterGroup.removeLayer(m); delete markers[photo.id]; }

    // Revoke blob URL
    if (photo.url) URL.revokeObjectURL(photo.url);

    // Remove from photos array
    photos.splice(idx, 1);

    // Remove list item
    const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
    if (item) item.remove();

    // Clear detail panel
    activeId = null;
    detailPanel.style.display = 'none';

    updateStats();
    _refreshMetaTabDebounced();
    refreshDateTimeline();
    renderSortedList();

    if (!photos.length) {
      document.getElementById('fitAllBtn').style.display = 'none';
      document.getElementById('clearBtn').style.display  = 'none';
      document.getElementById('exportBar').classList.remove('visible');
      emptyState.style.display = 'flex';
    }

    showToast(`🗑 <span class="accent">${photo.name}</span> removida`);

    // Select next photo if available
    if (nextListId) {
      const next = photos.find(p => String(p.id) === nextListId);
      if (next) selectPhoto(next.id);
    }
  }

  // Tab / Shift+Tab: navigate between photos in sidebar order
  if (e.key === 'Tab' && activeId != null && photos.length > 1) {
    e.preventDefault();
    const listIds = [...document.querySelectorAll('.photo-item[data-id]')].map(el => el.dataset.id);
    if (!listIds.length) return;
    const idx     = listIds.indexOf(String(activeId));
    const nextIdx = e.shiftKey
      ? (idx - 1 + listIds.length) % listIds.length
      : (idx + 1) % listIds.length;
    const nextId    = listIds[nextIdx];
    const nextPhoto = photos.find(p => String(p.id) === nextId);
    if (!nextPhoto) return;
    selectPhoto(nextPhoto.id);
    const m = markers[nextPhoto.id];
    if (m) m.openPopup();
  }
});

// UI REFS — cached once at startup
const fileInput    = document.getElementById('fileInput');
const photoList    = document.getElementById('photoList');
const detailPanel  = document.getElementById('detailPanel');
const detailRows   = document.getElementById('detailRows');
const _elStatTotal = document.getElementById('statTotal');
const _elStatGPS   = document.getElementById('statGPS');
const _elStatNoGPS = document.getElementById('statNoGPS');
const _elMetaEmpty = document.getElementById('metaTabEmpty');
const _elMetaWrap  = document.getElementById('metaBulkWrap');
const _elMetaList  = document.getElementById('metaPhotoList');
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
  if (pendingMarkers.length) clusterGroup.addLayers(pendingMarkers);

  if (photos.some(p => p.lat != null)) {
    emptyState.style.display = 'none';
    document.getElementById('fitAllBtn').style.display = 'block';
    document.getElementById('clearBtn').style.display = 'block';
  }
  if (photos.length) document.getElementById('exportBar').classList.add('visible');

  updateStats();
  refreshMetaTab();
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
      html: `<div class="custom-marker" id="marker-${photo.id}"><img src="${photo.thumbUrl}" alt=""></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -40]
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
  checkNoGps(photos.slice(-all.length));
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
    clearTimeout(window._mpAlertTimer);
    window._mpAlertTimer = setTimeout(() => {
      const lowCount = photos.filter(p => p.megapixels != null && p.megapixels < 12).length;
      if (lowCount > 0) showMpAlert(lowCount);
    }, 800);
  };
  _mpImg.onerror = () => {};
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
    container.innerHTML = '<div class="date-timeline-empty">No photos loaded yet</div>';
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
        <button class="rename-btn" title="Rename">✎</button>
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
        (exif.DateTimeOriginal || exif.CreateDate) ? ['Date Taken', formatDate(exif.DateTimeOriginal || exif.CreateDate)] : null,
        exif.Make ? ['Camera', `${exif.Make || ''} ${exif.Model || ''}`.trim()] : null,
        toNum(exif.FocalLength) ? ['Focal Length', `${toNum(exif.FocalLength).toFixed(1)}mm`] : null,
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

function buildPhotoPopupHtml(photo) {
  const exif = photo.exif || {};
  const id = photo.id;
  return `
    <div class="popup-content" style="min-width:220px">
      <img class="popup-img" src="${photo.url}" alt="${photo.name}">
      <input class="popup-edit-name" data-field="name" data-id="${id}"
        value="${photo.name.replace(/"/g,'&quot;')}" maxlength="80" spellcheck="false">
      <div class="popup-edit-row">
        <span class="popup-edit-label">GPS Lat</span>
        <input class="popup-edit-input" data-field="lat" data-id="${id}"
          value="${photo.lat != null ? photo.lat.toFixed(8) : ''}" placeholder="—" type="number" step="any">
      </div>
      <div class="popup-edit-row">
        <span class="popup-edit-label">GPS Lng</span>
        <input class="popup-edit-input" data-field="lng" data-id="${id}"
          value="${photo.lng != null ? photo.lng.toFixed(8) : ''}" placeholder="—" type="number" step="any">
      </div>
      <div class="popup-edit-row">
        <span class="popup-edit-label">Date Taken</span>
        <input class="popup-edit-input" data-field="DateTimeOriginal" data-id="${id}"
          value="${exif.DateTimeOriginal ? formatDate(exif.DateTimeOriginal) : ''}" placeholder="—">
      </div>
      <div class="popup-btn-row">
        <button class="popup-save-btn" onclick="savePopupEdits('${id}')">SAVE</button>
        <button class="popup-relocate-btn" onclick="startRelocateMode('${id}')" title="Click map to redefine location">📍</button>
        <button class="popup-relocate-btn" onclick="openSVAtMarker(${photo.lat}, ${photo.lng})" title="Abrir no Google Maps">🗺</button>
      </div>
    </div>
  `;
}

window.savePopupEdits = function(id) {
  const photo = photos.find(p => p.id == id);
  if (!photo) return;
  const marker = markers[id];
  if (!marker) return;
  const popup = marker.getPopup();
  const el = popup.getElement();
  if (!el) return;

  if (!photo.exif) photo.exif = {};
  pushUndo(photo);
  const numFields = ['FocalLength','FNumber','ISO'];

  el.querySelectorAll('[data-field]').forEach(input => {
    const field = input.dataset.field;
    const val = input.value.trim();
    if (field === 'name') {
      if (val) {
        photo.name = val;
        // update sidebar list item
        const listItem = document.querySelector(`.photo-item[data-id="${id}"]`);
        if (listItem) {
          const nameText = listItem.querySelector('.photo-name-text');
          if (nameText) { nameText.textContent = val; nameText.title = val; }
        }
      }
    } else if (field === 'lat') {
      const v = parseFloat(val);
      if (!isNaN(v)) { photo.lat = v; photo.exif.latitude = v; }
    } else if (field === 'lng') {
      const v = parseFloat(val);
      if (!isNaN(v)) { photo.lng = v; photo.exif.longitude = v; }
    } else {
      if (val === '') return;
      photo.exif[field] = numFields.includes(field) ? parseFloat(val) : val;
    }
  });

  // Update marker position if GPS changed
  if (photo.lat != null && photo.lng != null) {
    marker.setLatLng([photo.lat, photo.lng]);
  }

  // Refresh popup content
  marker.setPopupContent(buildPhotoPopupHtml(photo));

  // Re-attach events after content swap
  setTimeout(() => attachPopupEvents(id), 50);

  // Update detail panel if active
  if (activeId == id) showDetail(photo);
  _refreshMetaTabDebounced();
  showToast('Photo updated ✓');
};

function attachPopupEvents(id) {
  const marker = markers[id];
  if (!marker) return;
  const popup = marker.getPopup();
  const el = popup?.getElement();
  if (!el) return;
  // prevent map click-through on inputs
  el.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('mousedown', e => e.stopPropagation());
  });
}

let _pickingForId = null;
let _pickingHandler = null;
let _pickingKeyHandler = null;

window.startRelocateMode = function(id) {
  // Cancel any existing picking session
  cancelRelocateMode();

  _pickingForId = id;
  const mapEl = document.getElementById('map');
  const banner = document.getElementById('pickingBanner');

  mapEl.classList.add('picking-location');
  banner.classList.add('show');

  // Mark the relocate button as active
  const marker = markers[id];
  if (marker) {
    const popup = marker.getPopup();
    const el = popup?.getElement();
    if (el) {
      const btn = el.querySelector('.popup-relocate-btn');
      if (btn) btn.classList.add('active');
    }
  }

  _pickingHandler = function(e) {
    const photo = photos.find(p => p.id == _pickingForId);
    if (!photo) { cancelRelocateMode(); return; }

    const { lat, lng } = e.latlng;
    pushUndo(photo);
    photo.lat = lat;
    photo.lng = lng;
    if (!photo.exif) photo.exif = {};
    photo.exif.latitude  = lat;
    photo.exif.longitude = lng;

    const m = markers[_pickingForId];
    if (m) {
      m.setLatLng([lat, lng]);
      m.setPopupContent(buildPhotoPopupHtml(photo));
      m.openPopup();
      setTimeout(() => attachPopupEvents(_pickingForId), 60);
    } else {
      // photo had no GPS before — create marker now
      addMarker(photo);
      markers[photo.id].openPopup();
      // update list item GPS display
      const listItem = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
      if (listItem) {
        const coordEl = listItem.querySelector('.photo-coords');
        if (coordEl) {
          coordEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          coordEl.className = 'photo-coords has-gps';
        }
        const badge = listItem.querySelector('.photo-badge');
        if (badge) { badge.className = 'photo-badge gps'; }
      }
    }

    // Sync lat/lng inputs in popup if still open
    const pm = markers[photo.id];
    if (pm) {
      const pe = pm.getPopup()?.getElement();
      if (pe) {
        const latIn = pe.querySelector('[data-field="lat"]');
        const lngIn = pe.querySelector('[data-field="lng"]');
        if (latIn) latIn.value = lat.toFixed(8);
        if (lngIn) lngIn.value = lng.toFixed(8);
      }
    }

    if (activeId == photo.id) showDetail(photo);
    refreshMetaTab();
    showToast(`📍 Location set — <span class="accent">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`);
    cancelRelocateMode();
  };

  _pickingKeyHandler = function(e) {
    if (e.key === 'Escape') cancelRelocateMode();
  };

  map.once('click', _pickingHandler);
  document.addEventListener('keydown', _pickingKeyHandler);
};

function cancelRelocateMode() {
  if (_pickingHandler)    { map.off('click', _pickingHandler); _pickingHandler = null; }
  if (_pickingKeyHandler) { document.removeEventListener('keydown', _pickingKeyHandler); _pickingKeyHandler = null; }

  document.getElementById('map').classList.remove('picking-location');
  document.getElementById('pickingBanner').classList.remove('show');

  // Remove active class from all relocate buttons
  document.querySelectorAll('.popup-relocate-btn.active').forEach(b => b.classList.remove('active'));

  _pickingForId = null;
}

function buildMarker(photo) {
  // Use tiny thumb for marker icon if available, else a placeholder
  const thumbSrc = photo.thumbUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const icon = L.divIcon({
    className: '',
    html: `<div class="custom-marker" id="marker-${photo.id}"><img src="${thumbSrc}" alt=""></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -40]
  });
  const marker = L.marker([photo.lat, photo.lng], { icon, bubblingMouseEvents: false });
  marker.bindPopup(() => buildPhotoPopupHtml(photo), {
    maxWidth: 340, maxHeight: 560,
    autoPan: true, autoPanPadding: L.point(20, 20)
  });
  marker.on('popupopen', function() {
    setTimeout(() => attachPopupEvents(photo.id), 80);
  });
  marker.on('click', () => selectPhoto(photo.id));
  return marker;
}

function addMarker(photo) {
  const marker = buildMarker(photo);
  clusterGroup.addLayer(marker);

  markers[photo.id] = marker;
}

function selectPhoto(id) {
  // Deactivate previous
  document.querySelectorAll('.photo-item').forEach(el => el.classList.remove('active'));
  Object.keys(markers).forEach(mid => {
    const el = document.getElementById(`marker-${mid}`);
    if (el) el.classList.remove('active');
  });

  activeId = id;
  const photo = photos.find(p => p.id == id);
  if (!photo) return;

  // Activate list item
  const listItem = document.querySelector(`[data-id="${id}"]`);
  if (listItem) {
    listItem.classList.add('active');
    listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Activate marker
  const el = document.getElementById(`marker-${id}`);
  if (el) el.classList.add('active');

  // Open popup without moving map
  if (photo.lat != null) {
    markers[id]?.openPopup();
  }

  // Show EXIF detail
  showDetail(photo);
}

function showDetail(photo) {
  const exif = photo.exif || {};
  // editable fields: [key, label, exifKey, format hint]
  const editableFields = [
    ['DateTimeOriginal', 'Date Taken', 'datetime-local'],
    ['Make', 'Camera Make', 'text'],
    ['Model', 'Camera Model', 'text'],
    ['LensModel', 'Lens', 'text'],
    ['FocalLength', 'Focal Length (mm)', 'number'],
    ['FNumber', 'Aperture (f/)', 'number'],
    ['ISO', 'ISO', 'number'],
    ['Software', 'Software', 'text'],
    ['GPSAltitude', 'GPS Alt (m)', 'number'],
  ];

  const fields = [
    ['File Name', photo.name, null],
    ['File Size', formatSize(photo.file.size), null],
    ['Dimensions', exif.ImageWidth ? `${exif.ImageWidth} × ${exif.ImageHeight}` : '—', null],
    ['Date Taken', exif.DateTimeOriginal ? formatDate(exif.DateTimeOriginal) : '—', 'DateTimeOriginal'],
    ['Camera Make', exif.Make || '—', 'Make'],
    ['Camera Model', exif.Model || '—', 'Model'],
    ['Lens', exif.LensModel || '—', 'LensModel'],
    ['Focal Length', exif.FocalLength ? `${exif.FocalLength}mm` : '—', 'FocalLength'],
    ['Aperture', exif.FNumber ? `f/${exif.FNumber}` : '—', 'FNumber'],
    ['Shutter Speed', exif.ExposureTime ? `1/${Math.round(1/exif.ExposureTime)}s` : '—', null],
    ['ISO', exif.ISO || '—', 'ISO'],
    ['Flash', exif.Flash != null ? (exif.Flash ? 'Yes' : 'No') : '—', null],
    ['GPS Lat', photo.lat != null ? photo.lat.toFixed(8) : 'Not available', 'lat'],
    ['GPS Lng', photo.lng != null ? photo.lng.toFixed(8) : 'Not available', 'lng'],
    ['GPS Alt', toNum(exif.GPSAltitude) != null ? `${toNum(exif.GPSAltitude).toFixed(1)}m` : '—', 'GPSAltitude'],
    ['Software', exif.Software || '—', 'Software'],
  ];

  detailRows.innerHTML = fields.map(([k, v, metaKey]) => {
    const canEdit = metaKey !== null;
    return `
      <div class="detail-row${canEdit ? ' editable' : ''}" data-meta-key="${metaKey || ''}">
        <span class="detail-key">${k}</span>
        <span class="detail-val" ${canEdit ? `contenteditable="false" data-original="${v}" data-photo-id="${photo.id}"` : ''}>${v}</span>
      </div>
    `;
  }).join('');

  // Attach input listeners to editable cells
  detailRows.querySelectorAll('.detail-row.editable .detail-val').forEach(el => {
    el.addEventListener('blur', () => commitMetaEdit(el, photo));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { el.textContent = el.dataset.original; el.blur(); }
    });
  });

  detailPanel.style.display = 'block';
}

function commitMetaEdit(el, photo) {
  pushUndo(photo);
  const row = el.closest('.detail-row');
  const metaKey = row.dataset.metaKey;
  const newVal = el.textContent.trim();
  if (!newVal || newVal === el.dataset.original) return;

  // Persist into photo object
  if (metaKey === 'lat') {
    const v = parseFloat(newVal);
    if (!isNaN(v)) { photo.lat = v; photo.exif.latitude = v; }
  } else if (metaKey === 'lng') {
    const v = parseFloat(newVal);
    if (!isNaN(v)) { photo.lng = v; photo.exif.longitude = v; }
  } else {
    if (!photo.exif) photo.exif = {};
    const numFields = ['FocalLength', 'FNumber', 'ISO', 'GPSAltitude'];
    photo.exif[metaKey] = numFields.includes(metaKey) ? parseFloat(newVal) : newVal;
  }

  el.dataset.original = newVal;

  // Flash saved dot
  const dot = document.getElementById('metaSavedDot');
  dot.classList.add('show');
  setTimeout(() => dot.classList.remove('show'), 1800);

  // Update marker popup if it exists
  if (markers[photo.id]) {
    const exif = photo.exif || {};
    const rows = [
      ['Coordinates', photo.lat != null ? `${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}` : '—'],
      exif.DateTimeOriginal ? ['Date Taken', formatDate(exif.DateTimeOriginal)] : null,
      exif.Make ? ['Camera', `${exif.Make || ''} ${exif.Model || ''}`.trim()] : null,
    ].filter(Boolean);
    const rowsHtml = rows.map(([k, v]) => `<div class="popup-row">${k} <span>${v}</span></div>`).join('');
markers[photo.id].setPopupContent(buildPhotoPopupHtml(photo));

    // Update marker position if GPS changed
    if (metaKey === 'lat' || metaKey === 'lng') {
      if (photo.lat != null && photo.lng != null) {
        markers[photo.id].setLatLng([photo.lat, photo.lng]);
      }
    }
  }

  showToast(`<span class="accent">${metaKey}</span> updated`);
}

let metaEditMode = false;
window.toggleMetaEdit = function() {
  metaEditMode = !metaEditMode;
  const btn = document.getElementById('editMetaBtn');
  btn.textContent = metaEditMode ? '✓ DONE' : '✎ EDIT';
  btn.classList.toggle('active', metaEditMode);

  detailRows.querySelectorAll('.detail-row.editable .detail-val').forEach(el => {
    el.contentEditable = metaEditMode ? 'true' : 'false';
    if (metaEditMode) el.style.color = 'var(--text)';
    else el.style.color = '';
  });

  if (metaEditMode) {
    const first = detailRows.querySelector('.detail-row.editable .detail-val');
    if (first) first.focus();
  }
};

function ensureJpgExtension(name) {
  return name.replace(/\.(jpe?g|heic|tiff?|png|webp|bmp|gif)$/i, '') + '.jpg';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Convert degrees decimal to [deg, min, sec] rational arrays for piexif
function decimalToRational(decimal) {
  const d = Math.abs(decimal);
  const deg = Math.floor(d);
  const minFull = (d - deg) * 60;
  const min = Math.floor(minFull);
  const sec = Math.round((minFull - min) * 60 * 100);
  return [[deg, 1], [min, 1], [sec, 100]];
}

async function buildJpegWithExif(photo) {
  // 1. Draw image to canvas → get raw JPEG dataURL
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = photo.url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // 2. Build EXIF dict from photo metadata using piexif
  const exif = photo.exif || {};

  const zerothIfd = {};
  const exifIfd  = {};
  const gpsIfd   = {};

  if (exif.Make)    zerothIfd[piexif.ImageIFD.Make]    = exif.Make;
  if (exif.Model)   zerothIfd[piexif.ImageIFD.Model]   = exif.Model;
  if (exif.Software) zerothIfd[piexif.ImageIFD.Software] = exif.Software;
  zerothIfd[piexif.ImageIFD.ImageDescription] = photo.name;

  if (exif.DateTimeOriginal) {
    // piexif expects "YYYY:MM:DD HH:MM:SS"
    let dt = exif.DateTimeOriginal;
    if (dt instanceof Date) {
      dt = dt.toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, ':');
    } else if (typeof dt === 'string' && dt.includes('-')) {
      dt = dt.replace(/-/g, ':').replace('T', ' ').slice(0, 19);
    }
    exifIfd[piexif.ExifIFD.DateTimeOriginal] = dt;
    exifIfd[piexif.ExifIFD.DateTimeDigitized] = dt;
    zerothIfd[piexif.ImageIFD.DateTime] = dt;
  }

  if (exif.FocalLength) exifIfd[piexif.ExifIFD.FocalLength] = [Math.round(exif.FocalLength * 100), 100];
  if (exif.FNumber)     exifIfd[piexif.ExifIFD.FNumber]     = [Math.round(exif.FNumber * 100), 100];
  if (exif.ISO)         exifIfd[piexif.ExifIFD.ISOSpeedRatings] = exif.ISO;
  if (exif.ExposureTime) exifIfd[piexif.ExifIFD.ExposureTime] = [1, Math.round(1 / exif.ExposureTime)];
  if (exif.LensModel)  exifIfd[piexif.ExifIFD.LensModel]    = exif.LensModel;

  if (photo.lat != null && photo.lng != null) {
    gpsIfd[piexif.GPSIFD.GPSLatitudeRef]  = photo.lat >= 0 ? 'N' : 'S';
    gpsIfd[piexif.GPSIFD.GPSLatitude]     = decimalToRational(photo.lat);
    gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = photo.lng >= 0 ? 'E' : 'W';
    gpsIfd[piexif.GPSIFD.GPSLongitude]    = decimalToRational(photo.lng);
    if (toNum(exif.GPSAltitude) != null) {
      const _alt = toNum(exif.GPSAltitude);
      gpsIfd[piexif.GPSIFD.GPSAltitudeRef] = _alt >= 0 ? 0 : 1;
      gpsIfd[piexif.GPSIFD.GPSAltitude]    = [Math.round(Math.abs(_alt) * 100), 100];
    }
  }

  const exifObj = { '0th': zerothIfd, 'Exif': exifIfd, 'GPS': gpsIfd };
  const exifBytes = piexif.dump(exifObj);
  const jpegWithExif = piexif.insert(exifBytes, dataUrl);

  // 3. Convert dataURL → Blob
  const binary = atob(jpegWithExif.split(',')[1]);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

window.exportSingle = async function() {
  if (!activeId) { showToast('Select a photo first'); return; }
  const photo = photos.find(p => p.id == activeId);
  if (!photo) return;

  const overlay = document.getElementById('exportOverlay');
  const sub = document.getElementById('exportOverlaySub');
  const fill = document.getElementById('exportProgressFill');

  overlay.classList.add('show');
  sub.textContent = `Processing ${photo.name}…`;
  fill.style.width = '40%';

  try {
    const blob = await buildJpegWithExif(photo);
    fill.style.width = '100%';
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
      triggerDownload(blob, ensureJpgExtension(photo.name));
      showToast(`Exported <span class="accent">${ensureJpgExtension(photo.name)}</span> with EXIF`);
    }, 300);
  } catch(e) {
    overlay.classList.remove('show');
    showToast('Export error: ' + e.message);
    console.error(e);
  }
};

window.exportAllSmart = async function() {
  // Try File System Access API first (saves directly to folder, bypasses SmartScreen)
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
        id: 'fotos-export'
      });

      const overlay = document.getElementById('exportOverlay');
      const sub     = document.getElementById('exportOverlaySub');
      const fill    = document.getElementById('exportProgressFill');
      overlay.classList.add('show');
      fill.style.width = '0%';

      // Create subfolder
      const folder = await dirHandle.getDirectoryHandle('fotos renomeadas', { create: true });

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        sub.textContent = `Salvando ${i + 1} / ${photos.length} — ${photo.name}`;
        fill.style.width = ((i + 1) / photos.length * 100) + '%';

        const blob     = await buildJpegWithExif(photo);
        const filename = ensureJpgExtension(photo.name);
        const fileHandle = await folder.getFileHandle(filename, { create: true });
        const writable   = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      }

      fill.style.width = '100%';
      setTimeout(() => {
        overlay.classList.remove('show');
        fill.style.width = '0%';
        showToast(`✓ <span class="accent">${photos.length} fotos</span> salvas na pasta!`);
      }, 300);

      return; // done — no ZIP needed
    } catch(e) {
      if (e.name === 'AbortError') return; // user cancelled picker
    }
  }
  // Fallback: ZIP download
  exportAll();
};

window.exportAll = async function() {
  if (!photos.length) return;

  const overlay = document.getElementById('exportOverlay');
  const sub     = document.getElementById('exportOverlaySub');
  const fill    = document.getElementById('exportProgressFill');

  overlay.classList.add('show');
  fill.style.width = '0%';

  try {
    const zip    = new JSZip();
    const folder = zip.folder('fotos renomeadas');
    let errors   = 0;

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      sub.textContent = `Processando ${i + 1} / ${photos.length} — ${photo.name}`;
      fill.style.width = ((i / photos.length) * 85) + '%';

      try {
        const blob     = await buildJpegWithExif(photo);
        const filename = ensureJpgExtension(photo.name);
        folder.file(filename, blob);
      } catch(photoErr) {
        console.warn('buildJpegWithExif failed for', photo.name, photoErr);
        // Fallback: use original file as-is
        try {
          const origBlob = photo.file instanceof File
            ? photo.file
            : await fetch(photo.url).then(r => r.blob());
          folder.file(ensureJpgExtension(photo.name), origBlob);
        } catch(e2) {
          errors++;
          console.error('Could not export', photo.name, e2);
        }
      }
    }

    sub.textContent = 'Comprimindo ZIP…';
    fill.style.width = '92%';

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 3 }
    });

    fill.style.width = '100%';
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
      triggerDownload(zipBlob, 'fotos renomeadas.zip');
      const msg = errors > 0
        ? `Downloaded ${photos.length - errors} photos (${errors} com erro)`
        : `Downloaded <span class="accent">${photos.length} photos</span> em fotos renomeadas.zip`;
      showToast(msg);
    }, 300);

  } catch(e) {
    overlay.classList.remove('show');
    fill.style.width = '0%';
    showToast('Export error: ' + e.message);
    console.error(e);
  }
};
function updateStats() {
  const withGPS = photos.filter(p => p.lat != null).length;
  document.getElementById('statTotal').textContent = photos.length;
  document.getElementById('statGPS').textContent = withGPS;
  document.getElementById('statNoGPS').textContent = photos.length - withGPS;
}

window.fitAll = function() {
  const pts = photos.filter(p => p.lat != null).map(p => [p.lat, p.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [60, 60] });
};

window.clearAll = function() {
  photos.length = 0;
  _knownDupKeys.clear();
  _knownNoGpsIds.clear();
  Object.values(markers).forEach(m => clusterGroup.removeLayer(m));
  Object.keys(markers).forEach(k => delete markers[k]);
  photoList.innerHTML = '';
  detailPanel.style.display = 'none';
  refreshMetaTab();
  emptyState.style.display = 'flex';
  document.getElementById('fitAllBtn').style.display = 'none';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('exportBar').classList.remove('visible');
  updateStats();
  refreshDateTimeline();
  fileInput.value = '';
};

let toastTimeout;
function showToast(html) {
  const t = document.getElementById('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2800);
}

function formatDate(d) {
  if (!d) return '—';
  if (d instanceof Date) return d.toLocaleString();
  return String(d);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

const kmlLayers = {}; // id → { layer, name }
let kmlIdCounter = 0;

const kmlProgress    = document.getElementById('kmlProgress');
const kmlProgressFill = document.getElementById('kmlProgressFill');
const kmlFileName    = document.getElementById('kmlFileName');
const kmlLayerList   = document.getElementById('kmlLayerList');
const kmlDropOverlay = document.getElementById('kmlDropOverlay');
const kmlFileInput   = document.getElementById('kmlFileInput');
const mapContainer   = document.querySelector('.map-container');

// File input handler
document.getElementById('mapPhotoInput').addEventListener('change', e => {
  handleFiles(e.target.files);
  setTimeout(() => { e.target.value = ''; }, 100);
});

kmlFileInput.addEventListener('change', e => {
  [...e.target.files].forEach(loadKmlFile);
  kmlFileInput.value = '';
});

// Drag & drop on map container
mapContainer.addEventListener('dragover', e => {
  e.preventDefault();
  const items = [...e.dataTransfer.items];
  const hasPhoto = items.some(i => i.type.startsWith('image/'));
  const msg = document.getElementById('kmlDropMsg');
  if (hasPhoto) {
    msg.innerHTML = 'SOLTAR FOTOS<br>NO MAPA';
  } else {
    msg.innerHTML = 'SOLTAR KML<br>NO MAPA';
  }
  kmlDropOverlay.classList.add('active');
});

mapContainer.addEventListener('dragleave', e => {
  if (!mapContainer.contains(e.relatedTarget)) kmlDropOverlay.classList.remove('active');
});

mapContainer.addEventListener('drop', e => {
  e.preventDefault();
  kmlDropOverlay.classList.remove('active');
  const all = [...e.dataTransfer.files];
  const kmlFiles   = all.filter(f => f.name.endsWith('.kml') || f.name.endsWith('.kmz'));
  const photoFiles = all.filter(f => f.type.startsWith('image/'));
  if (kmlFiles.length)   kmlFiles.forEach(loadKmlFile);
  if (photoFiles.length) handleFiles(photoFiles);
});

// ─── DNIT ROUTE LOOKUP (LD_INICIO / LD_INICIO_OAE points) ─────────────────────
let _dnitRowSeq = 0;

function getTodayDnitDateParam() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; // matches DNIT's non-padded format, e.g. 2026-7-20
}

// DNIT's localizarkm endpoint responds with an array like:
// [{ id, br, sg_tp_trecho, uf, versao, id_trecho, km: "259.34227822364312", lat, lng }]
function extractDnitKm(data) {
  const rec = Array.isArray(data) ? data[0] : data;
  if (!rec || typeof rec !== 'object') return null;
  const raw = rec.km ?? rec.Km ?? rec.KM;
  if (raw == null || raw === '') return null;
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num.toFixed(2) : raw;
}

// Replace the "consultando…" placeholder in a marker's popup with the real value.
function updateDnitPopupRow(layer, text) {
  if (!layer || !layer._dnitRowId || !layer.getPopup) return;
  const popup = layer.getPopup();
  if (!popup) return;
  const html = popup.getContent();
  const re = new RegExp(`(id="${layer._dnitRowId}"[^>]*>\\s*DNIT km <span>)[^<]*(</span>)`);
  const updated = html.replace(re, `$1${text}$2`);
  layer.setPopupContent(updated);
}

async function lookupDnitKm(lat, lng, label, layer) {
  const dateStr = getTodayDnitDateParam();
  const url = `https://servicos.dnit.gov.br/sgplan/apigeo/rotas/localizarkm?lng=${lng}&lat=${lat}&r=250&data=${dateStr}`;
  try {
    const res = await fetch(url);
    let data = null;
    try { data = await res.json(); } catch (_) { data = await res.text().catch(() => null); }
    console.log(`[DNIT localizarkm] ${label} (${lat}, ${lng}):`, data);

    const km = extractDnitKm(data);
    const text = km != null ? km : (data ? JSON.stringify(data).slice(0, 80) : '—');
    updateDnitPopupRow(layer, text);
    return data;
  } catch (err) {
    console.error('DNIT localizarkm lookup failed:', err);
    updateDnitPopupRow(layer, 'erro na consulta');
    return null;
  }
}

function runDnitLookupForLayer(parsedLayer) {
  const matches = [];
  Object.values(parsedLayer._layers || {}).forEach(l => {
    const sublayers = l._layers ? Object.values(l._layers) : [l];
    sublayers.forEach(sl => {
      const props = sl.feature?.properties || sl.options?.properties || {};
      const name  = (props.name || '').toUpperCase();
      const latlng = sl.getLatLng?.() || sl.getBounds?.()?.getCenter?.();
      if (latlng && sl._dnitRowId) { // rows are only tagged on LD_INICIO / LD_INICIO_OAE points
        matches.push({ name: props.name || name, latlng, layer: sl });
      }
    });
  });
  matches.forEach(m => lookupDnitKm(m.latlng.lat, m.latlng.lng, m.name, m.layer));
}

function loadKmlFile(file, options = {}) {
  const dotColor = options.color || '#e8ff4d';
  const id = 'kml_' + (++kmlIdCounter);
  const shortName = file.name.length > 24 ? file.name.slice(0, 22) + '…' : file.name;

  // Show progress
  kmlFileName.textContent = shortName;
  kmlProgressFill.style.width = '0%';
  kmlProgress.classList.add('show');

  // Animate progress bar (indeterminate feel for large files)
  let fakeProgress = 0;
  const progressInterval = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + (fakeProgress < 60 ? 3 : fakeProgress < 85 ? 1 : 0.2), 90);
    kmlProgressFill.style.width = fakeProgress + '%';
  }, 100);

  const reader = new FileReader();
  reader.onload = e => {
    clearInterval(progressInterval);
    kmlProgressFill.style.width = '95%';

    try {
      const kmlText = e.target.result;

      // Parse KML using DOMParser + leaflet-omnivore
      const customLayer = L.geoJSON(null, {
        style: {
          color: dotColor,
          weight: 1.5,
          opacity: 0.75,
          fillColor: dotColor,
          fillOpacity: 0.3
        },
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
          radius: 5,
          fillColor: dotColor,
          color: '#000',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const name = props.name || props.Nome_Tipo_Trecho || props.Codigo_SNV || props.Codigo_BR || '—';
          const oae  = props.Identificacao_OAE ? `<div style="color:var(--accent);font-size:10px;margin-bottom:4px;">${props.Identificacao_OAE}</div>` : '';
          const uf   = props.Unidade_Federacao || props.sg_uf || '';
          const km   = props.Extensao ? `${props.Extensao} km` : '';

          const rows = Object.entries(props)
            .filter(([k, v]) => v && k !== 'description' && k !== 'styleUrl')
            .slice(0, 10)
            .map(([k, v]) => `<div class="popup-row">${k} <span>${v}</span></div>`)
            .join('');

          // LD_INICIO / LD_INICIO_OAE points get an extra row that's filled in
          // once the DNIT km lookup for this point resolves.
          const isLdInicio = String(name).toUpperCase().includes('LD_INICIO');
          let dnitRow = '';
          if (isLdInicio) {
            layer._dnitRowId = 'dnitkm-' + (++_dnitRowSeq);
            dnitRow = `<div class="popup-row dnit-km-row" id="${layer._dnitRowId}">DNIT km <span>consultando…</span></div>`;
          }

          layer.bindPopup(`
            <div class="popup-content">
              <div class="popup-name">${name}${uf ? ' · ' + uf : ''}</div>
              ${oae}
              ${km ? `<div class="popup-row">Extensão <span>${km}</span></div>` : ''}
              ${rows}
              ${dnitRow}
            </div>
          `, { maxHeight: 280 });
        }
      });

      // Use omnivore to parse KML text
      const parsed = omnivore.kml.parse(kmlText, null, customLayer);
      parsed.addTo(map);

      kmlProgressFill.style.width = '100%';

      setTimeout(() => {
        kmlProgress.classList.remove('show');

        const bounds = parsed.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40] });
          emptyState.style.display = 'none';
        }

        const featureCount = Object.keys(parsed._layers || {}).length;
        kmlLayers[id] = { layer: parsed, name: file.name };
        addKmlLayerEntry(id, file.name, featureCount);
        showToast(`KML carregado — <span class="accent">${featureCount.toLocaleString()} feições</span>`);

        if (!options.skipDnitLookup) {
          runDnitLookupForLayer(parsed);
        }
      }, 400);

    } catch (err) {
      clearInterval(progressInterval);
      kmlProgress.classList.remove('show');
      showToast(`Erro ao carregar KML: ${err.message}`);
      console.error(err);
    }
  };

  reader.onerror = () => {
    clearInterval(progressInterval);
    kmlProgress.classList.remove('show');
    showToast('Erro ao ler o arquivo');
  };

  reader.readAsText(file, 'UTF-8');
}

function addKmlLayerEntry(id, name, count) {
  const shortName = name.length > 20 ? name.slice(0, 18) + '…' : name;
  const entry = document.createElement('div');
  entry.className = 'kml-file-entry';
  entry.id = 'kml-entry-' + id;
  entry.innerHTML = `
    <div class="layer-dot" style="background:#e8ff4d;box-shadow:0 0 6px rgba(232,255,77,0.5)"></div>
    <div class="layer-info">
      <div class="kml-file-name" title="${name}">${shortName}</div>
      <div class="layer-desc">${count.toLocaleString()} feições</div>
    </div>
    <button class="kml-remove-btn" onclick="removeKmlLayer('${id}')" title="Remover">✕</button>
  `;
  kmlLayerList.appendChild(entry);
  window._scheduleKmlPanelCollapse();
}

window.removeKmlLayer = function(id) {
  if (kmlLayers[id]) {
    map.removeLayer(kmlLayers[id].layer);
    delete kmlLayers[id];
  }
  const entry = document.getElementById('kml-entry-' + id);
  if (entry) entry.remove();
  showToast('Camada KML removida');
};

window.switchTab = function(tab) {
  // Cancel ponto picking if switching away from pontos tab
  if (tab !== 'pontos' && typeof _pontoPickingHandler !== 'undefined' && _pontoPickingHandler) {
    window.togglePontoPicking();
  }
  ['photos','meta','pontos'].forEach(t => {
    const btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const content = document.getElementById('tabContent' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn)     btn.classList.toggle('active',     t === tab);
    if (content) content.classList.toggle('active', t === tab);
  });
};

function refreshMetaTab() {
  const empty = _elMetaEmpty;
  const wrap  = _elMetaWrap;
  const list  = _elMetaList;
  if (!list) return;
  if (!photos || !photos.length) {
    if (empty) empty.style.display = '';
    if (wrap)  wrap.style.display  = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap)  wrap.style.display  = 'flex';

  const openIds = new Set(
    [...list.querySelectorAll('.meta-photo-header.open')].map(el => el.dataset.id)
  );

  list.innerHTML = photos.map(photo => {
    const exif   = photo.exif || {};
    const isOpen = openIds.has(String(photo.id));
    const fields = [
      { key: 'File Name',    val: photo.name,           readonly: true },
      { key: 'Date Taken',   val: exif.DateTimeOriginal ? formatDate(exif.DateTimeOriginal) : '', metaKey: 'DateTimeOriginal' },
      { key: 'Camera Make',  val: exif.Make   || '',    metaKey: 'Make' },
      { key: 'Camera Model', val: exif.Model  || '',    metaKey: 'Model' },
      { key: 'Lens',         val: exif.LensModel || '', metaKey: 'LensModel' },
      { key: 'Focal Length', val: exif.FocalLength  != null ? String(exif.FocalLength)  : '', metaKey: 'FocalLength' },
      { key: 'Aperture f/',  val: exif.FNumber      != null ? String(exif.FNumber)      : '', metaKey: 'FNumber' },
      { key: 'ISO',          val: exif.ISO          != null ? String(exif.ISO)          : '', metaKey: 'ISO' },
      { key: 'GPS Lat',      val: photo.lat != null ? photo.lat.toFixed(8) : '',              metaKey: 'lat' },
      { key: 'GPS Lng',      val: photo.lng != null ? photo.lng.toFixed(8) : '',              metaKey: 'lng' },
      { key: 'GPS Alt (m)',  val: toNum(exif.GPSAltitude) != null ? toNum(exif.GPSAltitude).toFixed(1) : '', metaKey: 'GPSAltitude' },
      { key: 'Software',     val: exif.Software || '',  metaKey: 'Software' },
    ];
    const fieldsHtml = fields.map(f => `
      <div class="meta-field-row">
        <span class="meta-field-key">${f.key}</span>
        <input class="meta-field-val"
          value="${(f.val || '').replace(/"/g, '&quot;')}"
          ${f.readonly ? 'readonly' : ''}
          ${f.metaKey  ? `data-meta-key="${f.metaKey}" data-photo-id="${photo.id}"` : ''}
          placeholder="${f.readonly ? '' : '—'}">
      </div>`).join('');
    return `
      <div class="meta-photo-entry">
        <div class="meta-photo-header ${isOpen ? 'open' : ''}" data-id="${photo.id}">
          <img class="meta-photo-thumb" src="${photo.url}" alt="">
          <span class="meta-photo-name">${photo.name}</span>
          <span class="meta-photo-chevron">▶</span>
        </div>
        <div class="meta-fields ${isOpen ? 'open' : ''}">${fieldsHtml}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.meta-photo-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('open');
      header.nextElementSibling.classList.toggle('open');
    });
  });

  list.querySelectorAll('.meta-field-val[data-meta-key]').forEach(input => {
    input.addEventListener('change', () => {
      const photo  = photos.find(p => p.id == input.dataset.photoId);
      if (!photo) return;
      const metaKey = input.dataset.metaKey;
      const newVal  = input.value.trim();
      if (!photo.exif) photo.exif = {};
      if (metaKey === 'lat') {
        const v = parseFloat(newVal); if (!isNaN(v)) photo.lat = v;
      } else if (metaKey === 'lng') {
        const v = parseFloat(newVal); if (!isNaN(v)) photo.lng = v;
      } else {
        const numFields = ['FocalLength','FNumber','ISO','GPSAltitude'];
        photo.exif[metaKey] = numFields.includes(metaKey) ? parseFloat(newVal) : newVal;
      }
      if (markers[photo.id] && (metaKey === 'lat' || metaKey === 'lng')) {
        if (photo.lat != null && photo.lng != null)
          markers[photo.id].setLatLng([photo.lat, photo.lng]);
      }
      showToast('<span class="accent">' + metaKey + '</span> updated');
    });
  });
}

window.toggleBulkEdit = function() {
  const btn    = document.getElementById('metaBulkToggle');
  const fields = document.getElementById('metaBulkFields');
  btn.classList.toggle('open');
  fields.classList.toggle('open');
};

window.applyBulkEdit = function() {
  const bulkFields = [
    { id: 'bulk_Make',        metaKey: 'Make',        num: false },
    { id: 'bulk_Model',       metaKey: 'Model',       num: false },
    { id: 'bulk_LensModel',   metaKey: 'LensModel',   num: false },
    { id: 'bulk_FocalLength', metaKey: 'FocalLength', num: true  },
    { id: 'bulk_FNumber',     metaKey: 'FNumber',     num: true  },
    { id: 'bulk_ISO',         metaKey: 'ISO',         num: true  },
    { id: 'bulk_Software',    metaKey: 'Software',    num: false },
    { id: 'bulk_lat',         metaKey: 'lat',         num: true  },
    { id: 'bulk_lng',         metaKey: 'lng',         num: true  },
  ];

  const toApply = bulkFields
    .map(f => ({ ...f, val: document.getElementById(f.id).value.trim() }))
    .filter(f => f.val !== '');

  if (!toApply.length) {
    showToast('No fields filled in');
    return;
  }

  let count = 0;
  photos.forEach(photo => {
    if (!photo.exif) photo.exif = {};
    toApply.forEach(f => {
      pushUndo(photo);
      if (f.metaKey === 'lat') { photo.lat = parseFloat(f.val); }
      else if (f.metaKey === 'lng') { photo.lng = parseFloat(f.val); }
      else { photo.exif[f.metaKey] = f.num ? parseFloat(f.val) : f.val; }
      count++;
    });
    // Update map markers for GPS changes
    if (photo.lat != null && photo.lng != null && markers[photo.id]) {
      markers[photo.id].setLatLng([photo.lat, photo.lng]);
    }
  });

  // Clear inputs
  toApply.forEach(f => { document.getElementById(f.id).value = ''; });

  refreshMetaTab();
  showToast('<span class="accent">' + toApply.length + ' field' + (toApply.length > 1 ? 's' : '') + '</span> applied to ' + photos.length + ' photos');
};

window.autoLoadKmlFromFolder = async function() {
  if (!window.showDirectoryPicker) {
    showToast('File System Access API not supported in this browser');
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch (e) {
    // User cancelled
    return;
  }

  const desc = document.getElementById('autoLoadDesc');
  desc.textContent = 'Procurando arquivos KML/KMZ…';

  const kmlHandles = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && (name.endsWith('.kml') || name.endsWith('.kmz'))) {
      kmlHandles.push(handle);
    }
  }

  if (!kmlHandles.length) {
    desc.textContent = 'Nenhum KML/KMZ encontrado na pasta';
    showToast('No KML/KMZ files found in folder');
    return;
  }

  desc.textContent = `Carregando ${kmlHandles.length} arquivo(s)…`;

  for (const handle of kmlHandles) {
    const file = await handle.getFile();
    loadKmlFile(file);
  }

  desc.textContent = `${kmlHandles.length} arquivo(s) carregado(s) de: ${dirHandle.name}/`;
  showToast('<span class="accent">' + kmlHandles.length + ' KML/KMZ</span> loaded from folder');
};

(function() {
  let _bearing = 0;

  function setBearing(deg) {
    _bearing = ((deg % 360) + 360) % 360;

    // Update compass UI
    const svg = document.querySelector('.compass-svg');
    if (svg) svg.style.transform = `rotate(${_bearing}deg)`;
    const label = document.getElementById('compassBearing');
    if (label) label.textContent = Math.round(_bearing) + '°';

    // Use leaflet-rotate plugin — handles everything natively
    if (map.setBearing) {
      try { map.setBearing(_bearing); } catch(e) {}
    }
  }

  // Expose globally so other functions (SNV, etc.) can call it
  window.setBearing = setBearing;
  window.getBearing = () => _bearing;

  // Buttons
  document.getElementById('rotateLeft') .addEventListener('click', () => setBearing(window.getBearing() - 15));
  document.getElementById('rotateRight').addEventListener('click', () => setBearing(window.getBearing() + 15));
  document.getElementById('rotateReset').addEventListener('click', () => setBearing(0));

  // Drag compass to rotate
  const rose = document.getElementById('compassRose');
  let _dragMoved = false;
  let _startAngle = 0, _startBearing = 0;

  function getAngle(e) {
    const rect = rose.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return Math.atan2(clientY - cy, clientX - cx) * 180 / Math.PI;
  }

  rose.addEventListener('mousedown', e => {
    e.preventDefault();
    _dragMoved = false;
    _startAngle   = getAngle(e);
    _startBearing = window.getBearing();

    function onDrag(e) {
      const delta = getAngle(e) - _startAngle;
      if (Math.abs(delta) > 2) _dragMoved = true;
      setBearing(_startBearing + delta);
    }
    function onUp() {
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup',   onUp);
  });

  // Click the N label or compass to reset — only if not dragging
  rose.addEventListener('click', e => {
    if (!_dragMoved) setBearing(0);
  });

  // ── Ctrl + Left-click drag OR Middle-click drag on map → rotate ──────────
  const mapEl = document.getElementById('map');

  let _mapRotating = false;
  let _mapRotateStartX = 0;
  let _mapRotateStartBearing = 0;

  mapEl.addEventListener('mousedown', e => {
    const isCtrlLeft   = e.button === 0 && e.ctrlKey;
    const isMiddle     = e.button === 1;
    if (!isCtrlLeft && !isMiddle) return;

    e.preventDefault();
    e.stopPropagation();
    _mapRotating = true;
    _mapRotateStartX = e.clientX;
    _mapRotateStartBearing = window.getBearing();

    // Show cursor
    mapEl.style.cursor = 'ew-resize';

    function onMove(e) {
      if (!_mapRotating) return;
      const dx = e.clientX - _mapRotateStartX;
      setBearing(_mapRotateStartBearing + dx * 0.4);
    }

    function onUp() {
      _mapRotating = false;
      mapEl.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // Prevent context menu on ctrl+click
  mapEl.addEventListener('contextmenu', e => { if (e.ctrlKey) e.preventDefault(); });
})();

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

  // Update the alert count
  const remaining = photos.filter(p => p.megapixels != null && p.megapixels < TARGET_MP).length;
  document.getElementById('mpAlertCount').textContent = remaining;
  if (remaining === 0) {
    setTimeout(() => closeMpAlert(), 1000);
  }
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

// ─── NO GPS ALERT ─────────────────────────────────────────────────────────────
const _knownNoGpsIds = new Set();

function checkNoGps(newPhotos) {
  const noGps = newPhotos.filter(p => p.lat == null);
  const newNoGps = noGps.filter(p => !_knownNoGpsIds.has(p.id));
  if (!newNoGps.length) return;
  newNoGps.forEach(p => _knownNoGpsIds.add(p.id));
  const overlay = document.getElementById('nogpsAlertOverlay');
  const countEl = document.getElementById('nogpsAlertCount');
  if (!overlay || !countEl) return;
  countEl.textContent = newNoGps.length;
  overlay.classList.add('show');
}

window.closeNoGpsAlert = function(e) {
  if (e && e.target !== document.getElementById('nogpsAlertOverlay') &&
      !e.target.classList.contains('nogps-alert-close')) return;
  document.getElementById('nogpsAlertOverlay').classList.remove('show');
};

function showMpAlert(count) {
  const overlay = document.getElementById('mpAlertOverlay');
  const countEl = document.getElementById('mpAlertCount');
  if (!overlay || !countEl) return;
  countEl.textContent = count;
  overlay.classList.add('show');
}
window.closeMpAlert = function(e) {
  if (e && e.target !== document.getElementById('mpAlertOverlay') &&
      !e.target.classList.contains('mp-alert-close')) return;
  document.getElementById('mpAlertOverlay').classList.remove('show');
};

(function() {
  const input   = document.getElementById('kmlSearchInput');
  const results = document.getElementById('kmlSearchResults');
  const clearBtn = document.getElementById('kmlSearchClear');
  if (!input) return;

  let _activeMarker = null;

  function getAllKmlFeatures() {
    const features = [];
    Object.values(kmlLayers).forEach(({ layer, name: fileName }) => {
      if (!layer._layers) return;
      Object.values(layer._layers).forEach(l => {
        // Recurse into group layers
        const sublayers = l._layers ? Object.values(l._layers) : [l];
        sublayers.forEach(sl => {
          const props = sl.feature?.properties || sl.options?.properties || {};
          const fname = props.name || props.Nome_Tipo_Trecho || props.Codigo_SNV || props.Codigo_BR || '';
          const oae   = props.Identificacao_OAE || '';
          if (!fname && !oae) return;
          const searchText = [fname, oae].filter(Boolean).join(' · ');
          const latlng = sl.getLatLng?.() || sl.getBounds?.()?.getCenter?.();
          if (!latlng) return;
          features.push({ name: fname || oae, oae, searchText, props, latlng, layer: sl, fileName });
        });
      });
    });
    return features;
  }

  function highlight(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx)
      + `<mark>${text.slice(idx, idx + query.length)}</mark>`
      + text.slice(idx + query.length);
  }

  // Parse coordinates from query: "-5.286997 -61.934218" or "-5.286997, -61.934218"
  function parseCoords(q) {
    const m = q.match(/(-?\d{1,3}\.?\d*)[,\s]+(-?\d{1,3}\.?\d*)/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  let _customMarkers = []; // track user-created points

  // ─── PONTO MAP PICKING ────────────────────────────────────────────────────────
let _pontoPickingHandler = null;
let _pontoPickingKeyHandler = null;

window.togglePontoPicking = function() {
  const btn    = document.getElementById('btnAddPonto');
  const banner = document.getElementById('pickingBanner');

  if (_pontoPickingHandler) {
    // Cancel picking
    map.off('click', _pontoPickingHandler);
    document.removeEventListener('keydown', _pontoPickingKeyHandler);
    _pontoPickingHandler = null;
    map.getContainer().style.cursor = '';
    if (btn)    { btn.classList.remove('active'); btn.textContent = '📌 Clicar no mapa'; }
    if (banner) banner.classList.remove('show');
    return;
  }

  // Start picking
  if (btn)    { btn.classList.add('active'); btn.textContent = '✕ Cancelar'; }
  if (banner) {
    banner.textContent = '📌 Clique no mapa para criar um ponto · ESC para cancelar';
    banner.classList.add('show');
  }
  map.getContainer().style.cursor = 'crosshair';

  _pontoPickingHandler = function(e) {
    const { lat, lng } = e.latlng;
    criarPonto(lat, lng);
    // Keep picking active for multiple points
  };

  _pontoPickingKeyHandler = function(e) {
    if (e.key === 'Escape') window.togglePontoPicking();
  };

  map.on('click', _pontoPickingHandler);
  document.addEventListener('keydown', _pontoPickingKeyHandler);
};

function removeCustomMarker(idx) {
    const m = _customMarkers[idx];
    if (m) { map.removeLayer(m); _customMarkers[idx] = null; }
    // Remove from pontos list
    const item = document.querySelector(`.ponto-item[data-idx="${idx}"]`);
    if (item) item.remove();
    // Show empty state if no pontos left
    const remaining = _customMarkers.filter(Boolean).length;
    const empty = document.getElementById('pontosEmpty');
    if (empty) empty.style.display = remaining === 0 ? 'flex' : 'none';
  }
  window._removeCustomMarker = removeCustomMarker;

  function criarPonto(lat, lng, customName) {
    const idx  = _customMarkers.length;
    const name = customName || `Ponto ${idx + 1}`;

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:var(--accent);color:#000;font-family:var(--mono);font-size:8px;font-weight:600;padding:3px 7px;border-radius:12px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:1px solid rgba(0,0,0,0.2);letter-spacing:0.5px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`,
        iconAnchor: [60, 12],
        popupAnchor: [0, -16]
      })
    }).addTo(map);

    marker.bindPopup(`
      <div class="popup-content" style="min-width:180px">
        <div class="popup-name" style="font-size:12px">${name}</div>
        <div class="popup-row">Lat <span>${lat.toFixed(8)}</span></div>
        <div class="popup-row">Lng <span>${lng.toFixed(8)}</span></div>
        <button class="popup-save-btn" style="margin-top:8px;background:#f44336;"
          onclick="window._removeCustomMarker(${idx})">🗑 REMOVER</button>
      </div>
    `);

    _customMarkers.push(marker);

    // Add to pontos tab
    const pontosList = document.getElementById('pontosList');
    const pontosEmpty = document.getElementById('pontosEmpty');
    if (pontosEmpty) pontosEmpty.style.display = 'none';
    if (pontosList) {
      const item = document.createElement('div');
      item.className = 'ponto-item';
      item.dataset.idx = idx;
      item.innerHTML = `
        <span class="ponto-icon">📌</span>
        <div class="ponto-info">
          <span class="ponto-name" contenteditable="true" spellcheck="false" title="Clique para renomear">${name}</span>
          <div class="ponto-coords">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        </div>
        <button class="ponto-delete" title="Remover">✕</button>
      `;

      // Rename on blur / Enter
      const nameEl = item.querySelector('.ponto-name');
      nameEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
        e.stopPropagation(); // prevent Tab navigation while editing
      });
      nameEl.addEventListener('blur', () => {
        const newName = nameEl.textContent.trim() || name;
        nameEl.textContent = newName;
        // Update popup content
        marker.setPopupContent(`
          <div class="popup-content" style="min-width:180px">
            <div class="popup-name" style="font-size:12px">${newName}</div>
            <div class="popup-row">Lat <span>${lat.toFixed(8)}</span></div>
            <div class="popup-row">Lng <span>${lng.toFixed(8)}</span></div>
            <button class="popup-save-btn" style="margin-top:8px;background:#f44336;"
              onclick="window._removeCustomMarker(${idx})">🗑 REMOVER</button>
          </div>
        `);
      });
      nameEl.addEventListener('click', e => e.stopPropagation()); // don't fly map when clicking to rename
      nameEl.addEventListener('focus', e => {
        // Select all text when focused
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      item.querySelector('.ponto-delete').addEventListener('click', e => {
        e.stopPropagation();
        removeCustomMarker(idx);
      });
      item.addEventListener('click', () => {
        map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
        marker.openPopup();
      });
      pontosList.appendChild(item);
    }

    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
    marker.openPopup();
    showToast(`📌 Ponto criado — <span class="accent">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`);
    results.style.display = 'none';
    input.value = '';
    clearBtn.style.display = 'none';
  }

  function search(q) {
    q = q.trim();
    clearBtn.style.display = q ? 'block' : 'none';
    if (!q) { results.style.display = 'none'; return; }

    const coords  = parseCoords(q);
    const features = getAllKmlFeatures();
    const kmlMatches = features.filter(f => f.searchText.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

    // Search custom pontos
    const pontoMatches = _customMarkers
      .map((m, idx) => m ? { idx, latlng: m.getLatLng(), name: document.querySelector(`.ponto-item[data-idx="${idx}"] .ponto-name`)?.textContent?.trim() || `Ponto ${idx + 1}`, marker: m } : null)
      .filter(p => p && p.name.toLowerCase().includes(q.toLowerCase()));

    results.style.display = 'block';

    let html = '';

    // Coords button on top
    if (coords) {
      html += `<div class="criar-ponto-btn" id="criarPontoBtn">
        <span class="criar-ponto-btn-icon">📌</span>
        <div>
          <div class="criar-ponto-btn-text">Criar ponto</div>
          <div class="criar-ponto-btn-coords">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</div>
        </div>
      </div>`;
    }

    // Custom pontos matches
    if (pontoMatches.length) {
      html += pontoMatches.map((p, i) => `
        <div class="kml-search-result-item ponto-search-item" data-ponto-idx="${p.idx}">
          <div class="kml-result-name">📌 ${highlight(p.name, q)}</div>
          <div class="kml-result-meta">${p.latlng.lat.toFixed(6)}, ${p.latlng.lng.toFixed(6)}</div>
        </div>
      `).join('');
    }

    if (!kmlMatches.length && !pontoMatches.length && !coords) {
      html += '<div class="kml-search-empty">Nenhum resultado encontrado</div>';
    } else {
      html += kmlMatches.map((f, i) => {
        const meta = [f.props.sg_uf || f.props.Unidade_Federacao, f.fileName]
          .filter(Boolean).join(' · ');
        const oaeHtml = f.oae ? `<div class="kml-result-meta" style="color:var(--accent);opacity:0.8;">${highlight(f.oae, q)}</div>` : '';
        return `<div class="kml-search-result-item" data-idx="${i}">
          <div class="kml-result-name">${highlight(f.name, q)}</div>
          ${oaeHtml}
          ${meta ? `<div class="kml-result-meta">${meta}</div>` : ''}
        </div>`;
      }).join('');
    }

    results.innerHTML = html;

    // Wire criar ponto button
    const cpBtn = results.querySelector('#criarPontoBtn');
    if (cpBtn && coords) cpBtn.addEventListener('click', () => criarPonto(coords.lat, coords.lng));

    // Wire custom ponto items
    results.querySelectorAll('.ponto-search-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.pontoIdx);
        const m = _customMarkers[idx];
        if (m) {
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
          m.openPopup();
        }
        results.style.display = 'none';
        clearBtn.style.display = 'block';
        switchTab('pontos');
      });
    });

    // Wire KML result items
    results.querySelectorAll('.kml-search-result-item:not(.ponto-search-item)').forEach((el, i) => {
      el.addEventListener('click', () => {
        const f = kmlMatches[i];
        map.setView(f.latlng, Math.max(map.getZoom(), 14), { animate: true });
        if (f.layer.openPopup) f.layer.openPopup();
        if (_activeMarker && _activeMarker.setStyle) _activeMarker.setStyle({ weight: 1.5 });
        if (f.layer.setStyle) {
          f.layer.setStyle({ weight: 4, color: '#d4f53c' });
          _activeMarker = f.layer;
          setTimeout(() => { if (f.layer.setStyle) f.layer.setStyle({ weight: 1.5 }); }, 2000);
        }
        input.value = f.name;
        results.style.display = 'none';
        clearBtn.style.display = 'block';
      });
    });
  }

  input.addEventListener('input', e => search(e.target.value));
  clearBtn.addEventListener('click', () => {
    input.value = '';
    results.style.display = 'none';
    clearBtn.style.display = 'none';
    input.focus();
  });

  // Close results when clicking outside
  document.addEventListener('click', e => {
    if (!document.getElementById('kmlSearchBar').contains(e.target)) {
      results.style.display = 'none';
    }
  });

  // Keyboard nav
  input.addEventListener('keydown', e => {
    const items = results.querySelectorAll('.kml-search-result-item');
    const active = results.querySelector('.kml-search-result-item.focused');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? (active.nextElementSibling || items[0]) : items[0];
      active?.classList.remove('focused');
      next?.classList.add('focused');
      next?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? (active.previousElementSibling || items[items.length-1]) : items[items.length-1];
      active?.classList.remove('focused');
      prev?.classList.add('focused');
      prev?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active) {
      active.click();
    } else if (e.key === 'Escape') {
      results.style.display = 'none';
      input.blur();
    }
  });
})();

let _sortKey = 'name', _sortDir = 'asc';

const _sortBtns = {
  'date-desc': 'sortBtnDate',
  'date-asc':  'sortBtnDateAsc',
  'name-asc':  'sortBtnNameAsc',
  'name-desc': 'sortBtnNameDesc',
};

window.setSort = function(key, dir) {
  _sortKey = key;
  _sortDir = dir;

  // Update active button
  Object.entries(_sortBtns).forEach(([k, id]) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', k === `${key}-${dir}`);
  });

  renderSortedList();
};

function getPhotoDate(photo) {
  const raw = photo.exif?.DateTimeOriginal || photo.exif?.CreateDate
           || photo.exif?.DateTime || photo.exif?.DateTimeDigitized;
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const m = String(raw).match(/(\d{4})[:\-](\d{2})[:\-](\d{2})/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
}

function renderSortedList() {
  const sorted = [...photos].sort((a, b) => {
    if (_sortKey === 'name') {
      const cmp = a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' });
      return _sortDir === 'asc' ? cmp : -cmp;
    } else {
      // date
      const da = getPhotoDate(a), db = getPhotoDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      const cmp = da - db;
      return _sortDir === 'asc' ? cmp : -cmp;
    }
  });

  // Re-order DOM nodes (no re-render, just move existing elements)
  const list = document.getElementById('photoList');
  sorted.forEach(photo => {
    const el = list.querySelector(`.photo-item[data-id="${photo.id}"]`);
    if (el) list.appendChild(el);
  });
}

// ─── DISTANCE MEASURE TOOL ───────────────────────────────────────────────────
(function() {
  let _measuring   = false;
  let _points      = [];
  let _polyline    = null;
  let _markers     = [];
  let _tooltips    = [];
  let _totalDist   = 0;

  const measureBtn = document.getElementById('measureBtn');
  const banner     = document.getElementById('measureBanner');

  function formatDist(m) {
    return m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`;
  }

  function clearMeasure() {
    _points = [];
    _totalDist = 0;
    if (_polyline) { map.removeLayer(_polyline); _polyline = null; }
    _markers.forEach(m => map.removeLayer(m));  _markers = [];
    _tooltips.forEach(t => map.removeLayer(t)); _tooltips = [];
  }

  function onMapClick(e) {
    if (!_measuring) return;
    const latlng = e.latlng;
    _points.push(latlng);

    // Draw dot marker
    const dot = L.circleMarker(latlng, {
      radius: 5, color: '#d4f53c', fillColor: '#d4f53c',
      fillOpacity: 1, weight: 2, pane: 'markerPane'
    }).addTo(map);
    _markers.push(dot);

    // Update polyline
    if (_polyline) map.removeLayer(_polyline);
    if (_points.length > 1) {
      _polyline = L.polyline(_points, {
        color: '#d4f53c', weight: 2, dashArray: '6,4', opacity: 0.9
      }).addTo(map);

      // Segment distance tooltip
      const p1 = _points[_points.length - 2];
      const p2 = _points[_points.length - 1];
      const segDist = map.distance(p1, p2);
      _totalDist += segDist;

      const mid = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
      const tt = L.tooltip({ permanent: true, direction: 'top', className: 'measure-tooltip', offset: [0, -4] })
        .setLatLng(mid)
        .setContent(formatDist(segDist))
        .addTo(map);
      _tooltips.push(tt);
    }
  }

  function startMeasure() {
    _measuring = true;
    clearMeasure();
    measureBtn.classList.add('active');
    measureBtn.textContent = '✕ PARAR';
    banner.classList.add('show');
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', onMapClick);
    document.addEventListener('keydown', onEsc);
  }

  function stopMeasure() {
    _measuring = false;
    measureBtn.classList.remove('active');
    measureBtn.textContent = '📏 MEDIR';
    banner.classList.remove('show');
    map.getContainer().style.cursor = '';
    map.off('click', onMapClick);
    document.removeEventListener('keydown', onEsc);
    clearMeasure();
  }

  function onEsc(e) { if (e.key === 'Escape') stopMeasure(); }

  // ─── SNV ALIGNMENT ────────────────────────────────────────────────────────────
window.alignToSNV = function() {
  const features = [];
  Object.values(kmlLayers).forEach(({ layer }) => {
    if (!layer._layers) return;
    Object.values(layer._layers).forEach(l => {
      const sublayers = l._layers ? Object.values(l._layers) : [l];
      sublayers.forEach(sl => {
        const props  = sl.feature?.properties || sl.options?.properties || {};
        const name   = (props.name || '').toUpperCase();
        const latlng = sl.getLatLng?.() || sl.getBounds?.()?.getCenter?.();
        if (latlng) features.push({ name, latlng });
      });
    });
  });

  const ldInicio = features.find(f => f.name.includes('LD_INICIO_OAE'));
  const ldFinal  = features.find(f => f.name.includes('LD_FINAL_OAE'));
  const leInicio = features.find(f => f.name.includes('LE_INICIO_OAE'));
  const leFinal  = features.find(f => f.name.includes('LE_FINAL_OAE'));

  // Need at least one LD and one LE point to compute bearing
  const bottomPt = ldInicio?.latlng || ldFinal?.latlng;
  const topPt    = leInicio?.latlng || leFinal?.latlng;

  if (!bottomPt || !topPt) {
    const missing = !bottomPt ? 'LD_INICIO_OAE / LD_FINAL_OAE' : 'LE_INICIO_OAE / LE_FINAL_OAE';
    showToast(`⚠️ Pontos <span class="accent">${missing}</span> não encontrados no KML`);
    return;
  }

  // Bearing from bottom (LD) → top (LE)
  const lat1 = bottomPt.lat * Math.PI / 180;
  const lat2 = topPt.lat    * Math.PI / 180;
  const dLng = (topPt.lng - bottomPt.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const roadBearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

  // Calculate exact rotation to make LD→LE axis horizontal on screen
  // We want the LD-LE line to be perfectly horizontal (pointing left-right)
  // The bearing from bottomPt(LD) to topPt(LE) gives the road direction
  // To make this horizontal, we rotate the map by (90° - roadBearing) so the
  // axis aligns with the screen's horizontal axis
  // Then +180 to put LD on the left side
  const mapRotation = ((90 - roadBearing) + 270) % 360;

  // Collect all 4 points that exist and fit them all in view
  const allPts = [ldInicio, ldFinal, leInicio, leFinal]
    .filter(Boolean).map(f => f.latlng);
  const bounds = L.latLngBounds(allPts);
  map.fitBounds(bounds, { padding: [80, 80], animate: true });

  // Apply rotation after fitBounds settles
  setTimeout(() => setBearing(mapRotation), 400);

  showToast(`🧭 SNV alinhado — LD↓ LE↑ &nbsp;<span class="accent">${Math.round(mapRotation)}°</span>`);
};

// ─── STREET VIEW ──────────────────────────────────────────────────────────────
function openSV(lat, lng) {
  const panel  = document.getElementById('svPanel');
  const iframe = document.getElementById('svIframe');
  if (!panel || !iframe) return;

  // Use Mapillary — free, open street-level imagery, no API key needed
  const url = `https://www.mapillary.com/embed?map_style=Mapillary+satellite&image_key=none&x=0.5&y=0.5&client_id=MLY|4381028608625026|8e309c7d0b02f32a32fcbff1eb24b8cc&lat=${lat}&lng=${lng}&z=17`;
  iframe.src = url;
  panel.classList.add('show');

  // Update the "open in Google Maps" link
  const extLink = document.getElementById('svExtLink');
  if (extLink) extLink.href = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}`;
}

window.openGoogleMaps = function() {
  // Use selected photo if any, else map center
  let lat, lng;
  if (activeId != null) {
    const photo = photos.find(p => p.id === activeId);
    if (photo && photo.lat != null) {
      lat = photo.lat; lng = photo.lng;
    }
  }
  if (lat == null) {
    const center = map.getCenter();
    lat = center.lat; lng = center.lng;
  }
  window.open(`https://www.google.com/maps?q=${lat},${lng}&ll=${lat},${lng}&z=18`, '_blank');
};

window.openSVAtCenter = window.openGoogleMaps; // legacy alias
window.openSVAtMarker = function(lat, lng) {
  window.open(`https://www.google.com/maps?q=${lat},${lng}&ll=${lat},${lng}&z=18`, '_blank');
};

window.closeSV = function() {
  const panel  = document.getElementById('svPanel');
  const iframe = document.getElementById('svIframe');
  if (panel) panel.classList.remove('show');
  if (iframe) iframe.src = '';
};

// Right-click on map → open Street View at that point
map.on('contextmenu', function(e) {
  openSV(e.latlng.lat, e.latlng.lng);
});

window.toggleMeasure = function() {
    _measuring ? stopMeasure() : startMeasure();
  };
})();

(function() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebarResizer');
  const toggle  = document.getElementById('sidebarToggle');
  if (!sidebar) return;

  const MIN_W = 200;
  const MAX_W = 600;
  let _lastW = 320;

  // ── Minimize / expand ──────────────────────────────────────────────────────
  if (toggle) {
    toggle.addEventListener('click', () => {
      const isMin = sidebar.classList.toggle('minimized');
      toggle.textContent = isMin ? '▶' : '◀';
      toggle.title = isMin ? 'Expandir painel' : 'Minimizar painel';
      if (!isMin) {
        sidebar.style.width = _lastW + 'px';
      } else {
        _lastW = sidebar.getBoundingClientRect().width;
      }
      // Toggle DNIT layer panel visibility with sidebar
      const layerPanel = document.querySelector('.layer-panel');
      if (layerPanel) layerPanel.style.display = isMin ? 'none' : '';
    });
  }

  // ── Resize drag ────────────────────────────────────────────────────────────
  if (!resizer) return;
  let startX, startW;

  resizer.addEventListener('mousedown', e => {
    if (sidebar.classList.contains('minimized')) return;
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const newW = Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - startX)));
      sidebar.style.width = newW + 'px';
      _lastW = newW;
    }

    function onUp() {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ─── EMBEDDED KML AUTO-LOAD ──────────────────────────────────────────────────
(function() {
  
  window.addEventListener('load', function() {
    setTimeout(function() {
      try {
        const blob = new Blob([EMBEDDED_KML], { type: 'application/vnd.google-earth.kml+xml' });
        const file = new File([blob], EMBEDDED_KML_NAME);
        loadKmlFile(file, { color: '#ff6b35', skipDnitLookup: true }); // distinct color, no DNIT lookup for the embedded dataset
      } catch(e) {
        console.error('Embedded KML load error:', e);
      }
    }, 1000);
  });
})();

