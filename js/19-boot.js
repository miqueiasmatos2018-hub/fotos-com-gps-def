// ==========================================================================
// 19-boot.js
// Ponto de entrada: carrega o conjunto de dados CSV embutido na inicialização.
//
// Carregado como script clássico (não módulo) -- veja index.html.
// ==========================================================================

// Carrega current.csv na inicialização. Para atualizar a base, basta
// sobrescrever esse arquivo no repositório -- o nome é fixo, então nenhum
// código precisa mudar.
//
// A versão anterior esperava o evento `load` (que só dispara depois de todas
// as imagens e tiles) e ainda somava 1 segundo de setTimeout por cima: na
// prática o mapa ficava vazio por vários segundos sem motivo. O DOM já está
// pronto quando este script roda -- ele é o último da página --, então a
// busca começa imediatamente.
(function() {
  function boot() {
    loadEmbeddedCsv();
    // As estações de chuva são consultadas quando um KML com LD_INICIO é
    // solto. Pré-carregar em segundo plano tira essa espera do caminho.
    if (typeof loadEstacoesCsv === 'function') {
      setTimeout(() => { loadEstacoesCsv().catch(() => {}); }, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
