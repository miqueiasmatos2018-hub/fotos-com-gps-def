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
  // Refresh "Data Inspeção" (most recent photo date) every time the Dados
  // tab is opened -- covers the case where photos were added/removed
  // without ever touching a structure card.
  if (tab === 'medidas' && typeof _updateInspectionDate === 'function') {
    _updateInspectionDate();
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
    showToast('Nenhum campo preenchido');
    return;
  }
  if (!photos.length) {
    showToast('Nenhuma foto carregada');
    return;
  }

  const touchesGps = toApply.some(f => f.metaKey === 'lat' || f.metaKey === 'lng');

  photos.forEach(photo => {
    if (!photo.exif) photo.exif = {};
    // pushUndo ficava DENTRO do laço de campos: aplicar 5 campos empilhava
    // 5 estados idênticos por foto, e desfazer exigia 5 Ctrl+Z para voltar
    // um passo. Um instantâneo por foto é o suficiente.
    pushUndo(photo);

    toApply.forEach(f => {
      if (f.metaKey === 'lat') { photo.lat = parseFloat(f.val); photo.exif.latitude = photo.lat; }
      else if (f.metaKey === 'lng') { photo.lng = parseFloat(f.val); photo.exif.longitude = photo.lng; }
      else { photo.exif[f.metaKey] = f.num ? parseFloat(f.val) : f.val; }
    });

    if (photo.lat != null && photo.lng != null) {
      if (markers[photo.id]) {
        markers[photo.id].setLatLng([photo.lat, photo.lng]);
        markers[photo.id].setPopupContent(buildPhotoPopupHtml(photo));
      } else {
        // A foto ganhou GPS agora: antes o marcador simplesmente não era
        // criado, então a coordenada existia no EXIF exportado mas a foto
        // nunca aparecia no mapa.
        addMarker(photo);
      }
      const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
      if (item) {
        const coordEl = item.querySelector('.photo-coords');
        if (coordEl) {
          coordEl.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
          coordEl.className = 'photo-coords has-gps';
        }
        const badge = item.querySelector('.photo-badge');
        if (badge) badge.className = 'photo-badge gps';
      }
    }
  });

  // Limpa os campos
  toApply.forEach(f => { document.getElementById(f.id).value = ''; });

  // A barra lateral, as estatísticas e o painel de detalhes não eram
  // atualizados depois de uma edição em massa.
  updateStats();
  refreshDateTimeline();
  renderSortedList();
  if (touchesGps) {
    checkDuplicateGps();
    if (photos.some(p => p.lat != null)) {
      emptyState.style.display = 'none';
      document.getElementById('fitAllBtn').style.display = 'block';
      document.getElementById('clearBtn').style.display = 'block';
    }
  }
  if (activeId != null) {
    const active = photos.find(p => p.id === activeId);
    if (active) showDetail(active);
  }

  showToast('<span class="accent">' + toApply.length + ' campo' + (toApply.length > 1 ? 's' : '') + '</span> aplicado' + (toApply.length > 1 ? 's' : '') + ' a ' + photos.length + ' foto' + (photos.length > 1 ? 's' : ''));
};

window.autoLoadKmlFromFolder = async function() {
  if (!window.showDirectoryPicker) {
    showToast('Este navegador não suporta seleção de pasta (File System Access API)');
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
    showToast('Nenhum arquivo KML/KMZ encontrado na pasta');
    return;
  }

  desc.textContent = `Carregando ${kmlHandles.length} arquivo(s)…`;

  for (const handle of kmlHandles) {
    const file = await handle.getFile();
    loadKmlFile(file);
  }

  desc.textContent = `${kmlHandles.length} arquivo(s) carregado(s) de: ${dirHandle.name}/`;
  showToast('<span class="accent">' + kmlHandles.length + ' KML/KMZ</span> carregado(s) da pasta');
};
