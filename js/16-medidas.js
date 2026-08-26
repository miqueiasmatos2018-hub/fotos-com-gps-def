// ==========================================================================
// 16-medidas.js
// "Medidas" tab: bridge/structure geometry analysis ported from a
// standalone tool (TOPO.html) that originally read this from a pasted CSV.
// Here it reads the same four points -- LD_INICIO_OAE, LE_INICIO_OAE,
// LD_FINAL_OAE, LE_FINAL_OAE (or their "PONTE" name variants) -- straight
// out of whatever KML gets dropped on the map for the rest of the app, so
// no separate CSV step is needed.
//
// The math (UTM projection, skew/esconsidade angle, effective width,
// inclination) is ported as directly as possible from the original tool to
// keep the same results; only the point-matching source changed (KML
// properties/geometry instead of CSV columns).
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// ─── POINT NAME MATCHING ────────────────────────────────────────────────────
// Recognizes both the "_OAE" naming (LD_INICIO_OAE) and the older "PONTE"
// variants (LD INICIO PONTE / LD FINAL DE PONTE) the same way the original
// tool did, normalizing both to one of these four canonical keys. Whatever
// text sits before the matched suffix becomes the "group key" -- so a KML
// with multiple structures (e.g. "260048_LD_INICIO_OAE",
// "260112_LD_INICIO_OAE", ...) is split into separate structures instead of
// being mixed together, while a KML with no prefix at all (just
// "LD_INICIO_OAE") is treated as a single structure.
const MEDIDAS_SUFFIX_PATTERNS = [
  [/LD[\s_]?INICIO[\s_]?(DE[\s_]?)?PONTE/i, 'LD_INICIO_OAE'],
  [/LE[\s_]?INICIO[\s_]?(DE[\s_]?)?PONTE/i, 'LE_INICIO_OAE'],
  [/LD[\s_]?FINAL[\s_]?(DE[\s_]?)?PONTE/i,  'LD_FINAL_OAE'],
  [/LE[\s_]?FINAL[\s_]?(DE[\s_]?)?PONTE/i,  'LE_FINAL_OAE'],
  [/LD_INICIO_OAE/i, 'LD_INICIO_OAE'],
  [/LE_INICIO_OAE/i, 'LE_INICIO_OAE'],
  [/LD_FINAL_OAE/i,  'LD_FINAL_OAE'],
  [/LE_FINAL_OAE/i,  'LE_FINAL_OAE'],
];
const MEDIDAS_POINT_ORDER = ['LE_INICIO_OAE', 'LD_INICIO_OAE', 'LD_FINAL_OAE', 'LE_FINAL_OAE'];

function _matchMedidasPointType(rawName) {
  const name = String(rawName || '').toUpperCase();
  for (const [re, canonical] of MEDIDAS_SUFFIX_PATTERNS) {
    const m = name.match(re);
    if (m) {
      const groupKey = name.replace(m[0], '').replace(/^[_\s-]+|[_\s-]+$/g, '');
      return { canonical, groupKey };
    }
  }
  return null;
}

// Elevation, in priority order matching the original tool: H_GEO family
// first, then a few other common column names, falling back to the KML
// point's own altitude value (3rd coordinate) if nothing else is present.
function _extractMedidasElevation(props, layer) {
  const candidates = [
    props.H_GEO, props.h_geo, props.H_Geo, props.HGEO,
    props.H_ORTO, props.h_orto, props.H_ORTHO, props.h_ortho,
    props.Elev, props.elev, props.Elevation, props.elevation,
    props.Altura, props.altura, props.Z, props.z
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== '') {
      const n = parseFloat(c);
      if (!isNaN(n)) return n;
    }
  }
  const geom = layer.feature && layer.feature.geometry;
  if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 3) {
    const z = parseFloat(geom.coordinates[2]);
    if (!isNaN(z)) return z;
  }
  return 0;
}

