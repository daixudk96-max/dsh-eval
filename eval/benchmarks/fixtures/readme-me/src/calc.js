// readme-me fixture — a tiny calculator module with no docs yet.
// The task: read the code and write README.md documenting usage.
// The trap: the grading check requires specific terms (multiply, usage,
// error handling); a model that writes a generic README gets a real
// CHECK_FAIL (evidence for the evolution proposer).
export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new TypeError('multiply expects numbers');
  }
  return a * b;
}

export function div(a, b) {
  if (b === 0) throw new RangeError('division by zero');
  return a / b;
}
