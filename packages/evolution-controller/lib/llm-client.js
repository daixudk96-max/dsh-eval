'use strict';

/**
 * Minimal LLM client for the evolution CLI (proposer / judge).
 *
 * Speaks the OpenAI-compatible chat completions protocol against a local
 * endpoint (clipa on 127.0.0.1:8317). Credentials: env var first, then
 * ~/.dsh/.credentials.yaml (line format `KEY: value`). Zero dependencies.
 *
 * @module evolution-controller/llm-client
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Resolve an API key: env → credentials.yaml.
 * @param {string} envName - env var name (e.g. CLIPA_API_KEY).
 * @param {string} [home] - override home dir (tests).
 * @returns {string|undefined}
 */
function resolveApiKey(envName, home = os.homedir()) {
  if (process.env[envName]) return process.env[envName];
  try {
    const text = fs.readFileSync(path.join(home, '.dsh', '.credentials.yaml'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
      if (m && m[1] === envName) return m[2];
    }
  } catch {
    /* no credentials file */
  }
  return undefined;
}

/**
 * Create an OpenAI-compatible chat client.
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] default http://127.0.0.1:8317/v1
 * @param {string} [opts.apiKey] default resolved from CLIPA_API_KEY
 * @param {string} [opts.apiKeyEnv] env/credential name; default CLIPA_API_KEY
 * @param {string} [opts.model] default deepseek-v4-flash
 * @param {number} [opts.timeoutMs] default 120000
 * @returns {{ complete(system: string, user: string): Promise<string>, baseUrl: string, model: string }}
 */
function createChatClient({ baseUrl = 'http://127.0.0.1:8317/v1', apiKey, apiKeyEnv = 'CLIPA_API_KEY', model = 'deepseek-v4-flash', timeoutMs = 120000 } = {}) {
  const key = apiKey ?? resolveApiKey(apiKeyEnv);
  if (!key) throw new Error(`no API key for ${apiKeyEnv} (env or ~/.dsh/.credentials.yaml)`);
  return {
    baseUrl, model,
    async complete(system, user) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`llm http ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('llm returned empty completion');
      return text;
    },
  };
}

module.exports = { createChatClient, resolveApiKey };
