'use strict';

/**
 * # absorbed-from: dsh-skill-evolve/src/extractor.ts + dsh-skill-evolve/src/generator.ts
 *
 * P3-1 skill extraction: parse a DSH session trace (EvalTrace-shaped: user /
 * assistant messages interleaved with tool calls and results) into a compact
 * skill workflow, then render it as a reusable SKILL.md document.
 *
 * The upstream extractor walks `SessionEvent{type,seq,time,data}` records and
 * generalizes argument values into patterns so equivalent invocations collapse;
 * the generator renders a frontmatter + when-to-use/steps/parameters/examples
 * body. This port 1) accepts either a trace object `{events:[...]}` or a bare
 * event array, 2) speaks the real dsh event vocabulary (`turn/start`,
 * `user/message`, `tool/call`, `tool/result`, `turn/end`) observed in persisted
 * session logs, 3) attaches the matching `tool/result` text back to each step
 * (bounded), and 4) renders an English body matching the P3 plan section
 * order (when-to-use / steps / parameters / examples).
 *
 * Pure module: no fs, no network, no timers. All I/O belongs to callers.
 *
 * @module evolution-controller/lib/skill-extract
 */

/** Max length of `taskDescription` (upstream slices content to 0..200). */
const DESCRIPTION_MAX = 200;
/** Max length of a step's attached `result` summary. */
const RESULT_MAX = 200;
/** Max example invocations rendered into the Examples section. */
const EXAMPLES_MAX = 6;

/**
 * Collect the display text from content blocks (strings, `{type:'text'}` and
 * nested `{type:'tool-result', content:[...]}` blocks, block arrays).
 * @param {unknown} value - a string, a block object, or a block array.
 * @returns {string} the joined display text.
 */
function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (block === null || typeof block !== 'object') return '';
        const type = block.type;
        if (type === 'text' && typeof block.text === 'string') return block.text;
        if (type === 'tool-result' && Array.isArray(block.content)) return textOf(block.content);
        if (typeof block.text === 'string') return block.text;
        return '';
      })
      .join('\n');
  }
  if (value !== null && typeof value === 'object' && typeof value.text === 'string') return value.text;
  return '';
}

/**
 * Generalize a raw argument value into a reusable pattern.
 * Mirrors upstream `generalizeValue`: http(s) URLs become `<url>`, slash- or
 * backslash-bearing values become `<path>` (backslash added for Windows paths),
 * pure digit strings become `<number>`, over-length values become `<long_text>`,
 * everything else is preserved as a quoted literal. Non-string values generalize
 * to their type name.
 * @param {unknown} value - the raw argument value.
 * @returns {string} the generalized pattern.
 */
function generalizeValue(value) {
  if (typeof value !== 'string') return typeof value;
  if (value.startsWith('http://') || value.startsWith('https://')) return '<url>';
  if (value.includes('/') || value.includes('\\')) return '<path>';
  if (/^\d+$/u.test(value)) return '<number>';
  if (value.length > 50) return '<long_text>';
  return `"${value}"`;
}

/**
 * Generalize a whole argument object into `{ key: pattern }`.
 * @param {Record<string, unknown>} [args] - the raw tool arguments.
 * @returns {Record<string, string>} per-key generalized patterns.
 */
function generalizeArguments(args = {}) {
  const out = {};
  for (const [key, value] of Object.entries(args)) out[key] = generalizeValue(value);
  return out;
}

/**
 * Derive a one-line purpose for a tool invocation. Ports the upstream purpose
 * switch and extends it for tools present in real dsh eval sessions (`pwsh`,
 * `grep`, `glob`, `todo_write`, `web_search`, `job_output`, `compress`,
 * `subagent`, `cordis_*`).
 * @param {string} tool - the tool name.
 * @param {Record<string, unknown>} [args] - the raw tool arguments.
 * @returns {string} a short imperative purpose line.
 */
function inferPurpose(tool, args = {}) {
  const firstOf = (keys) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    return '';
  };
  switch (tool) {
    case 'bash':
    case 'pwsh': {
      const command = firstOf(['command', 'cmd', 'script']);
      return `Execute: ${command.slice(0, 60)}`;
    }
    case 'read':
      return `Read file: ${firstOf(['file_path', 'path']) || '<path>'}`;
    case 'write':
      return `Write file: ${firstOf(['file_path', 'path']) || '<path>'}`;
    case 'edit':
      return `Edit file: ${firstOf(['file_path', 'path']) || '<path>'}`;
    case 'grep':
      return `Search: ${firstOf(['pattern']) || '<pattern>'}`;
    case 'glob':
      return `Find files: ${firstOf(['pattern']) || '<pattern>'}`;
    case 'todo_write':
      return 'Update the task list';
    case 'web_search':
      return 'Search the web';
    case 'web_fetch':
      return 'Fetch a URL';
    case 'job_output':
      return 'Read a background job result';
    case 'compress':
      return 'Compress consumed context';
    case 'subagent':
      return 'Delegate a self-contained task to a subagent';
    default:
      return `Use ${tool}`;
  }
}

