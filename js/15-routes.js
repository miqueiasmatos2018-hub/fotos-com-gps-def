// ==========================================================================
// 15-routes.js
// "Rotas" tab: two named, colored (red/green) car routes with multiple
// stops. Routes follow real roads via the free OSRM routing engine and are
// editable by dragging the line on the map. Exportable as KML.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// Free, keyless OSRM public demo server. Rate-limited / not for heavy
// production use -- fine for occasional route planning. If this app ever
// needs guaranteed uptime, swap serviceUrl for a self-hosted OSRM instance
// or a paid provider (GraphHopper / ORS); nothing else here needs to change.
const OSRM_SERVICE_URL = 'https://router.project-osrm.org/route/v1';

// ── HIGHWAY CLASSIFICATION ──────────────────────────────────────────────────
// The routes here must stay on federal (BR-xxx) or state (UF-xxx, e.g.
// SP-330, MG-050) highways. IMPORTANT LIMITATION: the free public OSRM demo
// server has no parameter to actually *restrict* routing to only those road
// classes -- that would need a custom-configured routing server, which is
// outside what a keyless/free setup can do. What this DOES do reliably:
// OSRM returns the name/ref of the road used for each turn-by-turn step, so
// after a route is calculated, its steps are checked against known BR-/UF-
// highway numbering and the fraction of the trip's distance that's on a
// recognized highway is computed. That fraction then drives route selection
// (prefer/require routes that stay on highways) and warnings (flag routes
// that can't avoid local roads) throughout this file.
const BR_UF_CODES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const HIGHWAY_REF_RE = new RegExp(`\\b(?:BR|${BR_UF_CODES.join('|')})[-\\s]?\\d{2,4}\\b`, 'i');
const HIGHWAY_FRACTION_MIN = 0.7; // require/prefer at least 70% of distance on BR-/UF- roads

function _isHighwayName(name) {
  return !!(name && HIGHWAY_REF_RE.test(name));
}

// Distance-weighted fraction (0-1) of a raw OSRM route response that runs on
// a recognized federal/state highway, using each turn-by-turn step's own
// road name and distance (steps=true in the request below).
function _highwayFractionFromRoute(osrmRoute) {
  if (!osrmRoute || !osrmRoute.legs) return null;
  let total = 0, onHighway = 0;
  for (const leg of osrmRoute.legs) {
    for (const step of (leg.steps || [])) {
      const dist = step.distance || 0;
      total += dist;
      if (_isHighwayName(step.name)) onHighway += dist;
    }
  }
  return total > 0 ? onHighway / total : null;
}

// Raw OSRM fetch (bypassing the Leaflet Routing Machine control) purely to
// check which roads a set of waypoints would actually use.
async function _fetchOsrmHighwayFraction(points) {
  const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM_SERVICE_URL}/driving/${coordStr}?overview=false&steps=true`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return _highwayFractionFromRoute(data.routes && data.routes[0]);
  } catch (err) {
    console.error('OSRM highway-classification fetch failed:', err);
    return null;
  }
}

// Pulls the highway code (e.g. "BR-174", "RR-342") out of a road name/ref,
// normalised to uppercase with a single hyphen, so "br 174" and "BR-174"
// collapse to the same token.
function _extractHighwayCode(text) {
  if (!text) return null;
  const m = String(text).match(HIGHWAY_REF_RE);
  if (!m) return null;
  return m[0].toUpperCase().replace(/[-\s]+/, '-');
}

// Ordered list of the highways a route travels, in the order they're used —
// e.g. ["BR-174", "RR-342", "RR-203", "BR-174"]. Only *consecutive*
// duplicates are collapsed, so a route that leaves BR-174 and later rejoins
// it correctly shows BR-174 twice (which is the normal shape here, since
// these routes start and end on the same BR).
function _highwaySequenceFromRoute(osrmRoute) {
  if (!osrmRoute || !osrmRoute.legs) return [];
  const seq = [];
  for (const leg of osrmRoute.legs) {
    for (const step of (leg.steps || [])) {
      // OSRM puts the highway designation in `ref` on some roads and only
      // in `name` on others, so check both.
      const code = _extractHighwayCode(step.ref) || _extractHighwayCode(step.name);
      if (!code) continue;
      if (seq.length === 0 || seq[seq.length - 1] !== code) seq.push(code);
    }
  }
  return seq;
}

// Fetches a route and returns both its total distance and the ordered
// sequence of highways it uses, for the exported description.
async function _fetchRouteDescription(points) {
  const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM_SERVICE_URL}/driving/${coordStr}?overview=false&steps=true`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rt = data.routes && data.routes[0];
    if (!rt) return null;
    return {
      distanceKm: rt.distance / 1000,
      highways: _highwaySequenceFromRoute(rt)
    };
  } catch (err) {
    console.error('OSRM route-description fetch failed:', err);
    return null;
  }
}

