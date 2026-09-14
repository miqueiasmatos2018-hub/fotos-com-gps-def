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

// Fonte única da data de uma foto. Antes existiam três leitores de data
// levemente diferentes (aqui, na linha do tempo e na aba Dados), que
// discordavam entre si em fotos que só tinham ModifyDate.
function getPhotoDate(photo) {
  const raw = photo.exif?.DateTimeOriginal || photo.exif?.CreateDate
           || photo.exif?.DateTime || photo.exif?.DateTimeDigitized
           || photo.exif?.ModifyDate;
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw) ? null : raw;
  const str = String(raw);
  const m = str.match(/(\d{4})[:\/\-](\d{2})[:\/\-](\d{2})/);
  if (!m) return null;
  const t = str.match(/(\d{2}):(\d{2}):(\d{2})(?!\d)/g);
  // O primeiro grupo "hh:mm:ss" só é hora se não for a própria data.
  const time = t && t.length ? t[t.length - 1].split(':').map(Number) : [0, 0, 0];
  const d = new Date(+m[1], +m[2] - 1, +m[3], time[0], time[1], time[2]);
  return isNaN(d) ? null : d;
}

function renderSortedList() {
  const sorted = [...photos].sort((a, b) => {
    if (_sortKey === 'name') {
      // numeric:true -> "FOTO 2" antes de "FOTO 10" (antes vinha ao contrário,
      // porque a comparação era puramente alfabética).
      const cmp = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true });
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

  // Reordena os nós já existentes (sem re-renderizar). Montar tudo em um
  // DocumentFragment e inserir de uma vez evita um reflow por foto -- com
  // algumas centenas de itens a diferença é visível.
  const list = document.getElementById('photoList');
  if (!list) return;
  const byId = new Map();
  list.querySelectorAll('.photo-item[data-id]').forEach(el => byId.set(el.dataset.id, el));
  const frag = document.createDocumentFragment();
  sorted.forEach(photo => {
    const el = byId.get(String(photo.id));
    if (el) frag.appendChild(el);
  });
  list.appendChild(frag);
}