/**
 * Summarize a `tool/result` event's data into a bounded single string:
 * the tool-result text content, falling back to the meta shape marker.
 * @param {Record<string, unknown>} [data] - the `tool/result` data.
 * @returns {string} the bounded summary.
 */
function summarizeResult(data = {}) {
  const content = data.message && data.message.content;
  const text = textOf(content).trim();
  if (text !== '') return text;
  const meta = data.meta;
  if (meta && typeof meta.shape === 'string') return `#${meta.shape}`;
  return '';
}

/**
 * Compute the dedup identity of one step: tool name plus JSON of its
 * generalized argument pattern (upstream `deduplicateSteps` key).
 * @param {{tool: string, argsPattern: Record<string, string>}} step - a step.
 * @returns {string} the dedup key.
 */
function stepKey(step) {
  return `${step.tool}::${JSON.stringify(step.argsPattern || {})}`;
}

/**
 * Remove repeated tool invocations that share the same call shape; the first
 * occurrence wins (its concrete params and result summary are kept).
 * @param {Array<object>} steps - extracted steps in order.
 * @returns {Array<object>} steps with duplicates dropped.
 */
function deduplicateSteps(steps) {
  const seen = new Set();
  const out = [];
  for (const step of steps) {
    const key = stepKey(step);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out;
}

/**
 * Merge generalized argument patterns per tool across the deduped steps into
 * `{ [tool]: { [key]: pattern } }`.
 * @param {Array<object>} steps - deduped steps.
 * @returns {Record<string, Record<string, string>>} per-tool parameter patterns.
 */
function buildParameters(steps) {
  const byTool = {};
  for (const step of steps) {
    const slot = byTool[step.tool] || (byTool[step.tool] = {});
    Object.assign(slot, step.argsPattern || {});
  }
  return byTool;
}

/**
 * Parse a DSH session trace into a skill workflow.
 * Ignores transport/streaming noise (`*`/chunk`, `reasoning-chunks`,
 * `text-chunks`) and only consumes durable messages and tool events.
 * @param {object | Array<object>} input - an `{events:[...]}` trace object or
 *   a bare event array.
 * @returns {{
 *   taskDescription: string,
 *   steps: Array<{action: string, tool: string, params: object,
 *     argsPattern: Record<string, string>, purpose: string, order: number,
 *     result: string}>,
 *   parameters: Record<string, Record<string, string>>,
 *   toolsUsed: string[], turnCount: number, success: boolean,
 * }} the extracted workflow.
 */
function extractWorkflow(input) {
  const events = Array.isArray(input) ? input : input && Array.isArray(input.events) ? input.events : [];
  const userTexts = [];
  const steps = [];
  const awaitingResult = [];
  let turnCount = 0;
  let success = false;
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    const type = event.type;
    const data = event.data;
    if (type === 'turn/start') {
      turnCount += 1;
    } else if (type === 'turn/end') {
      if (data && data.reason && data.reason.kind === 'completed') success = true;
    } else if (type === 'user/message') {
      const text = textOf(data && data.content).trim();
      if (text !== '') userTexts.push(text);
    } else if (type === 'tool/call' && data && typeof data.name === 'string') {
      let rawArgs = {};
      if (typeof data.arguments === 'string' && data.arguments !== '') {
        try {
          rawArgs = JSON.parse(data.arguments);
        } catch {
          rawArgs = { _raw: data.arguments };
        }
      } else if (data.arguments !== null && typeof data.arguments === 'object') {
        rawArgs = data.arguments;
      }
      const step = {
        action: data.name,
        tool: data.name,
        params: rawArgs,
        argsPattern: generalizeArguments(rawArgs),
        purpose: inferPurpose(data.name, rawArgs),
        order: steps.length,
        result: '',
      };
      steps.push(step);
      awaitingResult.push(step);
    } else if (type === 'tool/result' && awaitingResult.length > 0) {
      const step = awaitingResult.shift();
      step.result = summarizeResult(data).slice(0, RESULT_MAX);
    }
  }
  const taskDescription = (userTexts[0] || '').slice(0, DESCRIPTION_MAX);
  const toolsUsed = [...new Set(steps.map((step) => step.tool))];
  const deduped = deduplicateSteps(steps);
  return {
    taskDescription,
    steps: deduped,
    parameters: buildParameters(deduped),
    toolsUsed,
    turnCount,
    success,
  };
}

