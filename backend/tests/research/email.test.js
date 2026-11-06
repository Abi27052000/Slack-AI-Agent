import { describe, it, expect } from 'vitest';
import { getEmailDomain, isPersonalEmail } from '../../src/utils/email.js';

describe('getEmailDomain', () => {
  it.each([
    ['jane@Acme.IO', 'acme.io'],
    ['a.b+tag@sub.example.co.uk', 'sub.example.co.uk'],
    ['weird"@"local@acme.io', 'acme.io'],
  ])('%s -> %s', (email, domain) => {
    expect(getEmailDomain(email)).toBe(domain);
  });

  it.each([null, undefined, '', 'no-at-sign', '@acme.io', 'jane@'])('returns null for %j', (email) => {
    expect(getEmailDomain(email)).toBeNull();
  });
});

describe('isPersonalEmail', () => {
  it.each(['x@gmail.com', 'x@GMAIL.com', 'x@proton.me', 'x@yahoo.co.in', 'x@icloud.com'])(
    'treats %s as personal',
    (email) => expect(isPersonalEmail(email)).toBe(true),
  );

  it.each(['x@acme.io', 'x@gmail.acme.io', null])('treats %s as not personal', (email) => {
    expect(isPersonalEmail(email)).toBe(false);
  });
});
