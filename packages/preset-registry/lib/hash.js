'use strict';
const crypto = require('node:crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Deterministic digest of a plain object (sorted keys, compact JSON). */
function digestObject(obj) {
  const sorted = (o) => {
    if (Array.isArray(o)) return o.map(sorted);
    if (o && typeof o === 'object') {
      const out = {};
      for (const k of Object.keys(o).sort()) out[k] = sorted(o[k]);
      return out;
    }
    return o;
  };
  return sha256(JSON.stringify(sorted(obj)));
}

module.exports = { sha256, digestObject };
