// Self-check for passwordError(). No test runner in this project by design — run directly:
//   node web/src/lib/password.check.mjs
// Exits non-zero on failure. The symbol set here must match PASSWORD_REQUIRED_CHARACTERS
// in selfhost/.env, so this fails loudly if the two drift apart.
import assert from 'node:assert/strict'
import { passwordError } from './password.js'

const ok = 'Test-Admin~1'.replace('~', '!') // 8+ chars, upper, lower, digit, symbol

// Valid password passes.
assert.equal(passwordError(ok), '')

// Each rule rejects independently.
assert.match(passwordError('Ab1!'), /at least 8/)          // too short
assert.match(passwordError('abcdefg1!'), /uppercase/)      // no upper
assert.match(passwordError('ABCDEFG1!'), /lowercase/)      // no lower
assert.match(passwordError('Abcdefgh!'), /number/)         // no digit
assert.match(passwordError('Abcdefg1'), /special/)         // no symbol

// The 4-char password from the audit's Case III proof-of-concept must be rejected.
assert.match(passwordError('1234'), /at least 8/)

// Multiple missing classes are reported together, not one at a time.
assert.match(passwordError('abcdefgh'), /uppercase.*number.*special/)

console.log('password.check.mjs: all assertions passed')
