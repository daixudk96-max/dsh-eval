'use strict';
const { appendLedger } = require('./fs-store');
const { assertTransition } = require('./state-machine');
const { evaluateGate } = require('./gate');
const { proposalCheck, normalizeFiles } = require('./proposal-check');
const { BudgetLedger } = require('./budget');
const { nearDuplicate, contentHash } = require('./near-dup');
const { redactReviewText } = require('./redact');

/**
 * EvolutionController — deterministic governance core.
 * Owns the Candidate state machine, the Code Gate, CAS promote binding
 * (via the injected preset-registry) and the append-only audit ledger.
 * It never generates semantic evaluation verdicts itself.
 *
 * Proposal quality (hypothesis + evidence + no-change/test-only/comment-only
 * rejection, W_p = 3) and near-duplicate rejection at promote are enforced in
 * code, absorbed from timwhitez/dsh-self-evolving (proposer protocol) and
 * ZK-Andy/dsh-continual-evolve (promotion near-duplicate detection).
 */
class EvolutionController {
  /**
   * @param {object} opts
   * @param {object} opts.registry preset-registry instance (createCandidate, patchCandidate, sealRevision, promote, revisionContent, history)
   * @param {string} opts.auditDir append-only audit ledger directory
   * @param {object} [opts.gateDefaults] default minEffect/tolerance
   * @param {object} [opts.budget] { dir, limitUsd } budget ledger config; omitted = unlimited
   * @param {string[]} [opts.redactValues] known credential values masked from
   *   hypothesis/evidence before they reach the audit ledger (default none).
   */
  constructor({ registry, auditDir, gateDefaults = {}, budget, redactValues = [] }) {
    if (!registry) throw new Error('registry is required');
    this.registry = registry;
    this.auditDir = auditDir;
    this.gateDefaults = gateDefaults;
    this.budget = budget ? new BudgetLedger(budget) : null;
    this.redactValues = redactValues;
    this.runs = new Map();
  }

  /** Redact review text with this controller's known credential values. */
  _redact(text) {
    return redactReviewText(text, { values: this.redactValues });
  }

  async _audit(entry) {
    await appendLedger(this.auditDir, { op: 'audit', ts: new Date().toISOString(), ...entry });
  }

  /** Spend from the evolution budget (external amounts only); no-op without a budget. */
  async spendBudget(bucket, amountUsd, meta = {}) {
    if (!this.budget) return null;
    const entry = await this.budget.spend(bucket, amountUsd, meta);
    await this._audit({ event: 'budget', bucket, amountUsd, ...meta });
    return entry;
  }

  async newRun({ source, triggerEvaluationRunId, selectedFailureClusters = [] }) {
    if (this.budget) {
      const remaining = await this.budget.remaining();
      if (remaining <= 0) throw new Error(`evolution budget exhausted (remaining ${remaining} USD)`);
    }
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

  /**
   * Create + patch the candidate in staging; the run moves DRAFT → SEALED only on seal().
   * Enforces the proposal quality floor deterministically: the candidate must carry
   * a falsifiable hypothesis and evidence, differ from its source revision in real
   * content (no no-change / test-only / comment-only), and not exceed the run's
   * distinct-hypothesis cap (W_p = 3) nor duplicate an earlier candidate.
   * @param {string} runId
   * @param {object} args
   * @param {string} args.logicalId
   * @param {string} args.sourceRevisionId
   * @param {string} args.hypothesis - falsifiable mechanism claim (required).
   * @param {string[]} args.evidence - refs to failure clusters / eval run ids (required).
   * @param {object[]} args.mutations - mutation records.
   * @param {() => Promise<Record<string,string>>} [args.readCandidateFiles] - reads the
   *   staged candidate content files; defaults to registry.revisionContent on the
   *   staged source revision (no adapter) — callers writing real files must supply it.
   */
  async createCandidate(runId, {
    logicalId, sourceRevisionId, hypothesis, evidence = [], mutations = [],
    readCandidateFiles,
  }) {
    const run = this._require(runId);
    assertTransition(run.state, 'SEALED'); // candidate-created is within DRAFT flow
    // --- deterministic proposal quality floor (before any staging write) ---
    const sourceContent = await this._revisionFiles(logicalId, sourceRevisionId);
    if (!sourceContent) throw new Error(`proposal rejected: source revision not found: ${sourceRevisionId}`);
    const candidateFiles = readCandidateFiles ? await readCandidateFiles() : {};
    const check = proposalCheck({
      logicalId, sourceRevisionId, hypothesis, evidence, mutations,
      sourceContent: normalizeFiles(sourceContent.files ?? {}),
      candidateContent: normalizeFiles(candidateFiles),
      existingCandidates: run.candidates ?? [],
    });
    if (!check.ok) {
      await this._audit({ runId, event: 'proposal-rejected', reasons: check.reasons });
      throw new Error(`proposal rejected: ${check.reasons.join('; ')}`);
    }
    const candidateId = await this.registry.createCandidate(logicalId, { sourceRevisionId, evolutionRunId: runId });
    for (const m of mutations) await this.registry.patchCandidate(candidateId, m);
    run.candidateId = candidateId;
    run.mutations = mutations;
    // Redact hypothesis/evidence before they are stored on the run or written
    // to the audit ledger (failure evidence may carry credentials/paths).
    run.hypothesis = this._redact(String(hypothesis ?? ''));
    run.evidence = evidence.map((e) => this._redact(String(e ?? '')));
    if (!run.candidates) run.candidates = [];
    run.candidates.push({ candidateId, hypothesis: run.hypothesis, contentHash: contentHash(candidateFiles) });
    await this._audit({
      runId, event: 'candidate-created', candidateId, hypothesis: run.hypothesis, evidence: run.evidence.length,
    });
    return candidateId;
  }

  /**
   * Resolve a revision's content files by id (`<logicalId>-<digest8>` or bare
   * 64-hex digest). Revision ids are shortened; look up the full digest from
   * the logical preset's history when the id is not itself a full digest.
   */
  async _revisionFiles(logicalId, revisionId) {
    const full = /^[0-9a-f]{64}$/i.test(revisionId) ? revisionId : null;
    if (full) return this.registry.revisionContent(full);
    const history = await this.registry.history(logicalId);
    const hit = history.find((r) => r.revisionId === revisionId);
    return hit ? this.registry.revisionContent(hit.digest) : null;
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
   * Rejects near-duplicates of any historical revision by default
   * (semantic content hash), absorbed from dsh-continual-evolve promotion.
   * @param {string} runId
   * @param {object} args
   * @param {string} args.logicalId
   * @param {string} args.approvalId - user confirmation binding (required).
   * @param {boolean} [args.nearDuplicateCheck=true] - set false to skip the check.
   */
  async promote(runId, { logicalId, approvalId, nearDuplicateCheck = true }) {
    const run = this._require(runId);
    if (run.state !== 'ACCEPTED') throw new Error(`cannot promote run in state ${run.state} (only ACCEPTED)`);
    if (!approvalId) throw new Error('approvalId is required (user confirmation binding)');
    if (!run.sealed) throw new Error('run not sealed');
    if (nearDuplicateCheck) {
      const history = await this.registry.history(logicalId);
      const candidate = await this._revisionFiles(logicalId, run.sealed.digest);
      if (history.length > 0 && candidate) {
        const dup = await nearDuplicate(history, (digest) => this.registry.revisionContent(digest), candidate.files ?? {});
        if (dup.isDup) {
          await this._audit({ runId, event: 'promote-near-duplicate', of: dup.of });
          throw new Error(`promote rejected: near-duplicate of ${dup.of}`);
        }
      }
    }
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
