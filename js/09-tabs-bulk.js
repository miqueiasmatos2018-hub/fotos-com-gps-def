// ==========================================================================
// 09-tabs-bulk.js
// Sidebar tab switching and the bulk EXIF editor.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

window.switchTab = function(tab) {
  // Cancel ponto picking if switching away from pontos tab
  if (tab !== 'pontos' && typeof _pontoPickingHandler !== 'undefined' && _pontoPickingHandler) {
    window.togglePontoPicking();
  }
  // Cancel route picking if switching away from rotas tab
  if (tab !== 'rotas' && typeof _routePickingKey !== 'undefined' && _routePickingKey) {
    window.toggleRoutePicking(_routePickingKey);
  }
  // The structure outline drawing only makes sense while looking at the
  // Medidas tab -- show it when entering, hide it the moment you leave.
  if (typeof _setMedidasLayerVisible === 'function') {
    _setMedidasLayerVisible(tab === 'medidas');
  }
  // Elementos/Nomes cover the whole screen and don't use the sidebar, so
  // floating sidebar controls (like the collapse toggle) that sit at a
  // higher z-index than the overlay would otherwise poke through on top
  // of it -- this class lets CSS hide them specifically for these tabs.
  document.body.classList.toggle('fullscreen-tab-active', tab === 'elementos' || tab === 'nomes');
  ['photos','pontos','rotas','medidas','elementos','nomes'].forEach(t => {
    const btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const content = document.getElementById('tabContent' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn)     btn.classList.toggle('active',     t === tab);
    if (content) content.classList.toggle('active', t === tab);
  });
};

window.toggleBulkEdit = function() {
  const btn    = document.getElementById('metaBulkToggle');
  const fields = document.getElementById('metaBulkFields');
  btn.classList.toggle('open');
  fields.classList.toggle('open');
};

window.applyBulkEdit = function() {
  const bulkFields = [
    { id: 'bulk_Make',        metaKey: 'Make',        num: false },
    { id: 'bulk_Model',       metaKey: 'Model',       num: false },
    { id: 'bulk_LensModel',   metaKey: 'LensModel',   num: false },
    { id: 'bulk_FocalLength', metaKey: 'FocalLength', num: true  },
    { id: 'bulk_FNumber',     metaKey: 'FNumber',     num: true  },
    { id: 'bulk_ISO',         metaKey: 'ISO',         num: true  },
    { id: 'bulk_Software',    metaKey: 'Software',    num: false },
    { id: 'bulk_lat',         metaKey: 'lat',         num: true  },
    { id: 'bulk_lng',         metaKey: 'lng',         num: true  },
  ];

  const toApply = bulkFields
    .map(f => ({ ...f, val: document.getElementById(f.id).value.trim() }))
    .filter(f => f.val !== '');

  if (!toApply.length) {
    showToast('No fields filled in');
    return;
  }

  let count = 0;
  photos.forEach(photo => {
    if (!photo.exif) photo.exif = {};
    toApply.forEach(f => {
      pushUndo(photo);
      if (f.metaKey === 'lat') { photo.lat = parseFloat(f.val); }
      else if (f.metaKey === 'lng') { photo.lng = parseFloat(f.val); }
      else { photo.exif[f.metaKey] = f.num ? parseFloat(f.val) : f.val; }
      count++;
    });
    // Update map markers for GPS changes
    if (photo.lat != null && photo.lng != null && markers[photo.id]) {
      markers[photo.id].setLatLng([photo.lat, photo.lng]);
    }
  });

  // Clear inputs
  toApply.forEach(f => { document.getElementById(f.id).value = ''; });

  showToast('<span class="accent">' + toApply.length + ' field' + (toApply.length > 1 ? 's' : '') + '</span> applied to ' + photos.length + ' photos');
};

window.autoLoadKmlFromFolder = async function() {
  if (!window.showDirectoryPicker) {
    showToast('File System Access API not supported in this browser');
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch (e) {
    // User cancelled
    return;
  }

  const desc = document.getElementById('autoLoadDesc');
  desc.textContent = 'Procurando arquivos KML/KMZ…';

  const kmlHandles = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && (name.endsWith('.kml') || name.endsWith('.kmz'))) {
      kmlHandles.push(handle);
    }
  }

  if (!kmlHandles.length) {
    desc.textContent = 'Nenhum KML/KMZ encontrado na pasta';
    showToast('No KML/KMZ files found in folder');
    return;
  }

  desc.textContent = `Carregando ${kmlHandles.length} arquivo(s)…`;

  for (const handle of kmlHandles) {
    const file = await handle.getFile();
    loadKmlFile(file);
  }

  desc.textContent = `${kmlHandles.length} arquivo(s) carregado(s) de: ${dirHandle.name}/`;
  showToast('<span class="accent">' + kmlHandles.length + ' KML/KMZ</span> loaded from folder');
};