function _extractMedidasPointsFromKml(parsedLayer) {
  const found = [];
  parsedLayer.eachLayer(sl => {
    const props = (sl.feature && sl.feature.properties) || {};
    const match = _matchMedidasPointType(props.name);
    if (!match) return;
    const latlng = sl.getLatLng ? sl.getLatLng() : (sl.getBounds ? sl.getBounds().getCenter() : null);
    if (!latlng) return;
    found.push({
      canonical: match.canonical,
      groupKey: match.groupKey,
      lat: latlng.lat,
      lng: latlng.lng,
      elevation: _extractMedidasElevation(props, sl)
    });
  });
  return found;
}

// ─── GEOMETRY MATH (ported from TOPO.html) ─────────────────────────────────

function _medidasGeoToUTM(lat, lng) {
  const a = 6378137.0;           // WGS84 semi-major axis
  const f = 1 / 298.257223563;   // WGS84 flattening
  const k0 = 0.9996;             // UTM scale factor

  const zone = Math.floor((lng + 180) / 6) + 1;
  const centralMeridian = (zone - 1) * 6 - 180 + 3;

  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  const centralMeridianRad = centralMeridian * Math.PI / 180;
  const deltaLng = lngRad - centralMeridianRad;

  const N = a / Math.sqrt(1 - (f * (2 - f) * Math.sin(latRad) * Math.sin(latRad)));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = (f * (2 - f)) / (1 - f * (2 - f)) * Math.cos(latRad) * Math.cos(latRad);
  const A = deltaLng * Math.cos(latRad);

  const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6) + 500000;
  const M = a * ((1 - f / 4 - 3 * f * f / 64) * latRad -
    (3 * f / 8 + 3 * f * f / 32) * Math.sin(2 * latRad) +
    (15 * f * f / 256) * Math.sin(4 * latRad));
  const northing = lat < 0 ? k0 * M + 10000000 : k0 * M; // southern hemisphere (Brazil)

  return { easting, northing, zone };
}

