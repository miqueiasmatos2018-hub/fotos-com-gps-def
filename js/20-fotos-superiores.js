// ==========================================================================
// 20-fotos-superiores.js
// "Fotos" tab: standalone tool to rename the standard "fotos superiores"
// (aerial reference shots always taken the same way around an OAE) into
// F-01, F-02, F-03... NOT part of the main photos[] list/workflow -- this
// is a separate dropzone: drop the files in, then click each one's pin on
// the map in the order it should be numbered. First click -> F-01, second
// -> F-02, and so on. Works with however many photos are dropped (no fixed
// count).
//
// An earlier version of this tool tried to guess the F-01..F-11 order
// automatically from each photo's GPS position (ring around the structure
// + 3 shots along the road). That didn't work reliably in practice, so
// this version drops the geometry entirely: the person doing the
// inspection already knows the right order by eye, so they just click the
// pins themselves.
// ==========================================================================

// Lightweight GPS-only EXIF read -- this tool doesn't need thumbnails or
// the rest of the metadata pipeline processFile() (04-photos.js) builds,
// so it doesn't go through it.
async function _fsupReadGps(file) {
  try {
    const exif = await exifr.parse(file, { gps: true, translateValues: true, reviveValues: true }) || {};
    if (exif.latitude != null && exif.longitude != null &&
        Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) &&
        Math.abs(exif.latitude) <= 90 && Math.abs(exif.longitude) <= 180 &&
        !(exif.latitude === 0 && exif.longitude === 0)) {
      return { lat: exif.latitude, lng: exif.longitude };
    }
  } catch (e) {
    console.error('Leitura de GPS falhou em', file.name, e);
  }
  return null;
}

function _fsupExt(name) {
  const m = /\.[^.]+$/.exec(name);
  return m ? m[0] : '.jpg';
}

function _fsupLabelFor(n) {
  return `F-${String(n).padStart(2, '0')}`;
}

// One session = one drop of photos, live until downloaded or cancelled.
// items[i] = { file, lat, lng, marker, order } -- order is null until the
// pin is clicked, then 1, 2, 3... in click sequence.
let _fsupSession = null;

