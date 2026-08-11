// ==========================================================================
// 02-orientation-layers.js
// Reference basemap overlays (cities / roads / hybrid) and the DNIT layer-panel show/hide.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

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
