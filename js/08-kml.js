// ==========================================================================
// 08-kml.js
// KML/KMZ import, embedded CSV dataset, DNIT km lookup.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

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
let _epocaRowSeq = 0;

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
  const re = new RegExp(`(id="${layer._dnitRowId}"[^>]*>\\s*DNIT km:\\s*<span>)[^<]*(</span>)`);
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

// ─── "MELHOR ÉPOCA" LOOKUP (nearest rain station, LD_INICIO points) ────────────
// Embedded reference dataset of ~2,568 rain-gauge stations (name, coords, and
// their driest 3-month window). Not shown on the map -- used only to find the
// closest station to an LD_INICIO/LD_INICIO_OAE point dropped in a KML, so its
// "best time of year to visit" can be shown under the DNIT km row.
let ESTACOES_CHUVA = [];
let _estacoesLoadPromise = null;

function loadEstacoesCsv() {
  if (_estacoesLoadPromise) return _estacoesLoadPromise; // idempotent, loads once
  _estacoesLoadPromise = (async () => {
    try {
      const res = await fetch('./estacoes_periodo_chuva.csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let text = await res.text();
      text = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM
      const rows = parseCSV(text, ';'); // this file is semicolon-delimited, comma-decimal
      ESTACOES_CHUVA = rows.map(r => ({
        name: r.NOME,
        lat: parseFloat(String(r.LATITUDE).replace(',', '.')),
        lng: parseFloat(String(r.LONGITUDE).replace(',', '.')),
        periodo: r.MAIS_SECO
      })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      console.log(`[estacoes] ${ESTACOES_CHUVA.length} estações carregadas`);
    } catch (err) {
      console.error('Erro ao carregar estacoes_periodo_chuva.csv:', err);
    }
  })();
  return _estacoesLoadPromise;
}

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestEstacao(lat, lng) {
  if (!ESTACOES_CHUVA.length) return null;
  let best = null, bestDist = Infinity;
  for (const s of ESTACOES_CHUVA) {
    const d = _haversineKm(lat, lng, s.lat, s.lng);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best ? { ...best, distanceKm: bestDist } : null;
}

// Replace the "calculando…" placeholder in a marker's popup with the result.
function updateEpocaPopupRow(layer, text) {
  if (!layer || !layer._epocaRowId || !layer.getPopup) return;
  const popup = layer.getPopup();
  if (!popup) return;
  const html = popup.getContent();
  const re = new RegExp(`(id="${layer._epocaRowId}"[^>]*>\\s*MELHOR ÉPOCA:\\s*<span>)[^<]*(</span>)`);
  const updated = html.replace(re, `$1${text}$2`);
  layer.setPopupContent(updated);
}

async function runEpocaLookupForLayer(parsedLayer) {
  const matches = [];
  Object.values(parsedLayer._layers || {}).forEach(l => {
    const sublayers = l._layers ? Object.values(l._layers) : [l];
    sublayers.forEach(sl => {
      const latlng = sl.getLatLng?.() || sl.getBounds?.()?.getCenter?.();
      if (latlng && sl._epocaRowId) { // rows are only tagged on LD_INICIO / LD_INICIO_OAE points
        matches.push({ latlng, layer: sl });
      }
    });
  });
  if (!matches.length) return;

  await loadEstacoesCsv();
  matches.forEach(m => {
    const nearest = findNearestEstacao(m.latlng.lat, m.latlng.lng);
    const text = nearest
      ? `${nearest.periodo} (${nearest.name}, ${Math.round(nearest.distanceKm)} km)`
      : 'dados indisponíveis';
    updateEpocaPopupRow(m.layer, text);
  });
}

function buildStyledGeoJsonOptions(dotColor, fields) {
  return {
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

      if (fields && fields.length) {
        // Fixed, ordered column list (used for the CSV dataset)
        const name = props.Identificacao_OAE || props.codigo_SGO || '—';
        const rows = fields
          .filter(f => f.key !== 'Identificacao_OAE') // already shown as the title
          .map(f => `<div class="popup-row">${f.label}: <span>${props[f.key] || '—'}</span></div>`)
          .join('');

        layer.bindPopup(`
          <div class="popup-content">
            <div class="popup-name">${name}</div>
            ${rows}
          </div>
        `, { maxHeight: 280 });
        return;
      }

      const name = props.name || props.Nome_Tipo_Trecho || props.Codigo_SNV || props.Codigo_BR || '—';

      // Only these fields are wanted from a dropped KML -- everything else
      // in the file is ignored. LAT/LONG come from the feature's own
      // geometry (authoritative) rather than from properties, which may be
      // absent or formatted inconsistently between files. Points expose
      // getLatLng; lines/polygons don't, so fall back to their centre so
      // those features still show a coordinate instead of nothing.
      const latlng = layer.getLatLng ? layer.getLatLng()
                   : (layer.getBounds ? layer.getBounds().getCenter() : null);
      const hGeo = props.H_GEO ?? props.h_geo ?? props.H_Geo ?? props.HGEO ?? null;

      const rows = [
        latlng ? `<div class="popup-row">LAT: <span>${latlng.lat.toFixed(8)}</span></div>` : '',
        latlng ? `<div class="popup-row">LONG: <span>${latlng.lng.toFixed(8)}</span></div>` : '',
        (hGeo !== null && hGeo !== '') ? `<div class="popup-row">H_GEO: <span>${hGeo}</span></div>` : ''
      ].join('');

      // LD_INICIO / LD_INICIO_OAE points get two extra rows that are filled
      // in once their async lookups resolve: DNIT km, then (under it) the
      // best/driest three-month window from the nearest rain station.
      const isLdInicio = String(name).toUpperCase().includes('LD_INICIO');
      let dnitRow = '';
      let epocaRow = '';
      if (isLdInicio) {
        layer._dnitRowId = 'dnitkm-' + (++_dnitRowSeq);
        dnitRow = `<div class="popup-row dnit-km-row" id="${layer._dnitRowId}">DNIT km: <span>consultando…</span></div>`;
        layer._epocaRowId = 'epoca-' + (++_epocaRowSeq);
        epocaRow = `<div class="popup-row melhor-epoca-row" id="${layer._epocaRowId}">MELHOR ÉPOCA: <span>calculando…</span></div>`;
      }

      layer.bindPopup(`
        <div class="popup-content">
          <div class="popup-name">${name}</div>
          ${rows}
          ${dnitRow}
          ${epocaRow}
        </div>
      `, { maxHeight: 280 });
    }
  };
}

// ─── CSV parsing (RFC4180-ish: handles quoted fields, escaped quotes, commas/newlines inside quotes) ──
function parseCSV(text, delimiter) {
  const delim = delimiter || ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings but keep them out of the loop logic by handling \r\n as \n
  const s = text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\r') {
        // skip, \n (or end) will terminate the row
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  // Final field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === '') continue; // skip blank trailing lines
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] !== undefined ? cols[idx] : '').trim(); });
    out.push(obj);
  }
  return out;
}