/**
 * Single-line display of an argument value (JSON, bounded).
 * @param {unknown} value - raw argument value.
 * @returns {string} bounded single-line text.
 */
function describeValue(value) {
  if (typeof value === 'string') {
    const oneLine = value.replace(/\s+/gu, ' ').trim();
    return oneLine.length <= 120 ? JSON.stringify(oneLine) : `"${oneLine.slice(0, 117)}…"`;
  }
  const raw = JSON.stringify(value);
  return raw.length <= 120 ? raw : `${raw.slice(0, 117)}…`;
}

/**
 * Render a reusable SKILL.md document from an extracted workflow.
 * Frontmatter carries `name`/`description`/`source`; the body follows the P3
 * section order: when-to-use, steps, parameters, examples, plus a short notes
 * block mirroring upstream's guidance (review, placeholder replacement,
 * environment drift).
 * @param {ReturnType<typeof extractWorkflow>} workflow - extracted workflow.
 * @param {{name?: string, description?: string, generatedFrom?: string,
 *   generatedAt?: string}} [opts] - authoring options.
 * @returns {string} the SKILL.md text.
 */
function generateSkill(workflow, opts = {}) {
  const name = opts.name || generateSkillName(workflow.taskDescription);
  const description = opts.description
    || `${workflow.steps.length} tool step${workflow.steps.length === 1 ? '' : 's'} distilled from a completed session`;
  const generatedFrom = opts.generatedFrom || 'session';
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const lines = [];
  lines.push('---', `name: ${name}`, `description: ${description}`, `source: ${generatedFrom}`, '---', '');
  lines.push(`# Skill: ${name}`, '');
  lines.push(`> Auto-generated from session \`${generatedFrom}\` on ${generatedAt}`, '');
  lines.push('## When to use', '');
  lines.push('Use when the user request resembles:');
  lines.push(`> ${workflow.taskDescription || '(no user message recorded)'}`, '');
  lines.push('## Steps', '');
  workflow.steps.forEach((step, index) => {
    lines.push(`### ${index + 1}. ${step.purpose}`, '');
    lines.push(`- Tool: \`${step.tool}\``);
    const entries = Object.entries(step.params || {});
    if (entries.length > 0) {
      lines.push('- Params:');
      for (const [key, value] of entries) lines.push(`  - ${key}: ${describeValue(value)}`);
    }
    if (step.result) lines.push(`- Result: ${step.result.replace(/\s+/gu, ' ').trim()}`);
    lines.push('');
  });
  lines.push('## Parameters', '');
  const parameterTools = Object.keys(workflow.parameters || {});
  if (parameterTools.length === 0) {
    lines.push('_No parameters observed._', '');
  } else {
    for (const tool of parameterTools) {
      lines.push(`### ${tool}`);
      for (const [key, pattern] of Object.entries(workflow.parameters[tool])) {
        lines.push(`- \`${key}\`: ${pattern}`);
      }
      lines.push('');
    }
  }
  lines.push('## Examples', '');
  const examples = workflow.steps.slice(0, EXAMPLES_MAX);
  if (examples.length === 0) {
    lines.push('_No tool invocations observed._', '');
  } else {
    for (const step of examples) {
      const invocation = Object.keys(step.params || {}).length > 0
        ? JSON.stringify(step.params)
        : '(no parameters)';
      lines.push(`- \`${step.tool}\` ${invocation}`);
    }
    lines.push('');
  }
  lines.push('## Notes', '');
  lines.push('- Review before reuse: the session may include tool-specific detours.');
  lines.push('- Replace placeholder parameter values (<path>, <url>, <number>) before reuse.');
  lines.push('- Refresh when the environment or available tools change.');
  return lines.join('\n');
}

/**
 * Slugify a skill name into a SKILL.md filename (lowercased, runs of
 * non-alphanumeric / non-CJK characters become `-`).
 * @param {string} name - the skill name.
 * @returns {string} e.g. `weather-report.md`.
 */
function generateSkillFilename(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `${slug || 'skill'}.md`;
}

/**
 * Derive a default skill name from a task description (first 40 chars,
 * slugified).
 * @param {string} taskDescription - the extracted task description.
 * @returns {string} a readable skill name.
 */
function generateSkillName(taskDescription) {
  const seed = (taskDescription || 'extracted skill').slice(0, 40);
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'extracted-skill';
}

module.exports = {
  DESCRIPTION_MAX,
  RESULT_MAX,
  textOf,
  generalizeValue,
  generalizeArguments,
  inferPurpose,
  summarizeResult,
  stepKey,
  deduplicateSteps,
  buildParameters,
  extractWorkflow,
  generateSkill,
  generateSkillFilename,
  generateSkillName,
};