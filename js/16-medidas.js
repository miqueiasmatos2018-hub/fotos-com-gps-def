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
  // Variantes sem sufixo nenhum (ex: "LD_INICIO" puro) -- checadas por
  // último, depois de todas as mais específicas acima, para não "roubar"
  // o _OAE/PONTE de dentro do groupKey de um nome que já tem um desses.
  [/LD[\s_]?INICIO\b/i, 'LD_INICIO_OAE'],
  [/LE[\s_]?INICIO\b/i, 'LE_INICIO_OAE'],
  [/LD[\s_]?FINAL\b/i,  'LD_FINAL_OAE'],
  [/LE[\s_]?FINAL\b/i,  'LE_FINAL_OAE'],
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
    anguloEsconsidade, statusEsconsidade, anguloEixo,
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
    if (!MEDIDAS_STRUCTURES[key]) MEDIDAS_STRUCTURES[key] = { groupKey: p.groupKey, points: {}, analysis: null, barrierType: null, dnitKm: null, dnitBr: null, dnitUf: null, dnitSnvCodigo: null, dnitSnvVersao: null, melhorEpoca: null, cidadeAntes: null, cidadeDepois: null, lookupsStarted: false };
    const struct = MEDIDAS_STRUCTURES[key];
    const prev = struct.points[p.canonical];

    // Re-soltar um KML corrigido atualizava as coordenadas mas mantinha
    // `lookupsStarted`, então km do DNIT / melhor época / cidades ficavam
    // congelados nos valores do ponto antigo.
    if (p.canonical === 'LD_INICIO_OAE' && prev &&
        (Math.abs(prev.lat - p.lat) > 1e-9 || Math.abs(prev.lng - p.lng) > 1e-9)) {
      struct.lookupsStarted = false;
      struct.dnitKm = struct.dnitBr = struct.dnitUf = null;
      struct.dnitSnvCodigo = struct.dnitSnvVersao = null;
      struct.melhorEpoca = struct.cidadeAntes = struct.cidadeDepois = null;
    }

    struct.points[p.canonical] = { lat: p.lat, lng: p.lng, elevation: p.elevation };
    touchedGroups.add(key);
  });

  let completedCount = 0;
  touchedGroups.forEach(key => {
    const s = MEDIDAS_STRUCTURES[key];
    const pts = s.points;
    if (pts.LD_INICIO_OAE && pts.LE_INICIO_OAE && pts.LD_FINAL_OAE && pts.LE_FINAL_OAE) {
      s.analysis = _analyzeMedidasStructure(pts);
      completedCount++;
      if (!s.lookupsStarted) {
        s.lookupsStarted = true;
        _startMedidasLdInicioLookups(s);
      }
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

// DNIT's localizarkm endpoint also returns "br", "uf" and "versao" (Versão
// SNV) alongside "km" (see extractDnitKm's comment in 08-kml.js for the
// full response shape) -- pulled out the same tolerant way in case casing
// varies between records. Its "id_trecho" field (which looked like it
// might be the Código SNV) comes back as an empty string in practice, so
// it's normalized to null here and the real Código SNV is fetched
// separately from a different source (see _fetchCodigoSnv below).
function _extractDnitBrUf(data) {
  const rec = Array.isArray(data) ? data[0] : data;
  if (!rec || typeof rec !== 'object') return { br: null, uf: null, codigoSnv: null, versaoSnv: null };
  const br = rec.br ?? rec.BR ?? rec.Br ?? null;
  const uf = rec.uf ?? rec.UF ?? rec.Uf ?? null;
  const rawCodigo = rec.id_trecho ?? rec.Id_Trecho ?? rec.ID_TRECHO ?? rec.codigo_snv ?? rec.Codigo_SNV ?? null;
  const codigoSnv = rawCodigo != null && String(rawCodigo).trim() !== '' ? rawCodigo : null;
  const versaoSnv = rec.versao ?? rec.Versao ?? rec.VERSAO ?? rec.versao_snv ?? rec.Versao_SNV ?? null;
  return { br, uf, codigoSnv, versaoSnv };
}

// O localizarkm da DNIT não traz o Código SNV de verdade (campo id_trecho
// vazio -- confirmado no console em 2026-08). Esta camada pública, um
// espelho da malha rodoviária oficial da DNIT mantido pelo IBAMA/PAMGIA,
// tem o campo "codigo_snv" de verdade. É um servidor ArcGIS completamente
// separado do resto do app -- se sair do ar ou bloquear CORS para o
// domínio do site, isso é pego pelo try/catch do chamador e não derruba
// BR/UF/km, que já vieram do localizarkm.
const DNIT_SNV_LAYER_URL = 'https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/tra_trecho_rodoviario_principal_l/FeatureServer/23/query';

async function _fetchCodigoSnv(lat, lng) {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: '500', // metros -- a geometria da via raramente passa exatamente no ponto do GPS
    units: 'esriSRUnit_Meter',
    outFields: 'codigo_snv',
    returnGeometry: 'false',
    f: 'json'
  });
  const res = await fetch(`${DNIT_SNV_LAYER_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const feat = data && Array.isArray(data.features) ? data.features[0] : null;
  const codigo = feat && feat.attributes ? feat.attributes.codigo_snv : null;
  return codigo != null && String(codigo).trim() !== '' ? String(codigo).trim() : null;
}

// Same two lookups shown in the LD_INICIO_OAE marker popup for a dropped
// KML (see runDnitLookupForLayer / runEpocaLookupForLayer in 08-kml.js),
// reusing those global helper functions directly instead of duplicating
// the fetch/CSV logic -- just without a Leaflet layer+popup to write into,
// so the result is stored on the structure and the sidebar list re-renders
// once each promise resolves.
// Turns the CSV's raw "SETEMBRO-OUTUBRO-NOVEMBRO" into a readable
// "Setembro, Outubro, Novembro" -- just the months, no station name/distance.
function _formatPeriodoMonths(periodo) {
  if (!periodo) return 'dados indisponíveis';
  return String(periodo)
    .split('-')
    .map(m => m.trim())
    .filter(Boolean)
    .map(m => m.charAt(0) + m.slice(1).toLowerCase())
    .join(', ');
}

async function _startMedidasLdInicioLookups(s) {
  const ld = s.points.LD_INICIO_OAE;
  if (!ld) return;

  (async () => {
    try {
      const dateStr = getTodayDnitDateParam();
      const url = `https://servicos.dnit.gov.br/sgplan/apigeo/rotas/localizarkm?lng=${ld.lng}&lat=${ld.lat}&r=250&data=${dateStr}`;
      const res = await fetch(url);
      let data = null;
      try { data = await res.json(); } catch (_) { data = await res.text().catch(() => null); }
      const km = extractDnitKm(data);
      s.dnitKm = km != null ? km : (data ? JSON.stringify(data).slice(0, 80) : '—');
      const { br, uf, codigoSnv, versaoSnv } = _extractDnitBrUf(data);
      s.dnitBr = br != null ? String(br) : '—';
      s.dnitUf = uf != null ? String(uf) : '—';
      s.dnitSnvVersao = versaoSnv != null ? String(versaoSnv) : '—';

      // Consulta separada -- ver comentário de _fetchCodigoSnv. Erro aqui
      // (fora do ar, CORS) não deve apagar BR/UF/km que já vieram acima.
      try {
        const codigoFromLayer = await _fetchCodigoSnv(ld.lat, ld.lng);
        s.dnitSnvCodigo = codigoFromLayer != null ? codigoFromLayer : (codigoSnv != null ? String(codigoSnv) : '—');
      } catch (snvErr) {
        console.warn('Código SNV (camada IBAMA/PAMGIA) lookup failed:', snvErr);
        s.dnitSnvCodigo = codigoSnv != null ? String(codigoSnv) : '—';
      }
    } catch (err) {
      console.error('DNIT localizarkm lookup (medidas) failed:', err);
      s.dnitKm = 'erro na consulta';
      s.dnitBr = 'erro na consulta';
      s.dnitUf = 'erro na consulta';
      s.dnitSnvCodigo = 'erro na consulta';
      s.dnitSnvVersao = 'erro na consulta';
    }
    _renderMedidasList();
    // Only makes sense once we know which BR the structure is on.
    _startMedidasCidadesLookup(s);
  })();

  (async () => {
    await loadEstacoesCsv();
    const nearest = findNearestEstacao(ld.lat, ld.lng);
    // Just the months (e.g. "Setembro, Outubro, Novembro") -- the station
    // name/distance used to be shown alongside but that's not wanted here.
    s.melhorEpoca = nearest ? _formatPeriodoMonths(nearest.periodo) : 'dados indisponíveis';
    _renderMedidasList();
  })();
}

