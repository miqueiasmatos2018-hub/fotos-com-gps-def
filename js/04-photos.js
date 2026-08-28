// ==========================================================================
// 04-photos.js
// Nós de DOM em cache, importação de arquivos, leitura de EXIF, detecção de
// GPS duplicado, lista lateral e renomeação.
//
// Carregado como script clássico (não módulo) para que todos os arquivos
// compartilhem o mesmo escopo global, igual à build original de arquivo
// único. A ORDEM DE CARREGAMENTO IMPORTA -- veja as tags <script> no fim
// do index.html.
// ==========================================================================

const fileInput    = document.getElementById('fileInput');
const photoList    = document.getElementById('photoList');
const detailPanel  = document.getElementById('detailPanel');
const detailRows   = document.getElementById('detailRows');
const _elStatTotal = document.getElementById('statTotal');
const _elStatGPS   = document.getElementById('statGPS');
const _elStatNoGPS = document.getElementById('statNoGPS');
const emptyState = document.getElementById('emptyState');
const progressFill = document.getElementById('progressFill');

// Quantas fotos são decodificadas ao mesmo tempo para gerar miniatura.
// Sem esse limite, um lote de 200 fotos de 12MP disparava 200 decodificações
// simultâneas e travava (ou derrubava) a aba por falta de memória.
const THUMB_CONCURRENCY = 4;
const THUMB_SIZE = 80;

// input de arquivo (escondido, acionado pela UI do mapa)
fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
  setTimeout(() => { e.target.value = ''; }, 100);
});

let _handlingFiles = false;

async function handleFiles(fileList) {
  const all = Array.from(fileList).filter(f =>
    f.type.startsWith('image/') ||
    /\.(jpe?g|jpg|png|gif|webp|tiff?|bmp|heic|heif)$/i.test(f.name)
  );
  if (!all.length) return;

  // Soltar um segundo lote no mapa enquanto o primeiro ainda processa
  // embaralhava as duas barras de progresso. Enfileira em vez de concorrer.
  if (_handlingFiles) {
    await new Promise(resolve => {
      const wait = setInterval(() => { if (!_handlingFiles) { clearInterval(wait); resolve(); } }, 120);
    });
  }
  _handlingFiles = true;

  const procWrap  = document.getElementById('procBarWrap');
  const procFill  = document.getElementById('procBarFill');
  const procLabel = document.getElementById('procBarLabel');
  if (procWrap)  procWrap.style.display = 'flex';
  if (procFill)  procFill.style.width = '0%';
  if (procLabel) procLabel.textContent = `Lendo EXIF 0 / ${all.length}...`;

  try {
    // ── Fase 1: EXIF em lotes paralelos (rápido, sem decodificar a imagem)
    const added = [];
    await runWithConcurrency(all, 8, async (file) => {
      try {
        const photo = await processFile(file);
        if (photo) added.push(photo);
      } catch (err) {
        console.error('Erro ao processar arquivo:', file && file.name, err);
      }
    }, (done, total) => {
      if (procLabel) procLabel.textContent = `Lendo EXIF ${done} / ${total}...`;
      if (procFill)  procFill.style.width = Math.round(done / total * 35) + '%';
    });

    // Adiciona todos os marcadores de uma vez (muito mais rápido que um a um)
    const pendingMarkers = added.filter(p => markers[p.id]).map(p => markers[p.id]);
    if (pendingMarkers.length) addMarkersToActiveLayer(pendingMarkers);

    if (photos.some(p => p.lat != null)) {
      emptyState.style.display = 'none';
      document.getElementById('fitAllBtn').style.display = 'block';
      document.getElementById('clearBtn').style.display = 'block';
    }
    if (photos.length) document.getElementById('exportBar').classList.add('visible');

    updateStats();
    refreshDateTimeline();
    renderSortedList();

    // ── Fase 2: miniaturas + megapixels, com concorrência limitada.
    //
    // A versão anterior disparava tudo de uma vez e depois ficava em um
    // setInterval de 100ms esperando `photo.thumbUrl` aparecer. Se a imagem
    // falhasse ao decodificar (HEIC, arquivo corrompido), esse intervalo
    // nunca terminava: a barra de progresso ficava presa na tela para
    // sempre e o `Promise.all` nunca resolvia. Agora cada foto é uma
    // promise de verdade, que resolve inclusive em caso de erro.
    if (procLabel) procLabel.textContent = `Gerando miniaturas 0 / ${added.length}...`;
    if (procFill)  procFill.style.width = '35%';

    await runWithConcurrency(added, THUMB_CONCURRENCY, async (photo) => {
      await buildThumbForPhoto(photo);
    }, (done, total) => {
      if (procFill)  procFill.style.width = (35 + Math.round(done / total * 65)) + '%';
      if (procLabel) procLabel.textContent = `Miniaturas ${done} / ${total}...`;
    });

    if (procLabel) procLabel.textContent = `✓ ${all.length} foto${all.length > 1 ? 's' : ''} processada${all.length > 1 ? 's' : ''}`;
    if (procFill)  procFill.style.width = '100%';
    setTimeout(() => {
      if (procWrap) procWrap.style.display = 'none';
      if (procFill) procFill.style.width = '0%';
      if (progressFill) progressFill.style.width = '0%';
    }, 1200);

    checkDuplicateGps();
    checkPhotoIssues();
  } finally {
    _handlingFiles = false;
  }
}

