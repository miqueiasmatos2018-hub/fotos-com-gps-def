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
    _updateRouteResults();
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

    // Keep the TRAJETO: / DIFERENÇA (KM): rows current too (same debounce
    // reasoning as above).
    _scheduleRouteResultsUpdate();
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
    const offsetKm = Math.max(straightKm * frac, 5); // nunca menos que 5km de desvio
    // Os dois lados eram consultados um depois do outro: até 8 idas ao OSRM
    // em série. Em paralelo o tempo de espera cai praticamente à metade.
    const sides = [1, -1].map(side => {
      const via = _perpendicularOffsetPoint(first, last, offsetKm, side);
      return _fetchOsrmRoute([first, via, last]).then(result => (result ? { via, result } : null));
    });
    const settled = await Promise.all(sides);

    for (const entry of settled) {
      if (!entry) continue;
      const { via, result } = entry;
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
  _updateRouteResults();
  showToast(`${label} <span class="accent">limpa</span>`);
};

// ─── PROXIMITY-BASED STOP INSERTION ────────────────────────────────────────────
// When a new stop is added by clicking the map, insert it wherever along the
// existing sequence it adds the least extra distance -- rather than always
// tacking it onto the end -- so a point dropped near the middle of a route
// lands between the two stops it's actually between, keeping the route in a
// sensible driving order without the person having to manually reorder it
// afterward (via the ▲▼ buttons in the stop list).
function _insertWaypointByProximity(waypoints, point) {
  // Nothing to compare against yet -- just append.
  if (waypoints.length < 2) {
    waypoints.push(point);
    return;
  }

  const first = waypoints[0];
  const last  = waypoints[waypoints.length - 1];

  // Extending the route before the first stop or after the last one only
  // adds the one new leg (no existing leg is being replaced).
  let bestIdx  = 0;
  let bestCost = _haversineKm(point.lat, point.lng, first.lat, first.lng);

  const appendCost = _haversineKm(last.lat, last.lng, point.lat, point.lng);
  if (appendCost < bestCost) { bestCost = appendCost; bestIdx = waypoints.length; }

  // Inserting between two existing consecutive stops replaces their direct
  // leg with two legs via the new point -- the extra distance that costs is
  // what actually measures "does this point belong between these two".
  for (let i = 0; i < waypoints.length - 1; i++) {
    const w1 = waypoints[i], w2 = waypoints[i + 1];
    const direct = _haversineKm(w1.lat, w1.lng, w2.lat, w2.lng);
    const viaPoint = _haversineKm(w1.lat, w1.lng, point.lat, point.lng) +
                      _haversineKm(point.lat, point.lng, w2.lat, w2.lng);
    const cost = viaPoint - direct;
    if (cost < bestCost) { bestCost = cost; bestIdx = i + 1; }
  }

  waypoints.splice(bestIdx, 0, point);
}

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
    _insertWaypointByProximity(r.waypoints, { lat: e.latlng.lat, lng: e.latlng.lng });
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

// ─── STATIC ROUTE IMAGE (JPG) ──────────────────────────────────────────────
// Composes a single satellite-imagery JPG with both routes, the
// LD_INICIO_OAE marker, a title block, a legend, a north arrow and a scale
// bar -- modeled after the Google Earth Pro-style export the person already
// uses (see the reference image they shared).
//
// Uses Esri's public World_Imagery export service instead of the app's own
// Google satellite tiles: Google's tile server doesn't send CORS headers,
// which would leave the canvas "tainted" and block canvas.toBlob() with a
// SecurityError. Esri's ArcGIS Online export endpoint does allow anonymous
// cross-origin reads, which is what makes drawing it into a canvas (and
// then exporting that canvas as a JPG) possible at all client-side.
const ROUTE_IMAGE_WIDTH = 2000;
const ROUTE_IMAGE_HEIGHT = 1250; // ~16:10, matching the reference export's proportions
const ROUTE_IMAGE_PADDING_FRACTION = 0.12; // breathing room around the routes/marker
const ESRI_WORLD_IMAGERY_EXPORT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
// Road tracing + labels (BR-xxx, RR-xxx...) are drawn ourselves from OSM
// data (via Overpass) instead of using Esri's Reference/World_Transportation
// raster overlay: that overlay is a pre-rendered cartographic layer whose
// label size is baked into the image at whatever real-world scale the
// requested bbox implies -- so for a route spanning 150km+, the labels
// come out tiny no matter how high a "dpi" is requested (dpi doesn't undo
// that; it's a cached/tiled service, not a service that re-symbolizes on
// demand). Drawing the labels ourselves as fixed-pixel-size text keeps
// them exactly as legible as the LD_INICIO_OAE label or the legend text,
// regardless of how much real-world distance the frame covers -- the same
// "same size at any zoom" property already true of the app's own map.
const OVERPASS_ROAD_LABEL_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const ROAD_LABEL_MIN_SPACING_PX = 260; // per ref, so a long highway gets repeated labels, not a cluster