// Debounced per-route wrapper around the highway check above. Only warns
// when the fraction is genuinely known and below the threshold, and only
// once the route has settled (see the call site in _rebuildRouteControl).
const _highwayCheckDebounced = {
  a: debounce(() => _runHighwayCheck('a'), 700),
  b: debounce(() => _runHighwayCheck('b'), 700)
};

function _scheduleHighwayCheck(key) {
  const fn = _highwayCheckDebounced[key];
  if (fn) fn();
}

async function _runHighwayCheck(key) {
  const r = ROUTES[key];
  if (!r || !r.waypoints || r.waypoints.length < 2) return;
  const frac = await _fetchOsrmHighwayFraction(r.waypoints);
  if (frac == null) return;
  r.highwayFraction = frac;
  if (frac < HIGHWAY_FRACTION_MIN) {
    const pct = Math.round(frac * 100);
    showToast(`⚠ ${_composeRouteName(key)}: apenas <span class="accent">${pct}%</span> do trajeto está em vias federais/estaduais`);
  }
}


//   PREFIX + "_" + <editable middle, optional> + "_" + <distance>KM
// The prefix is fixed per route; the distance suffix is recalculated live
// as the route is drawn/edited.
const ROUTE_NAME_PREFIX = { a: 'ROTA_ALTERNATIVA', b: 'ROTA_ORIGINAL' };

const ROUTES = {
  a: { nameMiddle: '', distanceKm: 0, color: '#ff0000', waypoints: [], control: null, roadCoords: null,
       allRoutes: [], selectedRouteIdx: 0, previewLine: null, highwayFraction: null },
  b: { nameMiddle: '', distanceKm: 0, color: '#00ff00', waypoints: [], control: null, roadCoords: null,
       allRoutes: [], selectedRouteIdx: 0, previewLine: null, highwayFraction: null }
};

function _routeSuffix(key) { return key === 'a' ? 'A' : 'B'; }

// ─── LD_INICIO_OAE REFERENCE POINT (found in a dropped KML) ────────────────────
// Any point whose name contains "LD_INICIO" (same case-insensitive match used
// elsewhere in the app for DNIT lookups / SNV alignment) gets a dedicated
// yellow marker named "LD_INICIO_OAE", tracked here so it travels along with
// the two routes when exported.
const LD_INICIO_COLOR = '#ffff00';
const LD_INICIO_POINTS = []; // { lat, lng } -- not shown on the map, export-only

function _extractLdInicioPointsFromKml(parsedLayer) {
  const found = [];
  parsedLayer.eachLayer(sl => {
    const props = (sl.feature && sl.feature.properties) || {};
    const name = String(props.name || '').toUpperCase();
    if (!name.includes('LD_INICIO')) return;
    const latlng = sl.getLatLng ? sl.getLatLng() : (sl.getBounds ? sl.getBounds().getCenter() : null);
    if (!latlng) return;
    found.push({ lat: latlng.lat, lng: latlng.lng });
  });
  return found;
}

// Called from loadKmlFile() once a dropped KML finishes loading:
//  1. Scans it for any LD_INICIO / LD_INICIO_OAE point and remembers it
//     (not drawn on the map -- only included later in the KML export).
//  2. Uses the KML's filename to auto-fill the editable middle segment of
//     BOTH route names.
function registerRouteKmlDrop(parsedLayer, fileName) {
  const points = _extractLdInicioPointsFromKml(parsedLayer);

  // De-duplicate: dropping the same KML twice (or re-dropping a corrected
  // version) would otherwise stack identical points and emit each of them
  // repeatedly in the exported KML.
  let added = 0;
  for (const p of points) {
    const dup = LD_INICIO_POINTS.some(e =>
      Math.abs(e.lat - p.lat) < 1e-7 && Math.abs(e.lng - p.lng) < 1e-7);
    if (!dup) { LD_INICIO_POINTS.push({ lat: p.lat, lng: p.lng }); added++; }
  }
  if (added) {
    showToast(`📍 <span class="accent">${added}</span> ponto${added > 1 ? 's' : ''} LD_INICIO_OAE identificado${added > 1 ? 's' : ''}`);
  }

  const base = fileName.replace(/\.(kml|kmz)$/i, '');
  ['a', 'b'].forEach(key => {
    ROUTES[key].nameMiddle = base;
    const input = document.getElementById('routeName' + _routeSuffix(key));
    if (input) input.value = base;
  });
}

