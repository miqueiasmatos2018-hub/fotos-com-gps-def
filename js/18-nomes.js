// ==========================================================================
// 18-nomes.js
// "Nomes" tab: standardized photo-name generator for OAE inspections.
//
// "Fotos Superiores" -- a fixed set of 11 names tied to a schematic diagram
// of the structure (click a numbered badge to copy that name).
//
// "Fotos Inferiores" -- a template diagram (8 points, A-H) repeated once
// per tramo, side by side. Clicking an empty point fills it with the next
// number in sequence and generates its name from fixed rules based on the
// point's letter and its tramo's position (first/middle/last) -- see
// buildInfName(). Only clicked points get a name. Names are computed live
// from (letter, tramo index, total tramo count) rather than frozen at
// click time, so a point that fell back to "TRANSIÇÃO 02" for being on the
// last tramo automatically updates to "APOIO NN" if more tramos are added
// afterward. The list persists in localStorage across reloads.
//
// Ported from a standalone tool (gerador-nomes) with the same two changes
// made for the Elementos tab, for the same reasons:
//  1. Every DOM id is prefixed "nomes" (nomesNamesList, nomesInfDiagrams,
//     ...) so it can't collide with ids anywhere else in this app.
//  2. Every CSS class this file generates or queries is prefixed "nomes-"
//     (nomes-group, nomes-g-title, ...) -- NOT "elem-", even though a few
//     names (like "group" and "copied") are shared with the Elementos tool
//     this app already has, specifically to avoid colliding with ITS
//     elem-* classes as well as the rest of the app's own stylesheet.
//  3. Everything is wrapped in the SAME top-level IIFE the original tool
//     already used, so none of its internal names (filled, render, el,
//     ...) leak into the shared global scope.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

