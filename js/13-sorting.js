// ==========================================================================
// 13-sorting.js
// Photo list sorting controls.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

let _sortKey = 'name', _sortDir = 'asc';

const _sortBtns = {
  'date-desc': 'sortBtnDate',
  'date-asc':  'sortBtnDateAsc',
  'name-asc':  'sortBtnNameAsc',
  'name-desc': 'sortBtnNameDesc',
};

window.setSort = function(key, dir) {
  _sortKey = key;
  _sortDir = dir;

  // Update active button
  Object.entries(_sortBtns).forEach(([k, id]) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', k === `${key}-${dir}`);
  });

  renderSortedList();
};

function getPhotoDate(photo) {
  const raw = photo.exif?.DateTimeOriginal || photo.exif?.CreateDate
           || photo.exif?.DateTime || photo.exif?.DateTimeDigitized;
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const m = String(raw).match(/(\d{4})[:\-](\d{2})[:\-](\d{2})/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
}

function renderSortedList() {
  const sorted = [...photos].sort((a, b) => {
    if (_sortKey === 'name') {
      const cmp = a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' });
      return _sortDir === 'asc' ? cmp : -cmp;
    } else {
      // date
      const da = getPhotoDate(a), db = getPhotoDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      const cmp = da - db;
      return _sortDir === 'asc' ? cmp : -cmp;
    }
  });

  // Re-order DOM nodes (no re-render, just move existing elements)
  const list = document.getElementById('photoList');
  sorted.forEach(photo => {
    const el = list.querySelector(`.photo-item[data-id="${photo.id}"]`);
    if (el) list.appendChild(el);
  });
}