// Spherical Web Mercator (EPSG:3857) -- the projection both Esri's and
// Google's tile services use, so projecting our own lat/lng points into it
// lines them up correctly with the fetched satellite image.
function _lngLatToMercatorXY(lng, lat) {
  const R = 6378137;
  const x = lng * Math.PI / 180 * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  return { x, y };
}

function _mercatorYToLat(y) {
  const R = 6378137;
  return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
}

function _mercatorXToLng(x) {
  const R = 6378137;
  return x / R * 180 / Math.PI;
}

// Fetches OSM ways carrying a route-number ref inside the given (Mercator)
// bbox -- the raw material for drawing our own road tracing + labels.
// No highway-class restriction here anymore (motorway/primary/secondary
// only ended up excluding real state highways that OSM happens to tag as
// tertiary/unclassified in this region) -- classification turned out to be
// an unreliable way to tell "federal/state" from "municipal/vicinal"
// apart. The actual filter is proximity to the routes themselves, applied
// afterward in _filterRoadWaysNearRoute(): a road is only federal/state
// *and relevant* here if the trip's own route actually runs along it.
// Tries a second Overpass mirror if the first one fails/times out.
async function _fetchRoadRefWaysInBBox(bbox) {
  const south = _mercatorYToLat(bbox.ymin);
  const north = _mercatorYToLat(bbox.ymax);
  const west = _mercatorXToLng(bbox.xmin);
  const east = _mercatorXToLng(bbox.xmax);
  const query = `[out:json][timeout:25];way(${south},${west},${north},${east})[highway][ref];out tags geom;`;

  let lastErr = null;
  for (const endpoint of OVERPASS_ROAD_LABEL_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ways = data.elements || [];
      // Keep only refs that actually look like a Brazilian federal/state
      // route number (e.g. "BR-174", "RR-203") -- filters out things like
      // a local road's own name or a cycle-route ref sharing the `ref` tag.
      return ways.filter(w => w.tags && /^[A-Z]{2,3}-?\s?\d/.test(String(w.tags.ref || '').trim()));
    } catch (err) {
      lastErr = err;
      console.warn(`Overpass road lookup failed (${endpoint}):`, err);
    }
  }
  throw lastErr || new Error('Todos os espelhos do Overpass falharam');
}

const ROAD_NEAR_ROUTE_THRESHOLD_KM = 0.1; // ~100m -- generous enough for OSM/OSRM alignment slack, tight enough to exclude a parallel road
const ROAD_NEAR_ROUTE_GRID_CELL_DEG = 0.001; // ~110m cells -- close to the threshold itself

