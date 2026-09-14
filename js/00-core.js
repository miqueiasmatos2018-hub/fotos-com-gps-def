// ==========================================================================
// 00-core.js
// Config, helpers compartilhados (EXIF, escape de HTML, concorrência).
// Roda primeiro.
//
// Carregado como script clássico (não módulo) para que todos os arquivos
// compartilhem o mesmo escopo global, igual à build original de arquivo
// único. A ORDEM DE CARREGAMENTO IMPORTA -- veja as tags <script> no fim
// do index.html.
// ==========================================================================

const EMBEDDED_CSV_URL = './current.csv';

const exifr = window.exifr;

// exifr pode devolver racionais como {numerator,denominator}
function toNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (Array.isArray(val) && val.length === 2) {
    const n = Number(val[0]) / Number(val[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === 'object' && 'numerator' in val) {
    const n = Number(val.numerator) / Number(val.denominator);
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

// ─── ESCAPE DE HTML ──────────────────────────────────────────────────────
// Nomes de arquivo, nomes de KML e nomes de ponto são digitados/importados
// pelo usuário e iam direto para innerHTML. Um arquivo chamado
// `foto"><img onerror=...>.jpg` quebrava a lista (ou pior). Tudo que vem
// de fora passa por aqui antes de virar HTML.
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── LOADING DE BOTÃO (mini-ponte animada) ──────────────────────────────
// Usado por qualquer botão que dispara uma operação demorada (gerar
// imagem de satélite, compactar um zip, processar GPX). Antes cada um
// desses botões só trocava o texto para "⏳ ...", cada um com sua própria
// cópia da lógica de salvar/restaurar o rótulo original. Centralizado
// aqui para reduzir duplicação e para todos ganharem a mesma animação.
const BRIDGE_LOADER_SVG =
  '<span class="btn-bridge-loader" aria-hidden="true"><svg viewBox="0 0 64 24" xmlns="http://www.w3.org/2000/svg">' +
    '<line class="bl-tower" x1="12" y1="3" x2="12" y2="18"/>' +
    '<line class="bl-tower" x1="52" y1="3" x2="52" y2="18"/>' +
    '<path class="bl-cable" d="M4,18 Q12,6 20,18"/>' +
    '<path class="bl-cable" d="M20,18 Q32,10 44,18"/>' +
    '<path class="bl-cable" d="M44,18 Q52,6 60,18"/>' +
    '<line class="bl-hanger" x1="16" y1="18" x2="16" y2="11"/>' +
    '<line class="bl-hanger" x1="26" y1="18" x2="26" y2="13.5"/>' +
    '<line class="bl-hanger" x1="38" y1="18" x2="38" y2="13.5"/>' +
    '<line class="bl-hanger" x1="48" y1="18" x2="48" y2="11"/>' +
    '<line class="bl-deck" x1="2" y1="18" x2="62" y2="18"/>' +
    '<rect class="bl-seg bl-seg-1" x="2"  y="19.5" width="12" height="2.4" rx="0.6"/>' +
    '<rect class="bl-seg bl-seg-2" x="15" y="19.5" width="12" height="2.4" rx="0.6"/>' +
    '<rect class="bl-seg bl-seg-3" x="28" y="19.5" width="12" height="2.4" rx="0.6"/>' +
    '<rect class="bl-seg bl-seg-4" x="41" y="19.5" width="12" height="2.4" rx="0.6"/>' +
    '<rect class="bl-seg bl-seg-5" x="54" y="19.5" width="8"  height="2.4" rx="0.6"/>' +
    '<g class="bl-car"><rect x="-4" y="12.6" width="8" height="4" rx="1.2"/></g>' +
  '</svg></span>';

// Põe o botão em estado de carregamento: desabilita, guarda o HTML
// original (para restaurar exatamente como estava, ícones inclusive) e
// mostra a mini-ponte + rótulo. Chamadas repetidas (ex.: PROCESSANDO ->
// SALVANDO no mesmo botão) só atualizam o rótulo, sem perder o HTML
// original já guardado da primeira chamada.
function setButtonLoading(btn, label) {
  if (!btn) return;
  if (btn.dataset.bridgeLoading !== '1') {
    btn.dataset.bridgeLoading = '1';
    btn.dataset.originalHtml = btn.innerHTML;
  }
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.innerHTML = BRIDGE_LOADER_SVG + '<span class="btn-bridge-label">' + escapeHtml(label || 'Aguarde…') + '</span>';
}

// Tira o botão do estado de carregamento. Sem argumentos, restaura o HTML
// de antes de setButtonLoading(); passando restoreLabel, usa esse texto
// no lugar (útil quando o rótulo original também mudou nesse meio-tempo).
function clearButtonLoading(btn, restoreLabel) {
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('btn-loading');
  if (restoreLabel != null) {
    btn.textContent = restoreLabel;
  } else if (btn.dataset.originalHtml != null) {
    btn.innerHTML = btn.dataset.originalHtml;
  }
  delete btn.dataset.bridgeLoading;
  delete btn.dataset.originalHtml;
}

// ─── EXECUÇÃO COM LIMITE DE CONCORRÊNCIA ─────────────────────────────────
// Usado na geração de miniaturas: decodificar 200 fotos de 12MP ao mesmo
// tempo estourava a memória do navegador. Aqui no máximo `limit` tarefas
// rodam simultaneamente, e `onProgress` é chamado a cada conclusão.
async function runWithConcurrency(items, limit, worker, onProgress) {
  let next = 0;
  let done = 0;
  const total = items.length;
  const results = new Array(total);

  async function runner() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      try { results[i] = await worker(items[i], i); }
      catch (err) { results[i] = null; console.warn('Tarefa falhou:', err); }
      done++;
      if (onProgress) onProgress(done, total);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.max(1, Math.min(limit, total)); i++) runners.push(runner());
  await Promise.all(runners);
  return results;
}