function _fsupPinIcon(order) {
  const label = order != null ? _fsupLabelFor(order) : '?';
  return L.divIcon({
    className: '',
    html: `<div class="fsup-pin${order != null ? ' assigned' : ''}"><span>${label}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function _fsupClearSession() {
  if (_fsupSession) {
    _fsupSession.items.forEach(it => { if (it.marker) map.removeLayer(it.marker); });
  }
  _fsupSession = null;
  const resultsEl = document.getElementById('fsupResults');
  if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
}

function _fsupOnMarkerClick(item) {
  if (!_fsupSession) return;
  if (item.order != null) {
    showToast(`Essa já é <span class="accent">${_fsupLabelFor(item.order)}</span> — use "Reiniciar numeração" para trocar`);
    return;
  }
  _fsupSession.nextOrder += 1;
  item.order = _fsupSession.nextOrder;
  item.marker.setIcon(_fsupPinIcon(item.order));
  _fsupRenderStatus();
}

function _fsupUndoLast() {
  if (!_fsupSession || _fsupSession.nextOrder === 0) return;
  const last = _fsupSession.items.find(it => it.order === _fsupSession.nextOrder);
  if (last) { last.order = null; last.marker.setIcon(_fsupPinIcon(null)); }
  _fsupSession.nextOrder -= 1;
  _fsupRenderStatus();
}

function _fsupResetNumbering() {
  if (!_fsupSession) return;
  _fsupSession.items.forEach(it => { it.order = null; it.marker.setIcon(_fsupPinIcon(null)); });
  _fsupSession.nextOrder = 0;
  _fsupRenderStatus();
}

function _fsupRenderStatus() {
  const resultsEl = document.getElementById('fsupResults');
  if (!resultsEl || !_fsupSession) return;
  const total = _fsupSession.items.length;
  const done = _fsupSession.nextOrder;
  const assigned = _fsupSession.items
    .filter(it => it.order != null)
    .sort((a, b) => a.order - b.order);

  resultsEl.style.display = 'block';
  resultsEl.innerHTML = `
    <p style="font-size:10.5px;color:var(--text2);margin:0 0 8px;">
      Clique nos pinos no mapa na ordem certa — <b style="color:var(--accent)">${done} de ${total}</b> numeradas.
    </p>
    ${assigned.length ? `
      <div class="fsup-list">
        ${assigned.map(it => `<div class="fsup-row"><b>${_fsupLabelFor(it.order)}</b><span>${escapeHtml(it.file.name)}</span></div>`).join('')}
      </div>
    ` : ''}
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button class="elem-btn" id="fsupUndoBtn" type="button" style="flex:1;" ${done === 0 ? 'disabled' : ''}>↩ Desfazer última</button>
      <button class="elem-btn" id="fsupResetBtn" type="button" style="flex:1;" ${done === 0 ? 'disabled' : ''}>↺ Reiniciar numeração</button>
    </div>
    <div class="fsup-download-bar">
      <button class="elem-btn primary" id="fsupDownloadBtn" type="button" style="width:100%;" ${done === total ? '' : 'disabled'}>
        ⬇ BAIXAR RENOMEADAS${done === total ? '' : ` — faltam ${total - done}`}
      </button>
      <button class="elem-btn" id="fsupCancelBtn" type="button" style="margin-top:6px;width:100%;">✕ Cancelar</button>
    </div>
  `;
  document.getElementById('fsupUndoBtn').addEventListener('click', _fsupUndoLast);
  document.getElementById('fsupResetBtn').addEventListener('click', _fsupResetNumbering);
  document.getElementById('fsupCancelBtn').addEventListener('click', _fsupClearSession);
  const dlBtn = document.getElementById('fsupDownloadBtn');
  if (done === total) dlBtn.addEventListener('click', () => _fsupDownloadPhotos(assigned));
}

// Salva as fotos renomeadas numa pasta de verdade (File System Access API
// -- mesmo caminho que exportAllSmart() usa em 06-export.js), sem passar
// por ZIP. Onde essa API não existe (Firefox, Safari), cai de volta para o
// download solto de cada arquivo. Nenhuma reescrita de EXIF acontece aqui
// -- é só o arquivo original com o nome trocado, então o download direto
// (sem canvas/piexif) preserva os bytes exatamente como vieram da câmera.
async function _fsupDownloadPhotos(assignedItems) {
  const btn = document.getElementById('fsupDownloadBtn');
  if (btn) setButtonLoading(btn, 'SALVANDO…');

  if (window.showDirectoryPicker) {
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
        id: 'fotos-superiores-export'
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // A pessoa cancelou o seletor de pasta -- não cai para download
        // solto nesse caso, só desfaz o estado "salvando" do botão.
        if (btn) clearButtonLoading(btn, '⬇ BAIXAR RENOMEADAS');
        return;
      }
      dirHandle = null; // sem permissão / API indisponível -> cai no download solto
    }

    if (dirHandle) {
      try {
        const folder = await dirHandle.getDirectoryHandle('fotos superiores', { create: true });
        const used = new Set();
        let errors = 0;
        for (const it of assignedItems) {
          const filename = makeUniqueName(`${_fsupLabelFor(it.order)}${_fsupExt(it.file.name)}`, used);
          try {
            const fileHandle = await folder.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(it.file);
            await writable.close();
          } catch (writeErr) {
            errors++;
            console.error('Não foi possível salvar', filename, writeErr);
          }
        }
        showToast(errors
          ? `✓ ${assignedItems.length - errors} fotos salvas na pasta (${errors} com erro)`
          : `✓ <span class="accent">${assignedItems.length} fotos</span> salvas na pasta "fotos superiores"`);
        if (btn) clearButtonLoading(btn, '⬇ BAIXAR RENOMEADAS');
        return;
      } catch (err) {
        console.error('Exportação de fotos superiores para pasta falhou, caindo para download solto:', err);
      }
    }
  }

  // Alternativa: um <a download> por foto, com um pequeno intervalo entre
  // cada uma -- disparar vários downloads no mesmo instante faz o
  // navegador bloquear ou juntar tudo num só. O "finally" garante que o
  // botão sempre volta ao normal, inclusive quando dá certo -- antes só o
  // catch reativava o botão, então um download bem-sucedido deixava o
  // botão travado em "GERANDO ZIP…" para sempre.
  try {
    for (const it of assignedItems) {
      triggerDownload(it.file, `${_fsupLabelFor(it.order)}${_fsupExt(it.file.name)}`);
      await _sleep(250);
    }
    showToast('✓ Fotos superiores renomeadas e baixadas');
  } catch (e) {
    console.error('Download das fotos superiores falhou:', e);
    showToast('⚠ Não foi possível baixar as fotos');
  } finally {
    if (btn) clearButtonLoading(btn, '⬇ BAIXAR RENOMEADAS');
  }
}

window.toggleFsupPanel = function() {
  const btn = document.getElementById('fsupToggle');
  const fields = document.getElementById('fsupFields');
  btn.classList.toggle('open');
  fields.classList.toggle('open');
};

async function _fsupHandleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));

  if (!files.length) {
    showToast('⚠️ Nenhuma imagem encontrada nos arquivos soltos');
    return;
  }

  _fsupClearSession();
  const resultsEl = document.getElementById('fsupResults');
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '<p style="font-size:10.5px;color:var(--text2);">Lendo GPS das fotos…</p>';

  const gpsList = await Promise.all(files.map(_fsupReadGps));
  const noGps = files.filter((f, i) => !gpsList[i]);
  if (noGps.length) {
    showToast(`⚠️ ${noGps.length} foto(s) sem GPS: ${noGps.map(f => f.name).join(', ')}`);
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    return;
  }

  const items = files.map((file, i) => ({ file, lat: gpsList[i].lat, lng: gpsList[i].lng, marker: null, order: null }));

  items.forEach(item => {
    const marker = L.marker([item.lat, item.lng], {
      icon: _fsupPinIcon(null),
      bubblingMouseEvents: false // não deve acionar outras ferramentas do mapa (medir, reposicionar, etc.)
    }).addTo(map);
    marker.on('click', () => _fsupOnMarkerClick(item));
    item.marker = marker;
  });

  _fsupSession = { items, nextOrder: 0 };

  const bounds = L.latLngBounds(items.map(it => [it.lat, it.lng]));
  map.fitBounds(bounds, { padding: [60, 60] });

  _fsupRenderStatus();
}

(function _fsupWireDropzone() {
  const dz = document.getElementById('fsupDropzone');
  const input = document.getElementById('fsupFileInput');
  const chooseBtn = document.getElementById('fsupBtnChoose');
  if (!dz || !input || !chooseBtn) return;

  chooseBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) _fsupHandleFiles(input.files); input.value = ''; });

  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation();
    dz.classList.add('elem-drag');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation();
    dz.classList.remove('elem-drag');
  }));
  dz.addEventListener('drop', e => {
    const dropped = e.dataTransfer && e.dataTransfer.files;
    if (dropped && dropped.length) _fsupHandleFiles(dropped);
  });
})();
