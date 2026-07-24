import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenAuth } from '../src/auth.ts';
import { authorize, effectiveRole, principalsOf } from '../src/permissions.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import type { Share, User } from '../src/types.ts';

describe('TokenAuth', () => {
  const auth = new TokenAuth('test-secret-1234');

  test('issue → identify round-trips identity and derives org', () => {
    const u = auth.identify(auth.issue('alice@acme.com', ['eng']));
    assert.equal(u?.email, 'alice@acme.com');
    assert.equal(u?.org, 'acme.com');
    assert.deepEqual(u?.groups, ['eng']);
  });

  test('a null / empty token is anonymous', () => {
    assert.equal(auth.identify(null), null);
    assert.equal(auth.identify(''), null);
  });

  test('a tampered token is rejected', () => {
    const tok = auth.issue('bob@acme.com');
    // Flip the first character to a definitely-different one (deterministic tamper).
    const tampered = (tok[0] === 'A' ? 'B' : 'A') + tok.slice(1);
    assert.equal(auth.identify(tampered), null);
  });

  test('a token signed with a different secret is rejected', () => {
    const other = new TokenAuth('different-secret-9999');
    assert.equal(auth.identify(other.issue('eve@acme.com')), null);
  });
});

describe('authorization truth table', () => {
  const owner = 'owner@acme.com';
  const alice: User = { email: 'alice@acme.com', org: 'acme.com', groups: ['eng'] };
  const dan: User = { email: 'dan@other.com', org: 'other.com' };

  test('owner is always an editor, even with no shares', () => {
    const u: User = { email: owner, org: 'acme.com' };
    assert.equal(effectiveRole(owner, [], u), 'editor');
    assert.ok(authorize(owner, [], u, 'editor').allowed);
  });

  test('no share → anonymous and outsiders are denied', () => {
    assert.equal(authorize(owner, [], null, 'user').allowed, false);
    assert.equal(authorize(owner, [], dan, 'user').allowed, false);
  });

  test('org share grants "user" to org members but not outsiders', () => {
    const shares: Share[] = [{ appId: 'x', principal: 'org:acme.com', role: 'user' }];
    assert.ok(authorize(owner, shares, alice, 'user').allowed);
    assert.equal(authorize(owner, shares, dan, 'user').allowed, false);
  });

  test('a "user" role does not satisfy an "editor" requirement', () => {
    const shares: Share[] = [{ appId: 'x', principal: 'user:alice@acme.com', role: 'user' }];
    assert.ok(authorize(owner, shares, alice, 'user').allowed);
    assert.equal(authorize(owner, shares, alice, 'editor').allowed, false);
  });

  test('public share lets an anonymous visitor run it', () => {
    const shares: Share[] = [{ appId: 'x', principal: 'public', role: 'user' }];
    assert.ok(authorize(owner, shares, null, 'user').allowed);
  });

  test('the highest matching role wins', () => {
    const shares: Share[] = [
      { appId: 'x', principal: 'org:acme.com', role: 'viewer' },
      { appId: 'x', principal: 'user:alice@acme.com', role: 'editor' },
    ];
    assert.equal(effectiveRole(owner, shares, alice), 'editor');
  });

  test('principalsOf: anonymous matches only public', () => {
    assert.deepEqual(principalsOf(null), ['public']);
  });
});

describe('RateLimiter', () => {
  test('allows up to capacity then blocks', () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1, now: () => t });
    assert.ok(rl.take('k'));
    assert.ok(rl.take('k'));
    assert.ok(rl.take('k'));
    assert.equal(rl.take('k'), false); // 4th in the same instant
  });

  test('refills over time', () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1, now: () => t });
    assert.ok(rl.take('k'));
    assert.equal(rl.take('k'), false);
    t = 1000; // one second later → one token back
    assert.ok(rl.take('k'));
  });

  test('keys are independent', () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1, now: () => t });
    assert.ok(rl.take('a'));
    assert.ok(rl.take('b'));
  });
});