function csvRowsToGeoJSON(rows) {
  const features = [];
  for (const row of rows) {
    const lat = parseFloat(String(row.Latitude).replace(',', '.'));
    const lon = parseFloat(String(row.Longitude).replace(',', '.'));
    if (!isFinite(lat) || !isFinite(lon)) continue;

    const sgoRaw = (row.codigo_SGO || '').trim();
    const sgoPadded = /^\d+$/.test(sgoRaw) ? sgoRaw.padStart(6, '0') : sgoRaw;

    const properties = { ...row, codigo_SGO: sgoPadded, name: row.Identificacao_OAE || sgoPadded || '—' };

    features.push({
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: [lon, lat] }
    });
  }
  return { type: 'FeatureCollection', features };
}

async function loadEmbeddedCsv() {
  const dotColor = '#e8ff4d';
  const id = 'kml_' + (++kmlIdCounter);
  const displayName = 'current.csv';

  const POPUP_FIELDS = [
    { key: 'codigo_SGO',        label: 'Código SGO' },
    { key: 'Identificacao_OAE', label: 'Identificação OAE' },
    { key: 'UF',                label: 'UF' },
    { key: 'Rodovia_(BR)',      label: 'Rodovia (BR)' },
    { key: 'km',                label: 'km' },
    { key: 'Extensao_(m)',      label: 'Extensão (m)' },
    { key: 'Largura_(m)',       label: 'Largura (m)' },
    { key: 'Tipo_Estrutura',    label: 'Tipo Estrutura' },
    { key: 'Latitude',          label: 'Latitude' },
    { key: 'Longitude',         label: 'Longitude' }
  ];

  try {
    const res = await fetch(EMBEDDED_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csvText = await res.text();

    const rows = parseCSV(csvText);
    const geojson = csvRowsToGeoJSON(rows);

    const parsed = L.geoJSON(geojson, buildStyledGeoJsonOptions(dotColor, POPUP_FIELDS));
    parsed.addTo(map);

    const bounds = parsed.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
      emptyState.style.display = 'none';
    }

    const featureCount = geojson.features.length;
    kmlLayers[id] = { layer: parsed, name: displayName };
    addKmlLayerEntry(id, displayName, featureCount);
    showToast(`CSV carregado — <span class="accent">${featureCount.toLocaleString()} feições</span>`);
  } catch (err) {
    console.error('Embedded CSV load error:', err);
    showToast(`Erro ao carregar CSV: ${err.message}`);
  }
}

function loadKmlFile(file, options = {}) {
  const dotColor = options.color || '#0000ff';
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
      const customLayer = L.geoJSON(null, buildStyledGeoJsonOptions(dotColor));

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
          runEpocaLookupForLayer(parsed);
        }

        // Scan for LD_INICIO / LD_INICIO_OAE points (yellow reference marker)
        // and auto-fill both route names from this file's name — see 15-routes.js.
        if (typeof registerRouteKmlDrop === 'function') {
          registerRouteKmlDrop(parsed, file.name);
        }

        // Scan for the four structure points (LD/LE INICIO/FINAL) used by
        // the Medidas tab — see 16-medidas.js.
        if (typeof registerMedidasKmlDrop === 'function') {
          registerMedidasKmlDrop(parsed);
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