// Buckets route points into a lat/lng grid so "is there a route point near
// (lat,lng)" is a lookup in ~9 cells instead of a scan of every route point.
function _buildRouteProximityGrid(routePts) {
  const grid = new Map();
  routePts.forEach(p => {
    const key = `${Math.floor(p.lat / ROAD_NEAR_ROUTE_GRID_CELL_DEG)},${Math.floor(p.lng / ROAD_NEAR_ROUTE_GRID_CELL_DEG)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  });
  return grid;
}

function _isPointNearRoute(grid, lat, lng) {
  const cellLat = Math.floor(lat / ROAD_NEAR_ROUTE_GRID_CELL_DEG);
  const cellLng = Math.floor(lng / ROAD_NEAR_ROUTE_GRID_CELL_DEG);
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const pts = grid.get(`${cellLat + dLat},${cellLng + dLng}`);
      if (!pts) continue;
      for (const p of pts) {
        if (_haversineKm(lat, lng, p.lat, p.lng) <= ROAD_NEAR_ROUTE_THRESHOLD_KM) return true;
      }
    }
  }
  return false;
}

// Splits a way's geometry into the contiguous sub-segments that actually
// run near the route, dropping the rest. This is the fix for a whole way
// getting pulled in just because it *crosses* the route at one point (a
// perpendicular side road sharing one node with the route, but running off
// on its own for kilometres in either direction) -- only the portion of
// the way that genuinely runs alongside the route is kept, so its label
// and line no longer end up on an unrelated stretch of a crossing road.
// Segments of a single touching point (length 1) are discarded.
function _extractNearRouteSegments(way, grid) {
  if (!way.geometry || way.geometry.length < 2) return [];
  const segments = [];
  let current = null;
  way.geometry.forEach(pt => {
    if (_isPointNearRoute(grid, pt.lat, pt.lon)) {
      if (!current) current = [];
      current.push(pt);
    } else if (current) {
      segments.push(current);
      current = null;
    }
  });
  if (current) segments.push(current);
  return segments.filter(seg => seg.length >= 2);
}

// Replaces every way with just its near-route segments (see above), and
// drops ways left with none -- the real "federal/state, not
// municipal/vicinal" filter: if the trip's own route (which already
// follows the real road network) runs along a given road, that road is
// relevant regardless of how OSM happens to classify it. Returns
// {tags, segments} pairs ready for drawing, not raw OSM ways.
function _filterRoadWaysNearRoute(ways, routePts) {
  if (!routePts.length) return [];
  const grid = _buildRouteProximityGrid(routePts);
  const result = [];
  ways.forEach(way => {
    const segments = _extractNearRouteSegments(way, grid);
    if (segments.length) result.push({ tags: way.tags, segments });
  });
  return result;
}

// Bounding box (in EPSG:3857 metres) that fits every given {lat,lng} point,
// padded, then stretched to the export's aspect ratio so the satellite
// image isn't distorted.
function _computeMercatorBBoxForImage(points) {
  const merc = points.map(p => _lngLatToMercatorXY(p.lng, p.lat));
  let xmin = Math.min(...merc.map(m => m.x));
  let xmax = Math.max(...merc.map(m => m.x));
  let ymin = Math.min(...merc.map(m => m.y));
  let ymax = Math.max(...merc.map(m => m.y));

  // Guards against a degenerate span (e.g. a single point, or a route
  // running near-perfectly north-south/east-west) so the padding/aspect
  // math below never divides by ~0.
  const MIN_SPAN_M = 300;
  if (xmax - xmin < MIN_SPAN_M) { const cx = (xmin + xmax) / 2; xmin = cx - MIN_SPAN_M / 2; xmax = cx + MIN_SPAN_M / 2; }
  if (ymax - ymin < MIN_SPAN_M) { const cy = (ymin + ymax) / 2; ymin = cy - MIN_SPAN_M / 2; ymax = cy + MIN_SPAN_M / 2; }

  const padX = (xmax - xmin) * ROUTE_IMAGE_PADDING_FRACTION;
  const padY = (ymax - ymin) * ROUTE_IMAGE_PADDING_FRACTION;
  xmin -= padX; xmax += padX; ymin -= padY; ymax += padY;

  const targetRatio = ROUTE_IMAGE_WIDTH / ROUTE_IMAGE_HEIGHT;
  const curRatio = (xmax - xmin) / (ymax - ymin);
  if (curRatio > targetRatio) {
    const newH = (xmax - xmin) / targetRatio;
    const cy = (ymin + ymax) / 2;
    ymin = cy - newH / 2; ymax = cy + newH / 2;
  } else {
    const newW = (ymax - ymin) * targetRatio;
    const cx = (xmin + xmax) / 2;
    xmin = cx - newW / 2; xmax = cx + newW / 2;
  }

  return { xmin, ymin, xmax, ymax };
}

async function _fetchEsriMapImage(serviceUrl, bbox, width, height, extraParams) {
  const params = new URLSearchParams(Object.assign({
    bbox: `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${width},${height}`,
    format: 'jpg',
    f: 'image'
  }, extraParams || {}));
  const res = await fetch(`${serviceUrl}?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Falha ao decodificar a imagem'));
      img.src = objUrl;
    });
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

// All the decorative overlay functions below were tuned by eye at
// 1600x1000; this scales their fixed pixel sizes (fonts, padding, icon
// radii...) proportionally at other output sizes so the layout keeps the
// same proportions instead of shrinking relative to the image as
// ROUTE_IMAGE_WIDTH changes.
const ROUTE_IMAGE_UI_SCALE = ROUTE_IMAGE_WIDTH / 1600;

function _drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Simple map-pin shape (triangular tail + circular head), anchored so
// (x, y) is the exact ground point -- matches the "pushpin" marker style
// used for LD_INICIO_OAE in the reference export.
function _drawPinMarker(ctx, x, y, colorHex) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const r = 8 * s, tail = 11 * s;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - r * 0.6, y - tail);
  ctx.lineTo(x + r * 0.6, y - tail);
  ctx.closePath();
  ctx.fillStyle = colorHex;
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = '#000';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y - tail, r, 0, Math.PI * 2);
  ctx.fillStyle = colorHex;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y - tail, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

