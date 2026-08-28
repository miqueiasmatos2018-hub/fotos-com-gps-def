// ==========================================================================
// 05-photo-markers.js
// Photo markers, popups, relocate mode, EXIF detail panel.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// Declarado aqui em cima porque showDetail() precisa dele para reaplicar o
// modo de edição a cada re-render (antes, qualquer atualização do painel
// desligava a edição sem mudar o rótulo do botão).
let metaEditMode = false;

function buildPhotoPopupHtml(photo) {
  const exif = photo.exif || {};
  const id = photo.id;
  const hasGps = photo.lat != null && photo.lng != null;
  return `
    <div class="popup-content" style="min-width:220px">
      <img class="popup-img" src="${photo.url}" alt="" loading="lazy">
      <input class="popup-edit-name" data-field="name" data-id="${id}"
        value="${escapeHtml(photo.name)}" maxlength="120" spellcheck="false">
      <div class="popup-edit-row">
        <span class="popup-edit-label">GPS Lat</span>
        <input class="popup-edit-input" data-field="lat" data-id="${id}"
          value="${photo.lat != null ? photo.lat.toFixed(8) : ''}" placeholder="—" type="number" step="any">
      </div>
      <div class="popup-edit-row">
        <span class="popup-edit-label">GPS Lng</span>
        <input class="popup-edit-input" data-field="lng" data-id="${id}"
          value="${photo.lng != null ? photo.lng.toFixed(8) : ''}" placeholder="—" type="number" step="any">
      </div>
      <div class="popup-edit-row">
        <span class="popup-edit-label">Data</span>
        <input class="popup-edit-input" data-field="DateTimeOriginal" data-id="${id}"
          value="${exif.DateTimeOriginal ? formatDate(exif.DateTimeOriginal) : ''}" placeholder="—">
      </div>
      <div class="popup-btn-row">
        <button class="popup-save-btn" onclick="savePopupEdits('${id}')">SALVAR</button>
        <button class="popup-relocate-btn" onclick="startRelocateMode('${id}')" title="Clicar no mapa para redefinir a localização">🗺</button>
        ${hasGps ? `<button class="popup-relocate-btn" onclick="openSVAtMarker(${photo.lat}, ${photo.lng})" title="Abrir no Google Maps">🌐</button>` : ''}
      </div>
    </div>
  `;
}

window.savePopupEdits = function(id) {
  const photo = photos.find(p => p.id == id);
  if (!photo) return;
  const marker = markers[id];
  if (!marker) return;
  const popup = marker.getPopup();
  const el = popup.getElement();
  if (!el) return;

  if (!photo.exif) photo.exif = {};
  pushUndo(photo);
  const numFields = ['FocalLength','FNumber','ISO'];

  el.querySelectorAll('[data-field]').forEach(input => {
    const field = input.dataset.field;
    const val = input.value.trim();
    if (field === 'name') {
      if (val) {
        photo.name = val;
        // atualiza o item da barra lateral (textContent já escapa sozinho)
        const listItem = document.querySelector(`.photo-item[data-id="${id}"]`);
        if (listItem) {
          const nameText = listItem.querySelector('.photo-name-text');
          if (nameText) { nameText.textContent = val; nameText.title = val; }
        }
      }
    } else if (field === 'lat') {
      const v = parseFloat(val);
      if (!isNaN(v)) { photo.lat = v; photo.exif.latitude = v; }
    } else if (field === 'lng') {
      const v = parseFloat(val);
      if (!isNaN(v)) { photo.lng = v; photo.exif.longitude = v; }
    } else {
      if (val === '') return;
      photo.exif[field] = numFields.includes(field) ? parseFloat(val) : val;
    }
  });

  // Update marker position if GPS changed
  if (photo.lat != null && photo.lng != null) {
    marker.setLatLng([photo.lat, photo.lng]);
  }

  // Refresh popup content
  marker.setPopupContent(buildPhotoPopupHtml(photo));

  // Re-attach events after content swap
  setTimeout(() => attachPopupEvents(id), 50);

  // Atualiza o painel de detalhes se esta for a foto ativa
  if (activeId == id) showDetail(photo);

  // A edição pode ter mudado nome (ordem da lista) e coordenadas (contagem
  // de GPS / duplicatas). Antes nada disso era atualizado até recarregar.
  const listItem = document.querySelector(`.photo-item[data-id="${id}"]`);
  if (listItem) {
    const coordEl = listItem.querySelector('.photo-coords');
    if (coordEl && photo.lat != null) {
      coordEl.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
      coordEl.className = 'photo-coords has-gps';
    }
  }
  renderSortedList();
  refreshDateTimeline();
  updateStats();
  checkDuplicateGps();
  showToast('Foto atualizada ✓');
};

