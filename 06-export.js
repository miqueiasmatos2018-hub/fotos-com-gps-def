// ==========================================================================
// 06-export.js
// JPEG rebuild with EXIF, single + batch/ZIP export.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

function ensureJpgExtension(name) {
  return name.replace(/\.(jpe?g|heic|tiff?|png|webp|bmp|gif)$/i, '') + '.jpg';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Convert degrees decimal to [deg, min, sec] rational arrays for piexif
function decimalToRational(decimal) {
  const d = Math.abs(decimal);
  const deg = Math.floor(d);
  const minFull = (d - deg) * 60;
  const min = Math.floor(minFull);
  const sec = Math.round((minFull - min) * 60 * 100);
  return [[deg, 1], [min, 1], [sec, 100]];
}

async function buildJpegWithExif(photo) {
  // 1. Draw image to canvas → get raw JPEG dataURL
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = photo.url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // 2. Build EXIF dict from photo metadata using piexif
  const exif = photo.exif || {};

  const zerothIfd = {};
  const exifIfd  = {};
  const gpsIfd   = {};

  if (exif.Make)    zerothIfd[piexif.ImageIFD.Make]    = exif.Make;
  if (exif.Model)   zerothIfd[piexif.ImageIFD.Model]   = exif.Model;
  if (exif.Software) zerothIfd[piexif.ImageIFD.Software] = exif.Software;
  zerothIfd[piexif.ImageIFD.ImageDescription] = photo.name;

  if (exif.DateTimeOriginal) {
    // piexif expects "YYYY:MM:DD HH:MM:SS"
    let dt = exif.DateTimeOriginal;
    if (dt instanceof Date) {
      dt = dt.toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, ':');
    } else if (typeof dt === 'string' && dt.includes('-')) {
      dt = dt.replace(/-/g, ':').replace('T', ' ').slice(0, 19);
    }
    exifIfd[piexif.ExifIFD.DateTimeOriginal] = dt;
    exifIfd[piexif.ExifIFD.DateTimeDigitized] = dt;
    zerothIfd[piexif.ImageIFD.DateTime] = dt;
  }

  if (exif.FocalLength) exifIfd[piexif.ExifIFD.FocalLength] = [Math.round(exif.FocalLength * 100), 100];
  if (exif.FNumber)     exifIfd[piexif.ExifIFD.FNumber]     = [Math.round(exif.FNumber * 100), 100];
  if (exif.ISO)         exifIfd[piexif.ExifIFD.ISOSpeedRatings] = exif.ISO;
  if (exif.ExposureTime) exifIfd[piexif.ExifIFD.ExposureTime] = [1, Math.round(1 / exif.ExposureTime)];
  if (exif.LensModel)  exifIfd[piexif.ExifIFD.LensModel]    = exif.LensModel;

  if (photo.lat != null && photo.lng != null) {
    gpsIfd[piexif.GPSIFD.GPSLatitudeRef]  = photo.lat >= 0 ? 'N' : 'S';
    gpsIfd[piexif.GPSIFD.GPSLatitude]     = decimalToRational(photo.lat);
    gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = photo.lng >= 0 ? 'E' : 'W';
    gpsIfd[piexif.GPSIFD.GPSLongitude]    = decimalToRational(photo.lng);
    if (toNum(exif.GPSAltitude) != null) {
      const _alt = toNum(exif.GPSAltitude);
      gpsIfd[piexif.GPSIFD.GPSAltitudeRef] = _alt >= 0 ? 0 : 1;
      gpsIfd[piexif.GPSIFD.GPSAltitude]    = [Math.round(Math.abs(_alt) * 100), 100];
    }
  }

  const exifObj = { '0th': zerothIfd, 'Exif': exifIfd, 'GPS': gpsIfd };
  const exifBytes = piexif.dump(exifObj);
  const jpegWithExif = piexif.insert(exifBytes, dataUrl);

  // 3. Convert dataURL → Blob
  const binary = atob(jpegWithExif.split(',')[1]);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

window.exportSingle = async function() {
  if (!activeId) { showToast('Select a photo first'); return; }
  const photo = photos.find(p => p.id == activeId);
  if (!photo) return;

  const overlay = document.getElementById('exportOverlay');
  const sub = document.getElementById('exportOverlaySub');
  const fill = document.getElementById('exportProgressFill');

  overlay.classList.add('show');
  sub.textContent = `Processing ${photo.name}…`;
  fill.style.width = '40%';

  try {
    const blob = await buildJpegWithExif(photo);
    fill.style.width = '100%';
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
      triggerDownload(blob, ensureJpgExtension(photo.name));
      showToast(`Exported <span class="accent">${ensureJpgExtension(photo.name)}</span> with EXIF`);
    }, 300);
  } catch(e) {
    overlay.classList.remove('show');
    showToast('Export error: ' + e.message);
    console.error(e);
  }
};

