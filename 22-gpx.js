// ==========================================================================
// 22-gpx.js
// Aba GPX: geocodifica fotos usando um trajeto GPX gravado durante a saída
// de campo. Casa o DateTimeOriginal de cada foto com o ponto do GPX mais
// próximo no tempo (interpolando entre os dois pontos vizinhos) e grava a
// coordenada -- e altitude, se o GPX tiver -- direto no EXIF da foto.
//
// Ferramenta independente da lista principal (photos[] em 04-photos.js) --
// as fotos baixadas aqui já saem com GPS gravado; quem quiser usá-las no
// fluxo principal (mapa, Elementos, etc.) solta os arquivos baixados de
// volta na aba Fotos, como qualquer JPEG geotagueado.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// items[i] = { file, name, dateOriginal, lat, lng, alt, status, gapMin }
// status: 'ok' | 'extrapolated' | 'no-date' | 'error'
let _gpxPhotoFiles  = [];   // arquivos ainda não processados (antes de clicar "Processar")
let _gpxTrackPoints = null; // [{lat, lon, ele, t}] ordenado por tempo (t = ms UTC)
let _gpxTrackFile    = null;
let _gpxResultItems  = null;
let _gpxTrackLine    = null;
let _gpxPhotoMarkers = [];

// ─── Fuso: EXIF da câmera é "hora local ingênua" (sem fuso); o GPX grava em
// UTC. Tratamos os números do EXIF como se já fossem UTC (Date.UTC com os
// mesmos componentes que o exifr devolveu) e então subtraímos o fuso digitado
// pela pessoa -- assim o cálculo não depende do fuso do computador rodando a
// ferramenta, só do que foi digitado no campo.
function _gpxPhotoUtcMs(dateOriginal, offsetHours) {
  const naiveUtcMs = Date.UTC(
    dateOriginal.getFullYear(), dateOriginal.getMonth(), dateOriginal.getDate(),
    dateOriginal.getHours(), dateOriginal.getMinutes(), dateOriginal.getSeconds()
  );
  return naiveUtcMs - offsetHours * 3600000;
}

async function _gpxParseTrackFile(file) {
  const text = await file.text();
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) {
    throw new Error('Esse arquivo não é um GPX válido');
  }
  const trkpts = Array.from(xml.getElementsByTagName('trkpt'));
  const points = trkpts.map(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const timeEl = pt.getElementsByTagName('time')[0];
    const eleEl  = pt.getElementsByTagName('ele')[0];
    const t = timeEl ? Date.parse(timeEl.textContent.trim()) : NaN;
    const ele = eleEl ? parseFloat(eleEl.textContent.trim()) : null;
    return { lat, lon, ele: Number.isFinite(ele) ? ele : null, t };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t));

  if (!points.length) {
    throw new Error('Nenhum ponto com data/hora encontrado (precisa de <time> em cada <trkpt>)');
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

// Posição no instante targetMs, interpolando entre os dois pontos do
// trajeto que o cercam. Quando a foto foi tirada antes do trajeto começar
// ou depois de terminar, usa a ponta mais próxima e marca como
// "extrapolated" (o gapMin diz o tamanho do furo pra pessoa julgar se dá
// pra confiar).
function _gpxPositionAt(points, targetMs) {
  const first = points[0], last = points[points.length - 1];
  if (targetMs <= first.t) {
    return { lat: first.lat, lng: first.lon, alt: first.ele, extrapolated: true, gapMin: (first.t - targetMs) / 60000 };
  }
  if (targetMs >= last.t) {
    return { lat: last.lat, lng: last.lon, alt: last.ele, extrapolated: true, gapMin: (targetMs - last.t) / 60000 };
  }
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= targetMs) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const span = b.t - a.t;
  const frac = span > 0 ? (targetMs - a.t) / span : 0;
  const alt = (a.ele != null && b.ele != null) ? a.ele + (b.ele - a.ele) * frac
            : (a.ele != null ? a.ele : b.ele);
  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lng: a.lon + (b.lon - a.lon) * frac,
    alt,
    extrapolated: false,
    gapMin: 0
  };
}