function attachPopupEvents(id) {
  const marker = markers[id];
  if (!marker) return;
  const popup = marker.getPopup();
  const el = popup?.getElement();
  if (!el) return;
  // prevent map click-through on inputs
  el.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('mousedown', e => e.stopPropagation());
  });
}

let _pickingForId = null;
let _pickingHandler = null;
let _pickingKeyHandler = null;

window.startRelocateMode = function(id) {
  // Cancel any existing picking session
  cancelRelocateMode();

  _pickingForId = id;
  const mapEl = document.getElementById('map');
  const banner = document.getElementById('pickingBanner');

  mapEl.classList.add('picking-location');
  banner.classList.add('show');

  // Mark the relocate button as active
  const marker = markers[id];
  if (marker) {
    const popup = marker.getPopup();
    const el = popup?.getElement();
    if (el) {
      const btn = el.querySelector('.popup-relocate-btn');
      if (btn) btn.classList.add('active');
    }
  }
  const listItem = document.querySelector(`.photo-item[data-id="${id}"] .relocate-btn`);
  if (listItem) listItem.classList.add('active');

  _pickingHandler = function(e) {
    const photo = photos.find(p => p.id == _pickingForId);
    if (!photo) { cancelRelocateMode(); return; }

    const { lat, lng } = e.latlng;
    pushUndo(photo);
    photo.lat = lat;
    photo.lng = lng;
    if (!photo.exif) photo.exif = {};
    photo.exif.latitude  = lat;
    photo.exif.longitude = lng;

    const m = markers[_pickingForId];
    if (m) {
      m.setLatLng([lat, lng]);
      m.setPopupContent(buildPhotoPopupHtml(photo));
      m.openPopup();
      setTimeout(() => attachPopupEvents(_pickingForId), 60);
    } else {
      // a foto não tinha GPS antes -- cria o marcador agora
      addMarker(photo);
      updateStats();
      markers[photo.id].openPopup();
      // update list item GPS display
      const listItem = document.querySelector(`.photo-item[data-id="${photo.id}"]`);
      if (listItem) {
        const coordEl = listItem.querySelector('.photo-coords');
        if (coordEl) {
          coordEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          coordEl.className = 'photo-coords has-gps';
        }
        const badge = listItem.querySelector('.photo-badge');
        if (badge) { badge.className = 'photo-badge gps'; }
      }
    }

    // Sync lat/lng inputs in popup if still open
    const pm = markers[photo.id];
    if (pm) {
      const pe = pm.getPopup()?.getElement();
      if (pe) {
        const latIn = pe.querySelector('[data-field="lat"]');
        const lngIn = pe.querySelector('[data-field="lng"]');
        if (latIn) latIn.value = lat.toFixed(8);
        if (lngIn) lngIn.value = lng.toFixed(8);
      }
    }

    if (activeId == photo.id) showDetail(photo);
    showToast(`📍 Localização definida — <span class="accent">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`);
    cancelRelocateMode();
  };

  _pickingKeyHandler = function(e) {
    if (e.key === 'Escape') cancelRelocateMode();
  };

  map.once('click', _pickingHandler);
  document.addEventListener('keydown', _pickingKeyHandler);
};

function cancelRelocateMode() {
  if (_pickingHandler)    { map.off('click', _pickingHandler); _pickingHandler = null; }
  if (_pickingKeyHandler) { document.removeEventListener('keydown', _pickingKeyHandler); _pickingKeyHandler = null; }

  document.getElementById('map').classList.remove('picking-location');
  document.getElementById('pickingBanner').classList.remove('show');

  // Remove active class from all relocate buttons
  document.querySelectorAll('.popup-relocate-btn.active').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.relocate-btn.active').forEach(b => b.classList.remove('active'));

  _pickingForId = null;
}