// ─── MINIATURA + MEGAPIXELS ───────────────────────────────────────────────
// Dimensões vêm do EXIF quando disponível (PixelXDimension/PixelYDimension),
// o que evita decodificar a imagem inteira só para saber quantos MP ela tem.
// A miniatura usa createImageBitmap com redimensionamento no próprio
// decodificador quando o navegador suporta -- muito mais leve que carregar
// a foto original em um <img> de 8000×6000.
function _exifDimensions(exif) {
  if (!exif) return null;
  const w = toNum(exif.ExifImageWidth  ?? exif.PixelXDimension ?? exif.ImageWidth);
  const h = toNum(exif.ExifImageHeight ?? exif.PixelYDimension ?? exif.ImageHeight);
  if (w && h && w > 0 && h > 0) return { w, h };
  return null;
}

function _drawThumbFromSource(source, srcW, srcH) {
  const c = document.createElement('canvas');
  c.width = c.height = THUMB_SIZE;
  const ctx = c.getContext('2d');
  const scale = Math.max(THUMB_SIZE / srcW, THUMB_SIZE / srcH);
  const tw = srcW * scale, th = srcH * scale;
  ctx.drawImage(source, (THUMB_SIZE - tw) / 2, (THUMB_SIZE - th) / 2, tw, th);
  return c.toDataURL('image/jpeg', 0.55);
}

async function buildThumbForPhoto(photo) {
  const known = _exifDimensions(photo.exif);
  let width = known ? known.w : null;
  let height = known ? known.h : null;

  try {
    if (window.createImageBitmap) {
      // Se já sabemos as dimensões, pedimos ao decodificador uma versão
      // reduzida direto -- não há motivo para materializar a imagem cheia.
      let bmp;
      if (known) {
        const scale = Math.max(THUMB_SIZE / known.w, THUMB_SIZE / known.h);
        bmp = await createImageBitmap(photo.file, {
          resizeWidth: Math.max(1, Math.round(known.w * scale)),
          resizeHeight: Math.max(1, Math.round(known.h * scale)),
          resizeQuality: 'high'
        });
      } else {
        bmp = await createImageBitmap(photo.file);
        width = bmp.width; height = bmp.height;
      }
      photo.thumbUrl = _drawThumbFromSource(bmp, bmp.width, bmp.height);
      if (bmp.close) bmp.close();
    } else {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('decode falhou'));
        i.src = photo.url;
      });
      width = width || img.naturalWidth;
      height = height || img.naturalHeight;
      photo.thumbUrl = _drawThumbFromSource(img, img.naturalWidth, img.naturalHeight);
    }
  } catch (err) {
    // Formatos que o navegador não decodifica (HEIC na maioria dos casos).
    // Segue sem miniatura em vez de travar o lote inteiro.
    console.warn('Miniatura indisponível para', photo.name, err);
    photo.thumbFailed = true;
  }

  if (width && height) {
    photo.imgWidth = width;
    photo.imgHeight = height;
    photo.megapixels = (width * height) / 1_000_000;
  }

  applyThumbToUi(photo);
  return photo;
}