// ─── CIDADE ANTES / CIDADE DEPOIS ──────────────────────────────────────────
// Nearest place along the *same* federal highway the structure is on, one
// in each direction of travel.
//
// This used to be a single two-stage Overpass query (find the BR's ways,
// then find cities/towns near THAT specific set via "around.brways") --
// dropped because that set-based syntax is harder to get exactly right and
// gave zero results in practice. Replaced with two independent, simple
// queries (each an extremely common, well-tested Overpass shape) combined
// client-side instead:
//   1. every settlement (city/town/village -- village included because
//      that's how OSM tags a lot of small Brazilian towns, especially in
//      rural stretches) within a generous radius of the structure;
//   2. the BR's own way geometry within that same radius.
// A settlement only counts as "on this BR" if it falls within
// CIDADE_MATCH_RADIUS_M of that geometry -- if that check finds nothing
// (e.g. the BR fetch came back empty), it falls back to the plain
// nearest-in-that-direction settlement rather than showing nothing at all.
const CIDADE_SEARCH_RADIUS_M      = 80000;  // generous -- rural BR stretches can be sparse
const CIDADE_WIDE_SEARCH_RADIUS_M = 250000; // 2ª tentativa, ao longo da mesma BR, quando nada no raio normal atinge CIDADE_MIN_POPULATION
const CIDADE_MATCH_RADIUS_M       = 8000;   // how close to the BR geometry a place still counts as "on it"
const CIDADE_MIN_POPULATION       = 10000;  // Antes/Depois só considera cidades com essa população (tag OSM "population") ou mais