// Builds the full composed name, e.g. "ROTA_ALTERNATIVA_Desvio_Centro_12.4KM"
// (or "ROTA_ALTERNATIVA_12.4KM" if the editable middle is left blank).
function _composeRouteName(key) {
  const r = ROUTES[key];
  const middle = r.nameMiddle.trim();
  return `${ROUTE_NAME_PREFIX[key]}${middle ? '_' + middle : ''}_${r.distanceKm.toFixed(1)}KM`;
}

// Updates just the "_12.4KM" suffix label next to the editable name field.
function _updateRouteSuffixDisplay(key) {
  const el = document.getElementById('routeNameSuffix' + _routeSuffix(key));
  if (el) el.textContent = `_${ROUTES[key].distanceKm.toFixed(1)}KM`;
}

// ─── BUILD / REBUILD THE ROUTING LINE ──────────────────────────────────────────
function _rebuildRouteControl(key) {
  const r = ROUTES[key];

  if (r.control) {
    map.removeControl(r.control);
    r.control = null;
  }
  if (r.previewLine) {
    map.removeLayer(r.previewLine);
    r.previewLine = null;
  }
  if (r.waypoints.length < 2) {
    r.roadCoords = null;
    r.distanceKm = 0;
    r.allRoutes = [];
    r.selectedRouteIdx = 0;
    _updateRouteSuffixDisplay(key);
    _renderRouteAlternatives(key);
    return;
  }

  r.control = L.Routing.control({
    waypoints: r.waypoints.map(w => L.latLng(w.lat, w.lng)),
    router: L.Routing.osrmv1({ serviceUrl: OSRM_SERVICE_URL, profile: 'driving', alternatives: 3 }),
    lineOptions: {
      styles: [{ color: r.color, weight: 5, opacity: 0.85 }],
      addWaypoints: true // dragging the line inserts a new stop, like My Maps
    },
    routeWhileDragging: true,
    draggableWaypoints: true,
    fitSelectedRoutes: false,
    show: false, // we render our own stop list in the sidebar
    createMarker: (i, wp) => L.marker(wp.latLng, {
      draggable: true,
      icon: L.divIcon({
        className: '',
        html: `<div style="width:20px;height:20px;border-radius:50%;background:${r.color};
          border:2px solid #0a0a0a;box-shadow:0 2px 6px rgba(0,0,0,0.5);
          display:flex;align-items:center;justify-content:center;
          font-family:var(--mono);font-size:10px;font-weight:700;color:#0a0a0a;">${i + 1}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    })
  }).addTo(map);

  r.control.on('waypointschanged', e => {
    r.waypoints = e.waypoints
      .filter(w => w.latLng)
      .map(w => ({ lat: w.latLng.lat, lng: w.latLng.lng }));
    _renderRouteStops(key);
  });

  // OSRM may return more than one way to reach the same stops. We always
  // reset to its top suggestion (index 0) after any recalculation; the
  // sidebar picker below lets the person switch to a different one.
  r.control.on('routesfound', e => {
    r.allRoutes = e.routes || [];
    r.selectedRouteIdx = 0;
    _applySelectedRoute(key);
    _renderRouteAlternatives(key);

    // Best-effort highway check (see the note at the top of this file on
    // why this can only warn, not force the routing engine itself).
    // Debounced: routeWhileDragging makes 'routesfound' fire continuously
    // while a stop is being dragged, and firing an extra OSRM request per
    // frame would hammer the rate-limited public server (and spam toasts).
    _scheduleHighwayCheck(key);
  });

  r.control.on('routingerror', () => {
    showToast(`⚠ Não foi possível calcular <span class="accent">${_composeRouteName(key)}</span> — verifique a conexão`);
  });
}

// Applies whichever alternative is currently selected: updates the road
// geometry / distance used for the name suffix and KML export, and (for
// anything other than OSRM's own top pick, which is already drawn as the
// interactive/draggable line by the routing control itself) draws a dashed
// preview of that alternate path so it's visible on the map too.
function _applySelectedRoute(key) {
  const r = ROUTES[key];

  // Clear any previous dashed preview first -- doing this before the
  // early-return below matters, otherwise a stale preview from a previous
  // selection stays stranded on the map when the new one has no geometry.
  if (r.previewLine) {
    map.removeLayer(r.previewLine);
    r.previewLine = null;
  }

  const chosen = r.allRoutes && r.allRoutes[r.selectedRouteIdx];
  if (!chosen || !chosen.coordinates) return;

  r.roadCoords = chosen.coordinates.map(c => ({ lat: c.lat, lng: c.lng }));
  if (chosen.summary && typeof chosen.summary.totalDistance === 'number') {
    r.distanceKm = chosen.summary.totalDistance / 1000;
    _updateRouteSuffixDisplay(key);
  }

  if (r.selectedRouteIdx !== 0) {
    r.previewLine = L.polyline(
      r.roadCoords.map(c => [c.lat, c.lng]),
      { color: r.color, weight: 4, opacity: 0.55, dashArray: '8 6' }
    ).addTo(map);
  }
}

// Sidebar list of "Opção 1 · 12.4km", "Opção 2 · 13.1km", etc. Only shown
// when OSRM actually returned more than one way to the same stops.
function _renderRouteAlternatives(key) {
  const r = ROUTES[key];
  const wrap = document.getElementById('routeAlternatives' + _routeSuffix(key));
  if (!wrap) return;

  if (!r.allRoutes || r.allRoutes.length < 2) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  wrap.style.display = '';
  wrap.innerHTML = r.allRoutes.map((rt, i) => {
    const km = rt.summary && typeof rt.summary.totalDistance === 'number'
      ? (rt.summary.totalDistance / 1000).toFixed(1) : '?';
    const active = i === r.selectedRouteIdx;
    return `<button class="route-alt-btn ${active ? 'active' : ''}" data-idx="${i}">Opção ${i + 1} · ${km}km</button>`;
  }).join('');

  wrap.querySelectorAll('.route-alt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      r.selectedRouteIdx = Number(btn.dataset.idx);
      _applySelectedRoute(key);
      _renderRouteAlternatives(key);
    });
  });
}

// "🔀" toolbar button — cycles to the next way OSRM found to reach the same
// stops (wrapping back to the first once you've seen them all). Reuses the
// same apply/preview logic as clicking an option in the alternatives list.
window.suggestAlternateRoute = function(key) {
  const r = ROUTES[key];
  if (!r.waypoints || r.waypoints.length < 2) {
    showToast('Adicione ao menos 2 paradas para sugerir uma rota');
    return;
  }
  if (!r.allRoutes || r.allRoutes.length < 2) {
    showToast(`Nenhuma rota alternativa encontrada para <span class="accent">${_composeRouteName(key)}</span>`);
    return;
  }
  r.selectedRouteIdx = (r.selectedRouteIdx + 1) % r.allRoutes.length;
  _applySelectedRoute(key);
  _renderRouteAlternatives(key);
  showToast(`${_composeRouteName(key)} — <span class="accent">opção ${r.selectedRouteIdx + 1} de ${r.allRoutes.length}</span>`);
};

// How much of one route's path physically coincides with another's, used to
// judge whether an "alternative" actually takes different roads or just
// happens to be listed second by OSRM while mostly retracing the same
// streets. Samples points along routeA and checks, for each, whether a
// point on routeB lies within `thresholdKm` of it -- the fraction that do
// is the overlap. Sampling (not every point) keeps this fast even for long
// routes with thousands of coordinates.
function _sampleCoords(coords, maxSamples) {
  if (coords.length <= maxSamples) return coords;
  const step = coords.length / maxSamples;
  const out = [];
  for (let i = 0; i < maxSamples; i++) out.push(coords[Math.floor(i * step)]);
  return out;
}

function _routeOverlapFraction(coordsA, coordsB, thresholdKm) {
  if (!coordsA.length || !coordsB.length) return 0;
  const sampleA = _sampleCoords(coordsA, 60);
  const sampleB = _sampleCoords(coordsB, 200);
  let close = 0;
  for (const pa of sampleA) {
    let minD = Infinity;
    for (const pb of sampleB) {
      const d = _haversineKm(pa.lat, pa.lng, pb.lat, pb.lng);
      if (d < minD) minD = d;
      if (minD < thresholdKm) break; // already close enough, stop early
    }
    if (minD < thresholdKm) close++;
  }
  return close / sampleA.length;
}

// "🟢→🔴" toolbar button on the red route panel — forces a genuine detour
// between the FIRST and LAST point of the green route (not its intermediate
// stops, and not just asking OSRM for "alternatives").
//
// OSRM's built-in alternatives feature turned out to not be enough here: for
// a route spanning any real distance, it usually only offers minor local
// variations (a different street for a few blocks), not a route through a
// different area entirely -- which is what an actual detour needs to be
// useful if part of the green road is blocked or impassable.
//
// So instead, this tries routing through an artificial via-point offset to
// one side of the direct line between start and end, at a few different
// distances and on both sides, actually forcing the road network to be
// searched elsewhere. Each candidate's real road geometry is compared
// against green's actual path (not just its waypoints) to measure how much
// they truly overlap; whichever candidate diverges enough from green (and
// among those, is shortest) becomes the new red route -- as a normal
// 3-stop route (start, the detour via-point, end) that can still be
// dragged/edited like any other.
const ROUTE_OVERLAP_THRESHOLD_KM = 0.15; // ~150m: closer than this counts as "same road"
const ROUTE_DIFFERENT_ENOUGH = 0.1;      // less than 10% of the path may overlap with green

function _perpendicularOffsetPoint(first, last, offsetKm, side) {
  const midLat = (first.lat + last.lat) / 2;
  const midLng = (first.lng + last.lng) / 2;
  const dLat = last.lat - first.lat;
  const dLng = last.lng - first.lng;
  const len = Math.sqrt(dLat * dLat + dLng * dLng) || 1e-9;
  const perpLat = -dLng / len;
  const perpLng =  dLat / len;
  const kmPerDegLat = 111.0;
  const kmPerDegLng = 111.0 * Math.cos(midLat * Math.PI / 180) || 1e-9;
  return {
    lat: midLat + side * perpLat * (offsetKm / kmPerDegLat),
    lng: midLng + side * perpLng * (offsetKm / kmPerDegLng)
  };
}

async function _fetchOsrmRoute(points) {
  const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM_SERVICE_URL}/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) return null;
    const rt = data.routes[0];
    return {
      coords: rt.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] })), // geojson is [lng,lat]
      distanceKm: rt.distance / 1000,
      highwayFraction: _highwayFractionFromRoute(rt) // reuses the same response, no extra request
    };
  } catch (err) {
    console.error('OSRM detour route fetch failed:', err);
    return null;
  }
}

window.useGreenRoutePoints = async function() {
  const src = ROUTES.b; // green / Rota Original
  const dst = ROUTES.a; // red   / Rota Alternativa
  if (!src.waypoints || src.waypoints.length < 2) {
    showToast('Defina ao menos o início e o fim da Rota Original (verde) primeiro');
    return;
  }
  const greenCoords = src.roadCoords; // green's actual resolved road geometry
  if (!greenCoords || greenCoords.length < 2) {
    showToast('Aguarde a Rota Original terminar de calcular antes de pedir um desvio');
    return;
  }
  if (_routePickingKey) window.toggleRoutePicking(_routePickingKey);

  const first = src.waypoints[0];
  const last  = src.waypoints[src.waypoints.length - 1];
  const straightKm = _haversineKm(first.lat, first.lng, last.lat, last.lng);

  showToast('🔎 Procurando um desvio por vias estaduais/federais…');

  // Ranks a candidate by two requirements together: does it genuinely
  // diverge from green's road, AND does it stay mostly on recognized
  // federal/state highways. 0 = meets both (best), 3 = meets neither.
  function _candidateTier(c) {
    const diverges  = c.overlap < ROUTE_DIFFERENT_ENOUGH;
    const onHighway = c.highwayFraction == null || c.highwayFraction >= HIGHWAY_FRACTION_MIN;
    if (diverges && onHighway) return 0;
    if (diverges) return 1;
    if (onHighway) return 2;
    return 3;
  }

  // Try progressively wider detours, on both sides of the direct line,
  // until one both clears far enough away from green's road AND stays on
  // federal/state highways.
  const offsetFractions = [0.25, 0.45, 0.7, 1.0];
  let best = null;

  for (const frac of offsetFractions) {
    const offsetKm = Math.max(straightKm * frac, 5); // never less than a 5km push
    for (const side of [1, -1]) {
      const via = _perpendicularOffsetPoint(first, last, offsetKm, side);
      const result = await _fetchOsrmRoute([first, via, last]);
      if (!result) continue;

      const overlap = _routeOverlapFraction(result.coords, greenCoords, ROUTE_OVERLAP_THRESHOLD_KM);
      const candidate = {
        via, coords: result.coords, distanceKm: result.distanceKm,
        overlap, highwayFraction: result.highwayFraction
      };

      if (!best) { best = candidate; continue; }
      const candTier = _candidateTier(candidate);
      const bestTier = _candidateTier(best);
      if (candTier < bestTier) best = candidate;
      else if (candTier === bestTier && candidate.distanceKm < best.distanceKm) best = candidate;
    }
    // Stop widening the search as soon as a fully-qualifying detour (tier 0)
    // is found — no need to push further out than needed.
    if (best && _candidateTier(best) === 0) break;
  }

  if (!best) {
    showToast('⚠ Não foi possível calcular um desvio (sem conexão com o serviço de rotas?)');
    return;
  }

  dst.waypoints = [
    { lat: first.lat, lng: first.lng },
    { lat: best.via.lat, lng: best.via.lng },
    { lat: last.lat, lng: last.lng }
  ];
  _rebuildRouteControl('a');
  _renderRouteStops('a');

  const pct = Math.round((1 - best.overlap) * 100);
  const hwPct = best.highwayFraction != null ? Math.round(best.highwayFraction * 100) : null;
  const tier = _candidateTier(best);
  if (tier === 0) {
    showToast(`Desvio encontrado — <span class="accent">${pct}%</span> diferente${hwPct != null ? `, ${hwPct}% em vias estaduais/federais` : ''} (${best.distanceKm.toFixed(1)}km)`);
  } else if (tier === 1) {
    showToast(`⚠ Desvio ${pct}% diferente, mas só <span class="accent">${hwPct}%</span> do trajeto está em vias estaduais/federais`);
  } else if (tier === 2) {
    showToast(`⚠ Desvio majoritariamente em vias estaduais/federais, mas pouco diferente da Rota Original (${pct}%)`);
  } else {
    showToast('⚠ Nenhum desvio ideal encontrado — usando o mais próximo disponível');
  }
};

// ─── SIDEBAR STOP LIST ──────────────────────────────────────────────────────────
function _renderRouteStops(key) {
  const r = ROUTES[key];
  const sfx = _routeSuffix(key);
  const list  = document.getElementById('routeStopsList' + sfx);
  const empty = document.getElementById('routeStopsEmpty' + sfx);
  if (!list || !empty) return;

  empty.style.display = r.waypoints.length ? 'none' : '';
  list.innerHTML = r.waypoints.map((w, i) => `
    <div class="route-stop-item" data-idx="${i}">
      <span class="route-stop-num" style="background:${r.color}">${i + 1}</span>
      <div class="route-stop-coords">${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}</div>
      <button class="route-stop-move" data-dir="up"   title="Mover para cima"   ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="route-stop-move" data-dir="down" title="Mover para baixo" ${i === r.waypoints.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="route-stop-delete" title="Remover parada">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.route-stop-item').forEach(item => {
    const idx = Number(item.dataset.idx);
    item.querySelector('.route-stop-delete').addEventListener('click', () => {
      r.waypoints.splice(idx, 1);
      _rebuildRouteControl(key);
      _renderRouteStops(key);
    });
    item.querySelectorAll('.route-stop-move').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir === 'up' ? -1 : 1;
        const j = idx + dir;
        if (j < 0 || j >= r.waypoints.length) return;
        [r.waypoints[idx], r.waypoints[j]] = [r.waypoints[j], r.waypoints[idx]];
        _rebuildRouteControl(key);
        _renderRouteStops(key);
      });
    });
    item.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const w = r.waypoints[idx];
      map.setView([w.lat, w.lng], Math.max(map.getZoom(), 15), { animate: true });
    });
  });
}

