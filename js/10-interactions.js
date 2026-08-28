// ==========================================================================
// 10-interactions.js
// Drag & drop import, upload zone, keyboard shortcuts.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

(function() {
  let _bearing = 0;
  let _layerModeTimer = null;
  let _lastLayerMode = false;

  function _scheduleLayerModeSync(rotated) {
    if (rotated === _lastLayerMode) return;
    clearTimeout(_layerModeTimer);
    _layerModeTimer = setTimeout(() => {
      _lastLayerMode = rotated;
      syncMarkerLayerMode(rotated);
    }, 140);
  }

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

    // Desativa o agrupamento enquanto o mapa está rotacionado, para os
    // cliques continuarem caindo no marcador certo (ver syncMarkerLayerMode).
    // A troca de camada é cara com muitos marcadores e era refeita a cada
    // quadro do arrasto; agora só acontece quando o giro estabiliza.
    _scheduleLayerModeSync(_bearing !== 0);
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

  function startCompassDrag(e) {
    if (e.cancelable) e.preventDefault();
    _dragMoved = false;
    _startAngle   = getAngle(e);
    _startBearing = window.getBearing();

    function onDrag(ev) {
      const delta = getAngle(ev) - _startAngle;
      if (Math.abs(delta) > 2) _dragMoved = true;
      setBearing(_startBearing + delta);
      if (ev.cancelable) ev.preventDefault();
    }
    function onUp() {
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchmove', onDrag);
      document.removeEventListener('touchend',  onUp);
    }
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend',  onUp);
  }
  // getAngle() já sabia lidar com toques, mas só havia listener de mouse --
  // girar a rosa dos ventos em tablet não funcionava.
  rose.addEventListener('mousedown', startCompassDrag);
  rose.addEventListener('touchstart', startCompassDrag, { passive: false });

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
