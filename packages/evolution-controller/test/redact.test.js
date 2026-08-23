'use strict';
// redact.test.js — 审查脱敏: 凭证形状/路径/session id/已知值
// 运行: node test/redact.test.js(单进程)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redactReviewText, redactSecrets, redactSessionIds, redactPaths, redactCredentials,
} = require('../lib/redact.js');

test('openai-style key 被替换', () => {
  const out = redactSecrets('key=sk-abcdefghijklmnopqrstuvwxyz012345 and rest');
  assert.ok(!out.includes('sk-abcdefghijklmnopqrstuvwxyz012345'));
  assert.ok(out.includes('<redacted>'));
});

test('jwt 被替换', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const out = redactSecrets(`Authorization: ${jwt}`);
  assert.ok(!out.includes(jwt.slice(0, 30)));
  assert.ok(out.includes('<redacted>'));
});

test('Bearer 凭证被替换', () => {
  const out = redactSecrets('Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.ok(!out.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  assert.match(out, /<redacted>/);
});

test('inline assignment token=... 被替换但保留键名', () => {
  const out = redactSecrets('api_key: "dai123456secretvalue123" and token = "abcdefghijklmnop"');
  assert.ok(!out.includes('dai123456secretvalue123'));
  assert.ok(out.includes('api_key: "<redacted>"') || out.includes('api_key: <redacted>'));
});

test('session id 被替换', () => {
  const out = redactSessionIds('trace at session-a0c5c3a44b134d009cff21cfcb3f40bc.jsonl.zstd');
  assert.ok(!out.includes('session-a0c5c3a44b134d009cff21cfcb3f40bc'));
  assert.match(out, /<redacted:session>/);
});

test('盘符绝对路径被替换', () => {
  const out = redactPaths('launcher is node E:\\github\\dsh\\apps\\cli\\lib\\bin.js here');
  assert.ok(!out.includes('E:\\github'));
  assert.match(out, /<redacted:path>/);
});

test('UNC 路径被替换', () => {
  const out = redactPaths('share \\\\server\\share\\dir\\file.txt end');
  assert.ok(!out.includes('server'));
  assert.match(out, /<redacted:path>/);
});

test('已知凭证值被整体替换(不分形状)', () => {
  const out = redactCredentials('my secret value is dai123456 and more dai123456', ['dai123456']);
  assert.ok(!out.includes('dai123456'));
  assert.equal(out.match(/<redacted:credential>/g).length, 2);
});

test('短于 4 字符的值不替换(避免误伤普通词)', () => {
  const out = redactCredentials('word and key', ['and']);
  assert.ok(out.includes('and'));
});

test('redactReviewText 组合: 形状+路径+session+已知值', () => {
  const text = [
    'run dir C:\\Users\\daixu\\AppData\\Local\\Temp\\dsh-eval-abc session-a1b2c3d4e5f60718293a4b5c6d7e8f90',
    'key sk-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q secret=dai123456',
  ].join(' ');
  const out = redactReviewText(text, { values: ['dai123456'] });
  assert.ok(!out.includes('daixu'));
  assert.ok(!out.includes('session-a1b2c3'));
  assert.ok(!out.includes('sk-a1b2c3d4'));
  assert.ok(!out.includes('dai123456'));
  assert.ok(out.includes('<redacted:path>'));
  assert.ok(out.includes('<redacted:session>'));
  assert.ok(out.includes('<redacted:credential>'));
});

test('null/undefined 输入安全', () => {
  assert.equal(redactReviewText(null), '');
  assert.equal(redactReviewText(undefined), '');
});
