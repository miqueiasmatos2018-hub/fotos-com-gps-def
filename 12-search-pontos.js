// ==========================================================================
// 12-search-pontos.js
// Search bar over KML/CSV points, plus user-created custom points ("Pontos" tab) which share its closure.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

(function() {
  const input   = document.getElementById('kmlSearchInput');
  const results = document.getElementById('kmlSearchResults');
  const clearBtn = document.getElementById('kmlSearchClear');
  if (!input) return;

  let _activeMarker = null;

  function getAllKmlFeatures() {
    const features = [];
    Object.values(kmlLayers).forEach(({ layer, name: fileName }) => {
      if (!layer._layers) return;
      Object.values(layer._layers).forEach(l => {
        // Recurse into group layers
        const sublayers = l._layers ? Object.values(l._layers) : [l];
        sublayers.forEach(sl => {
          const props = sl.feature?.properties || sl.options?.properties || {};
          const fname = props.name || props.Nome_Tipo_Trecho || props.Codigo_SNV || props.Codigo_BR || '';
          const oae   = props.Identificacao_OAE || '';
          const sgo   = props.codigo_SGO || '';
          if (!fname && !oae && !sgo) return;
          const searchText = [fname, oae, sgo].filter(Boolean).join(' · ');
          const latlng = sl.getLatLng?.() || sl.getBounds?.()?.getCenter?.();
          if (!latlng) return;
          features.push({ name: fname || oae, oae, sgo, searchText, props, latlng, layer: sl, fileName });
        });
      });
    });
    return features;
  }

  function highlight(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx)
      + `<mark>${text.slice(idx, idx + query.length)}</mark>`
      + text.slice(idx + query.length);
  }

  // Parse coordinates from query: "-5.286997 -61.934218" or "-5.286997, -61.934218"
  function parseCoords(q) {
    const m = q.match(/(-?\d{1,3}\.?\d*)[,\s]+(-?\d{1,3}\.?\d*)/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  let _customMarkers = []; // track user-created points

  // ─── PONTO MAP PICKING ────────────────────────────────────────────────────────
let _pontoPickingHandler = null;
let _pontoPickingKeyHandler = null;

window.togglePontoPicking = function() {
  const btn    = document.getElementById('btnAddPonto');
  const banner = document.getElementById('pickingBanner');

  if (_pontoPickingHandler) {
    // Cancel picking
    map.off('click', _pontoPickingHandler);
    document.removeEventListener('keydown', _pontoPickingKeyHandler);
    _pontoPickingHandler = null;
    map.getContainer().style.cursor = '';
    if (btn)    { btn.classList.remove('active'); btn.textContent = '📌 Clicar no mapa'; }
    if (banner) banner.classList.remove('show');
    return;
  }

  // Start picking
  if (btn)    { btn.classList.add('active'); btn.textContent = '✕ Cancelar'; }
  if (banner) {
    banner.textContent = '📌 Clique no mapa para criar um ponto · ESC para cancelar';
    banner.classList.add('show');
  }
  map.getContainer().style.cursor = 'crosshair';

  _pontoPickingHandler = function(e) {
    const { lat, lng } = e.latlng;
    criarPonto(lat, lng);
    // Keep picking active for multiple points
  };

  _pontoPickingKeyHandler = function(e) {
    if (e.key === 'Escape') window.togglePontoPicking();
  };

  map.on('click', _pontoPickingHandler);
  document.addEventListener('keydown', _pontoPickingKeyHandler);
};

function removeCustomMarker(idx) {
    const m = _customMarkers[idx];
    if (m) { map.removeLayer(m); _customMarkers[idx] = null; }
    // Remove from pontos list
    const item = document.querySelector(`.ponto-item[data-idx="${idx}"]`);
    if (item) item.remove();
    // Show empty state if no pontos left
    const remaining = _customMarkers.filter(Boolean).length;
    const empty = document.getElementById('pontosEmpty');
    if (empty) empty.style.display = remaining === 0 ? 'flex' : 'none';
  }
  window._removeCustomMarker = removeCustomMarker;

  function criarPonto(lat, lng, customName) {
    const idx  = _customMarkers.length;
    const name = customName || `Ponto ${idx + 1}`;

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:var(--accent);color:#000;font-family:var(--mono);font-size:8px;font-weight:600;padding:3px 7px;border-radius:12px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:1px solid rgba(0,0,0,0.2);letter-spacing:0.5px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`,
        iconAnchor: [60, 12],
        popupAnchor: [0, -16]
      })
    }).addTo(map);

    marker.bindPopup(`
      <div class="popup-content" style="min-width:180px">
        <div class="popup-name" style="font-size:12px">${name}</div>
        <div class="popup-row">Lat <span>${lat.toFixed(8)}</span></div>
        <div class="popup-row">Lng <span>${lng.toFixed(8)}</span></div>
        <button class="popup-save-btn" style="margin-top:8px;background:#f44336;"
          onclick="window._removeCustomMarker(${idx})">🗑 REMOVER</button>
      </div>
    `);

    _customMarkers.push(marker);

    // Add to pontos tab
    const pontosList = document.getElementById('pontosList');
    const pontosEmpty = document.getElementById('pontosEmpty');
    if (pontosEmpty) pontosEmpty.style.display = 'none';
    if (pontosList) {
      const item = document.createElement('div');
      item.className = 'ponto-item';
      item.dataset.idx = idx;
      item.innerHTML = `
        <span class="ponto-icon">📌</span>
        <div class="ponto-info">
          <span class="ponto-name" contenteditable="true" spellcheck="false" title="Clique para renomear">${name}</span>
          <div class="ponto-coords">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        </div>
        <button class="ponto-delete" title="Remover">✕</button>
      `;

      // Rename on blur / Enter
      const nameEl = item.querySelector('.ponto-name');
      nameEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
        e.stopPropagation(); // prevent Tab navigation while editing
      });
      nameEl.addEventListener('blur', () => {
        const newName = nameEl.textContent.trim() || name;
        nameEl.textContent = newName;
        // Update popup content
        marker.setPopupContent(`
          <div class="popup-content" style="min-width:180px">
            <div class="popup-name" style="font-size:12px">${newName}</div>
            <div class="popup-row">Lat <span>${lat.toFixed(8)}</span></div>
            <div class="popup-row">Lng <span>${lng.toFixed(8)}</span></div>
            <button class="popup-save-btn" style="margin-top:8px;background:#f44336;"
              onclick="window._removeCustomMarker(${idx})">🗑 REMOVER</button>
          </div>
        `);
      });
      nameEl.addEventListener('click', e => e.stopPropagation()); // don't fly map when clicking to rename
      nameEl.addEventListener('focus', e => {
        // Select all text when focused
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      item.querySelector('.ponto-delete').addEventListener('click', e => {
        e.stopPropagation();
        removeCustomMarker(idx);
      });
      item.addEventListener('click', () => {
        map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
        marker.openPopup();
      });
      pontosList.appendChild(item);
    }

    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
    marker.openPopup();
    showToast(`📌 Ponto criado — <span class="accent">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`);
    results.style.display = 'none';
    input.value = '';
    clearBtn.style.display = 'none';
  }

  function search(q) {
    q = q.trim();
    clearBtn.style.display = q ? 'block' : 'none';
    if (!q) { results.style.display = 'none'; return; }

    const coords  = parseCoords(q);
    const features = getAllKmlFeatures();
    const kmlMatches = features.filter(f => f.searchText.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

    // Search custom pontos
    const pontoMatches = _customMarkers
      .map((m, idx) => m ? { idx, latlng: m.getLatLng(), name: document.querySelector(`.ponto-item[data-idx="${idx}"] .ponto-name`)?.textContent?.trim() || `Ponto ${idx + 1}`, marker: m } : null)
      .filter(p => p && p.name.toLowerCase().includes(q.toLowerCase()));

    results.style.display = 'block';

    let html = '';

    // Coords button on top
    if (coords) {
      html += `<div class="criar-ponto-btn" id="criarPontoBtn">
        <span class="criar-ponto-btn-icon">📌</span>
        <div>
          <div class="criar-ponto-btn-text">Criar ponto</div>
          <div class="criar-ponto-btn-coords">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</div>
        </div>
      </div>`;
    }

    // Custom pontos matches
    if (pontoMatches.length) {
      html += pontoMatches.map((p, i) => `
        <div class="kml-search-result-item ponto-search-item" data-ponto-idx="${p.idx}">
          <div class="kml-result-name">📌 ${highlight(p.name, q)}</div>
          <div class="kml-result-meta">${p.latlng.lat.toFixed(6)}, ${p.latlng.lng.toFixed(6)}</div>
        </div>
      `).join('');
    }

    if (!kmlMatches.length && !pontoMatches.length && !coords) {
      html += '<div class="kml-search-empty">Nenhum resultado encontrado</div>';
    } else {
      html += kmlMatches.map((f, i) => {
        const meta = [f.props.sg_uf || f.props.Unidade_Federacao, f.sgo ? `SGO ${f.sgo}` : '', f.fileName]
          .filter(Boolean).join(' · ');
        const oaeHtml = f.oae ? `<div class="kml-result-meta" style="color:var(--accent);opacity:0.8;">${highlight(f.oae, q)}</div>` : '';
        return `<div class="kml-search-result-item" data-idx="${i}">
          <div class="kml-result-name">${highlight(f.name, q)}</div>
          ${oaeHtml}
          ${meta ? `<div class="kml-result-meta">${meta}</div>` : ''}
        </div>`;
      }).join('');
    }

    results.innerHTML = html;

    // Wire criar ponto button
    const cpBtn = results.querySelector('#criarPontoBtn');
    if (cpBtn && coords) cpBtn.addEventListener('click', () => criarPonto(coords.lat, coords.lng));

    // Wire custom ponto items
    results.querySelectorAll('.ponto-search-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.pontoIdx);
        const m = _customMarkers[idx];
        if (m) {
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
          m.openPopup();
        }
        results.style.display = 'none';
        clearBtn.style.display = 'block';
        switchTab('pontos');
      });
    });

    // Wire KML result items
    results.querySelectorAll('.kml-search-result-item:not(.ponto-search-item)').forEach((el, i) => {
      el.addEventListener('click', () => {
        const f = kmlMatches[i];
        map.setView(f.latlng, Math.max(map.getZoom(), 14), { animate: true });
        if (f.layer.openPopup) f.layer.openPopup();
        if (_activeMarker && _activeMarker.setStyle) _activeMarker.setStyle({ weight: 1.5 });
        if (f.layer.setStyle) {
          f.layer.setStyle({ weight: 4, color: '#d4f53c' });
          _activeMarker = f.layer;
          setTimeout(() => { if (f.layer.setStyle) f.layer.setStyle({ weight: 1.5 }); }, 2000);
        }
        input.value = f.name;
        results.style.display = 'none';
        clearBtn.style.display = 'block';
      });
    });
  }

  input.addEventListener('input', e => search(e.target.value));
  clearBtn.addEventListener('click', () => {
    input.value = '';
    results.style.display = 'none';
    clearBtn.style.display = 'none';
    input.focus();
  });

  // Close results when clicking outside
  document.addEventListener('click', e => {
    // The wrapper is .map-search-bar -- there is no #kmlSearchBar element.
    // Guard the lookup so a missing node can't throw on every click.
    const bar = document.querySelector('.map-search-bar');
    if (bar && !bar.contains(e.target)) {
      results.style.display = 'none';
    }
  });

  // Keyboard nav
  input.addEventListener('keydown', e => {
    const items = results.querySelectorAll('.kml-search-result-item');
    const active = results.querySelector('.kml-search-result-item.focused');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? (active.nextElementSibling || items[0]) : items[0];
      active?.classList.remove('focused');
      next?.classList.add('focused');
      next?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? (active.previousElementSibling || items[items.length-1]) : items[items.length-1];
      active?.classList.remove('focused');
      prev?.classList.add('focused');
      prev?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active) {
      active.click();
    } else if (e.key === 'Escape') {
      results.style.display = 'none';
      input.blur();
    }
  });
})();
