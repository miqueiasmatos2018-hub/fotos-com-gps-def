// ==========================================================================
// 23-inspecoes.js
// Aba Inspeções: cada "equipe" tem uma rota montada a partir de códigos de
// OAE digitados (busca nas camadas KML já carregadas -- ver
// findKmlFeatureByCode em 12-search-pontos.js). Cada código vira uma parada,
// na ordem em que é adicionado; a rota entre as paradas segue estrada de
// verdade via OSRM (mesmo serviço e helpers resilientes de 15-routes.js:
// OSRM_SERVICE_URL, _fetchJsonResilient, _sleep -- carregados antes deste
// arquivo, então já existem quando isso roda).
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

const INSP_TEAM_COLORS = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa','#00acc1','#fdd835','#6d4c41','#d81b60','#3949ab'];

let _inspTeams = [];        // [{ id, name, color, stops:[{code,name,lat,lng,found}], line, markers:[], distanceKm, timeMin, routeToken, status }]
let _inspSelectedId = null;
let _inspNextId = 1;

function _inspFormatDuration(min) {
  if (min == null) return '—';
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function _inspTeamById(id) { return _inspTeams.find(t => t.id === id); }

function _inspCreateTeam(name) {
  const team = {
    id: _inspNextId++,
    name: name || `Equipe ${_inspTeams.length + 1}`,
    color: INSP_TEAM_COLORS[_inspTeams.length % INSP_TEAM_COLORS.length],
    stops: [],
    line: null,
    markers: [],
    distanceKm: null,
    timeMin: null,
    routeToken: 0,
    status: 'idle' // idle | loading | ok | error
  };
  _inspTeams.push(team);
  _inspSelectedId = team.id;
  _inspRenderTeams();
  return team;
}

function _inspDeleteTeam(id) {
  const team = _inspTeamById(id);
  if (!team) return;
  _inspClearTeamLayer(team);
  _inspTeams = _inspTeams.filter(t => t.id !== id);
  if (_inspSelectedId === id) _inspSelectedId = _inspTeams.length ? _inspTeams[0].id : null;
  _inspRenderTeams();
}

// ─── Resolver códigos digitados em paradas (nome + coordenada) ─────────────
// Aceita vários códigos de uma vez -- colar uma lista separada por linha,
// vírgula ou ponto-e-vírgula funciona igual a digitar um por um.
function _inspAddCodes(teamId, text) {
  const team = _inspTeamById(teamId);
  if (!team) return;
  const codes = String(text || '').split(/[\n\r\t,;]+/).map(s => s.trim()).filter(Boolean);
  if (!codes.length) return;

  let notFound = 0;
  codes.forEach(code => {
    const feature = (typeof findKmlFeatureByCode === 'function') ? findKmlFeatureByCode(code) : null;
    if (feature && feature.latlng) {
      team.stops.push({ code, name: feature.name || feature.oae || code, lat: feature.latlng.lat, lng: feature.latlng.lng, found: true });
    } else {
      team.stops.push({ code, name: null, lat: null, lng: null, found: false });
      notFound++;
    }
  });

  if (notFound) {
    showToast(`⚠️ ${notFound} código${notFound > 1 ? 's não encontrados' : ' não encontrado'} nas camadas KML carregadas`);
  }
  _inspRenderTeams();
  _inspRecalcRoute(team);
}

function _inspRemoveStop(teamId, idx) {
  const team = _inspTeamById(teamId);
  if (!team) return;
  team.stops.splice(idx, 1);
  _inspRenderTeams();
  _inspRecalcRoute(team);
}

function _inspMoveStop(teamId, idx, dir) {
  const team = _inspTeamById(teamId);
  if (!team) return;
  const j = idx + dir;
  if (j < 0 || j >= team.stops.length) return;
  [team.stops[idx], team.stops[j]] = [team.stops[j], team.stops[idx]];
  _inspRenderTeams();
  _inspRecalcRoute(team);
}

// ─── Roteamento por estrada (OSRM) ──────────────────────────────────────────
const _inspRecalcDebounced = {}; // teamId -> debounced fn (uma por equipe)

function _inspRecalcRoute(team) {
  if (!_inspRecalcDebounced[team.id]) {
    _inspRecalcDebounced[team.id] = debounce(() => _inspRecalcRouteNow(team.id), 400);
  }
  _inspRecalcDebounced[team.id]();
}

async function _inspRecalcRouteNow(teamId) {
  const team = _inspTeamById(teamId);
  if (!team) return;

  const usable = team.stops.filter(s => s.found);
  const token = ++team.routeToken; // descarta respostas de uma chamada mais antiga que já foi superada

  if (usable.length < 2) {
    team.distanceKm = null; team.timeMin = null; team.status = 'idle';
    _inspClearTeamLine(team);
    _inspRenderTeams();
    return;
  }

  team.status = 'loading';
  _inspRenderTeams();

  const coordStr = usable.map(s => `${s.lng},${s.lat}`).join(';');
  const url = `${OSRM_SERVICE_URL}/driving/${coordStr}?overview=full&geometries=geojson`;
  const data = await _fetchJsonResilient(url);

  if (token !== team.routeToken) return; // uma chamada mais nova já assumiu

  if (!data || !data.routes || !data.routes.length) {
    team.status = 'error'; team.distanceKm = null; team.timeMin = null;
    _inspClearTeamLine(team);
    _inspRenderTeams();
    return;
  }

  const route = data.routes[0];
  team.distanceKm = route.distance / 1000;
  team.timeMin = route.duration / 60;
  team.status = 'ok';
  team.geometry = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lng,lat] -> [lat,lng]
  _inspDrawTeamOnMap(team);
  _inspRenderTeams();
}