function applyThumbToUi(photo) {
  const item = document.querySelector(`.photo-item[data-id="${photo.id}"]`);

  if (photo.thumbUrl) {
    const thumbEl = item && item.querySelector('.photo-thumb');
    if (thumbEl) thumbEl.src = photo.thumbUrl;

    // setIcon funciona mesmo com o marcador dentro de um cluster fechado
    // (não depende do elemento estar no DOM).
    const m = markers[photo.id];
    if (m) {
      m.setIcon(L.divIcon({
        className: '',
        html: `<div class="custom-marker-hitbox"><div class="custom-marker" id="marker-${photo.id}"><img src="${photo.thumbUrl}" alt=""></div></div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 44],
        popupAnchor: [0, -46]
      }));
      if (activeId === photo.id) {
        const el = document.getElementById(`marker-${photo.id}`);
        if (el) el.classList.add('active');
      }
    }
  }

  const dot = item && item.querySelector('.mp-dot');
  if (dot) {
    if (photo.megapixels != null) {
      dot.classList.remove('unknown');
      dot.classList.add(photo.megapixels >= MIN_PHOTO_MP ? 'ok' : 'low');
      dot.title = `${photo.megapixels.toFixed(1)} MP — ${photo.imgWidth}×${photo.imgHeight}`;
    } else {
      dot.title = 'Não foi possível medir a resolução';
    }
  }
}

const _knownDupKeys = new Set(); // coordenadas duplicadas já avisadas

function checkDuplicateGps() {
  const withGps = photos.filter(p => p.lat != null && p.lng != null);

  // Reset dos badges (também precisa rodar quando sobra menos de 2 fotos,
  // senão um badge "duplicado" ficava marcado depois de apagar a outra).
  document.querySelectorAll('.photo-badge.dup-gps').forEach(el => {
    el.classList.remove('dup-gps');
    el.classList.add('gps');
  });
  if (withGps.length < 2) return;

  const seen = {};
  for (const p of withGps) {
    const key = `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
    if (!seen[key]) seen[key] = [];
    seen[key].push(p.id);
  }

  let newDupCount = 0;

  for (const [key, ids] of Object.entries(seen)) {
    if (ids.length > 1) {
      if (!_knownDupKeys.has(key)) newDupCount += ids.length;
      _knownDupKeys.add(key);
      ids.forEach(id => {
        const badge = document.querySelector(`.photo-item[data-id="${id}"] .photo-badge`);
        if (badge) { badge.classList.remove('gps'); badge.classList.add('dup-gps'); }
      });
    }
  }

  // Só abre o aviso se houver duplicatas NOVAS neste lote
  if (newDupCount === 0) return;

  const popup   = document.getElementById('dupGpsPopup');
  const countEl = document.getElementById('dupGpsCount');
  if (!popup || !countEl) return;

  countEl.textContent = newDupCount;
  popup.classList.add('show');
  clearTimeout(window._dupGpsPopupTimer);
  window._dupGpsPopupTimer = setTimeout(() => popup.classList.remove('show'), 8000);
}

let _fileIdCounter = 0;
async function processFile(file) {
  const id = `${Date.now()}_${++_fileIdCounter}`;
  const url = URL.createObjectURL(file);

  let exif = {};
  let lat = null, lng = null;

  try {
    exif = await exifr.parse(file, {
      // Todos os segmentos -- crítico para JPGs de iPhone
      tiff:        true,
      exif:        true,
      gps:         true,
      ifd0:        true,
      ifd1:        true,
      interop:     true,
      xmp:         true,
      iptc:        false,
      jfif:        false,
      ihdr:        false,
      translateKeys:   true,
      translateValues: true,
      reviveValues:    true,
      sanitize:        true,
      mergeOutput:     true,
    }) || {};

    // exifr normaliza GPS em .latitude / .longitude -- mas o iPhone também
    // expõe GPSLatitude + GPSLatitudeRef como arrays crus; trata os dois.
    if (exif.latitude != null && exif.longitude != null) {
      lat = exif.latitude;
      lng = exif.longitude;
    } else if (exif.GPSLatitude != null && exif.GPSLongitude != null) {
      const toDecimal = (arr, ref) => {
        const parts = Array.isArray(arr) ? arr : [arr, 0, 0];
        const d = toNum(parts[0]) || 0, m = toNum(parts[1]) || 0, s = toNum(parts[2]) || 0;
        const dec = d + m / 60 + s / 3600;
        return (ref === 'S' || ref === 'W') ? -dec : dec;
      };
      lat = toDecimal(exif.GPSLatitude,  exif.GPSLatitudeRef);
      lng = toDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
    }

    // Coordenadas fora de faixa (EXIF corrompido) viravam marcadores em
    // lugares impossíveis; melhor tratar como "sem GPS".
    if (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0))) {
      lat = null; lng = null;
    }
  } catch (e) {
    // sem EXIF legível -- segue com o arquivo mesmo assim
  }

  const photo = { id, file, url, name: file.name, lat, lng, exif, megapixels: null };
  photos.push(photo);

  addListItem(photo);

  if (lat != null) {
    const m = buildMarker(photo);
    markers[photo.id] = m; // adicionado à camada em lote por handleFiles()
  }

  return photo;
}

function refreshDateTimeline() {
  const container = document.getElementById('dateTimeline');
  if (!container) return;

  if (!photos.length) {
    container.innerHTML = '<div class="date-timeline-empty">NENHUMA FOTO ADICIONADA</div>';
    return;
  }

  // Agrupa por data (YYYY-MM-DD); sem data reconhecível cai em "Sem data"
  const UNKNOWN = 'Sem data';
  const groups = {};
  for (const p of photos) {
    const d = getPhotoDate(p);
    let key = UNKNOWN;
    if (d) {
      const y  = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dy = String(d.getDate()).padStart(2, '0');
      key = `${y}-${mo}-${dy}`;
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  // Mais recente primeiro, "Sem data" por último
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === UNKNOWN) return 1;
    if (b === UNKNOWN) return -1;
    return b.localeCompare(a);
  });

  const maxCount = Math.max(...sortedKeys.map(k => groups[k].length));

  container.innerHTML = '';
  for (const key of sortedKeys) {
    const count = groups[key].length;
    const pct   = Math.round(count / maxCount * 100);

    let label = key;
    if (key !== UNKNOWN) {
      const [y, mo, d] = key.split('-');
      label = `${d}/${mo}/${y}`;
    }

    const row = document.createElement('div');
    row.className = 'date-group';
    row.dataset.date = key;
    row.innerHTML = `
      <span class="date-group-label">${escapeHtml(label)}</span>
      <div class="date-group-bar"><div class="date-group-fill" style="width:${pct}%"></div></div>
      <span class="date-group-count">${count}</span>
    `;

    // Clique: rola até a primeira foto da data e destaca todas dela
    row.addEventListener('click', () => {
      document.querySelectorAll('.date-group').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const ids = groups[key].map(p => p.id);
      const firstItem = document.querySelector(`.photo-item[data-id="${ids[0]}"]`);
      if (firstItem) {
        firstItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        ids.forEach(id => {
          const el = document.querySelector(`.photo-item[data-id="${id}"]`);
          if (el) {
            el.classList.add('date-flash');
            setTimeout(() => el.classList.remove('date-flash'), 1200);
          }
        });
      }
    });

    container.appendChild(row);
  }
}

function addListItem(photo) {
  const item = document.createElement('div');
  item.className = 'photo-item';
  item.dataset.id = photo.id;
  item.style.animationDelay = '0ms';

  const hasGPS = photo.lat != null;
  const coordText = hasGPS
    ? `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`
    : 'Sem dados de GPS';
  const safeName = escapeHtml(photo.name);

  item.innerHTML = `
    <input type="checkbox" class="photo-select-checkbox" title="Selecionar para baixar">
    <img class="photo-thumb" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="">
    <div class="photo-info">
      <div class="photo-name">
        <span class="photo-name-text" title="${safeName}">${safeName}</span>
        <button class="relocate-btn" title="Clicar no mapa para definir localização">🗺</button>
        <button class="rename-btn" title="Renomear">✎</button>
      </div>
      <div class="photo-coords ${hasGPS ? 'has-gps' : 'no-gps'}">${coordText}</div>
    </div>
    <div class="dot-group">
      <div class="dot-with-label">
        <div class="photo-badge ${hasGPS ? 'gps' : 'no-gps'}"></div>
        <span class="dot-label" style="color:var(--accent)">GPS</span>
      </div>
      <div class="dot-with-label">
        <div class="mp-dot unknown" title="Calculando…"></div>
        <span class="dot-label mp-label" style="color:var(--accent)">12MP</span>
      </div>
    </div>
  `;

  const checkbox = item.querySelector('.photo-select-checkbox');
  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) selectedPhotoIds.add(photo.id);
    else selectedPhotoIds.delete(photo.id);
    _updateSelectedPhotosBar();
  });

  item.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.classList.contains('name-input')) return;
    selectPhoto(photo.id);
  });

  item.querySelector('.rename-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    startRename(photo.id, item);
  });

  item.querySelector('.relocate-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    selectPhoto(photo.id);
    startRelocateMode(photo.id);
  });

  item.querySelector('.photo-name-text').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(photo.id, item);
  });

  photoList.appendChild(item);
}

