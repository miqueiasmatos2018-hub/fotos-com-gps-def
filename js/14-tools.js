// ==========================================================================
// 14-tools.js
// Distance measure, SNV alignment, Google Maps, compass / rotation.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

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

window.openSVAtMarker = function(lat, lng) {
  window.open(`https://www.google.com/maps?q=${lat},${lng}&ll=${lat},${lng}&z=18`, '_blank');
};


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
