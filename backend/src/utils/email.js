/**
 * Free/consumer mailbox providers. A member on one of these tells us nothing about their employer,
 * so company research is skipped. (The reference project only listed 5 domains.)
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  // Google, Microsoft, Apple, Yahoo, AOL
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
  'aol.com',
  // Privacy-focused
  'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com',
  // Regional consumer providers
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'mail.com',
  'yandex.com', 'yandex.ru', 'mail.ru',
  'qq.com', '163.com', '126.com', 'sina.com',
  'rediffmail.com', 'zoho.com', 'zohomail.com',
  'naver.com', 'daum.net',
  'orange.fr', 'free.fr', 'laposte.net', 'libero.it', 'virgilio.it',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]);

/** Lower-cased domain part of an email address, or null if it isn't a plausible email. */
export function getEmailDomain(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

export function isPersonalEmail(email) {
  const domain = getEmailDomain(email);
  return domain !== null && PERSONAL_EMAIL_DOMAINS.has(domain);
}