async function _overpassQuery(query) {
  let lastErr = null;
  // Reuses the same two public Overpass mirrors already used for the
  // Rotas tab's road labels (see OVERPASS_ROAD_LABEL_ENDPOINTS in
  // 15-routes.js -- loaded before this file).
  for (const endpoint of OVERPASS_ROAD_LABEL_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      lastErr = err;
      console.warn(`Overpass query failed (${endpoint}):`, err);
    }
  }
  throw lastErr || new Error('Todos os espelhos do Overpass falharam');
}

function _fetchCidadesNear(lat, lng, radiusM) {
  return _overpassQuery(
    `[out:json][timeout:25];node(around:${radiusM},${lat},${lng})["place"~"^(city|town|village)$"];out body;`
  );
}

function _fetchBRWaysNear(lat, lng, digits, radiusM) {
  return _overpassQuery(
    `[out:json][timeout:25];way(around:${radiusM},${lat},${lng})["highway"]["ref"~"BR[-\\s]?0*${digits}\\b",i];out geom;`
  );
}

// Initial great-circle bearing from (lat1,lng1) to (lat2,lng2), in degrees,
// 0 = north, clockwise.
function _bearingBetween(lat1, lng1, lat2, lng2) {
  const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  const dLambda = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function _angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Excludes place names that aren't really an independent city/town --
// e.g. "P.A. Truaru" / "PA Nova Amazônia" are INCRA rural settlement
// projects (Projetos de Assentamento), which OSM sometimes tags as
// place=village even though they're really a district/subdivision of a
// bigger city (Boa Vista, in these cases) rather than their own town.
const CIDADE_NAME_EXCLUDE_RE = /^p\.?\s*a\.?\s/i; // "P.A. " / "PA " prefix

// Extrai a população de um node do OSM (tag "population"), tolerando
// separadores de milhar ("12.345", "12,345"). Retorna null quando a tag
// não existe ou não é um número -- esses lugares nunca contam como
// "cidade grande" (ver _pickCidadesAntesDepois), mesmo se forem a
// candidata mais próxima.
function _cityPopulation(c) {
  const raw = c.tags && c.tags.population;
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

// Splits candidate places into "ahead" (Depois) vs "behind" (Antes)
// relative to the highway's own direction of travel at the structure
// (roadCompassBearing), then keeps the nearest of each. Quando
// minPopulation é informado, ignora qualquer candidata sem população
// conhecida no OSM ou abaixo do mínimo.
function _pickCidadesAntesDepois(cities, structLat, structLng, roadCompassBearing, minPopulation) {
  let antes = null, antesDist = Infinity;
  let depois = null, depoisDist = Infinity;

  cities.forEach(c => {
    if (!c.tags || !c.tags.name || c.lat == null || c.lon == null) return;
    if (CIDADE_NAME_EXCLUDE_RE.test(c.tags.name)) return;
    if (minPopulation != null) {
      const pop = _cityPopulation(c);
      if (pop == null || pop < minPopulation) return;
    }
    const bearingToCity = _bearingBetween(structLat, structLng, c.lat, c.lon);
    const dist = _haversineKm(structLat, structLng, c.lat, c.lon);
    if (_angleDiff(bearingToCity, roadCompassBearing) <= 90) {
      if (dist < depoisDist) { depoisDist = dist; depois = c.tags.name; }
    } else {
      if (dist < antesDist) { antesDist = dist; antes = c.tags.name; }
    }
  });

  return { antes, depois };
}

async function _startMedidasCidadesLookup(s) {
  const ld = s.points.LD_INICIO_OAE;
  const a  = s.analysis;
  if (!ld || !a) return;
  // Soltar o mesmo KML duas vezes disparava a consulta de novo por cima da
  // que ainda estava em andamento, dobrando as chamadas ao Overpass.
  if (s._cidadesPending) return;
  s._cidadesPending = true;

  s.cidadeAntes = 'consultando…';
  s.cidadeDepois = 'consultando…';
  _renderMedidasList();

  try {
    const digits = String(s.dnitBr || '').replace(/\D/g, '');
    // Same UTM-plane-angle -> compass-bearing conversion used elsewhere in
    // this file: anguloEixo is the bridge's own longitudinal axis, which
    // is also the highway's direction of travel at that exact point.
    const roadBearing = (90 - a.anguloEixo + 360) % 360;

    // Busca cidades num raio, filtra pelas que ficam sobre a geometria da
    // própria BR (quando disponível) e cai para a lista sem filtro se essa
    // checagem não achar nada.
    async function candidatesAt(radiusM) {
      const [cities, brWays] = await Promise.all([
        _fetchCidadesNear(ld.lat, ld.lng, radiusM),
        digits ? _fetchBRWaysNear(ld.lat, ld.lng, digits, radiusM).catch(err => {
          console.warn('BR-geometry lookup for Cidade Antes/Depois failed, falling back to unfiltered:', err);
          return [];
        }) : Promise.resolve([])
      ]);
      const matchKm = CIDADE_MATCH_RADIUS_M / 1000;
      const onBR = brWays.length
        ? cities.filter(c => c.lat != null && c.lon != null && brWays.some(w =>
            (w.geometry || []).some(pt => _haversineKm(c.lat, c.lon, pt.lat, pt.lon) <= matchKm)
          ))
        : [];
      return onBR.length ? onBR : cities;
    }

    let { antes, depois } = _pickCidadesAntesDepois(
      await candidatesAt(CIDADE_SEARCH_RADIUS_M), ld.lat, ld.lng, roadBearing, CIDADE_MIN_POPULATION
    );

    // Nenhuma cidade com população >= CIDADE_MIN_POPULATION no raio normal,
    // numa das duas direções -- amplia a busca ao longo da mesma BR antes
    // de desistir, já que o objetivo é sempre indicar uma cidade de
    // referência de porte relevante, não a povoação mais próxima de
    // qualquer tamanho.
    if (antes == null || depois == null) {
      const wide = _pickCidadesAntesDepois(
        await candidatesAt(CIDADE_WIDE_SEARCH_RADIUS_M), ld.lat, ld.lng, roadBearing, CIDADE_MIN_POPULATION
      );
      if (antes == null) antes = wide.antes;
      if (depois == null) depois = wide.depois;
    }

    s.cidadeAntes = antes || 'não encontrada';
    s.cidadeDepois = depois || 'não encontrada';
  } catch (err) {
    console.error('Cidade Antes/Depois lookup failed:', err);
    s.cidadeAntes = 'erro na consulta';
    s.cidadeDepois = 'erro na consulta';
  } finally {
    s._cidadesPending = false;
  }
  _renderMedidasList();
}

// ─── "DATA INSPEÇÃO" (most recent photo date) ──────────────────────────────
// Global to the whole Dados tab, not tied to a specific structure -- pulls
// straight from the same EXIF date fields the Fotos tab's date timeline
// groups by (see buildDateTimeline() in 04-photos.js).
// Usa o mesmo leitor de data da aba Fotos (getPhotoDate, em 13-sorting.js).
// Antes havia uma cópia quase igual aqui, e as duas discordavam em fotos que
// só tinham ModifyDate: a linha do tempo mostrava a foto e a "Data Inspeção"
// ignorava ela.
function _extractPhotoDateValue(p) {
  return getPhotoDate(p);
}

function _updateInspectionDate() {
  const el = document.getElementById('medidasInspectionDate');
  if (!el) return;

  let latest = null;
  photos.forEach(p => {
    const d = _extractPhotoDateValue(p);
    if (d && (!latest || d > latest)) latest = d;
  });

  if (!latest) { el.textContent = '—'; return; }
  const dd = String(latest.getDate()).padStart(2, '0');
  const mm = String(latest.getMonth() + 1).padStart(2, '0');
  el.textContent = `${dd}/${mm}/${latest.getFullYear()}`;
}

// ─── SIDEBAR LIST ───────────────────────────────────────────────────────────
function _medidasCopyBtn(value) {
  const safe = escapeHtml(value);
  return `<button class="medidas-row-copy" data-copy="${safe}" title="Copiar">Copiar</button>`;
}

// label/value row with an optional copy button next to the value -- used
// for the LD_INICIO_OAE fields the person actually wants to paste elsewhere
// (LAT, LONG, Altitude Geométrica, BR, UF, Local na Via). No button while
// the value is still an async placeholder ("consultando…") since there's
// nothing useful to copy yet -- it appears once _renderMedidasList() runs
// again with the real value.
function _medidasCopyRow(label, value, pending) {
  const btn = pending ? '' : _medidasCopyBtn(value);
  return `<div class="medidas-row"><span>${label}</span><span class="medidas-row-value"><b>${escapeHtml(value)}</b>${btn}</span></div>`;
}

// LAT/LONG are truncated (not rounded) to a fixed number of decimals --
// rounding the 8th decimal can shift the point by enough to matter when
// pasting into the cadastro, so this cuts the string instead of doing
// arithmetic that could round it up. String-based on purpose: multiplying
// by 1e8 and flooring is exposed to float error right at the boundary
// (e.g. .99999995 landing a hair under the next integer).
function _truncDecimals(num, decimals) {
  const neg = num < 0;
  let str = Math.abs(num).toString();
  if (str.indexOf('e') !== -1 || str.indexOf('E') !== -1) {
    // Extremely small/large values that JS renders in scientific notation
    // -- not expected for lat/lng, but toFixed() as a safe fallback still
    // truncates correctly since expanding the exponent first would be
    // more code than this case is worth.
    str = Number(num).toFixed(decimals + 4);
  }
  const dot = str.indexOf('.');
  let intPart = dot === -1 ? str : str.slice(0, dot);
  let fracPart = dot === -1 ? '' : str.slice(dot + 1);
  fracPart = fracPart.length >= decimals ? fracPart.slice(0, decimals) : fracPart.padEnd(decimals, '0');
  return (neg ? '-' : '') + intPart + '.' + fracPart;
}

function _renderMedidasList() {
  _updateInspectionDate();
  const list  = document.getElementById('medidasList');
  const empty = document.getElementById('medidasEmpty');
  if (!list || !empty) return;

  const keys = Object.keys(MEDIDAS_STRUCTURES).filter(k => MEDIDAS_STRUCTURES[k].analysis);
  empty.style.display = keys.length ? 'none' : '';

  list.innerHTML = keys.map(key => {
    const s = MEDIDAS_STRUCTURES[key];
    const a = s.analysis;
    const pts = s.points;
    const title = s.groupKey || 'Estrutura';
    const ld = pts.LD_INICIO_OAE;

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
        <div class="medidas-card-header">📐 ${escapeHtml(title)}</div>
        <div class="medidas-row"><span>Largura Útil (Efetiva)</span><b>${larguraAjustada.toFixed(2)} m ${larguraExtra}</b></div>
        <div class="medidas-barrier-toggle">
          <button class="medidas-barrier-btn ${s.barrierType === 'NJ' ? 'active' : ''}" data-key="${key}" data-barrier="NJ">Barreira NJ</button>
          <button class="medidas-barrier-btn ${s.barrierType === 'GC' ? 'active' : ''}" data-key="${key}" data-barrier="GC">Guarda Corpo</button>
        </div>
        <div class="medidas-row"><span>Média Comprimento</span><b>${a.mediaComprimento.toFixed(2)} m</b></div>
        <div class="medidas-row"><span>Possui Inclinação</span>${inclBadge}</div>
        <div class="medidas-row"><span>Sentido</span><b>${sentidoIcon} ${a.sentido}</b>${sentidoCm}</div>
        <div class="medidas-row"><span>Esconsidade</span>${esconsaBadge}</div>
        <div class="medidas-subhead">LD_INICIO_OAE</div>
        ${_medidasCopyRow('LAT', _truncDecimals(ld.lat, 8), false)}
        ${_medidasCopyRow('LONG', _truncDecimals(ld.lng, 8), false)}
        ${_medidasCopyRow('Altitude Geométrica', Number(ld.elevation).toFixed(2), false)}
        ${_medidasCopyRow('BR', s.dnitBr != null ? s.dnitBr : 'consultando…', s.dnitBr == null)}
        ${_medidasCopyRow('UF', s.dnitUf != null ? s.dnitUf : 'consultando…', s.dnitUf == null)}
        ${_medidasCopyRow('Local na Via (km)', s.dnitKm != null ? s.dnitKm : 'consultando…', s.dnitKm == null)}
        ${_medidasCopyRow('Código SNV', s.dnitSnvCodigo != null ? s.dnitSnvCodigo : 'consultando…', s.dnitSnvCodigo == null)}
        ${_medidasCopyRow('Versão SNV', s.dnitSnvVersao != null ? s.dnitSnvVersao : 'consultando…', s.dnitSnvVersao == null)}
        <div class="medidas-row"><span>Melhor Época</span><b>${escapeHtml(s.melhorEpoca != null ? s.melhorEpoca : 'calculando…')}</b></div>
        ${_medidasCopyRow('Cidade Antes', s.cidadeAntes != null ? s.cidadeAntes : 'consultando…', s.cidadeAntes == null)}
        ${_medidasCopyRow('Cidade Depois', s.cidadeDepois != null ? s.cidadeDepois : 'consultando…', s.cidadeDepois == null)}
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

  list.querySelectorAll('.medidas-row-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy || '';
      const original = btn.textContent;
      _copyText(text)
        .then(() => {
          btn.classList.add('copied');
          btn.textContent = '✓';
        })
        .catch(err => {
          console.error('Copy failed (medidas):', err);
          btn.classList.add('copy-failed');
          btn.textContent = '✕';
        })
        .finally(() => {
          setTimeout(() => {
            btn.classList.remove('copied', 'copy-failed');
            btn.textContent = original;
          }, 1200);
        });
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
