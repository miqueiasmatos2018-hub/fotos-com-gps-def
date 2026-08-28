// ==========================================================================
// 06-export.js
// Gravação de EXIF no JPEG e exportação individual / em lote (ZIP ou pasta).
//
// MUDANÇA IMPORTANTE NESTA REVISÃO: fotos que já são JPEG não são mais
// redesenhadas em um canvas na exportação. A versão anterior recomprimia
// TODA foto exportada a 92% de qualidade e reconstruía o EXIF só com os
// poucos campos listados aqui -- ou seja, cada exportação degradava a
// imagem e descartava metadados originais (orientação, dados do fabricante,
// perfil, subsegundos, etc). Agora os bytes originais são preservados e só
// o bloco EXIF é reescrito, mesclado por cima do que já existia. O caminho
// via canvas continua existindo como último recurso (PNG/WEBP/HEIC ou JPEG
// que o piexif não conseguir processar).
//
// Carregado como script clássico (não módulo) -- veja index.html.
// ==========================================================================

function ensureJpgExtension(name) {
  return name.replace(/\.(jpe?g|heic|heif|tiff?|png|webp|bmp|gif)$/i, '') + '.jpg';
}

// Dois arquivos com o mesmo nome dentro do ZIP faziam o segundo sobrescrever
// o primeiro silenciosamente -- a pessoa baixava 40 fotos e recebia 38.
function makeUniqueName(name, usedSet) {
  if (!usedSet.has(name)) { usedSet.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  let candidate;
  do { candidate = `${base} (${i++})${ext}`; } while (usedSet.has(candidate));
  usedSet.add(candidate);
  return candidate;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // O anchor precisa estar no documento antes do clique: em alguns
  // navegadores (e servindo o site por IP na rede local) um anchor solto
  // simplesmente não dispara o download.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

// Graus decimais -> [grau, minuto, segundo] racionais para o piexif.
// O denominador dos segundos era 100 (≈0,3 m de resolução); com 10000 o
// erro de arredondamento vira alguns milímetros, o que importa quando a
// coordenada foi ajustada à mão no mapa.
function decimalToRational(decimal) {
  const d = Math.abs(decimal);
  const deg = Math.floor(d);
  const minFull = (d - deg) * 60;
  const min = Math.floor(minFull);
  const sec = Math.round((minFull - min) * 60 * 10000);
  return [[deg, 1], [min, 1], [sec, 10000]];
}

function _fileToBinaryString(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      // String.fromCharCode(...bytes) estoura a pilha em arquivos grandes;
      // por isso a conversão é feita em blocos.
      let out = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      resolve(out);
    };
    reader.readAsArrayBuffer(file);
  });
}

function _binaryStringToBlob(bin, type) {
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i) & 0xff;
  return new Blob([arr], { type: type || 'image/jpeg' });
}

function _isJpegFile(photo) {
  if (!photo.file) return false;
  if (photo.file.type) return photo.file.type === 'image/jpeg' || photo.file.type === 'image/jpg';
  return /\.jpe?g$/i.test(photo.name || photo.file.name || '');
}