function _gpxUpdateCounts() {
  const photosLabel = document.getElementById('gpxPhotosCount');
  if (photosLabel) {
    photosLabel.textContent = _gpxPhotoFiles.length
      ? `${_gpxPhotoFiles.length} foto${_gpxPhotoFiles.length > 1 ? 's' : ''} prontas para processar`
      : 'Nenhuma foto ainda';
  }
  const trackLabel = document.getElementById('gpxTrackLabel');
  if (trackLabel) {
    trackLabel.textContent = _gpxTrackFile
      ? `${_gpxTrackFile.name} (aguardando processar)`
      : 'Nenhum trajeto ainda';
  }
  const btn = document.getElementById('gpxProcessBtn');
  if (btn) btn.disabled = !(_gpxPhotoFiles.length && _gpxTrackFile);
}

async function _gpxHandlePhotoFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (!files.length) { showToast('⚠️ Nenhuma imagem encontrada nos arquivos soltos'); return; }
  _gpxPhotoFiles = _gpxPhotoFiles.concat(files);
  _gpxUpdateCounts();
}

async function _gpxHandleTrackFile(fileList) {
  const file = fileList[0];
  if (!file) return;
  if (!/\.gpx$/i.test(file.name)) { showToast('⚠️ Isso não parece um arquivo .gpx'); return; }
  _gpxTrackFile = file;
  _gpxUpdateCounts();
}

function _gpxRowHtml(item) {
  const coords = item.lat != null ? `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}` : '—';
  const statusLabel = {
    ok: 'OK',
    extrapolated: `fora do trajeto · ${Math.round(item.gapMin)} min`,
    'no-date': 'sem data no EXIF',
    error: 'erro'
  }[item.status] || item.status;
  return `<div class="gpx-row ${item.status}">
    <span class="gpx-row-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
    <span class="gpx-row-coords">${coords}</span>
    <span class="gpx-row-status">${statusLabel}</span>
  </div>`;
}

function _gpxRenderResults() {
  const el = document.getElementById('gpxResults');
  const downloadBar = document.getElementById('gpxDownloadBar');
  if (!el || !_gpxResultItems) return;

  const ok = _gpxResultItems.filter(i => i.status === 'ok').length;
  const extrap = _gpxResultItems.filter(i => i.status === 'extrapolated').length;
  const failed = _gpxResultItems.filter(i => i.status === 'no-date' || i.status === 'error').length;

  el.innerHTML = `
    <div class="gpx-summary">
      <b>${ok}</b> no trajeto${extrap ? ` · <b style="color:#ff9800">${extrap}</b> fora do intervalo do GPX` : ''}${failed ? ` · <b style="color:#f44336">${failed}</b> sem posição` : ''}
    </div>
    <div class="gpx-list">${_gpxResultItems.map(_gpxRowHtml).join('')}</div>
  `;
  if (downloadBar) downloadBar.style.display = (ok + extrap) ? 'block' : 'none';
}

