'use strict';
const { sha256 } = require('../../preset-registry/lib/hash');
const { normalizeText } = require('./proposal-check');

/**
 * near-dup — semantic near-duplicate detection for promotions.
 *
 * Absorbed from ZK-Andy/dsh-continual-evolve src/promotion.ts (near-duplicate
 * detection): a candidate whose normalized content already exists in the
 * logical preset's history is rejected before promote, so a revision cannot
 * be re-promoted under a new digest just by shuffling whitespace or comments.
 * Exact duplicates are caught by the registry's content addressing (equal
 * digests); this module catches near duplicates (normalized-equal content).
 *
 * @module evolution-controller/near-dup
 */

/**
 * Compute the semantic hash of a revision's content files.
 * @param {Record<string,string>} files - { path: content }.
 * @returns {string} sha256 over the joined normalized text.
 */
function contentHash(files) {
  const text = Object.values(files)
    .map((content) => normalizeText(content))
    .join('\n');
  return sha256(text);
}

/**
 * Check a candidate against a set of historical revisions.
 * @param {object[]} history - [{ revisionId, digest }] (active + previous).
 * @param {(digest: string) => Promise<{ files: Record<string,string> } | null>} readRevision
 *   - resolves revision content by digest.
 * @param {Record<string,string>} candidateFiles - { path: content } of the candidate.
 * @returns {Promise<{ isDup: boolean, of: string | null }>} of = historical revisionId when duplicate.
 */
async function nearDuplicate(history, readRevision, candidateFiles) {
  const candidateHash = contentHash(candidateFiles);
  for (const rev of history) {
    const content = await readRevision(rev.digest);
    if (!content) continue;
    if (contentHash(content.files) === candidateHash) {
      return { isDup: true, of: rev.revisionId };
    }
  }
  return { isDup: false, of: null };
}

module.exports = { nearDuplicate, contentHash };
