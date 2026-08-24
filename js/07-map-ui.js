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
  if (pts.length) map.fitBounds(pts, { padding: [60, 60] });
};

window.clearAll = function() {
  photos.length = 0;
  _knownDupKeys.clear();
  Object.values(markers).forEach(m => removeMarkerFromActiveLayer(m));
  Object.keys(markers).forEach(k => delete markers[k]);
  photoList.innerHTML = '';
  detailPanel.style.display = 'none';
  emptyState.style.display = 'flex';
  document.getElementById('fitAllBtn').style.display = 'none';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('exportBar').classList.remove('visible');
  updateStats();
  refreshDateTimeline();
  fileInput.value = '';
};

let toastTimeout;
function showToast(html) {
  const t = document.getElementById('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2800);
}

function formatDate(d) {
  if (!d) return '—';
  if (d instanceof Date) return d.toLocaleString();
  return String(d);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}
