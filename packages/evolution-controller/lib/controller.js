'use strict';
const { appendLedger } = require('./fs-store');
const { assertTransition } = require('./state-machine');
const { evaluateGate } = require('./gate');

/**
 * EvolutionController — deterministic governance core.
 * Owns the Candidate state machine, the Code Gate, CAS promote binding
 * (via the injected preset-registry) and the append-only audit ledger.
 * It never generates semantic evaluation verdicts itself.
 */
class EvolutionController {
  /**
   * @param {object} opts
   * @param {object} opts.registry preset-registry instance (createCandidate, patchCandidate, sealRevision, promote)
   * @param {string} opts.auditDir append-only audit ledger directory
   * @param {object} [opts.gateDefaults] default minEffect/tolerance
   */
  constructor({ registry, auditDir, gateDefaults = {} }) {
    if (!registry) throw new Error('registry is required');
    this.registry = registry;
    this.auditDir = auditDir;
    this.gateDefaults = gateDefaults;
    this.runs = new Map();
  }

  async _audit(entry) {
    await appendLedger(this.auditDir, { op: 'audit', ts: new Date().toISOString(), ...entry });
  }

  async newRun({ source, triggerEvaluationRunId, selectedFailureClusters = [] }) {
    const id = `evr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run = {
      id, source, triggerEvaluationRunId, selectedFailureClusters,
      state: 'DRAFT', candidateId: null, sealed: null, decision: null, gateResult: null,
      createdAt: new Date().toISOString(),
    };
    this.runs.set(id, run);
    await this._audit({ runId: id, event: 'created', state: run.state });
    return run;
  }

  getRun(runId) {
    return this.runs.get(runId);
  }

  /** Create + patch the candidate in staging; the run moves DRAFT → SEALED only on seal(). */
  async createCandidate(runId, { logicalId, sourceRevisionId, mutations = [] }) {
    const run = this._require(runId);
    assertTransition(run.state, 'SEALED'); // candidate-created is within DRAFT flow
    const candidateId = await this.registry.createCandidate(logicalId, { sourceRevisionId, evolutionRunId: runId });
    for (const m of mutations) await this.registry.patchCandidate(candidateId, m);
    run.candidateId = candidateId;
    run.mutations = mutations;
    await this._audit({ runId, event: 'candidate-created', candidateId });
    return candidateId;
  }

  /** Seal the candidate into an immutable revision; DRAFT → SEALED. */
  async seal(runId) {
    const run = this._require(runId);
    if (!run.candidateId) throw new Error('no candidate yet');
    assertTransition(run.state, 'SEALED');
    const sealed = await this.registry.sealRevision(run.candidateId);
    run.sealed = sealed;
    run.state = 'SEALED';
    await this._audit({ runId, event: 'sealed', candidateId: run.candidateId, revisionId: sealed.revisionId, digest: sealed.digest });
    return sealed;
  }

  /** Run the Code Gate; SEALED → EVALUATING → ACCEPTED | REJECTED | INCONCLUSIVE | INVALID. */
  async evaluate(runId, { baseline, candidate, gateOverrides = {}, rubric }) {
    const run = this._require(runId);
    assertTransition(run.state, 'EVALUATING');
    run.state = 'EVALUATING';
    const rubricOverrides = rubric !== undefined
      ? {
          rubricScore: rubric.score,
          rubricMinScore: rubric.minScore,
          rubricRegressions: rubric.regressions ?? [],
        }
      : {};
    const gateResult = evaluateGate({ baseline, candidate, ...this.gateDefaults, ...gateOverrides, ...rubricOverrides });
    run.gateResult = gateResult;
    run.decision = gateResult.decision;
    run.rubric = rubric; // raw rubric evidence kept on the run for audit
    // map gate decision to state
    if (gateResult.decision === 'PASS') run.state = 'ACCEPTED';
    else if (gateResult.decision === 'INCONCLUSIVE') run.state = 'INCONCLUSIVE';
    else if (gateResult.decision === 'INVALID') run.state = 'INVALID';
    else run.state = 'REJECTED'; // FAIL
    await this._audit({
      runId, event: 'gate', from: 'EVALUATING', to: run.state, decision: gateResult.decision, reason: gateResult.reason,
      ...(rubric !== undefined
        ? { rubric: { score: rubric.score, minScore: rubric.minScore, regressions: rubric.regressions ?? [] } }
        : {}),
    });
    return run;
  }

  /** Resample path: INCONCLUSIVE → EVALUATING (allows more trials). */
  async resample(runId) {
    const run = this._require(runId);
    assertTransition(run.state, 'EVALUATING');
    run.state = 'EVALUATING';
    await this._audit({ runId, event: 'resample', to: 'EVALUATING' });
    return run;
  }

  /**
   * Promote via preset-registry CAS. Requires ACCEPTED + user approvalId.
   * ACCEPTED → PROMOTED (only on success; audit-only on any failure).
   */
  async promote(runId, { logicalId, approvalId }) {
    const run = this._require(runId);
    if (run.state !== 'ACCEPTED') throw new Error(`cannot promote run in state ${run.state} (only ACCEPTED)`);
    if (!approvalId) throw new Error('approvalId is required (user confirmation binding)');
    if (!run.sealed) throw new Error('run not sealed');
    const expectedCurrent = await this.registry.resolveCurrent(logicalId);
    const gateResult = run.gateResult || {};
    const result = await this.registry.promote(logicalId, {
      expectedCurrent: expectedCurrent ? { revisionId: expectedCurrent.revisionId, digest: expectedCurrent.digest } : null,
      targetRevision: run.sealed.revisionId,
      candidateDigest: run.sealed.digest,
      gateRunId: run.id,
      approvalId,
    });
    run.state = 'PROMOTED';
    run.promotedAt = new Date().toISOString();
    run.promotedRevision = result.revisionId;
    await this._audit({ runId, event: 'promoted', revisionId: result.revisionId, digest: result.digest, approvalId, gateRuleSet: gateResult.ruleSetVersion });
    return result;
  }

  _require(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    return run;
  }
}

module.exports = { EvolutionController };
