// ==========================================================================
// 00-core.js
// Config, EXIF number helper. Runs first.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

const EMBEDDED_CSV_URL = './current.csv';

const exifr = window.exifr;

// exifr can return rational numbers as {numerator,denominator} objects
function toNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && 'numerator' in val) return val.numerator / val.denominator;
  if (Array.isArray(val) && val.length === 2) return val[0] / val[1];
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
