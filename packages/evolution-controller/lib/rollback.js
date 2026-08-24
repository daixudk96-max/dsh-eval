'use strict';
const { buildInverseEdits } = require('../../preset-registry/lib/registry.js');

/**
 * Content-level rollback orchestration for the EvolutionController (P2-1/2).
 *
 * `prepareRollback` computes the inverse edits that would restore the applied
 * current content back to a run's source revision — a pure data transform
 * (diff inversion over registry revisions), never an LLM re-guess. It writes
 * nothing. `applyRollback` applies those edits through
 * `registry.rollbackContent` with an explicit approval binding. The
 * controller's `autoRollbackOnReject` option calls `prepareRollback` on a
 * REJECTED candidate and records the intent in the audit ledger, but never
 * auto-applies: applying always requires explicit approval.
 *
 * @module evolution-controller/rollback
 */

/**
 * Compute the inverse edits that restore current content to a run's source
 * revision. Read-only.
 * @param {import('./controller.js').EvolutionController} controller
 * @param {string} runId
 * @param {object} args
 * @param {string} args.logicalId
 * @returns {Promise<{edits:Array,current:{revisionId:string,digest:string},target:string}>}
 */
async function prepareRollback(controller, runId, { logicalId }) {
  const run = controller.getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!run.sourceRevisionId) throw new Error('run has no source revision to roll back to');
  const current = await controller.registry.resolveCurrent(logicalId);
  if (!current) throw new Error(`no current revision for ${logicalId}`);
  const currentContent = await controller.registry.revisionContent(current.digest);
  const sourceContent = await controller._revisionFiles(logicalId, run.sourceRevisionId);
  if (!sourceContent) throw new Error(`source revision not found: ${run.sourceRevisionId}`);
  const edits = buildInverseEdits(currentContent.files, sourceContent.files);
  return {
    edits,
    current: { revisionId: current.revisionId, digest: current.digest },
    target: run.sourceRevisionId,
  };
}

/**
 * Apply a prepared rollback via `registry.rollbackContent`. Requires an
 * explicit approval binding (never auto-applied).
 * @param {import('./controller.js').EvolutionController} controller
 * @param {string} runId
 * @param {object} args
 * @param {string} args.logicalId
 * @param {string} args.approvalId - user confirmation binding (required).
 * @param {boolean} [args.force=false] - override conflict detection.
 * @returns {Promise<object>} registry.rollbackContent result.
 */
async function applyRollback(controller, runId, { logicalId, approvalId, force = false }) {
  const run = controller.getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!approvalId) throw new Error('approvalId is required (user confirmation binding)');
  if (!run.sourceRevisionId) throw new Error('run has no source revision to roll back to');
  return controller.registry.rollbackContent(logicalId, run.sourceRevisionId, {
    detectConflicts: true, force, gateRunId: run.id, approvalId,
  });
}

module.exports = { prepareRollback, applyRollback };
