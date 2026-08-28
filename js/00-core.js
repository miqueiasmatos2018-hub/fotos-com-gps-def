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
