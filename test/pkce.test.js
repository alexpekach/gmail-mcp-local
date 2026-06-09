'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { generatePkce, generateState, base64url } = require('../src/oauth/pkce');

test('PKCE challenge is base64url(sha256(verifier)) with S256', () => {
  const { code_verifier, code_challenge, code_challenge_method } = generatePkce();
  assert.strictEqual(code_challenge_method, 'S256');
  const expected = base64url(crypto.createHash('sha256').update(code_verifier).digest());
  assert.strictEqual(code_challenge, expected);
  assert.ok(code_verifier.length >= 43, 'verifier should be >= 43 chars (RFC 7636)');
  assert.ok(!/[+/=]/.test(code_verifier + code_challenge), 'must be base64url (no +, /, =)');
});

test('state values are random and unique', () => {
  const a = generateState();
  const b = generateState();
  assert.notStrictEqual(a, b);
  assert.ok(!/[+/=]/.test(a));
});