function _drawRouteImageLabel(ctx, x, y, text) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const fontSize = 13 * s, padX = 6 * s, padY = 3 * s;
  ctx.font = `${fontSize}px sans-serif`;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontSize + padY * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  _drawRoundedRect(ctx, x, y - h / 2, w, h, 3 * s);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y);
}

// Highway "shield" pill, e.g. "BR-174" / "RR-203" -- fixed pixel font size
// (scaled only by ROUTE_IMAGE_UI_SCALE, never by real-world distance), so
// it stays exactly as legible whether the frame covers 30km or 300km.
// Centered on (x, y), matching where a road-name pill sits on the road
// itself in the reference export.
function _drawRoadRefLabel(ctx, x, y, text) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const fontSize = 15 * s, padX = 7 * s, padY = 4 * s;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontSize + padY * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  _drawRoundedRect(ctx, x - w / 2, y - h / 2, w, h, 3 * s);
  ctx.fill();
  ctx.lineWidth = 1 * s;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// Draws each near-route segment's line (thin, pale) -- called before our
// own route lines so our routes stand out on top of it.
function _drawRoadRefLines(ctx, roadEntries, project) {
  const s = ROUTE_IMAGE_UI_SCALE;
  roadEntries.forEach(entry => {
    entry.segments.forEach(seg => {
      if (seg.length < 2) return;
      ctx.beginPath();
      seg.forEach((pt, i) => {
        const [px, py] = project(pt.lat, pt.lon);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2 * s;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    });
  });
}

// Draws one shield label per near-route segment (so a long highway made of
// many such segments gets repeated labels along its length, same as the
// reference export) -- skipping a label when it would land too close to
// another already placed for the same ref, so a road split into many tiny
// segments doesn't cluster labels. Called after our own route lines so
// labels stay legible even where a route runs right along that road.
function _drawRoadRefShieldLabels(ctx, roadEntries, project) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const placedByRef = {}; // ref -> array of [px, py] already placed

  roadEntries.forEach(entry => {
    const ref = (entry.tags && entry.tags.ref) ? String(entry.tags.ref).split(';')[0].trim() : null;
    if (!ref) return;

    entry.segments.forEach(seg => {
      if (seg.length < 2) return;
      const mid = seg[Math.floor(seg.length / 2)];
      const [px, py] = project(mid.lat, mid.lon);

      const placed = placedByRef[ref] || (placedByRef[ref] = []);
      const tooClose = placed.some(([qx, qy]) => Math.hypot(px - qx, py - qy) < ROAD_LABEL_MIN_SPACING_PX * s);
      if (tooClose) return;

      placed.push([px, py]);
      _drawRoadRefLabel(ctx, px, py, ref);
    });
  });
}

// Title block, top-left -- the obra code (reusing the same nameMiddle field
// already typed into the route name inputs / used for KML naming).
function _drawRouteImageTitle(ctx, code) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const x = 16 * s, y = 16 * s, w = 280 * s, h = 56 * s;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  _drawRoundedRect(ctx, x, y, w, h, 4 * s);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `bold ${22 * s}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(code || 'OAE', x + 12 * s, y + 8 * s);
  ctx.fillStyle = '#555';
  ctx.font = `${12 * s}px sans-serif`;
  ctx.fillText('Rota Alternativa × Rota Original', x + 12 * s, y + 34 * s);
  ctx.restore();
}

// Legend, top-right -- one row per route actually built, plus LD_INICIO_OAE
// if at least one such point was found in a dropped KML.
function _drawRouteImageLegend(ctx, readyEntries, hasLdPoint) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const rows = [];
  if (hasLdPoint) rows.push({ type: 'pin', color: LD_INICIO_COLOR, label: 'LD_INICIO_OAE' });
  readyEntries.forEach(([key, r]) => rows.push({ type: 'line', color: r.color, label: _composeRouteName(key) }));
  if (!rows.length) return;

  const padX = 12 * s, padY = 10 * s, titleH = 24 * s, rowH = 22 * s;
  ctx.font = `${12 * s}px sans-serif`;
  let maxTextW = 0;
  rows.forEach(row => { maxTextW = Math.max(maxTextW, ctx.measureText(row.label).width); });
  ctx.font = `bold ${14 * s}px sans-serif`;
  maxTextW = Math.max(maxTextW, ctx.measureText('Legenda').width);

  const boxW = padX * 2 + 24 * s + maxTextW;
  const boxH = padY * 2 + titleH + rows.length * rowH;
  const boxX = ROUTE_IMAGE_WIDTH - boxW - 16 * s;
  const boxY = 16 * s;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  _drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 4 * s);
  ctx.fill();

  ctx.fillStyle = '#1a1a1a';
  ctx.font = `bold ${14 * s}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Legenda', boxX + padX, boxY + padY);

  let rowY = boxY + padY + titleH;
  ctx.font = `${12 * s}px sans-serif`;
  rows.forEach(row => {
    const iconCX = boxX + padX + 8 * s;
    const iconCY = rowY + rowH / 2;
    if (row.type === 'pin') {
      ctx.beginPath();
      ctx.arc(iconCX, iconCY, 6 * s, 0, Math.PI * 2);
      ctx.fillStyle = row.color;
      ctx.fill();
      ctx.lineWidth = 1 * s;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    } else {
      ctx.strokeStyle = row.color;
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      ctx.moveTo(iconCX - 8 * s, iconCY);
      ctx.lineTo(iconCX + 8 * s, iconCY);
      ctx.stroke();
    }
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(row.label, boxX + padX + 24 * s, rowY + (rowH - 12 * s) / 2);
    rowY += rowH;
  });
  ctx.restore();
}