function buildMarker(photo) {
  // Use tiny thumb for marker icon if available, else a placeholder
  const thumbSrc = photo.thumbUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const icon = L.divIcon({
    className: '',
    html: `<div class="custom-marker-hitbox"><div class="custom-marker" id="marker-${photo.id}"><img src="${thumbSrc}" alt=""></div></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -46]
  });
  const marker = L.marker([photo.lat, photo.lng], { icon, bubblingMouseEvents: false });
  marker.bindPopup(() => buildPhotoPopupHtml(photo), {
    maxWidth: 340, maxHeight: 560,
    autoPan: true, autoPanPadding: L.point(20, 20)
  });
  marker.on('popupopen', function() {
    setTimeout(() => attachPopupEvents(photo.id), 80);
  });
  marker.on('click', () => selectPhoto(photo.id));
  return marker;
}

function addMarker(photo) {
  const marker = buildMarker(photo);
  addMarkerToActiveLayer(marker);

  markers[photo.id] = marker;
}

function selectPhoto(id) {
  // Deactivate previous
  document.querySelectorAll('.photo-item').forEach(el => el.classList.remove('active'));
  Object.keys(markers).forEach(mid => {
    const el = document.getElementById(`marker-${mid}`);
    if (el) el.classList.remove('active');
  });

  activeId = id;
  const photo = photos.find(p => p.id == id);
  if (!photo) return;

  // Ativa o item da lista -- escopo em .photo-item de propósito: um seletor
  // solto por [data-id] podia casar com outro elemento da interface.
  const listItem = document.querySelector(`.photo-item[data-id="${id}"]`);
  if (listItem) {
    listItem.classList.add('active');
    listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Activate marker
  const el = document.getElementById(`marker-${id}`);
  if (el) el.classList.add('active');

  // Open popup without moving map
  if (photo.lat != null) {
    markers[id]?.openPopup();
  }

  // Show EXIF detail
  showDetail(photo);
}

function showDetail(photo) {
  const exif = photo.exif || {};
  // editable fields: [key, label, exifKey, format hint]
  const editableFields = [
    ['DateTimeOriginal', 'Data', 'datetime-local'],
    ['Make', 'Marca da Câmera', 'text'],
    ['Model', 'Modelo da Câmera', 'text'],
    ['LensModel', 'Lente', 'text'],
    ['FocalLength', 'Distancia Focal (mm)', 'number'],
    ['FNumber', 'Abertura (f/)', 'number'],
    ['ISO', 'ISO', 'number'],
    ['Software', 'Software', 'text'],
    ['GPSAltitude', 'GPS Alt (m)', 'number'],
  ];

  const fields = [
    ['Nome do Arquivo', photo.name, null],
    ['Tamanho do Arquivo', photo.file ? formatSize(photo.file.size) : '—', null],
    ['Dimensões', exif.ImageWidth ? `${exif.ImageWidth} × ${exif.ImageHeight}` : '—', null],
    ['Data', exif.DateTimeOriginal ? formatDate(exif.DateTimeOriginal) : '—', 'DateTimeOriginal'],
    ['Marca da Câmera', exif.Make || '—', 'Make'],
    ['Modelo da Câmera', exif.Model || '—', 'Model'],
    ['Lens', exif.LensModel || '—', 'LensModel'],
    ['Distancia Focal', exif.FocalLength ? `${exif.FocalLength}mm` : '—', 'FocalLength'],
    ['Abertura', exif.FNumber ? `f/${exif.FNumber}` : '—', 'FNumber'],
    ['Velocidade do Obturador', exif.ExposureTime ? `1/${Math.round(1/exif.ExposureTime)}s` : '—', null],
    ['ISO', exif.ISO || '—', 'ISO'],
    ['Flash', exif.Flash != null ? (exif.Flash ? 'Yes' : 'No') : '—', null],
    ['GPS Lat', photo.lat != null ? photo.lat.toFixed(8) : 'Not available', 'lat'],
    ['GPS Lng', photo.lng != null ? photo.lng.toFixed(8) : 'Not available', 'lng'],
    ['GPS Alt', toNum(exif.GPSAltitude) != null ? `${toNum(exif.GPSAltitude).toFixed(1)}m` : '—', 'GPSAltitude'],
    ['Software', exif.Software || '—', 'Software'],
  ];

  detailRows.innerHTML = fields.map(([k, v, metaKey]) => {
    const canEdit = metaKey !== null;
    const sv = escapeHtml(v);
    return `
      <div class="detail-row${canEdit ? ' editable' : ''}" data-meta-key="${metaKey || ''}">
        <span class="detail-key">${k}</span>
        <span class="detail-val" ${canEdit ? `contenteditable="${metaEditMode}" data-original="${sv}" data-photo-id="${photo.id}"` : ''}>${sv}</span>
      </div>
    `;
  }).join('');

  // Attach input listeners to editable cells
  detailRows.querySelectorAll('.detail-row.editable .detail-val').forEach(el => {
    el.addEventListener('blur', () => commitMetaEdit(el, photo));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { el.textContent = el.dataset.original; el.blur(); }
    });
  });

  detailPanel.style.display = 'block';
  detailPanel.classList.toggle('collapsed', detailCollapsed);
}

function commitMetaEdit(el, photo) {
  const row = el.closest('.detail-row');
  const metaKey = row.dataset.metaKey;
  const newVal = el.textContent.trim();
  // pushUndo vinha ANTES desta guarda: só entrar e sair de um campo sem
  // digitar nada já empilhava um "desfazer" vazio, e o Ctrl+Z precisava ser
  // apertado várias vezes para surtir efeito.
  if (!newVal || newVal === el.dataset.original) return;
  pushUndo(photo);

  // Persist into photo object
  if (metaKey === 'lat') {
    const v = parseFloat(newVal);
    if (!isNaN(v)) { photo.lat = v; photo.exif.latitude = v; }
  } else if (metaKey === 'lng') {
    const v = parseFloat(newVal);
    if (!isNaN(v)) { photo.lng = v; photo.exif.longitude = v; }
  } else {
    if (!photo.exif) photo.exif = {};
    const numFields = ['FocalLength', 'FNumber', 'ISO', 'GPSAltitude'];
    photo.exif[metaKey] = numFields.includes(metaKey) ? parseFloat(newVal) : newVal;
  }

  el.dataset.original = newVal;

  // Flash saved dot
  const dot = document.getElementById('metaSavedDot');
  dot.classList.add('show');
  setTimeout(() => dot.classList.remove('show'), 1800);

  // Atualiza o popup do marcador, se existir
  if (markers[photo.id]) {
    markers[photo.id].setPopupContent(buildPhotoPopupHtml(photo));

    if ((metaKey === 'lat' || metaKey === 'lng') && photo.lat != null && photo.lng != null) {
      markers[photo.id].setLatLng([photo.lat, photo.lng]);
      const item = document.querySelector(`.photo-item[data-id="${photo.id}"] .photo-coords`);
      if (item) item.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
      checkDuplicateGps();
    }
  }

  showToast(`<span class="accent">${escapeHtml(metaKey)}</span> atualizado`);
}

window.toggleMetaEdit = function() {
  metaEditMode = !metaEditMode;
  const btn = document.getElementById('editMetaBtn');
  btn.textContent = metaEditMode ? '✓ FEITO' : '✎ EDITAR';
  btn.classList.toggle('active', metaEditMode);

  detailRows.querySelectorAll('.detail-row.editable .detail-val').forEach(el => {
    el.contentEditable = metaEditMode ? 'true' : 'false';
    if (metaEditMode) el.style.color = 'var(--text)';
    else el.style.color = '';
  });

  if (metaEditMode) {
    const first = detailRows.querySelector('.detail-row.editable .detail-val');
    if (first) first.focus();
  }
};

let detailCollapsed = false;

window.toggleDetailCollapse = function(e) {
  // Don't toggle collapse when the click originated from the EDIT button
  if (e && e.target.closest && e.target.closest('#editMetaBtn')) return;
  detailCollapsed = !detailCollapsed;
  detailPanel.classList.toggle('collapsed', detailCollapsed);
};
