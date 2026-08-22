'use strict';
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { ensureDir } = require('../../preset-registry/lib/fs-store');

/**
 * BudgetLedger — append-only evolution budget accounting.
 *
 * Absorbed from timwhitez/dsh-self-evolving specs/03-evolution-algorithm.md
 * (budget ledger): every spend is recorded append-only, bucketed by purpose
 * (proposal / attempt / failed), and amounts are injected by trusted callers
 * (e.g. the evaluator's costUsd) — the ledger never trusts self-reported
 * numbers from candidates. A run cannot start once the budget is exhausted.
 *
 * @module evolution-controller/budget
 */

/** Buckets the ledger distinguishes. */
const BUCKETS = ['proposal', 'attempt', 'failed'];

class BudgetLedger {
  /**
   * @param {object} opts
   * @param {string} opts.dir ledger directory (append-only JSONL: budget.jsonl).
   * @param {number} opts.limitUsd total budget in USD; <= 0 means unlimited.
   */
  constructor({ dir, limitUsd = 0 }) {
    this.dir = dir;
    this.limitUsd = Number(limitUsd) || 0;
    this.file = path.join(dir, 'budget.jsonl');
  }

  async _ensure() {
    await ensureDir(this.dir);
  }

  /**
   * Record one spend.
   * @param {string} bucket - 'proposal' | 'attempt' | 'failed'.
   * @param {number} amountUsd - externally sourced cost in USD.
   * @param {object} [meta] - { runId?, candidateId?, note? }.
   */
  async spend(bucket, amountUsd, meta = {}) {
    if (!BUCKETS.includes(bucket)) throw new Error(`budget: unknown bucket ${bucket}`);
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`budget: invalid amount ${amountUsd}`);
    await this._ensure();
    const entry = {
      ts: new Date().toISOString(), bucket, amountUsd: amount, ...meta,
    };
    // Append-only like the registry WAL: one line per spend, no rewrite.
    await fsp.appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  /** Read every recorded entry, oldest first. */
  async entries() {
    await this._ensure();
    const text = await fsp.readFile(this.file, 'utf8').catch(() => '');
    const out = [];
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim() === '') continue;
      try { out.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
    return out;
  }

  /** Sum spent per bucket and total. */
  async spent() {
    const entries = await this.entries();
    const out = { proposal: 0, attempt: 0, failed: 0, total: 0 };
    for (const e of entries) {
      if (!(e.bucket in out)) continue;
      out[e.bucket] += Number(e.amountUsd) || 0;
      out.total += Number(e.amountUsd) || 0;
    }
    return out;
  }

  /** Remaining spendable budget; Infinity when unlimited. */
  async remaining() {
    if (this.limitUsd <= 0) return Infinity;
    const { total } = await this.spent();
    return Math.max(0, this.limitUsd - total);
  }

  /** Whether a new spend of `amountUsd` in `bucket` is affordable. */
  async canAfford(bucket, amountUsd) {
    if (this.limitUsd <= 0) return true;
    const { total } = await this.spent();
    return total + (Number(amountUsd) || 0) <= this.limitUsd;
  }
}

module.exports = { BudgetLedger, BUCKETS };
