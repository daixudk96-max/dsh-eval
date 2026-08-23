// Test runner for the rename-me task.
// Do NOT modify this file — the grading check verifies it is untouched.
import { strict as assert } from 'node:assert';
import { doWork } from '../src/helper.js';

assert.equal(doWork(2, 3), 5, 'doWork(2, 3) should be 5');
assert.equal(doWork(10, -4), 6, 'doWork(10, -4) should be 6');
console.log('PASS');