// ─── RENAME (editable middle segment only — prefix/suffix are fixed/computed) ──
window.renameRoute = function(key, value) {
  ROUTES[key].nameMiddle = value;
};

// ─── CLEAR ──────────────────────────────────────────────────────────────────────
window.clearRoute = function(key) {
  if (_routePickingKey === key) window.toggleRoutePicking(key);
  const r = ROUTES[key];
  const label = _composeRouteName(key);
  if (r.control) { map.removeControl(r.control); r.control = null; }
  if (r.previewLine) { map.removeLayer(r.previewLine); r.previewLine = null; }
  r.waypoints  = [];
  r.roadCoords = null;
  r.distanceKm = 0;
  r.allRoutes = [];
  r.selectedRouteIdx = 0;
  r.highwayFraction = null;
  _updateRouteSuffixDisplay(key);
  _renderRouteStops(key);
  _renderRouteAlternatives(key);
  showToast(`${label} <span class="accent">limpa</span>`);
};

// ─── CLICK-MAP-TO-ADD-STOP ────────────────────────────────────────────────────
let _routePickingKey  = null;
let _routePickingClick = null;
let _routePickingKeydown = null;

window.toggleRoutePicking = function(key) {
  const sfx = _routeSuffix(key);
  const btn    = document.getElementById('btnRouteAdd' + sfx);
  const banner = document.getElementById('pickingBanner');

  // Turning off (either this route's picking, or switching to a different one)
  if (_routePickingKey) {
    map.off('click', _routePickingClick);
    document.removeEventListener('keydown', _routePickingKeydown);
    const prevBtn = document.getElementById('btnRouteAdd' + _routeSuffix(_routePickingKey));
    if (prevBtn) { prevBtn.classList.remove('active'); prevBtn.textContent = '📍 Clicar no mapa'; }
    map.getContainer().style.cursor = '';
    if (banner) banner.classList.remove('show');
    const wasSameRoute = _routePickingKey === key;
    _routePickingKey = null;
    _routePickingClick = null;
    _routePickingKeydown = null;
    if (wasSameRoute) return; // just cancelling — done
  }

  // Don't collide with other picking modes already in the app
  if (typeof _pontoPickingHandler !== 'undefined' && _pontoPickingHandler) window.togglePontoPicking();
  if (typeof _pickingForId !== 'undefined' && _pickingForId) cancelRelocateMode();

  // Start picking for this route
  _routePickingKey = key;
  const r = ROUTES[key];
  if (btn) { btn.classList.add('active'); btn.textContent = '✕ Cancelar'; }
  if (banner) {
    banner.textContent = `📍 Clique no mapa para adicionar parada em ${_composeRouteName(key)} · ESC para cancelar`;
    banner.classList.add('show');
  }
  map.getContainer().style.cursor = 'crosshair';

  _routePickingClick = e => {
    r.waypoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    _rebuildRouteControl(key);
    _renderRouteStops(key);
  };
  _routePickingKeydown = e => { if (e.key === 'Escape') window.toggleRoutePicking(key); };

  map.on('click', _routePickingClick);
  document.addEventListener('keydown', _routePickingKeydown);
};