// North arrow, bottom-right -- "N" sits in the upper part of the circle,
// with the arrow (pointing up, toward the N) below it, both fully inside
// the circle.
function _drawRouteImageNorthArrow(ctx, width, height) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const cx = width - 50 * s, cy = height - 60 * s;
  const R = 28 * s;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = '#333';
  ctx.stroke();

  ctx.fillStyle = '#000';
  ctx.font = `bold ${13 * s}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('N', cx, cy - R * 0.35);

  const tipY = cy - R * 0.05, baseY = cy + R * 0.55, halfW = R * 0.3;
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx - halfW, baseY);
  ctx.lineTo(cx, baseY - halfW * 0.4);
  ctx.lineTo(cx + halfW, baseY);
  ctx.closePath();
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  ctx.lineWidth = 1 * s;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.restore();
}

function _niceScaleNumber(x) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = x / Math.pow(10, exp);
  const niceBase = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10;
  return niceBase * Math.pow(10, exp);
}

// Scale bar, bottom-left. Web Mercator stretches distances by latitude, so
// the "map metres per pixel" from the bbox is corrected by cos(latitude)
// at the frame's vertical centre to get an actual ground distance.
function _drawRouteImageScaleBar(ctx, bbox, width, height) {
  const s = ROUTE_IMAGE_UI_SCALE;
  const mapMetersPerPixel = (bbox.xmax - bbox.xmin) / width;
  const centerLat = _mercatorYToLat((bbox.ymin + bbox.ymax) / 2);
  const groundMetersPerPixel = mapMetersPerPixel * Math.cos(centerLat * Math.PI / 180);

  const niceKm = _niceScaleNumber((150 * s * groundMetersPerPixel) / 1000);
  const barPx = (niceKm * 1000) / groundMetersPerPixel;

  const x0 = 24 * s, y0 = height - 30 * s;
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x0 + barPx, y0);
  ctx.moveTo(x0, y0 - 5 * s); ctx.lineTo(x0, y0 + 5 * s);
  ctx.moveTo(x0 + barPx, y0 - 5 * s); ctx.lineTo(x0 + barPx, y0 + 5 * s);
  ctx.stroke();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x0 + barPx, y0);
  ctx.moveTo(x0, y0 - 5 * s); ctx.lineTo(x0, y0 + 5 * s);
  ctx.moveTo(x0 + barPx, y0 - 5 * s); ctx.lineTo(x0 + barPx, y0 + 5 * s);
  ctx.stroke();

  const label = `${niceKm} km`;
  ctx.font = `${12 * s}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = '#000';
  ctx.strokeText(label, x0 + barPx / 2, y0 - 8 * s);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x0 + barPx / 2, y0 - 8 * s);
  ctx.restore();
}