// ─── Prévia no mapa ─────────────────────────────────────────────────────────
function _inspClearTeamLine(team) {
  if (team.line) { map.removeLayer(team.line); team.line = null; }
}
function _inspClearTeamLayer(team) {
  _inspClearTeamLine(team);
  team.markers.forEach(m => map.removeLayer(m));
  team.markers = [];
}
function _inspClearAllLayers() {
  _inspTeams.forEach(_inspClearTeamLayer);
}

function _inspDrawTeamOnMap(team) {
  _inspClearTeamLayer(team);
  if (team.geometry && team.geometry.length) {
    team.line = L.polyline(team.geometry, { color: team.color, weight: 4, opacity: 0.85 }).addTo(map);
  }
  team.stops.forEach((s, i) => {
    if (!s.found) return;
    const marker = L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="insp-map-marker" style="background:${team.color}">${i + 1}</div>`,
        iconSize: [20, 20], iconAnchor: [10, 10]
      }),
      bubblingMouseEvents: false
    }).addTo(map);
    marker.bindTooltip(`${escapeHtml(team.name)} · ${escapeHtml(s.code)} — ${escapeHtml(s.name || '')}`, { direction: 'top', offset: [0, -8] });
    team.markers.push(marker);
  });
}

function _inspRedrawAllLayers() {
  _inspTeams.forEach(team => {
    if (team.geometry || team.stops.some(s => s.found)) _inspDrawTeamOnMap(team);
  });
}

// Chamado pelo switchTab() em 09-tabs-bulk.js -- a prévia das rotas só faz
// sentido enquanto essa aba está aberta (mesma ideia do GPX/Medidas).
function _setInspLayerVisible(visible) {
  if (!visible) { _inspClearAllLayers(); return; }
  _inspRedrawAllLayers();
}

// ─── Exportar KML ───────────────────────────────────────────────────────────
function _inspBuildTeamPlacemark(team) {
  const coords = (team.geometry && team.geometry.length)
    ? team.geometry
    : team.stops.filter(s => s.found).map(s => [s.lat, s.lng]);
  if (coords.length < 2) return '';
  const coordStr = coords.map(([lat, lng]) => `${lng},${lat},0`).join(' ');
  const kmlColor = _hexToKmlColor(team.color, 1);
  const stopsPlacemarks = team.stops.filter(s => s.found).map((s, i) => `  <Placemark>
    <name>${_escapeXml(`${i + 1}. ${s.code}`)}</name>
    <description>${_escapeXml(s.name || '')}</description>
    <Point><coordinates>${s.lng},${s.lat},0</coordinates></Point>
  </Placemark>`).join('\n');
  return `  <Placemark>
    <name>${_escapeXml(team.name)}</name>
    <Style><LineStyle><color>${kmlColor}</color><width>4</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
  </Placemark>
${stopsPlacemarks}`;
}

function _inspKmlDoc(placemarksXml, docName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${_escapeXml(docName)}</name>
${placemarksXml}
</Document>
</kml>`;
}

window.exportInspTeamKml = function() {
  const team = _inspTeamById(_inspSelectedId);
  if (!team) { showToast('⚠️ Nenhuma equipe selecionada'); return; }
  const placemark = _inspBuildTeamPlacemark(team);
  if (!placemark) { showToast('⚠️ Adicione ao menos 2 códigos válidos antes de exportar'); return; }
  const kml = _inspKmlDoc(placemark, team.name);
  triggerDownload(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), `${team.name.replace(/[\\/:*?"<>|]+/g, '_')}.kml`);
  showToast(`⬇ KML de <span class="accent">${escapeHtml(team.name)}</span> exportado`);
};

window.exportInspAllTeamsKml = function() {
  const ready = _inspTeams.filter(t => t.stops.filter(s => s.found).length >= 2);
  if (!ready.length) { showToast('⚠️ Nenhuma equipe com rota pronta pra exportar'); return; }
  const placemarks = ready.map(_inspBuildTeamPlacemark).filter(Boolean).join('\n');
  const kml = _inspKmlDoc(placemarks, 'Rotas de inspeção');
  triggerDownload(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'rotas de inspecao - todas as equipes.kml');
  showToast(`⬇ <span class="accent">${ready.length} equipe${ready.length > 1 ? 's' : ''}</span> exportadas`);
};

// ─── Render ─────────────────────────────────────────────────────────────────
function _inspStatusLine(team) {
  const usable = team.stops.filter(s => s.found).length;
  if (usable < 2) return 'Adicione pelo menos 2 códigos encontrados para traçar a rota.';
  if (team.status === 'loading') return '⏳ Calculando rota…';
  if (team.status === 'error') return '⚠️ Não foi possível calcular a rota agora (tente de novo em alguns segundos).';
  if (team.status === 'ok' && team.distanceKm != null) {
    return `📏 ${team.distanceKm.toFixed(1)} km &nbsp;·&nbsp; ⏱ estimativa: <b>${_inspFormatDuration(team.timeMin)}</b>`;
  }
  return '';
}

function _inspTeamHtml(team) {
  const selected = team.id === _inspSelectedId;
  const stopsHtml = team.stops.length ? team.stops.map((s, i) => `
    <div class="route-stop-item insp-stop-item" data-idx="${i}">
      <span class="route-stop-num" style="background:${team.color}">${i + 1}</span>
      <span class="route-stop-coords${s.found ? '' : ' insp-not-found'}" title="${escapeHtml(s.name || '')}">
        ${escapeHtml(s.code)}${s.found ? ' — ' + escapeHtml(s.name || '') : ' (não encontrado)'}
      </span>
      <button class="route-stop-move" data-dir="up" title="Mover para cima" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="route-stop-move" data-dir="down" title="Mover para baixo" ${i === team.stops.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="route-stop-delete" title="Remover parada">✕</button>
    </div>
  `).join('') : '<div class="insp-stops-empty">Nenhum código adicionado ainda</div>';

  return `
    <div class="insp-team${selected ? ' insp-team-selected' : ''}" data-team="${team.id}" style="--team-color:${team.color}">
      <div class="insp-team-head">
        <button class="insp-team-color-dot" title="Clique para trocar a cor" style="background:${team.color}"></button>
        <input class="insp-team-name" value="${escapeHtml(team.name)}" spellcheck="false" title="Nome da equipe">
        <button class="insp-team-delete" title="Remover equipe">🗑</button>
      </div>
      <div class="insp-team-add">
        <input class="insp-code-input" placeholder="Código da OAE · Enter adiciona, ou cole uma coluna do Excel">
        <button class="insp-code-add-btn" type="button">+ Adicionar</button>
      </div>
      <div class="insp-team-stops">${stopsHtml}</div>
      <div class="insp-team-summary">${_inspStatusLine(team)}</div>
    </div>
  `;
}

function _inspRenderTeams() {
  const list = document.getElementById('inspTeamsList');
  if (!list) return;
  list.innerHTML = _inspTeams.map(_inspTeamHtml).join('');

  list.querySelectorAll('.insp-team').forEach(el => {
    const teamId = Number(el.dataset.team);
    const team = _inspTeamById(teamId);
    if (!team) return;

    el.addEventListener('click', () => {
      if (_inspSelectedId !== teamId) { _inspSelectedId = teamId; _inspRenderTeams(); }
    });

    el.querySelector('.insp-team-color-dot').addEventListener('click', ev => {
      ev.stopPropagation();
      const idx = INSP_TEAM_COLORS.indexOf(team.color);
      team.color = INSP_TEAM_COLORS[(idx + 1) % INSP_TEAM_COLORS.length];
      _inspRenderTeams();
      if (team.geometry || team.stops.some(s => s.found)) _inspDrawTeamOnMap(team);
    });

    const nameInput = el.querySelector('.insp-team-name');
    nameInput.addEventListener('click', ev => ev.stopPropagation());
    nameInput.addEventListener('change', () => { team.name = nameInput.value.trim() || team.name; });

    el.querySelector('.insp-team-delete').addEventListener('click', ev => {
      ev.stopPropagation();
      _inspDeleteTeam(teamId);
    });

    const codeInput = el.querySelector('.insp-code-input');
    const addBtn = el.querySelector('.insp-code-add-btn');
    codeInput.addEventListener('click', ev => ev.stopPropagation());
    const submitCode = () => {
      if (codeInput.value.trim()) { _inspAddCodes(teamId, codeInput.value); codeInput.value = ''; }
    };
    codeInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); submitCode(); } });
    addBtn.addEventListener('click', ev => { ev.stopPropagation(); submitCode(); });
    // Colar uma coluna copiada do Excel: um <input> de uma linha só
    // descarta as quebras de linha do texto colado (tudo vira uma linha
    // grudada), então sem isso só o primeiro código entrava. Lendo
    // clipboardData.getData direto (em vez de deixar o navegador colar no
    // campo) preserva as quebras de linha originais.
    codeInput.addEventListener('paste', ev => {
      const text = (ev.clipboardData || window.clipboardData).getData('text');
      if (text && /[\n\r\t,;]/.test(text)) {
        ev.preventDefault();
        _inspAddCodes(teamId, text);
        codeInput.value = '';
      }
      // colar um valor único (sem separador) segue o comportamento normal
      // do campo -- a pessoa ainda pode revisar/editar antes do Enter.
    });

    el.querySelectorAll('.insp-stop-item').forEach(item => {
      const idx = Number(item.dataset.idx);
      item.querySelector('.route-stop-delete').addEventListener('click', ev => {
        ev.stopPropagation();
        _inspRemoveStop(teamId, idx);
      });
      item.querySelectorAll('.route-stop-move').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          _inspMoveStop(teamId, idx, btn.dataset.dir === 'up' ? -1 : 1);
        });
      });
    });
  });
}

(function _inspWireUi() {
  const addTeamBtn = document.getElementById('inspAddTeamBtn');
  const exportSelectedBtn = document.getElementById('inspExportSelectedBtn');
  const exportAllBtn = document.getElementById('inspExportAllBtn');
  if (!addTeamBtn) return;

  addTeamBtn.addEventListener('click', () => _inspCreateTeam());
  if (exportSelectedBtn) exportSelectedBtn.addEventListener('click', () => window.exportInspTeamKml());
  if (exportAllBtn) exportAllBtn.addEventListener('click', () => window.exportInspAllTeamsKml());

  // Começa com uma equipe pronta pra usar, em vez de uma lista vazia.
  _inspCreateTeam('Equipe 1');
})();