(function(){

  "use strict";

  var STATIC_NAMES = [
    'LE INICIO, DIAGONAL SUPERIOR',
    'LE LATERAL, SUPERIOR',
    'LE FINAL, DIAGONAL SUPERIOR',
    'DECRESCENTE SUPERIOR',
    'LD FINAL, DIAGONAL SUPERIOR',
    'LD LATERAL, SUPERIOR',
    'LD INICIO, DIAGONAL SUPERIOR',
    'CRESCENTE SUPERIOR',
    'SUPERIOR ORTOGONAL',
    'VISTA TERREA SENTIDO CRESCENTE',
    'VISTA TERREA SENTIDO DECRESCENTE'
  ];

  function el(tag, attrs, children){
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function(c){ node.appendChild(c); });
    return node;
  }

  function pad2(n){ return String(n).padStart(2, '0'); }

  function populateNumberSelect(select, max){
    for (var i = 1; i <= max; i++){
      var opt = document.createElement('option');
      opt.value = pad2(i);
      opt.textContent = pad2(i);
      select.appendChild(opt);
    }
  }

  function populateTramoCountSelect(select, max){
    for (var i = 1; i <= max; i++){
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = i + (i === 1 ? ' tramo' : ' tramos');
      select.appendChild(opt);
    }
  }

  function uid(){
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  var listEl = document.getElementById('nomesNamesList');
  var emptyEl = document.getElementById('nomesNamesEmptyState');
  var countEl = document.getElementById('nomesNamesCount');
  var startNumberInput = document.getElementById('nomesStartNumber');
  var tramoCountSel = document.getElementById('nomesTramoCount');
  var diagramsEl = document.getElementById('nomesInfDiagrams');
  var staticCountEl = document.getElementById('nomesStaticNamesCount');
  var staticDiagram = document.getElementById('nomesStaticDiagram');
  var staticBadges = staticDiagram ? Array.prototype.slice.call(staticDiagram.querySelectorAll('.nomes-diagram-badge')) : [];

  if (!diagramsEl) return; // protecao caso o elemento nao exista na pagina

  populateTramoCountSelect(tramoCountSel, 20);

  // ---------- persistencia ----------
  function loadJSON(key, fallback){
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e){ return fallback; }
  }
  function saveJSON(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e){}
  }

  // ---------- clipboard (mesmo padrao do app.js) ----------
  function copyText(text){
    if (navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve, reject){
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); resolve(); }
      catch(e){ reject(e); }
      document.body.removeChild(ta);
    });
  }

  // onRemove: function|null — mostra botao "Remover"
  // isCopied / onToggleCopied: controlam o estado persistente de "copiado"
  // displayNumber: numero exibido antes do nome (não entra na cópia)
  function renderItemCard(text, onRemove, isCopied, onToggleCopied, displayNumber){
    var groupEl = el('div', {class:'nomes-group nomes-name-item' + (isCopied ? ' nomes-group-copied' : '')});
    groupEl.appendChild(el('div', {class:'nomes-g-corner-tr'}));
    groupEl.appendChild(el('div', {class:'nomes-g-corner-br'}));

    var titleChildren = [];
    if (displayNumber !== undefined && displayNumber !== null){
      titleChildren.push(el('span', {class:'nomes-g-id', text: String(displayNumber)}));
    }
    titleChildren.push(el('span', {class:'nomes-g-name', text: text}));
    var title = el('div', {class:'nomes-g-title'}, titleChildren);

    var actions = el('div', {class:'nomes-g-actions'});
    var badge = el('span', {class:'nomes-copied-badge', text:'✓ copiado'});
    var copyBtn = el('button', {class:'nomes-btn nomes-copy-dims', type:'button', text: isCopied ? 'Copiado' : 'Copiar'});

    copyBtn.addEventListener('click', function(){
      copyText(text).then(function(){
        groupEl.classList.add('nomes-group-copied');
        copyBtn.textContent = 'Copiado';
        onToggleCopied(true);
      }).catch(function(){
        // Clipboard writes legitimately fail (permission denied, page not
        // focused, non-HTTPS context). Without this the click did nothing
        // at all and gave no clue why.
        var original = copyBtn.textContent;
        copyBtn.textContent = 'Falhou';
        setTimeout(function(){ copyBtn.textContent = original; }, 1500);
      });
    });

    actions.appendChild(badge);
    actions.appendChild(copyBtn);

    if (onRemove){
      var removeBtn = el('button', {class:'nomes-btn', type:'button', text:'Remover'});
      removeBtn.addEventListener('click', onRemove);
      actions.appendChild(removeBtn);
    }

    var head = el('div', {class:'nomes-g-head'}, [title, actions]);
    groupEl.appendChild(head);
    return groupEl;
  }

  function fotoLabel(n){ return n + (n === 1 ? ' foto' : ' fotos'); }

  function renderStatic(){
    var copiedCount = Object.keys(staticCopied).length;
    staticCountEl.textContent = fotoLabel(STATIC_NAMES.length) + (copiedCount ? ' · ' + copiedCount + ' copiadas' : '');
    staticBadges.forEach(function(badge){
      var idx = Number(badge.getAttribute('data-index'));
      badge.classList.toggle('nomes-copied', !!staticCopied[idx]);
    });
  }

  function handleStaticBadgeActivate(badge){
    var idx = Number(badge.getAttribute('data-index'));
    var text = STATIC_NAMES[idx];
    if (text === undefined) return;
    copyText(text).then(function(){
      staticCopied[idx] = true;
      renderStatic();
    }).catch(function(){
      // Don't mark it green if nothing actually reached the clipboard --
      // that would tell the user the photo was handled when it wasn't.
      badge.classList.add('nomes-copy-failed');
      setTimeout(function(){ badge.classList.remove('nomes-copy-failed'); }, 1500);
    });
  }

  staticBadges.forEach(function(badge){
    badge.addEventListener('click', function(){ handleStaticBadgeActivate(badge); });
    badge.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){
        ev.preventDefault();
        handleStaticBadgeActivate(badge);
      }
    });
  });

  // =====================================================================
  // FOTOS INFERIORES — diagram-driven, click-to-fill generator.
  //
  // One template diagram (8 points, A-H) is repeated once per tramo, side
  // by side. Clicking an empty point assigns it the next number in the
  // sequence (starting from "Numeração inicial") and generates its name
  // from fixed rules -- see buildInfName() below. Only clicked points get
  // a name; nothing is generated for points never clicked. Names are
  // computed live from (letter, tramo index, total tramo count), not
  // frozen at click time, so they stay correct if the tramo count changes
  // later (e.g. a point that fell back to "TRANSIÇÃO 02" because it was
  // on the last tramo automatically becomes "APOIO NN" if more tramos are
  // added afterward).
  // =====================================================================

  var INF_STORAGE_KEY   = 'sge-nomes-inferiores-pontos';   // [{id, tramo, letter}], em ordem de clique
  var START_NUMBER_KEY  = 'sge-nomes-numero-inicial';       // reaproveita a mesma chave/campo de antes
  var TRAMO_COUNT_KEY   = 'sge-nomes-inferiores-qtd-tramos';

  var filled = loadJSON(INF_STORAGE_KEY, []);
  function saveFilled(){ saveJSON(INF_STORAGE_KEY, filled); }

  var tramoCount = loadJSON(TRAMO_COUNT_KEY, 1);
  if (tramoCount < 1 || tramoCount > 20) tramoCount = 1;
  tramoCountSel.value = String(tramoCount);

  var startNumber = loadJSON(START_NUMBER_KEY, 12);
  // Guard against a stored value from an older build (or a hand-edited
  // localStorage entry) that's below the minimum.
  if (!(startNumber >= 1)) startNumber = 1;
  if (startNumberInput){
    startNumberInput.value = startNumber;
    startNumberInput.addEventListener('input', function(){
      var val = parseInt(startNumberInput.value, 10);
      // The input declares min="1", but that's only enforced on form
      // submit/stepper -- typing "0" or "-5" directly still fires 'input'
      // with that value, which would produce zero/negative photo numbers.
      startNumber = (isNaN(val) || val < 1) ? 1 : val;
      saveJSON(START_NUMBER_KEY, startNumber);
      renderAll();
    });
  }

  // marcacoes de "copiado" (lista de resultados) — só duram enquanto a
  // página está aberta, não persistem em localStorage
  var staticCopied = {};   // { indice: true }  (Fotos Superiores)
  var dynamicCopied = {};  // { id: true }       (Fotos Inferiores)

  // ---------- regras de nomenclatura ----------
  // direction 'next' = apoio/transição em direção ao tramo seguinte;
  // 'prev' = em direção ao tramo anterior. O número do apoio usa o
  // número do PRÓPRIO tramo (lado seguinte) ou do tramo ANTERIOR (lado
  // anterior) -- nunca "tramo + 1".
  function apoioLabel(tramoIdx, total, direction){
    if (direction === 'next'){
      return tramoIdx < total ? ('APOIO ' + pad2(tramoIdx)) : 'TRANSIÇÃO 02';
    }
    return tramoIdx > 1 ? ('APOIO ' + pad2(tramoIdx - 1)) : 'TRANSIÇÃO 01';
  }

  function buildInfName(letter, tramoIdx, total){
    var t = 'INFERIOR, TRAMO ' + pad2(tramoIdx);
    switch (letter){
      case 'A': return t + ', LE, ' + apoioLabel(tramoIdx, total, 'next');
      case 'B': return t + ', LE';
      case 'C': return t + ', LE, ' + apoioLabel(tramoIdx, total, 'prev');
      case 'D': return t + ', ' + apoioLabel(tramoIdx, total, 'prev');
      case 'E': return t + ', ' + apoioLabel(tramoIdx, total, 'next');
      case 'F': return t + ', LD, ' + apoioLabel(tramoIdx, total, 'next');
      case 'G': return t + ', LD';
      case 'H': return t + ', LD, ' + apoioLabel(tramoIdx, total, 'prev');
      default:  return t;
    }
  }

  // ---------- diagrama (SVG por tramo) ----------
  // Posições dos 8 pontos dentro de um viewBox 0 0 300 210, no mesmo
  // arranjo do template de referência: A/B/C acima do retângulo (fora),
  // D/E dentro do retângulo, F/G/H abaixo (fora).
  var LETTER_ORDER = ['A','B','C','D','E','F','G','H'];
  var LETTER_POS = {
    A: { cx: 30,  cy: 22 }, B: { cx: 150, cy: 16 }, C: { cx: 270, cy: 22 },
    D: { cx: 110, cy: 100 }, E: { cx: 190, cy: 100 },
    F: { cx: 30,  cy: 182 }, G: { cx: 150, cy: 188 }, H: { cx: 270, cy: 182 }
  };
  // Segmento curto de seta perto de cada círculo, na direção descrita no
  // template (A/C/F/H apontam para dentro horizontalmente; B/G apontam
  // para dentro do retângulo verticalmente; D/E apontam para fora do
  // retângulo, D para a esquerda e E para a direita).
  var LETTER_ARROW = {
    A: { x1: 48,  y1: 22,  x2: 62,  y2: 22 },
    B: { x1: 150, y1: 34,  x2: 150, y2: 58 },
    C: { x1: 252, y1: 22,  x2: 238, y2: 22 },
    D: { x1: 95,  y1: 100, x2: 65,  y2: 100 },
    E: { x1: 205, y1: 100, x2: 235, y2: 100 },
    F: { x1: 48,  y1: 182, x2: 62,  y2: 182 },
    G: { x1: 150, y1: 168, x2: 150, y2: 144 },
    H: { x1: 252, y1: 182, x2: 238, y2: 182 }
  };
  var LETTER_TITLE = {
    A: 'LE, apoio seguinte (ou transição final)',
    B: 'LE',
    C: 'LE, apoio anterior (ou transição inicial)',
    D: 'Apoio anterior (ou transição inicial)',
    E: 'Apoio seguinte (ou transição final)',
    F: 'LD, apoio seguinte (ou transição final)',
    G: 'LD',
    H: 'LD, apoio anterior (ou transição inicial)'
  };

  function findFilled(tramoIdx, letter){
    for (var i = 0; i < filled.length; i++){
      if (filled[i].tramo === tramoIdx && filled[i].letter === letter) return filled[i];
    }
    return null;
  }

  function buildTramoDiagramHtml(tramoIdx){
    var markerId = 'nomesInfArrow' + tramoIdx;
    var badgesHtml = LETTER_ORDER.map(function(letter){
      var pos = LETTER_POS[letter];
      var entry = findFilled(tramoIdx, letter);
      var displayNum = entry ? String(filled.indexOf(entry) + startNumber) : '';
      var filledClass = entry ? ' nomes-copied' : '';
      return '<g class="nomes-diagram-badge nomes-inf-badge' + filledClass + '" data-tramo="' + tramoIdx + '" data-letter="' + letter + '" role="button" tabindex="0" aria-label="' + LETTER_TITLE[letter] + '">' +
        '<title>' + LETTER_TITLE[letter] + '</title>' +
        '<circle class="nomes-diagram-badge-circle" cx="' + pos.cx + '" cy="' + pos.cy + '" r="15"></circle>' +
        '<text class="nomes-diagram-badge-text" x="' + pos.cx + '" y="' + pos.cy + '" dy="0.35em">' + displayNum + '</text>' +
      '</g>';
    }).join('');

    var arrowsHtml = LETTER_ORDER.map(function(letter){
      var a = LETTER_ARROW[letter];
      return '<line class="nomes-diagram-arrow" x1="' + a.x1 + '" y1="' + a.y1 + '" x2="' + a.x2 + '" y2="' + a.y2 + '" marker-end="url(#' + markerId + ')"></line>';
    }).join('');

    return '<div class="nomes-inf-diagram-wrap">' +
      '<svg class="nomes-inf-diagram" viewBox="0 0 300 210" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><marker id="' + markerId + '" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="nomes-diagram-arrowhead"></path></marker></defs>' +
        '<text class="nomes-inf-tramo-label" x="150" y="72">TRAMO ' + pad2(tramoIdx) + '</text>' +
        '<rect class="nomes-diagram-rect" x="60" y="60" width="180" height="80"></rect>' +
        arrowsHtml + badgesHtml +
      '</svg>' +
    '</div>';
  }

  function renderDiagrams(){
    var html = '';
    for (var i = 1; i <= tramoCount; i++) html += buildTramoDiagramHtml(i);
    diagramsEl.innerHTML = html;
  }

  function handleInfBadgeActivate(badge){
    var tramoIdx = Number(badge.getAttribute('data-tramo'));
    var letter = badge.getAttribute('data-letter');
    if (findFilled(tramoIdx, letter)) return; // já preenchido -- clique não faz nada
    filled.push({ id: uid(), tramo: tramoIdx, letter: letter });
    saveFilled();
    renderAll();
  }

  // Delegação de evento no container -- sobrevive a renderDiagrams()
  // recriar todo o innerHTML a cada clique, sem precisar re-anexar
  // listeners em cada círculo individualmente.
  diagramsEl.addEventListener('click', function(ev){
    var badge = ev.target.closest('.nomes-inf-badge');
    if (badge) handleInfBadgeActivate(badge);
  });
  diagramsEl.addEventListener('keydown', function(ev){
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var badge = ev.target.closest('.nomes-inf-badge');
    if (!badge) return;
    ev.preventDefault();
    handleInfBadgeActivate(badge);
  });

  tramoCountSel.addEventListener('change', function(){
    var val = parseInt(tramoCountSel.value, 10);
    var newCount = isNaN(val) ? 1 : val;
    var orphaned = filled.filter(function(f){ return f.tramo > newCount; });
    if (orphaned.length && !confirm('Reduzir para ' + newCount + ' tramo(s) vai remover ' + orphaned.length + ' nome(s) já gerado(s) para tramos que deixarão de existir. Continuar?')){
      tramoCountSel.value = String(tramoCount);
      return;
    }
    tramoCount = newCount;
    if (orphaned.length){
      filled = filled.filter(function(f){ return f.tramo <= tramoCount; });
      saveFilled();
    }
    saveJSON(TRAMO_COUNT_KEY, tramoCount);
    renderAll();
  });

  function renderInfList(){
    listEl.innerHTML = '';
    var copiedCount = filled.filter(function(f){ return !!dynamicCopied[f.id]; }).length;
    countEl.textContent = fotoLabel(filled.length) + (copiedCount ? ' · ' + copiedCount + ' copiadas' : '');
    emptyEl.style.display = filled.length ? 'none' : 'block';
    filled.forEach(function(entry, i){
      var text = buildInfName(entry.letter, entry.tramo, tramoCount);
      listEl.appendChild(renderItemCard(
        text,
        function(){
          filled = filled.filter(function(f){ return f.id !== entry.id; });
          delete dynamicCopied[entry.id];
          saveFilled();
          renderAll();
        },
        !!dynamicCopied[entry.id],
        function(val){
          if (val) dynamicCopied[entry.id] = true; else delete dynamicCopied[entry.id];
          renderInfList();
        },
        i + startNumber
      ));
    });
  }

  function renderAll(){
    renderDiagrams();
    renderInfList();
  }

  document.getElementById('nomesBtnCopyAllNames').addEventListener('click', function(ev){
    if (filled.length === 0) return;
    var btn = ev.currentTarget;
    var allText = filled.map(function(f){ return buildInfName(f.letter, f.tramo, tramoCount); }).join('\n');
    copyText(allText).then(function(){
      var original = btn.textContent;
      btn.classList.add('nomes-copied');
      btn.textContent = 'Copiado!';
      setTimeout(function(){ btn.classList.remove('nomes-copied'); btn.textContent = original; }, 1200);
    }).catch(function(){
      var original = btn.textContent;
      btn.textContent = 'Falhou';
      setTimeout(function(){ btn.textContent = original; }, 1500);
    });
  });

  document.getElementById('nomesBtnClearNames').addEventListener('click', function(){
    if (filled.length === 0) return;
    if (confirm('Remover todos os nomes gerados da lista?')){
      filled = [];
      dynamicCopied = {};
      saveFilled();
      renderAll();
    }
  });

  var btnUnmarkNames = document.getElementById('nomesBtnUnmarkNames');
  if (btnUnmarkNames){
    btnUnmarkNames.addEventListener('click', function(){
      dynamicCopied = {};
      renderInfList();
    });
  }

  document.getElementById('nomesBtnCopyAllStatic').addEventListener('click', function(ev){
    var btn = ev.currentTarget;
    copyText(STATIC_NAMES.join('\n')).then(function(){
      var original = btn.textContent;
      btn.classList.add('nomes-copied');
      btn.textContent = 'Copiado!';
      setTimeout(function(){ btn.classList.remove('nomes-copied'); btn.textContent = original; }, 1200);
    }).catch(function(){
      var original = btn.textContent;
      btn.textContent = 'Falhou';
      setTimeout(function(){ btn.textContent = original; }, 1500);
    });
  });

  var btnUnmarkStatic = document.getElementById('nomesBtnUnmarkStatic');
  if (btnUnmarkStatic){
    btnUnmarkStatic.addEventListener('click', function(){
      staticCopied = {};
      renderStatic();
    });
  }

  renderStatic();
  renderAll();

})();

