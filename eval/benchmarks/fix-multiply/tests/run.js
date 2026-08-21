import { multiply } from '../src/multiply.js'

const got = multiply(3, 4)
if (got === 12) {
  console.log('PASS')
} else {
  console.log('FAIL: multiply(3, 4) = ' + got + ', expected 12')
  process.exit(1)
}