function _drawRouteImageAttribution(ctx, width, height) {
  const s = ROUTE_IMAGE_UI_SCALE;
  ctx.save();
  ctx.font = `${10 * s}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Imagery © Esri, Maxar, Earthstar Geographics · Roads © OpenStreetMap contributors', 10 * s, height - 8 * s);
  ctx.restore();
}

window.exportRoutesImage = async function() {
  const ready = Object.entries(ROUTES).filter(([, r]) => r.waypoints.length >= 2);
  if (!ready.length) {
    showToast('Crie ao menos uma rota antes de gerar a imagem');
    return;
  }

  const btn = document.getElementById('routeImageBtn');
  // Guarda o rótulo original no próprio elemento: dois cliques seguidos
  // (ou um erro no meio) faziam o botão ficar preso em "GERANDO IMAGEM…".
  const originalLabel = btn ? (btn.dataset.label || btn.textContent) : null;
  if (btn) btn.dataset.label = originalLabel;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ GERANDO IMAGEM…'; }
  showToast('🛰️ Buscando imagem de satélite…');

  try {
    const routePts = [];
    ready.forEach(([, r]) => {
      const coords = (r.roadCoords && r.roadCoords.length >= 2) ? r.roadCoords : r.waypoints;
      coords.forEach(c => routePts.push({ lat: c.lat, lng: c.lng }));
    });

    const allPoints = routePts.slice();
    LD_INICIO_POINTS.forEach(p => allPoints.push(p));

    const bbox = _computeMercatorBBoxForImage(allPoints);

    // Whitelist de códigos de rodovia: exatamente as que alguma das rotas
    // construídas realmente percorre. Calculado na hora (mesma conta do
    // campo TRAJETO:) em vez de ler o texto atual desse campo, para não
    // pegá-lo no meio do "…" (ainda calculando).
    //
    // CORREÇÃO: a versão anterior olhava só para a Rota Alternativa (chave
    // 'a'). Se a pessoa tivesse desenhado apenas a Rota Original (verde,
    // chave 'b') -- o caso mais comum, já que ela normalmente já vem pronta
    // ao soltar o KML -- a whitelist ficava vazia e NENHUM rótulo de via
    // era desenhado na imagem, mesmo com rodovias federais/estaduais
    // genuinamente no trajeto. Agora soma as rodovias das duas rotas que
    // existirem.
    const [descA, descB] = await Promise.all([
      (ROUTES.a.waypoints && ROUTES.a.waypoints.length >= 2) ? _fetchRouteDescription(ROUTES.a.waypoints) : Promise.resolve(null),
      (ROUTES.b.waypoints && ROUTES.b.waypoints.length >= 2) ? _fetchRouteDescription(ROUTES.b.waypoints) : Promise.resolve(null)
    ]);
    const allowedHighwayRefs = new Set([
      ...((descA && descA.highways) || []),
      ...((descB && descB.highways) || [])
    ]);

    // Base satellite (requested lossless so the only JPEG compression that
    // ever happens is the final canvas.toBlob() below -- avoids the
    // double-recompression quality loss of re-saving an already-JPEG base)
    // and the OSM road/ref data are independent of each other, so fetch
    // both at once instead of one after another.
    const [baseImg, roadWaysRaw] = await Promise.all([
      _fetchEsriMapImage(ESRI_WORLD_IMAGERY_EXPORT_URL, bbox, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT, { format: 'png24' }),
      _fetchRoadRefWaysInBBox(bbox).catch(err => {
        console.warn('Overpass road/ref lookup indisponível, seguindo só com satélite + rotas:', err);
        return [];
      })
    ]);
    // First keep only the roads actually part of the alternative route's
    // trajeto, then (as a safety net) only the portions of those roads
    // that genuinely run near one of the built routes -- see
    // _filterRoadWaysNearRoute() for why that second step still matters
    // (a road can share a ref with an unrelated stretch elsewhere in the
    // frame).
    const roadWaysAllowed = allowedHighwayRefs.size
      ? roadWaysRaw.filter(w => allowedHighwayRefs.has(_extractHighwayCode(w.tags && w.tags.ref)))
      : [];
    const roadWays = _filterRoadWaysNearRoute(roadWaysAllowed, routePts);

    const canvas = document.createElement('canvas');
    canvas.width = ROUTE_IMAGE_WIDTH;
    canvas.height = ROUTE_IMAGE_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(baseImg, 0, 0, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT);

    const project = (lat, lng) => {
      const m = _lngLatToMercatorXY(lng, lat);
      return [
        (m.x - bbox.xmin) / (bbox.xmax - bbox.xmin) * ROUTE_IMAGE_WIDTH,
        (bbox.ymax - m.y) / (bbox.ymax - bbox.ymin) * ROUTE_IMAGE_HEIGHT
      ];
    };

    // Other roads' tracing (thin, pale) drawn before our own route lines,
    // so our routes still stand out on top of the general road network.
    _drawRoadRefLines(ctx, roadWays, project);

    // Original (green) drawn first, alternative (red) on top -- matches
    // the layering in the reference export.
    ['b', 'a'].forEach(key => {
      const r = ROUTES[key];
      if (r.waypoints.length < 2) return;
      const coords = (r.roadCoords && r.roadCoords.length >= 2) ? r.roadCoords : r.waypoints;
      ctx.beginPath();
      coords.forEach((c, i) => {
        const [px, py] = project(c.lat, c.lng);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 4 * ROUTE_IMAGE_UI_SCALE;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 3 * ROUTE_IMAGE_UI_SCALE;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // Road shield labels (BR-xxx, RR-xxx...) drawn AFTER the route lines,
    // fixed pixel size, so they stay legible even where a route runs right
    // along that road -- matching the reference export's layering.
    _drawRoadRefShieldLabels(ctx, roadWays, project);

    LD_INICIO_POINTS.forEach(p => {
      const [px, py] = project(p.lat, p.lng);
      _drawPinMarker(ctx, px, py, LD_INICIO_COLOR);
      // O deslocamento do rótulo era em pixels fixos, então em outros
      // tamanhos de saída ele descolava do alfinete.
      _drawRouteImageLabel(ctx, px + 14 * ROUTE_IMAGE_UI_SCALE, py - 11 * ROUTE_IMAGE_UI_SCALE, 'LD_INICIO_OAE');
    });

    const code = (ROUTES.a.nameMiddle || ROUTES.b.nameMiddle || '').trim();
    _drawRouteImageTitle(ctx, code);
    _drawRouteImageLegend(ctx, ready, LD_INICIO_POINTS.length > 0);
    _drawRouteImageNorthArrow(ctx, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT);
    _drawRouteImageScaleBar(ctx, bbox, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT);
    _drawRouteImageAttribution(ctx, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT);

    canvas.toBlob(blob => {
      if (!blob) { showToast('⚠ Não foi possível gerar a imagem'); return; }
      const safeCode = code.replace(/[\\/:*?"<>|]/g, '_');
      const fileName = safeCode ? `ROTA_ALTERNATIVA_${safeCode}.jpg` : 'ROTA_ALTERNATIVA.jpg';
      triggerDownload(blob, fileName);
      const warning = !allowedHighwayRefs.size ? ' (nenhuma rodovia identificada no trajeto -- imagem sem rótulos de via)' : '';
      showToast(`⬇ Imagem <span class="accent">${fileName}</span> gerada${warning}`);
    }, 'image/jpeg', 0.95);
  } catch (err) {
    console.error('Falha ao gerar imagem da rota:', err);
    showToast('⚠ Não foi possível gerar a imagem — falha ao obter a imagem de satélite (verifique a conexão)');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
};

// ─── LIVE RESULT ROWS (trajeto da alternativa / diferença em km) ──────────────
// Two small display rows under the panels, kept up to date automatically as
// either route is built/edited, each with its own compact copy button next
// to the value (see index.html: #routeTrajetoValue / #routeDiffValue).
function _copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); resolve(); }
    catch (e) { reject(e); }
    document.body.removeChild(ta);
  });
}

function _flashCopyButton(btn, ok) {
  if (!btn) return;
  const original = btn.textContent;
  btn.classList.add(ok ? 'copied' : 'copy-failed');
  btn.textContent = ok ? '✓' : '✕';
  setTimeout(() => {
    btn.classList.remove('copied', 'copy-failed');
    btn.textContent = original;
  }, 1200);
}

// Recomputes both result rows from scratch (one shared OSRM round-trip per
// route). Debounced at the call site so dragging a stop doesn't fire this
// on every frame.
// Cada chamada recebe um número de sequência. Como as respostas do OSRM
// podem voltar fora de ordem, uma consulta antiga que demorasse mais que a
// seguinte sobrescrevia o resultado novo com um valor já obsoleto.
let _routeResultsSeq = 0;

async function _updateRouteResults() {
  const seq = ++_routeResultsSeq;
  const a = ROUTES.a; // vermelha / ROTA_ALTERNATIVA
  const b = ROUTES.b; // verde    / ROTA_ORIGINAL
  const trajetoEl = document.getElementById('routeTrajetoValue');
  const diffEl = document.getElementById('routeDiffValue');
  if (!trajetoEl || !diffEl) return;

  const haveA = a.waypoints && a.waypoints.length >= 2;
  const haveB = b.waypoints && b.waypoints.length >= 2;

  if (!haveA && !haveB) {
    trajetoEl.textContent = '—';
    diffEl.textContent = '—';
    return;
  }

  if (haveA) trajetoEl.textContent = '…';
  if (haveA && haveB) diffEl.textContent = '…';

  const [descA, descB] = await Promise.all([
    haveA ? _fetchRouteDescription(a.waypoints) : Promise.resolve(null),
    haveB ? _fetchRouteDescription(b.waypoints) : Promise.resolve(null)
  ]);

  if (seq !== _routeResultsSeq) return; // resultado obsoleto, já há consulta mais nova

  trajetoEl.textContent = haveA
    ? ((descA && descA.highways.length) ? descA.highways.join('; ') : '—')
    : '—';

  const kmA = descA ? descA.distanceKm : (haveA ? a.distanceKm : null);
  const kmB = descB ? descB.distanceKm : (haveB ? b.distanceKm : null);
  if (haveA && haveB && kmA != null && kmB != null) {
    const diff = kmA - kmB;
    const sign = diff >= 0 ? '+' : '-';
    diffEl.textContent = `${sign}${Math.abs(diff).toFixed(1)} KM`;
  } else {
    diffEl.textContent = '—';
  }
}

const _scheduleRouteResultsUpdate = debounce(_updateRouteResults, 700);

// "📋" next to TRAJETO: -- copies whatever is currently shown (doesn't
// re-fetch; the value row is always kept current by _updateRouteResults).
window.copyRouteTrajeto = function() {
  const el = document.getElementById('routeTrajetoValue');
  const btn = document.getElementById('routeCopyTrajetoBtn');
  const text = el ? el.textContent.trim() : '';
  if (!text || text === '—' || text === '…') {
    showToast('Trajeto ainda não disponível — adicione ao menos 2 paradas na Rota Alternativa');
    return;
  }
  _copyText(text)
    .then(() => _flashCopyButton(btn, true))
    .catch(err => { console.error('Copy trajeto failed:', err); _flashCopyButton(btn, false); });
};

// "📋" next to DIFERENÇA (KM): -- same idea, copies the value currently shown.
window.copyRouteDiffKm = function() {
  const el = document.getElementById('routeDiffValue');
  const btn = document.getElementById('routeCopyDiffBtn');
  const text = el ? el.textContent.trim() : '';
  if (!text || text === '—' || text === '…') {
    showToast('Diferença ainda não disponível — crie as duas rotas primeiro');
    return;
  }
  // O "+" na tela é só uma pista visual de que a alternativa é mais longa
  // -- vira ruído depois de colado em outro lugar, então é removido daqui
  // (um "-" para uma alternativa mais curta é mantido, já que esse sinal
  // tem significado). O sufixo " KM" também é só rótulo de tela; copiar só
  // o número é o que faz sentido para colar numa planilha, por exemplo.
  const copyValue = text.replace(/^\+/, '').replace(/\s*km\s*$/i, '').trim();
  _copyText(copyValue)
    .then(() => _flashCopyButton(btn, true))
    .catch(err => { console.error('Copy diff failed:', err); _flashCopyButton(btn, false); });
};
