// ==========================================================================
// 03-state.js
// Shared photo/marker state, debounce helper, undo history.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

const photos = [];
const markers = {};
let activeId = null;

// ─── DEBOUNCE HELPER ──────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const _updateStatsDebounced    = debounce(() => updateStats(),     60);


const _undoStack = [];
const MAX_UNDO = 50;

function _snapshotPhoto(photo) {
  return {
    id:   photo.id,
    name: photo.name,
    lat:  photo.lat,
    lng:  photo.lng,
    exif: JSON.parse(JSON.stringify(photo.exif || {}))
  };
}

function pushUndo(photo) {
  _undoStack.push(_snapshotPhoto(photo));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
}

function _applySnapshot(snap) {
  const photo = photos.find(p => p.id === snap.id);
  if (!photo) return;

  photo.name = snap.name;
  photo.lat  = snap.lat;
  photo.lng  = snap.lng;
  photo.exif = snap.exif;

  // Update marker position
  const m = markers[photo.id];
  if (m) {
    if (photo.lat != null && photo.lng != null) {
      m.setLatLng([photo.lat, photo.lng]);
      m.setPopupContent(buildPhotoPopupHtml(photo));
    }
  }

  // Update sidebar list item
  const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
  if (item) {
    const nameEl  = item.querySelector('.photo-name-text');
    const coordEl = item.querySelector('.photo-coords');
    const badge   = item.querySelector('.photo-badge');
    if (nameEl)  { nameEl.textContent = photo.name; nameEl.title = photo.name; }
    if (coordEl) {
      if (photo.lat != null) {
        coordEl.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
        coordEl.className = 'photo-coords has-gps';
      } else {
        coordEl.textContent = 'No GPS data';
        coordEl.className = 'photo-coords no-gps';
      }
    }
    if (badge) badge.className = `photo-badge ${photo.lat != null ? 'gps' : 'no-gps'}`;
  }

  // Update detail panel if active
  if (activeId === photo.id) showDetail(photo);
  refreshDateTimeline();
  _updateStatsDebounced();
  showToast('↩ Undo');
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (_undoStack.length === 0) { showToast('Nothing to undo'); return; }
    const snap = _undoStack.pop();
    _applySnapshot(snap);
  }

  // Skip all shortcuts if typing in an input
  if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  if (document.activeElement && document.activeElement.isContentEditable) return;

  // Delete / Backspace: remove selected photo
  if ((e.key === 'Delete' || e.key === 'Backspace') && activeId != null) {
    e.preventDefault();
    const idx   = photos.findIndex(p => p.id === activeId);
    const photo = photos[idx];
    if (!photo) return;

    // Select adjacent photo before removing
    const listIds   = [...document.querySelectorAll('.photo-item[data-id]')].map(el => el.dataset.id);
    const listIdx   = listIds.indexOf(String(activeId));
    const nextListId = listIds[listIdx + 1] || listIds[listIdx - 1] || null;

    // Remove marker
    const m = markers[photo.id];
    if (m) { removeMarkerFromActiveLayer(m); delete markers[photo.id]; }

    // Revoke blob URL
    if (photo.url) URL.revokeObjectURL(photo.url);

    // Remove from photos array
    photos.splice(idx, 1);

    // Remove list item
    const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
    if (item) item.remove();

    // Clear detail panel
    activeId = null;
    detailPanel.style.display = 'none';

    updateStats();
      refreshDateTimeline();
    renderSortedList();

    if (!photos.length) {
      document.getElementById('fitAllBtn').style.display = 'none';
      document.getElementById('clearBtn').style.display  = 'none';
      document.getElementById('exportBar').classList.remove('visible');
      emptyState.style.display = 'flex';
    }

    showToast(`🗑 <span class="accent">${photo.name}</span> removida`);

    // Select next photo if available
    if (nextListId) {
      const next = photos.find(p => String(p.id) === nextListId);
      if (next) selectPhoto(next.id);
    }
  }

  // Tab / Shift+Tab: navigate between photos in sidebar order
  if (e.key === 'Tab' && activeId != null && photos.length > 1) {
    e.preventDefault();
    const listIds = [...document.querySelectorAll('.photo-item[data-id]')].map(el => el.dataset.id);
    if (!listIds.length) return;
    const idx     = listIds.indexOf(String(activeId));
    const nextIdx = e.shiftKey
      ? (idx - 1 + listIds.length) % listIds.length
      : (idx + 1) % listIds.length;
    const nextId    = listIds[nextIdx];
    const nextPhoto = photos.find(p => String(p.id) === nextId);
    if (!nextPhoto) return;
    selectPhoto(nextPhoto.id);
    const m = markers[nextPhoto.id];
    if (m) m.openPopup();
  }
});

// UI REFS — cached once at startup