// Monta o dicionário EXIF a ser gravado, partindo do que o arquivo já tinha
// (quando disponível) e sobrescrevendo apenas o que o app edita.
function _buildExifObject(photo, baseExifObj) {
  const exif = photo.exif || {};
  const obj = {
    '0th':  Object.assign({}, (baseExifObj && baseExifObj['0th'])  || {}),
    'Exif': Object.assign({}, (baseExifObj && baseExifObj['Exif']) || {}),
    'GPS':  Object.assign({}, (baseExifObj && baseExifObj['GPS'])  || {}),
    'Interop': (baseExifObj && baseExifObj['Interop']) || {},
    '1st': (baseExifObj && baseExifObj['1st']) || {},
    'thumbnail': (baseExifObj && baseExifObj.thumbnail) || null
  };

  const zerothIfd = obj['0th'];
  const exifIfd = obj['Exif'];
  const gpsIfd = obj['GPS'];

  if (exif.Make)     zerothIfd[piexif.ImageIFD.Make]     = String(exif.Make);
  if (exif.Model)    zerothIfd[piexif.ImageIFD.Model]    = String(exif.Model);
  if (exif.Software) zerothIfd[piexif.ImageIFD.Software] = String(exif.Software);
  zerothIfd[piexif.ImageIFD.ImageDescription] = photo.name;

  if (exif.DateTimeOriginal) {
    // piexif espera "YYYY:MM:DD HH:MM:SS"
    let dt = exif.DateTimeOriginal;
    if (dt instanceof Date) {
      const p = n => String(n).padStart(2, '0');
      dt = `${dt.getFullYear()}:${p(dt.getMonth() + 1)}:${p(dt.getDate())} ` +
           `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
    } else if (typeof dt === 'string') {
      dt = dt.replace(/-/g, ':').replace('T', ' ').slice(0, 19);
    }
    exifIfd[piexif.ExifIFD.DateTimeOriginal]  = dt;
    exifIfd[piexif.ExifIFD.DateTimeDigitized] = dt;
    zerothIfd[piexif.ImageIFD.DateTime] = dt;
  }

  const focal = toNum(exif.FocalLength);
  if (focal != null) exifIfd[piexif.ExifIFD.FocalLength] = [Math.round(focal * 100), 100];
  const fnum = toNum(exif.FNumber);
  if (fnum != null) exifIfd[piexif.ExifIFD.FNumber] = [Math.round(fnum * 100), 100];
  const iso = toNum(exif.ISO);
  if (iso != null) exifIfd[piexif.ExifIFD.ISOSpeedRatings] = Math.round(iso);
  const expo = toNum(exif.ExposureTime);
  if (expo != null && expo > 0) exifIfd[piexif.ExifIFD.ExposureTime] = [1, Math.round(1 / expo)];
  if (exif.LensModel) exifIfd[piexif.ExifIFD.LensModel] = String(exif.LensModel);

  if (photo.lat != null && photo.lng != null) {
    gpsIfd[piexif.GPSIFD.GPSLatitudeRef]  = photo.lat >= 0 ? 'N' : 'S';
    gpsIfd[piexif.GPSIFD.GPSLatitude]     = decimalToRational(photo.lat);
    gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = photo.lng >= 0 ? 'E' : 'W';
    gpsIfd[piexif.GPSIFD.GPSLongitude]    = decimalToRational(photo.lng);
    const alt = toNum(exif.GPSAltitude);
    if (alt != null) {
      gpsIfd[piexif.GPSIFD.GPSAltitudeRef] = alt >= 0 ? 0 : 1;
      gpsIfd[piexif.GPSIFD.GPSAltitude]    = [Math.round(Math.abs(alt) * 100), 100];
    }
  }

  return obj;
}

// Caminho de último recurso: redesenha em canvas (perde qualidade). Só usado
// para formatos que não são JPEG ou quando a injeção direta falha.
async function _rebuildViaCanvas(photo) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Falha ao decodificar a imagem'));
    i.src = photo.url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

  const exifBytes = piexif.dump(_buildExifObject(photo, null));
  const jpegWithExif = piexif.insert(exifBytes, dataUrl);

  const binary = atob(jpegWithExif.split(',')[1]);
  return _binaryStringToBlob(binary, 'image/jpeg');
}

async function buildJpegWithExif(photo) {
  if (_isJpegFile(photo)) {
    try {
      const bin = await _fileToBinaryString(photo.file);
      let base = null;
      try { base = piexif.load(bin); } catch (_) { base = null; }
      const exifBytes = piexif.dump(_buildExifObject(photo, base));
      const withExif = piexif.insert(exifBytes, bin);
      return _binaryStringToBlob(withExif, 'image/jpeg');
    } catch (err) {
      console.warn('Injeção direta de EXIF falhou, usando canvas:', photo.name, err);
    }
  }
  return _rebuildViaCanvas(photo);
}

window.exportAllSmart = async function() {
  if (!photos.length) { showToast('Nenhuma foto para exportar'); return; }

  // File System Access API primeiro (salva direto na pasta, sem SmartScreen)
  if (window.showDirectoryPicker) {
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
        id: 'fotos-export'
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // cancelado pela pessoa
      dirHandle = null;                          // sem permissão -> cai no ZIP
    }

    if (dirHandle) {
      const overlay = document.getElementById('exportOverlay');
      const sub     = document.getElementById('exportOverlaySub');
      const fill    = document.getElementById('exportProgressFill');
      overlay.classList.add('show');
      fill.style.width = '0%';

      try {
        const folder = await dirHandle.getDirectoryHandle('fotos renomeadas', { create: true });
        const used = new Set();
        let errors = 0;

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          sub.textContent = `Salvando ${i + 1} / ${photos.length} — ${photo.name}`;
          fill.style.width = ((i + 1) / photos.length * 100) + '%';

          try {
            const blob = await buildJpegWithExif(photo);
            const filename = makeUniqueName(ensureJpgExtension(photo.name), used);
            const fileHandle = await folder.getFileHandle(filename, { create: true });
            const writable   = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch (perPhoto) {
            errors++;
            console.error('Não foi possível salvar', photo.name, perPhoto);
          }
        }

        fill.style.width = '100%';
        setTimeout(() => {
          overlay.classList.remove('show');
          fill.style.width = '0%';
          showToast(errors
            ? `✓ ${photos.length - errors} fotos salvas (${errors} com erro)`
            : `✓ <span class="accent">${photos.length} fotos</span> salvas na pasta!`);
        }, 300);
        return;
      } catch (e) {
        // A pasta ficou indisponível no meio do caminho: fecha o overlay
        // antes de cair no ZIP, senão ele ficava travado na tela.
        overlay.classList.remove('show');
        fill.style.width = '0%';
        console.error('Exportação para pasta falhou, usando ZIP:', e);
      }
    }
  }
  // Alternativa: ZIP
  exportAll();
};

// Mostra/esconde o botão "BAIXAR SELECIONADAS" e mantém a contagem em dia.
function _updateSelectedPhotosBar() {
  const btn = document.getElementById('exportSelectedBtn');
  const countEl = document.getElementById('selectedPhotosCount');
  if (!btn || !countEl) return;
  const count = selectedPhotoIds.size;
  countEl.textContent = count;
  btn.style.display = count > 0 ? '' : 'none';
}

// Núcleo compartilhado por "exportar tudo" e "baixar selecionadas" -- as
// duas funções eram cópias quase idênticas, e correções feitas em uma
// nunca chegavam à outra.
async function _exportPhotosAsZip(list, folderName, zipName) {
  const overlay = document.getElementById('exportOverlay');
  const sub     = document.getElementById('exportOverlaySub');
  const fill    = document.getElementById('exportProgressFill');

  overlay.classList.add('show');
  fill.style.width = '0%';

  try {
    const zip    = new JSZip();
    const folder = zip.folder(folderName);
    const used   = new Set();
    let errors   = 0;

    for (let i = 0; i < list.length; i++) {
      const photo = list[i];
      sub.textContent = `Processando ${i + 1} / ${list.length} — ${photo.name}`;
      fill.style.width = ((i / list.length) * 85) + '%';

      const filename = makeUniqueName(ensureJpgExtension(photo.name), used);
      try {
        folder.file(filename, await buildJpegWithExif(photo));
      } catch (photoErr) {
        console.warn('buildJpegWithExif falhou em', photo.name, photoErr);
        try {
          const origBlob = photo.file instanceof File
            ? photo.file
            : await fetch(photo.url).then(r => r.blob());
          folder.file(filename, origBlob);
        } catch (e2) {
          errors++;
          console.error('Não foi possível exportar', photo.name, e2);
        }
      }
      // Devolve o controle ao navegador de tempos em tempos para a barra
      // de progresso realmente animar em lotes grandes.
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }

    sub.textContent = 'Comprimindo ZIP…';
    fill.style.width = '92%';

    // Fotos JPEG já são comprimidas: nível 0 (store) gera o mesmo tamanho
    // final e é muito mais rápido que DEFLATE nível 3.
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE'
    }, meta => {
      fill.style.width = (92 + meta.percent * 0.08) + '%';
    });

    fill.style.width = '100%';
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
      triggerDownload(zipBlob, zipName);
      showToast(errors > 0
        ? `Baixadas ${list.length - errors} fotos (${errors} com erro)`
        : `Baixadas <span class="accent">${list.length} fotos</span> em ${escapeHtml(zipName)}`);
    }, 300);
  } catch (e) {
    console.error(e);
    showToast('Erro na exportação: ' + e.message);
  } finally {
    // Sem este finally, qualquer erro inesperado deixava o overlay preto
    // cobrindo o app até recarregar a página.
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
    }, 400);
  }
}

async function _exportSinglePhoto(photo) {
  const overlay = document.getElementById('exportOverlay');
  const sub = document.getElementById('exportOverlaySub');
  const fill = document.getElementById('exportProgressFill');
  overlay.classList.add('show');
  sub.textContent = `Processando ${photo.name}…`;
  fill.style.width = '40%';
  try {
    const blob = await buildJpegWithExif(photo);
    fill.style.width = '100%';
    triggerDownload(blob, ensureJpgExtension(photo.name));
    showToast(`Exportada <span class="accent">${escapeHtml(ensureJpgExtension(photo.name))}</span> com EXIF`);
  } catch (e) {
    console.error(e);
    showToast('Erro na exportação: ' + e.message);
  } finally {
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
    }, 300);
  }
}

window.exportSelectedPhotos = async function() {
  const selected = photos.filter(p => selectedPhotoIds.has(p.id));
  if (!selected.length) { showToast('Marque ao menos uma foto para baixar'); return; }
  if (selected.length === 1) return _exportSinglePhoto(selected[0]);
  return _exportPhotosAsZip(selected, 'fotos selecionadas', 'fotos selecionadas.zip');
};

window.exportAll = async function() {
  if (!photos.length) return;
  if (photos.length === 1) return _exportSinglePhoto(photos[0]);
  return _exportPhotosAsZip(photos, 'fotos renomeadas', 'fotos renomeadas.zip');
};