async function _gpxProcess() {
  const btn = document.getElementById('gpxProcessBtn');
  const offsetInput = document.getElementById('gpxOffsetInput');
  const offsetHours = parseFloat(offsetInput && offsetInput.value) || 0;

  if (btn) setButtonLoading(btn, 'PROCESSANDO…');
  try {
    _gpxTrackPoints = await _gpxParseTrackFile(_gpxTrackFile);
  } catch (err) {
    console.error('Leitura do GPX falhou:', err);
    showToast(`⚠️ ${err.message || 'Não foi possível ler o GPX'}`);
    if (btn) clearButtonLoading(btn, '📍 Processar');
    return;
  }

  const items = [];
  for (const file of _gpxPhotoFiles) {
    const item = { file, name: file.name, dateOriginal: null, lat: null, lng: null, alt: null, status: 'error', gapMin: 0 };
    try {
      const exif = await exifr.parse(file, {
        // Mesmas flags de segmento do parse principal (04-photos.js) --
        // crítico para achar DateTimeOriginal em JPGs de iPhone -- só que
        // filtrando a saída pra esses dois campos (mais rápido em lote).
        tiff: true, exif: true, ifd0: true,
        translateValues: true, reviveValues: true, sanitize: true, mergeOutput: true,
        pick: ['DateTimeOriginal', 'CreateDate']
      });
      const dt = (exif && (exif.DateTimeOriginal || exif.CreateDate)) || null;
      if (!dt) { item.status = 'no-date'; items.push(item); continue; }
      item.dateOriginal = dt;
      const targetMs = _gpxPhotoUtcMs(dt, offsetHours);
      const pos = _gpxPositionAt(_gpxTrackPoints, targetMs);
      item.lat = pos.lat; item.lng = pos.lng; item.alt = pos.alt;
      item.gapMin = pos.gapMin;
      item.status = pos.extrapolated ? 'extrapolated' : 'ok';
    } catch (err) {
      console.error('Leitura de EXIF falhou em', file.name, err);
      item.status = 'error';
    }
    items.push(item);
  }

  _gpxResultItems = items;
  _gpxRenderResults();
  _gpxRenderMapPreview();

  if (btn) clearButtonLoading(btn, '📍 Processar');
  const matched = items.filter(i => i.status === 'ok' || i.status === 'extrapolated').length;
  showToast(`📍 <span class="accent">${matched} de ${items.length}</span> fotos geocodificadas`);
}

// ─── Prévia no mapa (linha do trajeto + um pontinho por foto casada) ───────
function _gpxClearMapPreview() {
  if (_gpxTrackLine) { map.removeLayer(_gpxTrackLine); _gpxTrackLine = null; }
  _gpxPhotoMarkers.forEach(m => map.removeLayer(m));
  _gpxPhotoMarkers = [];
}

