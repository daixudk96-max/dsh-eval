'use strict';

/**
 * Candidate lifecycle state machine (from parent design §B).
 * DRAFT → SEALED → EVALUATING → ACCEPTED → PROMOTED
 *                            ↘ REJECTED | INCONCLUSIVE (→ EVALUATING) | INVALID
 * Terminal states: PROMOTED, REJECTED, INVALID (FAILED is a rejected outcome).
 */
const TRANSITIONS = {
  DRAFT: ['SEALED'],
  SEALED: ['EVALUATING'],
  EVALUATING: ['ACCEPTED', 'REJECTED', 'INCONCLUSIVE', 'INVALID'],
  ACCEPTED: ['PROMOTED'],
  INCONCLUSIVE: ['EVALUATING'],
  REJECTED: [],
  PROMOTED: [],
  INVALID: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`invalid transition ${from} -> ${to}`);
  }
}

module.exports = { TRANSITIONS, canTransition, assertTransition };
