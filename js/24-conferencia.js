// ==========================================================================
// 24-conferencia.js
// "Conferência" tab: checks a local folder (typically a Dropbox-synced
// "01_CADASTRAL" folder) against the fixed set of subfolders/files a
// complete OAE cadastral package must have, and reports what's missing.
// Also checks each photo in 02_FOTOS_SUPERIORES/03_FOTOS_INFERIORES for
// resolution (>=12MP), file size (<29MB) and GPS metadata (via exifr,
// already loaded for the Fotos tab -- see _checkPhotosQuality).
//
// Folder reading uses the plain <input type="file" webkitdirectory> input
// instead of window.showDirectoryPicker() (used elsewhere in this app):
// it's read-only here (no writing back into the folder), so the broader
// browser support of a directory-picking file input wins over the more
// restrictive/Chromium-only File System Access API used for read/write
// flows in 06-export.js, 15-routes.js, 20-fotos-superiores.js, 22-gpx.js.
//
// Same naming convention as every other tab in this app:
//  1. Every DOM id is prefixed "conf" (confResults, confFolderInput, ...).
//  2. Every CSS class this file generates or queries is prefixed "conf-".
//  3. Everything is wrapped in one top-level IIFE so none of these
//     internal names leak into the shared global scope.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

(function(){

  "use strict";

  // ─── FOLDER TREE ────────────────────────────────────────────────────────
  // Builds a small in-memory tree { name, dirs: {lowerName: node}, files:
  // [{name, lower, size}] } out of the flat FileList a webkitdirectory
  // input returns (each File carries a full "Folder/Sub/file.ext" path in
  // .webkitRelativePath). The returned root's contents ARE the picked
  // folder's contents -- its own name is kept separately (root.name) just
  // for display, matching how 01_CADASTRAL itself is never one of "its
  // own" required entries.
  // Shared by both entry points below: the file input (webkitRelativePath
  // on every File) and a folder dragged onto the dropzone (relative paths
  // walked by hand via the DataTransferItem entry API, see _readDroppedItems).
  // Each file entry keeps a reference to the actual File object (not just
  // its name/size) so 02_FOTOS_SUPERIORES/03_FOTOS_INFERIORES can later
  // read resolution/size/GPS straight out of the real file -- see
  // _checkPhotosQuality below.
  function _buildConfTreeFromPaths(entries) {
    const root = { name: null, dirs: {}, files: [] };
    entries.forEach(({ relativePath, size, file }) => {
      const parts = (relativePath || '').split('/').filter(Boolean);
      if (!parts.length) return;
      if (root.name == null) root.name = parts[0];
      let node = root;
      for (let p = 1; p < parts.length - 1; p++) {
        const seg = parts[p];
        const key = seg.toLowerCase();
        if (!node.dirs[key]) node.dirs[key] = { name: seg, dirs: {}, files: [] };
        node = node.dirs[key];
      }
      const fname = parts[parts.length - 1];
      if (parts.length > 1) node.files.push({ name: fname, lower: fname.toLowerCase(), size, file });
    });
    return root;
  }

  function _buildConfTree(fileList) {
    const entries = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      entries.push({ relativePath: file.webkitRelativePath || file.name, size: file.size, file });
    }
    return _buildConfTreeFromPaths(entries);
  }

  // ─── DRAG-AND-DROP FOLDER READING ───────────────────────────────────────
  // <input webkitdirectory> only fires from a click; a folder dragged onto
  // the dropzone has to be walked by hand through the (Chromium/WebKit)
  // DataTransferItem.webkitGetAsEntry() -> FileSystemDirectoryEntry API,
  // which is the only way to read a dropped folder's contents recursively
  // (dataTransfer.files alone would flatten everything with no path info).
  function _readEntriesBatch(dirReader) {
    return new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
  }

  async function _readAllEntries(dirReader) {
    let all = [];
    let batch;
    do {
      batch = await _readEntriesBatch(dirReader);
      all = all.concat(batch);
    } while (batch.length > 0);
    return all;
  }

  async function _walkEntry(entry, path, out) {
    if (entry.isFile) {
      await new Promise((resolve, reject) => {
        entry.file(file => { out.push({ relativePath: path + entry.name, size: file.size, file }); resolve(); }, reject);
      });
    } else if (entry.isDirectory) {
      const children = await _readAllEntries(entry.createReader());
      for (const child of children) {
        await _walkEntry(child, path + entry.name + '/', out);
      }
    }
  }

  async function _readDroppedItems(dataTransferItems) {
    const topEntries = [];
    for (let i = 0; i < dataTransferItems.length; i++) {
      const entry = dataTransferItems[i].webkitGetAsEntry && dataTransferItems[i].webkitGetAsEntry();
      if (entry) topEntries.push(entry);
    }
    const out = [];
    for (const entry of topEntries) {
      await _walkEntry(entry, '', out);
    }
    return out;
  }

  // Case-insensitive child-folder lookup, tolerant of a trailing note the
  // user's spec put in parentheses (e.g. "01_PROJETO_RTX (.JOB)" -> we only
  // ever look for "01_projeto_rtx") by falling back to a startsWith match.
  function _findDir(node, targetName) {
    if (!node) return null;
    const key = targetName.toLowerCase();
    if (node.dirs[key]) return node.dirs[key];
    for (const k in node.dirs) {
      if (k.startsWith(key)) return node.dirs[k];
    }
    return null;
  }

  function _filesWithExt(node, exts) {
    if (!node) return [];
    return node.files.filter(f => exts.some(ext => f.lower.endsWith(ext)));
  }

  function _dirCount(node) {
    return node ? Object.keys(node.dirs).length : 0;
  }

  // ─── SEQUENTIAL PHOTO NUMBERING (Fotos Superiores/Inferiores) ──────────
  // Pulls every "F-NN" style number out of a folder's filenames (order in
  // the name doesn't matter, so "010203_F-01.JPG" works the same as
  // "F-01_010203.JPG") and checks the count and the sequence for gaps.
  function _extractFNumbers(files) {
    const re = /F[-_]?(\d{1,3})/i;
    const nums = [];
    files.forEach(f => {
      const m = f.name.match(re);
      if (m) nums.push(parseInt(m[1], 10));
    });
    return nums;
  }

  function _checkSequentialPhotos(node, opts) {
    if (!node) return { status: 'fail', detail: 'Pasta não encontrada.' };
    const nums = _extractFNumbers(node.files);
    if (!nums.length) {
      return { status: 'fail', detail: `Nenhuma foto com numeração "F-NN" encontrada (${node.files.length} arquivo(s) na pasta).` };
    }
    const unique = [...new Set(nums)].sort((a, b) => a - b);
    const count = unique.length;
    const first = unique[0], last = unique[unique.length - 1];
    const missing = [];
    for (let n = first; n <= last; n++) { if (!unique.includes(n)) missing.push(n); }
    const pad = n => 'F-' + String(n).padStart(2, '0');
    let status = 'ok';
    const parts = [`${count} foto(s) numerada(s) encontrada(s), de ${pad(first)} a ${pad(last)}.`];
    if (count < opts.minCount) {
      status = 'fail';
      parts.push(`Esperado pelo menos ${opts.minCount} fotos.`);
    }
    if (opts.requireStartAt != null && first !== opts.requireStartAt) {
      if (status !== 'fail') status = 'warn';
      parts.push(`Esperado começar em ${pad(opts.requireStartAt)}, encontrado ${pad(first)}.`);
    }
    if (missing.length) {
      if (status !== 'fail') status = 'warn';
      parts.push(`Números faltando na sequência: ${missing.map(pad).join(', ')}.`);
    }
    if (nums.length !== unique.length) {
      if (status !== 'fail') status = 'warn';
      parts.push('Há números repetidos.');
    }
    return { status, detail: parts.join(' ') };
  }

  // ─── PHOTO QUALITY (resolution / file size / GPS) ──────────────────────
  // Reads each photo's actual pixel dimensions and its EXIF/XMP GPS tags
  // (reusing exifr, already loaded for the Fotos tab) to flag anything
  // under 12 MP, at or over 29 MB, or missing GPS coordinates.
  const CONF_MIN_MEGAPIXELS = 12;
  const CONF_MAX_FILE_MB = 29;

  function _isImageFile(f) {
    return /\.(jpe?g|png|tiff?|heic|heif)$/i.test(f.name);
  }

  async function _readImageDimsAndGps(file) {
    let width, height, hasGps = false;
    try {
      const meta = await exifr.parse(file, {
        tiff: true, exif: true, gps: true, ifd0: true, mergeOutput: true,
        translateKeys: true, translateValues: true, reviveValues: true, sanitize: true,
      });
      if (meta) {
        width = meta.ExifImageWidth || meta.PixelXDimension || meta.ImageWidth;
        height = meta.ExifImageHeight || meta.PixelYDimension || meta.ImageHeight;
        if ((meta.latitude != null && meta.longitude != null) || (meta.GPSLatitude != null && meta.GPSLongitude != null)) {
          hasGps = true;
        }
      }
    } catch (e) { /* segue para o fallback abaixo */ }
    // Nem toda câmera grava ImageWidth/Height no EXIF -- decodifica a
    // imagem de verdade quando o metadado não trouxe a resolução.
    if (!width || !height) {
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        if (bitmap.close) bitmap.close();
      } catch (e) { /* imagem ilegível -- fica sem resolução mesmo */ }
    }
    return { width, height, hasGps };
  }

  async function _checkPhotosQuality(node) {
    if (!node) return null;
    const photoFiles = node.files.filter(f => _isImageFile(f) && f.file);
    if (!photoFiles.length) return null;
    const results = await runWithConcurrency(photoFiles, 4, async f => {
      const { width, height, hasGps } = await _readImageDimsAndGps(f.file);
      const mp = width && height ? (width * height) / 1e6 : null;
      const sizeMB = f.size / (1024 * 1024);
      const problems = [];
      if (mp == null) problems.push('não foi possível ler a resolução');
      else if (mp < CONF_MIN_MEGAPIXELS) problems.push(`resolução baixa (${mp.toFixed(1)} MP, esperado ao menos ${CONF_MIN_MEGAPIXELS} MP)`);
      if (sizeMB >= CONF_MAX_FILE_MB) problems.push(`arquivo grande (${sizeMB.toFixed(1)} MB, esperado menos de ${CONF_MAX_FILE_MB} MB)`);
      if (!hasGps) problems.push('sem coordenadas GPS nos metadados');
      return { name: f.name, problems };
    });
    const withProblems = results.filter(r => r && r.problems.length);
    if (!withProblems.length) {
      return { status: 'ok', label: `Qualidade das fotos — OK (${photoFiles.length} foto(s): ≥${CONF_MIN_MEGAPIXELS} MP, <${CONF_MAX_FILE_MB} MB, com GPS)` };
    }
    const detailList = withProblems.map(r => `${r.name} (${r.problems.join('; ')})`).join(' | ');
    return { status: 'fail', label: `Qualidade das fotos — ${withProblems.length} de ${photoFiles.length} com problema(s): ${detailList}` };
  }

  // ─── FULL CHECKLIST ─────────────────────────────────────────────────────
  // Mirrors the exact structure the user specified for 01_CADASTRAL. Each
  // top-level entry becomes one card; 01_GPS_OAE and 04_HISTORICO also get
  // a breakdown of their own sub-requirements. Every "XXXXXX" code found in
  // a filename (04_HISTORICO, 05_RVT, 06_PDF, the loose root .rvt) is
  // collected to flag a mismatched/mixed OAE code across the folder.
  async function runConferencia(root) {
    const items = [];
    const codes = [];

    // 01_GPS_OAE
    const gpsOae = _findDir(root, '01_gps_oae');
    if (!gpsOae) {
      items.push({ title: '01_GPS_OAE', status: 'fail', detail: 'Pasta não encontrada dentro de 01_CADASTRAL.' });
    } else {
      const subs = [];

      const projetoRtx = _findDir(gpsOae, '01_projeto_rtx');
      if (!projetoRtx) {
        subs.push({ label: '01_PROJETO_RTX — pasta não encontrada', status: 'fail' });
      } else {
        const jobs = _filesWithExt(projetoRtx, ['.job']);
        subs.push(jobs.length
          ? { label: `01_PROJETO_RTX — OK (${jobs.length} arquivo(s) .JOB)`, status: 'ok' }
          : { label: '01_PROJETO_RTX — nenhum arquivo .JOB encontrado', status: 'fail' });
      }

      const relatorio = _findDir(gpsOae, '02_relatorio_trimble');
      if (!relatorio) {
        subs.push({ label: '02_RELATORIO_TRIMBLE — pasta não encontrada', status: 'fail' });
      } else {
        const n = _dirCount(relatorio);
        subs.push(n >= 34
          ? { label: `02_RELATORIO_TRIMBLE — OK (${n} subpastas)`, status: 'ok' }
          : { label: `02_RELATORIO_TRIMBLE — apenas ${n} subpasta(s), esperado ao menos 34`, status: 'fail' });
      }

      const entregaveis = _findDir(gpsOae, '03_entregaveis');
      if (!entregaveis) {
        subs.push({ label: '03_ENTREGAVEIS — pasta não encontrada', status: 'fail' });
      } else {
        const kmls = _filesWithExt(entregaveis, ['.kml']);
        const csvs = _filesWithExt(entregaveis, ['.csv']);
        if (kmls.length && csvs.length) {
          subs.push({ label: `03_ENTREGAVEIS — OK (${kmls.length} KML, ${csvs.length} CSV)`, status: 'ok' });
        } else {
          const faltando = [];
          if (!kmls.length) faltando.push('.kml');
          if (!csvs.length) faltando.push('.csv');
          subs.push({ label: `03_ENTREGAVEIS — faltando arquivo(s) ${faltando.join(' e ')}`, status: 'fail' });
        }
      }

      const worst = subs.some(s => s.status === 'fail') ? 'fail' : (subs.some(s => s.status === 'warn') ? 'warn' : 'ok');
      items.push({ title: '01_GPS_OAE', status: worst, subs });
    }

    // 02_FOTOS_SUPERIORES / 03_FOTOS_INFERIORES -- numeração sequencial +
    // qualidade (resolução ≥12MP, tamanho <29MB, GPS nos metadados).
    async function _evalFotosFolder(title, node, seqOpts) {
      if (!node) return { title, status: 'fail', detail: 'Pasta não encontrada.' };
      const seq = _checkSequentialPhotos(node, seqOpts);
      const subs = [{ label: seq.detail, status: seq.status }];
      const quality = await _checkPhotosQuality(node);
      if (quality) subs.push({ label: quality.label, status: quality.status });
      const worst = subs.some(s => s.status === 'fail') ? 'fail' : (subs.some(s => s.status === 'warn') ? 'warn' : 'ok');
      return { title, status: worst, subs };
    }

    const fotosSup = _findDir(root, '02_fotos_superiores');
    items.push(await _evalFotosFolder('02_FOTOS_SUPERIORES', fotosSup, { minCount: 11, requireStartAt: 1 }));

    const fotosInf = _findDir(root, '03_fotos_inferiores');
    items.push(await _evalFotosFolder('03_FOTOS_INFERIORES', fotosInf, { minCount: 6, requireStartAt: null }));

    // 04_HISTORICO
    const historico = _findDir(root, '04_historico');
    if (!historico) {
      items.push({ title: '04_HISTORICO', status: 'fail', detail: 'Pasta não encontrada.' });
    } else {
      const subs = [];

      const zip = historico.files.find(f => f.lower === '01_gps_oae.zip');
      subs.push(zip ? { label: '01_GPS_OAE.zip — OK', status: 'ok' } : { label: '01_GPS_OAE.zip — não encontrado', status: 'fail' });

      const trajeto = historico.files.find(f => /^rota_alternativa_.+_trajeto\.csv$/i.test(f.name));
      subs.push(trajeto ? { label: `ROTA_ALTERNATIVA_XXXXXX_trajeto.csv — OK (${trajeto.name})`, status: 'ok' } : { label: 'ROTA_ALTERNATIVA_XXXXXX_trajeto.csv — não encontrado', status: 'fail' });
      if (trajeto) { const m = trajeto.name.match(/^rota_alternativa_(.+)_trajeto\.csv$/i); if (m) codes.push(m[1]); }

      const kml = historico.files.find(f => /^rota_alternativa_.+\.kml$/i.test(f.name));
      subs.push(kml ? { label: `ROTA_ALTERNATIVA_XXXXXX.kml — OK (${kml.name})`, status: 'ok' } : { label: 'ROTA_ALTERNATIVA_XXXXXX.kml — não encontrado', status: 'fail' });
      if (kml) { const m = kml.name.match(/^rota_alternativa_(.+)\.kml$/i); if (m) codes.push(m[1]); }

      const jpg = historico.files.find(f => /^rota_alternativa_.+\.jpg$/i.test(f.name));
      subs.push(jpg ? { label: `ROTA_ALTERNATIVA_XXXXXX.jpg — OK (${jpg.name})`, status: 'ok' } : { label: 'ROTA_ALTERNATIVA_XXXXXX.jpg — não encontrado', status: 'fail' });
      if (jpg) { const m = jpg.name.match(/^rota_alternativa_(.+)\.jpg$/i); if (m) codes.push(m[1]); }

      const dim = historico.files.find(f => /_dim\.csv$/i.test(f.name));
      subs.push(dim ? { label: `XXXXXX_DIM.csv — OK (${dim.name})`, status: 'ok' } : { label: 'XXXXXX_DIM.csv — não encontrado', status: 'fail' });
      if (dim) { const m = dim.name.match(/^(.+)_dim\.csv$/i); if (m) codes.push(m[1]); }

      const sem = historico.files.find(f => /_sem\.csv$/i.test(f.name));
      subs.push(sem ? { label: `XXXXXX_SEM.csv — OK (${sem.name})`, status: 'ok' } : { label: 'XXXXXX_SEM.csv — não encontrado', status: 'fail' });
      if (sem) { const m = sem.name.match(/^(.+)_sem\.csv$/i); if (m) codes.push(m[1]); }

      const worst = subs.some(s => s.status === 'fail') ? 'fail' : 'ok';
      items.push({ title: '04_HISTORICO', status: worst, subs });
    }

    // 05_RVT
    const rvtDir = _findDir(root, '05_rvt');
    if (!rvtDir) {
      items.push({ title: '05_RVT', status: 'fail', detail: 'Pasta não encontrada.' });
    } else {
      const rvts = _filesWithExt(rvtDir, ['.rvt']);
      if (rvts.length) {
        rvts.forEach(f => codes.push(f.name.replace(/\.rvt$/i, '')));
        items.push({ title: '05_RVT', status: 'ok', detail: `OK (${rvts.map(f => f.name).join(', ')})` });
      } else {
        items.push({ title: '05_RVT', status: 'fail', detail: 'Nenhum arquivo .rvt encontrado.' });
      }
    }

    // 06_PDF
    const pdfDir = _findDir(root, '06_pdf');
    if (!pdfDir) {
      items.push({ title: '06_PDF', status: 'fail', detail: 'Pasta não encontrada.' });
    } else {
      // Aceita "XXXXXX_CROQUI.pdf" e variantes de separador entre o código
      // e "CROQUI" (espaço, hífen, "-" com espaços em volta, etc.), como
      // "XXXXXX -CROQUI.pdf".
      const croqui = pdfDir.files.find(f => /[\s_-]+croqui\.pdf$/i.test(f.name));
      if (croqui) {
        const m = croqui.name.match(/^(.+?)[\s_-]+croqui\.pdf$/i);
        if (m) codes.push(m[1]);
        items.push({ title: '06_PDF', status: 'ok', detail: `OK (${croqui.name})` });
      } else {
        items.push({ title: '06_PDF', status: 'fail', detail: 'Nenhum arquivo XXXXXX_CROQUI.pdf (ou variantes como "XXXXXX -CROQUI.pdf") encontrado.' });
      }
    }

    // 07_DWG
    const dwgDir = _findDir(root, '07_dwg');
    if (!dwgDir) {
      items.push({ title: '07_DWG', status: 'fail', detail: 'Pasta não encontrada.' });
    } else {
      const dwgs = _filesWithExt(dwgDir, ['.dwg']);
      items.push(dwgs.length >= 5
        ? { title: '07_DWG', status: 'ok', detail: `OK (${dwgs.length} arquivo(s) .dwg)` }
        : { title: '07_DWG', status: 'fail', detail: `Apenas ${dwgs.length} arquivo(s) .dwg, esperado ao menos 5.` });
    }

    // Arquivo solto XXXXXX.rvt diretamente dentro de 01_CADASTRAL
    const looseRvt = root.files.find(f => /\.rvt$/i.test(f.name));
    if (looseRvt) {
      codes.push(looseRvt.name.replace(/\.rvt$/i, ''));
      items.push({ title: 'Arquivo solto XXXXXX.rvt', status: 'ok', detail: `OK (${looseRvt.name}) na raiz de 01_CADASTRAL.` });
    } else {
      items.push({ title: 'Arquivo solto XXXXXX.rvt', status: 'fail', detail: 'Nenhum arquivo .rvt solto diretamente dentro de 01_CADASTRAL.' });
    }

    // Consistência do código da OAE entre os arquivos nomeados por código
    if (codes.length) {
      const uniqueCodes = [...new Set(codes.map(c => c.toUpperCase()))];
      items.push(uniqueCodes.length === 1
        ? { title: 'Consistência do código da OAE', status: 'ok', detail: `Código "${uniqueCodes[0]}" usado de forma consistente em todos os arquivos nomeados por código.` }
        : { title: 'Consistência do código da OAE', status: 'warn', detail: `Foram encontrados códigos diferentes nos nomes dos arquivos: ${uniqueCodes.join(', ')}. Confira se não há arquivos de outra OAE misturados.` });
    }

    return items;
  }

  // ─── RENDERING ──────────────────────────────────────────────────────────
  function _renderConfItem(item) {
    const detailHtml = item.detail ? `<p class="conf-item-detail">${escapeHtml(item.detail)}</p>` : '';
    const subsHtml = item.subs && item.subs.length
      ? '<div class="conf-item-sub">' + item.subs.map(s =>
          `<div class="conf-sub-row conf-${s.status}"><span class="conf-item-icon"></span>${escapeHtml(s.label)}</div>`
        ).join('') + '</div>'
      : '';
    return `<div class="conf-item conf-${item.status}">
      <div class="conf-item-head"><span class="conf-item-icon"></span><span class="conf-item-title">${escapeHtml(item.title)}</span></div>
      ${detailHtml}${subsHtml}
    </div>`;
  }

  function _buildConfReportText(items, folderName) {
    const lines = [`CONFERÊNCIA DE CADASTRO — ${folderName || '01_CADASTRAL'}`, ''];
    items.forEach(item => {
      const mark = item.status === 'ok' ? '[OK]' : (item.status === 'warn' ? '[ATENÇÃO]' : '[FALTANDO]');
      lines.push(`${mark} ${item.title}${item.detail ? ' — ' + item.detail : ''}`);
      if (item.subs) {
        item.subs.forEach(s => {
          const m2 = s.status === 'ok' ? '  [OK]' : (s.status === 'warn' ? '  [ATENÇÃO]' : '  [FALTANDO]');
          lines.push(`${m2} ${s.label}`);
        });
      }
    });
    return lines.join('\n');
  }

  function _renderConferencia(items, folderName) {
    const results = document.getElementById('confResults');
    const summaryRow = document.getElementById('confSummaryRow');
    const emptyState = document.getElementById('confEmptyState');
    const reportBtn = document.getElementById('confBtnGenerateReport');

    results.innerHTML = items.map(_renderConfItem).join('');

    const okCount = items.filter(i => i.status === 'ok').length;
    const warnCount = items.filter(i => i.status === 'warn').length;
    const failCount = items.filter(i => i.status === 'fail').length;
    document.getElementById('confCountOk').textContent = okCount;
    document.getElementById('confCountWarn').textContent = warnCount;
    document.getElementById('confCountFail').textContent = failCount;
    document.getElementById('confFolderName').textContent = folderName ? ('📁 ' + folderName) : '';

    summaryRow.style.display = 'flex';
    emptyState.style.display = 'none';
    reportBtn.style.display = 'inline-block';

    window._confLastReport = _buildConfReportText(items, folderName);
    window._confLastFolderName = folderName;

    const rootLooksRight = folderName && folderName.toLowerCase().indexOf('cadastral') !== -1;
    showToast(rootLooksRight
      ? `✅ Conferência concluída — <span class="accent">${okCount} OK</span>, ${warnCount} atenção, ${failCount} faltando`
      : `✅ Conferência concluída (pasta selecionada: "${folderName}" — confirme se é mesmo a 01_CADASTRAL) — ${okCount} OK, ${warnCount} atenção, ${failCount} faltando`);
  }

  // ─── WIRING ─────────────────────────────────────────────────────────────
  const dropzone = document.getElementById('confDropzone');
  const selectBtn = document.getElementById('confBtnSelectFolder');
  const folderInput = document.getElementById('confFolderInput');
  const reportBtn = document.getElementById('confBtnGenerateReport');

  async function _runFromTree(tree) {
    try {
      setButtonLoading(selectBtn, 'VERIFICANDO FOTOS…');
      const items = await runConferencia(tree);
      _renderConferencia(items, tree.name);
    } catch (err) {
      console.error('Falha na conferência da pasta:', err);
      showToast('⚠ Não foi possível conferir a pasta selecionada');
    } finally {
      clearButtonLoading(selectBtn, '📁 Selecionar pasta 01_CADASTRAL');
    }
  }

  if (selectBtn && folderInput && dropzone) {
    selectBtn.addEventListener('click', ev => { ev.stopPropagation(); folderInput.click(); });
    dropzone.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      folderInput.click();
    });

    folderInput.addEventListener('change', () => {
      const files = folderInput.files;
      if (!files || !files.length) return;
      setButtonLoading(selectBtn, 'CONFERINDO…');
      // Runs sync, but a rAF keeps the loading state paintable before the
      // (usually very fast) tree build + checklist evaluation blocks the
      // main thread for a large folder.
      requestAnimationFrame(() => {
        _runFromTree(_buildConfTree(files));
        folderInput.value = '';
      });
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('conf-drag'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('conf-drag'); });
    });
    dropzone.addEventListener('drop', async e => {
      const items = e.dataTransfer && e.dataTransfer.items;
      const hasEntryApi = items && items.length && items[0].webkitGetAsEntry;
      if (!hasEntryApi) {
        showToast('⚠ Este navegador não suporta arrastar pastas — use o botão "Selecionar pasta 01_CADASTRAL"');
        return;
      }
      setButtonLoading(selectBtn, 'LENDO PASTA…');
      try {
        const entries = await _readDroppedItems(items);
        if (!entries.length) {
          showToast('⚠ Nenhum arquivo encontrado na pasta arrastada');
          clearButtonLoading(selectBtn, '📁 Selecionar pasta 01_CADASTRAL');
          return;
        }
        setButtonLoading(selectBtn, 'CONFERINDO…');
        _runFromTree(_buildConfTreeFromPaths(entries));
      } catch (err) {
        console.error('Falha ao ler a pasta arrastada:', err);
        showToast('⚠ Não foi possível ler a pasta arrastada — tente o botão "Selecionar pasta 01_CADASTRAL"');
        clearButtonLoading(selectBtn, '📁 Selecionar pasta 01_CADASTRAL');
      }
    });
  }

  if (reportBtn) {
    reportBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!window._confLastReport) return;
      const safeFolder = (window._confLastFolderName || '01_CADASTRAL').replace(/[^a-zA-Z0-9_-]+/g, '_');
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([window._confLastReport], { type: 'text/plain;charset=utf-8' });
      triggerDownload(blob, `Conferencia_${safeFolder}_${stamp}.txt`);
      showToast('📄 Relatório da conferência baixado');
    });
  }

})();
