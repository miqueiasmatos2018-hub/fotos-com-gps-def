// ==========================================================================
// 07-map-ui.js
// Stats bar, fit-all / clear-all, toast, date/size formatters.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

function updateStats() {
  const withGPS = photos.filter(p => p.lat != null).length;
  // Uses the refs cached in 04-photos.js rather than re-querying the DOM --
  // this runs on every photo add/remove.
  if (_elStatTotal) _elStatTotal.textContent = photos.length;
  if (_elStatGPS)   _elStatGPS.textContent   = withGPS;
  if (_elStatNoGPS) _elStatNoGPS.textContent = photos.length - withGPS;
}

window.fitAll = function() {
  const pts = photos.filter(p => p.lat != null).map(p => [p.lat, p.lng]);
  if (!pts.length) { showToast('Nenhuma foto com GPS para enquadrar'); return; }
  // Uma foto só: fitBounds em um ponto único aproxima ao zoom máximo.
  if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 17));
  else map.fitBounds(pts, { padding: [60, 60] });
};

window.clearAll = function() {
  // Cada foto carrega uma blob URL viva; sem revogar, limpar a lista várias
  // vezes ia acumulando as imagens na memória do navegador até a aba travar.
  photos.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
  photos.length = 0;
  _knownDupKeys.clear();
  selectedPhotoIds.clear();
  _undoStack.length = 0;
  activeId = null;
  Object.values(markers).forEach(m => removeMarkerFromActiveLayer(m));
  Object.keys(markers).forEach(k => delete markers[k]);
  photoList.innerHTML = '';
  detailPanel.style.display = 'none';
  emptyState.style.display = 'flex';
  document.getElementById('fitAllBtn').style.display = 'none';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('exportBar').classList.remove('visible');
  if (typeof _updateSelectedPhotosBar === 'function') _updateSelectedPhotosBar();
  updateStats();
  refreshDateTimeline();
  fileInput.value = '';
};

let toastTimeout;
function showToast(html) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  // Mensagens longas some antes de dar tempo de ler; a duração acompanha o
  // tamanho do texto, entre 2,8 e 6 segundos.
  const ms = Math.min(6000, Math.max(2800, t.textContent.length * 55));
  toastTimeout = setTimeout(() => t.classList.remove('show'), ms);
}

function formatDate(d) {
  if (!d) return '—';
  if (d instanceof Date) return isNaN(d) ? '—' : d.toLocaleString('pt-BR');
  return String(d);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

// ─── MOBILE LIST/MAP TOGGLE ────────────────────────────────────────────────
// On phone widths the sidebar and the map no longer fit side by side (see
// the ".mobile-view-toggle" / ".app.mobile-show-map" rules in styles.css),
// so only one is shown at a time and this button flips between them. The
// map starts hidden (display:none), so Leaflet computes a 0×0 size for it
// on boot -- invalidateSize() right after revealing it is required or the
// tiles render wrong/blank until the next manual pan/zoom.
window.toggleMobileMapView = function() {
  const app = document.querySelector('.app');
  const btn = document.getElementById('mobileViewToggle');
  if (!app) return;
  const showingMap = app.classList.toggle('mobile-show-map');
  if (btn) btn.innerHTML = showingMap ? '☰ Lista' : '🗺 Mapa';
  if (showingMap && typeof map !== 'undefined' && map) {
    setTimeout(() => map.invalidateSize(), 60);
  }
};
