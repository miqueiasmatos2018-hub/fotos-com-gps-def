// ==========================================================================
// 01-map-core.js
// Leaflet map instance, rotation-safe marker hit-testing, cluster layers.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

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

// ── Prevent marker clicks from being swallowed as a map drag when rotated ──
// When the map is rotated, a marker's *actual clickable DOM position* can
// end up out of sync with where its icon is visually drawn (leaflet-rotate
// re-transforms the map pane, but marker icon placement doesn't always
// follow correctly) — worse the farther a marker sits from the map center,
// so worst at the corners. That means a click at the icon's visible
// location can land on the map underneath instead of the marker element
// itself, which both misses the marker AND starts a map drag.
//
// Relying on "did this event's DOM target land on a marker element" isn't
// reliable here, since the marker element may not actually be where it
// looks. Instead, on every press we independently recompute where each
// photo marker SHOULD be on screen right now (map.latLngToContainerPoint,
// which reflects the current rotation) and check if the press is close to
// any of them. If so, we handle it as that marker's tap ourselves and
// stop the gesture from reaching leaflet-rotate's drag handling —
// regardless of what DOM element technically received the event.
function _clientToContainerPoint(e) {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
  const rect = map.getContainer().getBoundingClientRect();
  return L.point(t.clientX - rect.left, t.clientY - rect.top);
}

function _findNearestMarkerId(containerPoint, thresholdPx) {
  let bestId = null, bestDist = Infinity;
  for (const id in markers) {
    const m = markers[id];
    if (!m || !m.getLatLng) continue;
    const pt = map.latLngToContainerPoint(m.getLatLng());
    const dx = pt.x - containerPoint.x, dy = pt.y - containerPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { bestDist = dist; bestId = id; }
  }
  return bestDist <= thresholdPx ? bestId : null;
}

let _lastMarkerTapId = null;
let _lastMarkerTapTime = 0;

function _onMapPointerDownCapture(e) {
  // Ignore right-click / non-primary buttons
  if (e.type === 'mousedown' && e.button !== 0) return;
  // Don't hijack taps while placing a new point (relocate / ponto picking)
  if (typeof _pickingForId !== 'undefined' && _pickingForId) return;
  if (typeof _pontoPickingHandler !== 'undefined' && _pontoPickingHandler) return;

  const containerEl = map.getContainer();
  if (!e.target || !containerEl.contains(e.target)) return;

  const pt = _clientToContainerPoint(e);
  const id = _findNearestMarkerId(pt, 26);
  if (!id) return; // not close enough to any marker — let the map behave normally

  // Stop here so leaflet-rotate's drag handling never sees this gesture.
  e.stopPropagation();
  if (e.cancelable) e.preventDefault();

  // mousedown and touchstart can both fire for the same physical tap on
  // touch devices — only act once per gesture.
  const now = Date.now();
  if (_lastMarkerTapId === id && (now - _lastMarkerTapTime) < 400) return;
  _lastMarkerTapId = id;
  _lastMarkerTapTime = now;

  const marker = markers[id];
  if (!marker) return;
  if (typeof selectPhoto === 'function') selectPhoto(id);
  marker.openPopup();
}
document.addEventListener('mousedown', _onMapPointerDownCapture, true);
document.addEventListener('touchstart', _onMapPointerDownCapture, true);

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

// ── Rotation-aware marker layer switching ────────────────────────────────
// leaflet.markercluster computes each icon's screen position with its own
// internal math, which doesn't fully account for the leaflet-rotate plugin's
// CSS rotation of the map pane — the click target drifts from the visible
// icon, worse the farther a marker sits from the map center (worst at the
// corners). Plain (unclustered) L.markers are positioned by Leaflet core,
// which leaflet-rotate does patch correctly, so they stay click-accurate.
// To fix this, markers are moved out of the cluster group into a plain
// layer whenever the map is rotated, and moved back into the cluster group
// once bearing returns to 0.
const plainMarkerLayer = L.layerGroup();
let _rotatedMode = false;

function addMarkerToActiveLayer(marker) {
  if (_rotatedMode) plainMarkerLayer.addLayer(marker);
  else clusterGroup.addLayer(marker);
}
function addMarkersToActiveLayer(markerArr) {
  if (!markerArr || !markerArr.length) return;
  if (_rotatedMode) markerArr.forEach(m => plainMarkerLayer.addLayer(m));
  else clusterGroup.addLayers(markerArr);
}
function removeMarkerFromActiveLayer(marker) {
  if (clusterGroup.hasLayer(marker)) clusterGroup.removeLayer(marker);
  if (plainMarkerLayer.hasLayer(marker)) plainMarkerLayer.removeLayer(marker);
}
function syncMarkerLayerMode(rotated) {
  if (rotated === _rotatedMode) return;
  _rotatedMode = rotated;
  const all = Object.values(markers);
  if (_rotatedMode) {
    all.forEach(m => { if (clusterGroup.hasLayer(m)) clusterGroup.removeLayer(m); });
    if (!map.hasLayer(plainMarkerLayer)) map.addLayer(plainMarkerLayer);
    all.forEach(m => { if (!plainMarkerLayer.hasLayer(m)) plainMarkerLayer.addLayer(m); });
  } else {
    all.forEach(m => { if (plainMarkerLayer.hasLayer(m)) plainMarkerLayer.removeLayer(m); });
    if (map.hasLayer(plainMarkerLayer)) map.removeLayer(plainMarkerLayer);
    if (all.length) clusterGroup.addLayers(all);
  }
}

// Spiderfy cluster on hover so overlapping markers spread apart
let _spiderfyTimer = null;
clusterGroup.on('clustermouseover', function(e) {
  _spiderfyTimer = setTimeout(() => e.layer.spiderfy(), 180);
});
clusterGroup.on('clustermouseout', function(e) {
  clearTimeout(_spiderfyTimer);
  e.layer.unspiderfy();
});