// ─── KML EXPORT ───────────────────────────────────────────────────────────────
function _escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// KML colors are aabbggrr (alpha first, byte order reversed from #rrggbb).
function _hexToKmlColor(hex, opacity) {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return (a + b + g + r).toLowerCase();
}

window.exportRoutesKML = function() {
  const ready = Object.entries(ROUTES).filter(([, r]) => r.waypoints.length >= 2);
  if (!ready.length && !LD_INICIO_POINTS.length) {
    showToast('Adicione ao menos 2 paradas em uma rota antes de exportar');
    return;
  }

  const routePlacemarks = ready.map(([key, r]) => {
    // Prefer the actual road-snapped geometry; fall back to straight lines
    // between stops if OSRM hasn't resolved yet (still exports something).
    const coords = (r.roadCoords && r.roadCoords.length >= 2) ? r.roadCoords : r.waypoints;
    const coordStr = coords.map(c => `${c.lng},${c.lat},0`).join(' ');
    const kmlColor = _hexToKmlColor(r.color, 1);
    return `  <Placemark>
    <name>${_escapeXml(_composeRouteName(key))}</name>
    <Style><LineStyle><color>${kmlColor}</color><width>4</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
  </Placemark>`;
  }).join('\n');

  const ldPlacemarks = LD_INICIO_POINTS.map(p => `  <Placemark>
    <name>LD_INICIO_OAE</name>
    <Style><IconStyle><color>${_hexToKmlColor(LD_INICIO_COLOR, 1)}</color><scale>1.1</scale></IconStyle></Style>
    <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
  </Placemark>`).join('\n');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
${routePlacemarks}${routePlacemarks && ldPlacemarks ? '\n' : ''}${ldPlacemarks}
</Document>
</kml>
`;

  // Exported filename: ROTA_ALTERNATIVA_<nome do KML solto no mapa>.kml
  // nameMiddle is filled in by registerRouteKmlDrop() when a KML is dropped;
  // if nothing has been dropped yet it falls back to a plain name so the
  // download still works.
  const middle = (ROUTES.a.nameMiddle || '').trim();
  const safeMiddle = middle.replace(/[\\/:*?"<>|]/g, '_'); // strip chars illegal in filenames
  const fileName = safeMiddle ? `ROTA_ALTERNATIVA_${safeMiddle}.kml` : 'ROTA_ALTERNATIVA.kml';

  triggerDownload(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), fileName);
  const parts = [];
  if (ready.length) parts.push(`${ready.length} rota${ready.length > 1 ? 's' : ''}`);
  if (LD_INICIO_POINTS.length) parts.push(`${LD_INICIO_POINTS.length} ponto${LD_INICIO_POINTS.length > 1 ? 's' : ''} LD_INICIO_OAE`);
  showToast(`⬇ <span class="accent">${parts.join(' + ')}</span> exportado(s)`);
};

// ─── TXT REPORT EXPORT ────────────────────────────────────────────────────────
// Exports a plain-text summary: the distance of each route, the difference
// between them, and a description of each route as the ordered sequence of
// highways it travels (e.g. "BR-174; RR-342; RR-203; BR-174").
window.exportRoutesTXT = async function() {
  const a = ROUTES.a; // vermelha / ROTA_ALTERNATIVA
  const b = ROUTES.b; // verde    / ROTA_ORIGINAL

  const haveA = a.waypoints && a.waypoints.length >= 2;
  const haveB = b.waypoints && b.waypoints.length >= 2;
  if (!haveA && !haveB) {
    showToast('Crie ao menos uma rota antes de exportar o relatório');
    return;
  }

  showToast('📝 Gerando relatório…');

  const [descA, descB] = await Promise.all([
    haveA ? _fetchRouteDescription(a.waypoints) : Promise.resolve(null),
    haveB ? _fetchRouteDescription(b.waypoints) : Promise.resolve(null)
  ]);

  // Prefer the freshly-fetched distance; fall back to the one already stored
  // on the route if the request failed, so the report still has numbers.
  const kmA = descA ? descA.distanceKm : (haveA ? a.distanceKm : null);
  const kmB = descB ? descB.distanceKm : (haveB ? b.distanceKm : null);

  const fmtKm  = v => v != null ? `${v.toFixed(1)} KM` : '—';
  const fmtSeq = d => (d && d.highways.length) ? d.highways.join('; ') : '—';

  const lines = [];
  lines.push('RELATORIO DE ROTAS');
  lines.push('='.repeat(60));
  lines.push('');

  if (haveB) {
    lines.push(`${_composeRouteName('b')}`);
    lines.push(`  Extensao...: ${fmtKm(kmB)}`);
    lines.push(`  Trajeto....: ${fmtSeq(descB)}`);
    lines.push('');
  }
  if (haveA) {
    lines.push(`${_composeRouteName('a')}`);
    lines.push(`  Extensao...: ${fmtKm(kmA)}`);
    lines.push(`  Trajeto....: ${fmtSeq(descA)}`);
    lines.push('');
  }

  if (kmA != null && kmB != null) {
    const diff = kmA - kmB;
    const sign = diff >= 0 ? '+' : '-';
    lines.push('-'.repeat(60));
    lines.push(`DIFERENCA: ${sign}${Math.abs(diff).toFixed(1)} KM`);
    lines.push(`  (${_composeRouteName('a')} em relacao a ${_composeRouteName('b')})`);
  } else {
    lines.push('-'.repeat(60));
    lines.push('DIFERENCA: indisponivel (crie as duas rotas para comparar)');
  }
  lines.push('');

  const middle = (a.nameMiddle || b.nameMiddle || '').trim();
  const safeMiddle = middle.replace(/[\\/:*?"<>|]/g, '_');
  const fileName = safeMiddle ? `ROTA_ALTERNATIVA_${safeMiddle}.txt` : 'ROTA_ALTERNATIVA.txt';

  triggerDownload(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), fileName);
  showToast(`⬇ Relatório <span class="accent">${fileName}</span> exportado`);
};