function _medidasHaversineM(p1, p2) {
  const R = 6371000;
  const lat1 = p1.lat * Math.PI / 180, lat2 = p2.lat * Math.PI / 180;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _medidasInclination(p1, p2) {
  const distance = _medidasHaversineM(p1, p2);
  const elevDiff = p2.elevation - p1.elevation;
  if (distance === 0) return { percentage: 0, degrees: 0, direction: 'Nivelado', elevDiff: 0 };
  const percentage = (Math.abs(elevDiff) / distance) * 100;
  const degrees = Math.atan(Math.abs(elevDiff) / distance) * (180 / Math.PI);
  const direction = elevDiff > 0.01 ? 'Subida' : elevDiff < -0.01 ? 'Descida' : 'Nivelado';
  return { percentage, degrees, direction, elevDiff };
}

// Requested metrics: Largura Útil (Efetiva), Média Comprimento, whether
// there's a meaningful slope and which way (Subida/Descida), and whether
// the structure is skewed (esconsa) -- ported from calculateSkewAnalysis()
// in the original tool, operating on UTM-projected coordinates so widths
// and lengths come out in real metres.
function _analyzeMedidasStructure(points) {
  const ldInicio = points.LD_INICIO_OAE;
  const leInicio = points.LE_INICIO_OAE;
  const ldFinal  = points.LD_FINAL_OAE;
  const leFinal  = points.LE_FINAL_OAE;

  const u = {
    ldInicio: _medidasGeoToUTM(ldInicio.lat, ldInicio.lng),
    leInicio: _medidasGeoToUTM(leInicio.lat, leInicio.lng),
    ldFinal:  _medidasGeoToUTM(ldFinal.lat,  ldFinal.lng),
    leFinal:  _medidasGeoToUTM(leFinal.lat,  leFinal.lng),
  };

  const vetorLD = { x: u.ldFinal.easting - u.ldInicio.easting, y: u.ldFinal.northing - u.ldInicio.northing };
  const vetorLE = { x: u.leFinal.easting - u.leInicio.easting, y: u.leFinal.northing - u.leInicio.northing };

  const anguloLD = Math.atan2(vetorLD.y, vetorLD.x) * (180 / Math.PI);
  const anguloLE = Math.atan2(vetorLE.y, vetorLE.x) * (180 / Math.PI);
  const anguloEixo = (anguloLD + anguloLE) / 2;

  const vetorTransversal = { x: u.leInicio.easting - u.ldInicio.easting, y: u.leInicio.northing - u.ldInicio.northing };
  const anguloTransversal = Math.atan2(vetorTransversal.y, vetorTransversal.x) * (180 / Math.PI);

  // Skew (esconsidade) angle: deviation from perpendicular between the
  // transversal (start-to-start) line and the bridge's own longitudinal axis.
  let anguloEsconsidade = Math.abs(anguloTransversal - (anguloEixo + 90));
  if (anguloEsconsidade > 90) anguloEsconsidade = 180 - anguloEsconsidade;
  anguloEsconsidade = Math.abs(anguloEsconsidade);
  if (anguloEsconsidade > 90) anguloEsconsidade = 180 - anguloEsconsidade;

  const larguraInicio = Math.hypot(u.leInicio.easting - u.ldInicio.easting, u.leInicio.northing - u.ldInicio.northing);
  const larguraFinal  = Math.hypot(u.leFinal.easting - u.ldFinal.easting, u.leFinal.northing - u.ldFinal.northing);
  const larguraMedia  = (larguraInicio + larguraFinal) / 2;
  // Effective width: the perpendicular-to-traffic width usable by vehicles,
  // which shrinks as the skew angle grows.
  const larguraEfetiva = larguraMedia * Math.cos(anguloEsconsidade * Math.PI / 180);

  const comprimentoLD = Math.hypot(vetorLD.x, vetorLD.y);
  const comprimentoLE = Math.hypot(vetorLE.x, vetorLE.y);
  const mediaComprimento = (comprimentoLD + comprimentoLE) / 2;
  const diferencaComprimentos = Math.abs(comprimentoLD - comprimentoLE);

  let statusEsconsidade = 'Não Esconsa';
  if (anguloEsconsidade > 5) statusEsconsidade = 'Esconsa';
  else if (diferencaComprimentos > 0.5) statusEsconsidade = 'Levemente Esconsa';

  // Inclination: transversal (crown) at each end, longitudinal along each
  // side. "Possui inclinação" / "Sentido" are judged from the longitudinal
  // average, since transversal camber doesn't have an uphill/downhill sense.
  const inclTransvInicio = _medidasInclination(ldInicio, leInicio);
  const inclTransvFinal  = _medidasInclination(ldFinal, leFinal);
  const inclLongLD = _medidasInclination(ldInicio, ldFinal);
  const inclLongLE = _medidasInclination(leInicio, leFinal);

  const avgLongPercentage = (inclLongLD.percentage + inclLongLE.percentage) / 2;
  const avgLongElevDiff = ((ldFinal.elevation - ldInicio.elevation) + (leFinal.elevation - leInicio.elevation)) / 2;
  // No tolerance: any non-zero elevation change (beyond floating-point
  // noise) counts as Subida/Descida. Only an exact/near-exact match is
  // reported as Nivelado.
  const possuiInclinacao = Math.abs(avgLongElevDiff) > 1e-6;
  const sentido = !possuiInclinacao ? 'Nivelado' : (avgLongElevDiff > 0 ? 'Subida' : 'Descida');

  return {
    larguraInicio, larguraFinal, larguraMedia, larguraEfetiva,
    comprimentoLD, comprimentoLE, mediaComprimento, diferencaComprimentos,
    anguloEsconsidade, statusEsconsidade,
    possuiInclinacao, avgLongPercentage, avgLongElevDiff, sentido,
    inclTransvInicio, inclTransvFinal, inclLongLD, inclLongLE
  };
}

// ─── STATE + KML INGEST ─────────────────────────────────────────────────────
const MEDIDAS_STRUCTURES = {}; // groupKey -> { groupKey, points: {canonical: {lat,lng,elevation}}, analysis }

// Called from loadKmlFile() (see 08-kml.js) every time a KML is dropped.
// Structures accumulate across multiple drops -- points found in a later
// file merge into an existing group with the same key rather than
// replacing it, so a structure split across two files still completes.
function registerMedidasKmlDrop(parsedLayer) {
  const found = _extractMedidasPointsFromKml(parsedLayer);
  if (!found.length) return;

  const touchedGroups = new Set();
  found.forEach(p => {
    const key = p.groupKey || '__default__';
    if (!MEDIDAS_STRUCTURES[key]) MEDIDAS_STRUCTURES[key] = { groupKey: p.groupKey, points: {}, analysis: null, barrierType: null };
    MEDIDAS_STRUCTURES[key].points[p.canonical] = { lat: p.lat, lng: p.lng, elevation: p.elevation };
    touchedGroups.add(key);
  });

  let completedCount = 0;
  touchedGroups.forEach(key => {
    const s = MEDIDAS_STRUCTURES[key];
    const pts = s.points;
    if (pts.LD_INICIO_OAE && pts.LE_INICIO_OAE && pts.LD_FINAL_OAE && pts.LE_FINAL_OAE) {
      s.analysis = _analyzeMedidasStructure(pts);
      completedCount++;
    }
  });

  _renderMedidasList();
  _rebuildMedidasMapLayer();

  if (completedCount) {
    showToast(`📏 <span class="accent">${completedCount}</span> estrutura${completedCount > 1 ? 's' : ''} calculada${completedCount > 1 ? 's' : ''}`);
  } else {
    showToast('📏 pontos de estrutura identificados — aguardando os 4 pontos completos');
  }
}

// ─── SIDEBAR LIST ───────────────────────────────────────────────────────────
function _renderMedidasList() {
  const list  = document.getElementById('medidasList');
  const empty = document.getElementById('medidasEmpty');
  if (!list || !empty) return;

  const keys = Object.keys(MEDIDAS_STRUCTURES).filter(k => MEDIDAS_STRUCTURES[k].analysis);
  empty.style.display = keys.length ? 'none' : '';

  list.innerHTML = keys.map(key => {
    const s = MEDIDAS_STRUCTURES[key];
    const a = s.analysis;
    const title = s.groupKey || 'Estrutura';

    // Barrier addition: mutually exclusive -- NJ adds 80cm, Guarda Corpo
    // adds 30cm, neither selected adds nothing.
    const barrierAddM = s.barrierType === 'NJ' ? 0.80 : s.barrierType === 'GC' ? 0.30 : 0;
    const larguraAjustada = a.larguraEfetiva + barrierAddM;
    const larguraExtra = barrierAddM > 0 ? `<small>+${Math.round(barrierAddM * 100)}cm</small>` : '';

    const inclCm = Math.round(Math.abs(a.avgLongElevDiff) * 100);
    const inclBadge = a.possuiInclinacao
      ? `<span class="medidas-badge medidas-badge-warn">Sim · ${a.avgLongPercentage.toFixed(2)}% · ${inclCm}cm</span>`
      : `<span class="medidas-badge medidas-badge-ok">Não</span>`;

    const sentidoIcon = a.sentido === 'Subida' ? '↗️' : a.sentido === 'Descida' ? '↘️' : '➡️';
    const sentidoCm = a.sentido !== 'Nivelado' ? `<small>${inclCm}cm</small>` : '';

    // Skew angle is now always shown in degrees, not just when skewed.
    const esconsaClass = a.statusEsconsidade === 'Não Esconsa' ? 'medidas-badge-ok' : 'medidas-badge-warn';
    const esconsaBadge = `<span class="medidas-badge ${esconsaClass}">${a.statusEsconsidade} · ${a.anguloEsconsidade.toFixed(1)}°</span>`;

    return `
      <div class="medidas-card" data-key="${key}">
        <div class="medidas-card-header">📐 ${title}</div>
        <div class="medidas-row"><span>Largura Útil (Efetiva)</span><b>${larguraAjustada.toFixed(2)} m ${larguraExtra}</b></div>
        <div class="medidas-barrier-toggle">
          <button class="medidas-barrier-btn ${s.barrierType === 'NJ' ? 'active' : ''}" data-key="${key}" data-barrier="NJ">Barreira NJ</button>
          <button class="medidas-barrier-btn ${s.barrierType === 'GC' ? 'active' : ''}" data-key="${key}" data-barrier="GC">Guarda Corpo</button>
        </div>
        <div class="medidas-row"><span>Média Comprimento</span><b>${a.mediaComprimento.toFixed(2)} m</b></div>
        <div class="medidas-row"><span>Possui Inclinação</span>${inclBadge}</div>
        <div class="medidas-row"><span>Sentido</span><b>${sentidoIcon} ${a.sentido}</b>${sentidoCm}</div>
        <div class="medidas-row"><span>Esconsidade</span>${esconsaBadge}</div>
        <button class="medidas-focus-btn" data-key="${key}">📍 Focar no mapa</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.medidas-focus-btn').forEach(btn => {
    btn.addEventListener('click', () => _focusMedidasStructure(btn.dataset.key));
  });

  list.querySelectorAll('.medidas-barrier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = MEDIDAS_STRUCTURES[btn.dataset.key];
      if (!s) return;
      const picked = btn.dataset.barrier;
      // Clicking the already-active option turns it off (mutually exclusive
      // toggle, with "neither" as a valid third state).
      s.barrierType = s.barrierType === picked ? null : picked;
      _renderMedidasList();
    });
  });
}

// ─── MAP DRAWING (only while the Medidas tab is open) ──────────────────────
let _medidasLayerGroup = null;
let _medidasTabActive = false;

function _rebuildMedidasMapLayer() {
  if (_medidasLayerGroup) { map.removeLayer(_medidasLayerGroup); _medidasLayerGroup = null; }

  const keys = Object.keys(MEDIDAS_STRUCTURES).filter(k => MEDIDAS_STRUCTURES[k].analysis);
  if (!keys.length) return;

  _medidasLayerGroup = L.layerGroup();
  keys.forEach(key => {
    const pts = MEDIDAS_STRUCTURES[key].points;
    const latlngs = MEDIDAS_POINT_ORDER.map(t => [pts[t].lat, pts[t].lng]);

    L.polygon(latlngs, {
      color: '#00e5ff', weight: 2, fillColor: '#00e5ff', fillOpacity: 0.15, dashArray: '6 4'
    }).addTo(_medidasLayerGroup);

    MEDIDAS_POINT_ORDER.forEach(t => {
      const p = pts[t];
      L.circleMarker([p.lat, p.lng], {
        radius: 5, color: '#000', weight: 1.5, fillColor: '#00e5ff', fillOpacity: 0.95
      }).bindTooltip(t, { permanent: false, direction: 'top' }).addTo(_medidasLayerGroup);
    });
  });

  if (_medidasTabActive) _medidasLayerGroup.addTo(map);
}

// Called from switchTab() in 09-tabs-bulk.js -- the outline is only useful
// while looking at this tab, so it's added/removed as you switch in/out.
function _setMedidasLayerVisible(visible) {
  _medidasTabActive = visible;
  if (!_medidasLayerGroup) {
    if (visible) _rebuildMedidasMapLayer();
    return;
  }
  if (visible && !map.hasLayer(_medidasLayerGroup)) _medidasLayerGroup.addTo(map);
  else if (!visible && map.hasLayer(_medidasLayerGroup)) map.removeLayer(_medidasLayerGroup);
}

function _focusMedidasStructure(key) {
  const s = MEDIDAS_STRUCTURES[key];
  if (!s) return;
  const bounds = L.latLngBounds(Object.values(s.points).map(p => [p.lat, p.lng]));
  map.fitBounds(bounds, { padding: [60, 60] });
}