function startRename(id, item) {
  const photo = photos.find(p => p.id == id);
  if (!photo) return;

  const nameEl = item.querySelector('.photo-name');
  const nameText = item.querySelector('.photo-name-text');
  const renameBtn = item.querySelector('.rename-btn');

  if (nameEl.querySelector('.name-input')) return; // já editando

  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = photo.name;
  input.maxLength = 120;

  nameText.style.display = 'none';
  renameBtn.style.display = 'none';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  // Antes, o ESC removia o input -- o que dispara `blur` -- e o handler de
  // blur gravava mesmo assim. Ou seja: cancelar salvava. Este sinalizador
  // faz o ESC realmente cancelar.
  let cancelled = false;
  let finished = false;

  function cleanup() {
    nameText.style.display = '';
    renameBtn.style.display = '';
    if (input.parentNode) input.remove();
  }

  function commit() {
    if (finished) return;
    finished = true;
    if (cancelled) { cleanup(); return; }

    const newName = input.value.trim() || photo.name;
    cleanup();
    if (newName === photo.name) return;

    pushUndo(photo);
    photo.name = newName;

    nameText.textContent = newName;
    nameText.title = newName;

    // Reaproveita o popup padrão em vez de montar um HTML paralelo: a
    // versão anterior substituía o popup editável por uma lista estática,
    // então renomear pela barra lateral fazia o marcador perder os campos
    // de edição até a página ser recarregada.
    if (markers[id]) markers[id].setPopupContent(buildPhotoPopupHtml(photo));

    if (activeId == id) showDetail(photo);
    renderSortedList();
    showToast(`Renomeada para <span class="accent">${escapeHtml(newName)}</span>`);
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // não deixa Delete/Tab acionarem atalhos globais
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelled = true; commit(); }
  });
  input.addEventListener('blur', commit);
}