function _gpxRenderMapPreview() {
  _gpxClearMapPreview();
  if (!_gpxTrackPoints || !_gpxTrackPoints.length) return;

  _gpxTrackLine = L.polyline(_gpxTrackPoints.map(p => [p.lat, p.lon]), {
    color: '#29b6f6', weight: 3, opacity: 0.85
  }).addTo(map);

  const matched = (_gpxResultItems || []).filter(i => i.lat != null);
  matched.forEach(item => {
    const marker = L.marker([item.lat, item.lng], {
      icon: L.divIcon({ className: '', html: '<div class="gpx-track-marker"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }),
      bubblingMouseEvents: false
    }).addTo(map);
    marker.bindTooltip(item.name, { direction: 'top', offset: [0, -4] });
    _gpxPhotoMarkers.push(marker);
  });

  const bounds = L.latLngBounds(_gpxTrackPoints.map(p => [p.lat, p.lon]));
  map.fitBounds(bounds, { padding: [60, 60] });
}

// Chamado pelo switchTab() em 09-tabs-bulk.js -- a prévia do trajeto só faz
// sentido enquanto essa aba está aberta (mesma ideia da silhueta da
// estrutura em 16-medidas.js).
function _setGpxLayerVisible(visible) {
  if (!visible) { _gpxClearMapPreview(); return; }
  if (_gpxTrackPoints) _gpxRenderMapPreview();
}

// Salva as fotos geocodificadas numa pasta de verdade (File System Access
// API -- mesmo caminho de exportAllSmart() em 06-export.js e do botão de
// Fotos Superiores em 20-fotos-superiores.js), sem passar por ZIP. Onde
// essa API não existe (Firefox, Safari), cai de volta para o download
// solto de cada arquivo.
async function _gpxDownloadAll() {
  const items = (_gpxResultItems || []).filter(i => i.lat != null);
  if (!items.length) return;
  const btn = document.getElementById('gpxDownloadBtn');
  if (btn) setButtonLoading(btn, 'SALVANDO…');

  function buildPhotoLike(item) {
    return {
      file: item.file,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      exif: item.alt != null ? { GPSAltitude: item.alt } : {}
    };
  }

  if (window.showDirectoryPicker) {
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
        id: 'gpx-export'
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (btn) clearButtonLoading(btn, '⬇ BAIXAR FOTOS COM GPS');
        return;
      }
      dirHandle = null; // sem permissão / API indisponível -> cai no download solto
    }

    if (dirHandle) {
      try {
        const folder = await dirHandle.getDirectoryHandle('fotos com gps', { create: true });
        const used = new Set();
        let errors = 0;
        for (const item of items) {
          const filename = makeUniqueName(ensureJpgExtension(item.name), used);
          try {
            const blob = await buildJpegWithExif(buildPhotoLike(item));
            const fileHandle = await folder.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch (writeErr) {
            errors++;
            console.error('Não foi possível salvar', filename, writeErr);
          }
        }
        showToast(errors
          ? `✓ ${items.length - errors} fotos salvas na pasta (${errors} com erro)`
          : `✓ <span class="accent">${items.length} fotos</span> salvas na pasta "fotos com gps"`);
        if (btn) clearButtonLoading(btn, '⬇ BAIXAR FOTOS COM GPS');
        return;
      } catch (err) {
        console.error('Exportação de fotos GPX para pasta falhou, caindo para download solto:', err);
      }
    }
  }

  // Alternativa: um <a download> por foto, com um pequeno intervalo entre
  // cada uma -- disparar vários downloads no mesmo instante faz o
  // navegador bloquear ou juntar tudo num só.
  try {
    for (const item of items) {
      const photoLike = buildPhotoLike(item);
      const blob = await buildJpegWithExif(photoLike);
      triggerDownload(blob, ensureJpgExtension(item.name));
      await _sleep(250);
    }
    showToast('✓ Fotos com GPS baixadas');
  } catch (err) {
    console.error('Download das fotos geocodificadas falhou:', err);
    showToast('⚠ Não foi possível baixar todas as fotos');
  } finally {
    if (btn) clearButtonLoading(btn, '⬇ BAIXAR FOTOS COM GPS');
  }
}

function _gpxClearAll() {
  _gpxPhotoFiles = [];
  _gpxTrackFile = null;
  _gpxTrackPoints = null;
  _gpxResultItems = null;
  _gpxClearMapPreview();
  _gpxUpdateCounts();
  const results = document.getElementById('gpxResults');
  if (results) results.innerHTML = '';
  const downloadBar = document.getElementById('gpxDownloadBar');
  if (downloadBar) downloadBar.style.display = 'none';
}

(function _gpxWireUi() {
  const dzPhotos  = document.getElementById('gpxDropPhotos');
  const dzTrack   = document.getElementById('gpxDropTrack');
  const photosInput = document.getElementById('gpxPhotosInput');
  const trackInput  = document.getElementById('gpxTrackInput');
  const choosePhotosBtn = document.getElementById('gpxBtnChoosePhotos');
  const chooseTrackBtn  = document.getElementById('gpxBtnChooseTrack');
  const processBtn = document.getElementById('gpxProcessBtn');
  const downloadBtn = document.getElementById('gpxDownloadBtn');
  const clearBtn = document.getElementById('gpxClearBtn');
  if (!dzPhotos || !dzTrack) return;

  function wireDropzone(dz, input, chooseBtn, handler) {
    chooseBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files.length) handler(input.files); input.value = ''; });
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
      if (dropped && dropped.length) handler(dropped);
    });
  }

  wireDropzone(dzPhotos, photosInput, choosePhotosBtn, _gpxHandlePhotoFiles);
  wireDropzone(dzTrack, trackInput, chooseTrackBtn, _gpxHandleTrackFile);

  if (processBtn) processBtn.addEventListener('click', _gpxProcess);
  if (downloadBtn) downloadBtn.addEventListener('click', _gpxDownloadAll);
  if (clearBtn) clearBtn.addEventListener('click', _gpxClearAll);

  _gpxUpdateCounts();
})();