window.exportAllSmart = async function() {
  // Try File System Access API first (saves directly to folder, bypasses SmartScreen)
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
        id: 'fotos-export'
      });

      const overlay = document.getElementById('exportOverlay');
      const sub     = document.getElementById('exportOverlaySub');
      const fill    = document.getElementById('exportProgressFill');
      overlay.classList.add('show');
      fill.style.width = '0%';

      // Create subfolder
      const folder = await dirHandle.getDirectoryHandle('fotos renomeadas', { create: true });

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        sub.textContent = `Salvando ${i + 1} / ${photos.length} — ${photo.name}`;
        fill.style.width = ((i + 1) / photos.length * 100) + '%';

        const blob     = await buildJpegWithExif(photo);
        const filename = ensureJpgExtension(photo.name);
        const fileHandle = await folder.getFileHandle(filename, { create: true });
        const writable   = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      }

      fill.style.width = '100%';
      setTimeout(() => {
        overlay.classList.remove('show');
        fill.style.width = '0%';
        showToast(`✓ <span class="accent">${photos.length} fotos</span> salvas na pasta!`);
      }, 300);

      return; // done — no ZIP needed
    } catch(e) {
      if (e.name === 'AbortError') return; // user cancelled picker
    }
  }
  // Fallback: ZIP download
  exportAll();
};

window.exportAll = async function() {
  if (!photos.length) return;

  const overlay = document.getElementById('exportOverlay');
  const sub     = document.getElementById('exportOverlaySub');
  const fill    = document.getElementById('exportProgressFill');

  overlay.classList.add('show');
  fill.style.width = '0%';

  try {
    const zip    = new JSZip();
    const folder = zip.folder('fotos renomeadas');
    let errors   = 0;

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      sub.textContent = `Processando ${i + 1} / ${photos.length} — ${photo.name}`;
      fill.style.width = ((i / photos.length) * 85) + '%';

      try {
        const blob     = await buildJpegWithExif(photo);
        const filename = ensureJpgExtension(photo.name);
        folder.file(filename, blob);
      } catch(photoErr) {
        console.warn('buildJpegWithExif failed for', photo.name, photoErr);
        // Fallback: use original file as-is
        try {
          const origBlob = photo.file instanceof File
            ? photo.file
            : await fetch(photo.url).then(r => r.blob());
          folder.file(ensureJpgExtension(photo.name), origBlob);
        } catch(e2) {
          errors++;
          console.error('Could not export', photo.name, e2);
        }
      }
    }

    sub.textContent = 'Comprimindo ZIP…';
    fill.style.width = '92%';

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 3 }
    });

    fill.style.width = '100%';
    setTimeout(() => {
      overlay.classList.remove('show');
      fill.style.width = '0%';
      triggerDownload(zipBlob, 'fotos renomeadas.zip');
      const msg = errors > 0
        ? `Downloaded ${photos.length - errors} photos (${errors} com erro)`
        : `Downloaded <span class="accent">${photos.length} photos</span> em fotos renomeadas.zip`;
      showToast(msg);
    }, 300);

  } catch(e) {
    overlay.classList.remove('show');
    fill.style.width = '0%';
    showToast('Export error: ' + e.message);
    console.error(e);
  }
};
