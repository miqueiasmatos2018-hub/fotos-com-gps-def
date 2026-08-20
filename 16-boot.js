// ==========================================================================
// 15-boot.js
// Entry point: loads the embedded CSV dataset on startup.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// ─── EMBEDDED CSV AUTO-LOAD ──────────────────────────────────────────────────
// Loads current.csv on startup. To update the dataset, just overwrite
// that file in the repo — the filename stays fixed, so no code changes needed.
(function() {
  window.addEventListener('load', function() {
    setTimeout(function() {
      loadEmbeddedCsv();
    }, 1000);
  });
})();
