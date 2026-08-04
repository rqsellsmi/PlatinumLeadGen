import { describe, it, expect } from 'vitest';
import { buildMimeMessage, encodeHeaderValue } from '../lib/mime';

const BASE = {
  from: 'leads@example.email',
  to: ['seller@gmail.com'],
  subject: 'We received your home valuation request',
  text: 'Hi, we got your request.',
  html: '<html><body><p>Hi, we got your request.</p></body></html>',
  date: new Date('2026-08-04T12:00:00Z'),
  boundary: 'BOUNDARY123',
};

/** Decode a base64 body part back to text. */
function decodePart(message: string, contentType: string): string {
  const section = message.split('--BOUNDARY123').find((s) => s.includes(`Content-Type: ${contentType}`));
  if (!section) throw new Error(`no ${contentType} part`);
  const body = section.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

describe('buildMimeMessage', () => {
  it('sends both alternatives, HTML last so clients prefer it', () => {
    const msg = buildMimeMessage(BASE);

    expect(msg).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY123"');
    expect(decodePart(msg, 'text/plain')).toBe(BASE.text);
    expect(decodePart(msg, 'text/html')).toBe(BASE.html);
    // Clients render the LAST part they understand — HTML must come second.
    expect(msg.indexOf('text/plain')).toBeLessThan(msg.indexOf('text/html'));
    expect(msg.trimEnd().endsWith('--BOUNDARY123--')).toBe(true);
  });

  it('writes the standard headers', () => {
    const msg = buildMimeMessage({ ...BASE, cc: ['admin@example.email'], replyTo: 'agent@example.email' });

    expect(msg).toContain('From: leads@example.email');
    expect(msg).toContain('To: seller@gmail.com');
    expect(msg).toContain('Cc: admin@example.email');
    expect(msg).toContain('Reply-To: agent@example.email');
    expect(msg).toContain('Subject: We received your home valuation request');
    expect(msg).toContain('Date: Tue, 04 Aug 2026 12:00:00 GMT');
    expect(msg).toContain('MIME-Version: 1.0');
  });

  it('joins multiple recipients and omits absent optional headers', () => {
    const msg = buildMimeMessage({ ...BASE, to: ['a@example.com', 'b@example.com'] });

    expect(msg).toContain('To: a@example.com, b@example.com');
    expect(msg).not.toContain('Cc:');
    expect(msg).not.toContain('Reply-To:');
    expect(msg).not.toContain('List-Unsubscribe:');
  });

  it('includes List-Unsubscribe only when given one', () => {
    const msg = buildMimeMessage({ ...BASE, listUnsubscribe: '<mailto:leads@example.email?subject=Unsubscribe>' });
    expect(msg).toContain('List-Unsubscribe: <mailto:leads@example.email?subject=Unsubscribe>');
  });

  it('uses CRLF line endings throughout', () => {
    const msg = buildMimeMessage(BASE);
    // A bare LF can truncate a part at some hosts.
    expect(msg.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('generates a unique boundary when none is supplied', () => {
    const a = buildMimeMessage({ ...BASE, boundary: undefined });
    const b = buildMimeMessage({ ...BASE, boundary: undefined });
    const boundaryOf = (m: string) => m.match(/boundary="([^"]+)"/)?.[1];

    expect(boundaryOf(a)).toBeTruthy();
    expect(boundaryOf(a)).not.toBe(boundaryOf(b));
  });

  it('strips CR/LF from header values — header injection', () => {
    // A newline in a caller-supplied subject must not open a new header.
    const msg = buildMimeMessage({
      ...BASE,
      subject: 'Innocent\r\nBcc: attacker@evil.com',
    });

    // The text survives as part of the Subject VALUE, folded onto one line —
    // what must never happen is a line that starts a new header.
    const headerLines = msg.split('\r\n\r\n')[0].split('\r\n');
    expect(headerLines.some((l) => l.startsWith('Bcc:'))).toBe(false);
    expect(msg).toContain('Subject: Innocent Bcc: attacker@evil.com');
  });

  it('keeps a body containing the boundary text from breaking the parts', () => {
    // Bodies are base64-encoded, so raw boundary-lookalike text can't terminate a part.
    const msg = buildMimeMessage({ ...BASE, text: '--BOUNDARY123--\nnot the end' });

    expect(decodePart(msg, 'text/plain')).toBe('--BOUNDARY123--\nnot the end');
    expect(decodePart(msg, 'text/html')).toBe(BASE.html);
  });
});

describe('encodeHeaderValue', () => {
  it('leaves plain ASCII alone', () => {
    expect(encodeHeaderValue('Your home valuation report')).toBe('Your home valuation report');
  });

  it('RFC 2047 encodes non-ASCII so accented names survive', () => {
    const encoded = encodeHeaderValue('Café Söder');
    expect(encoded).toMatch(/^=\?utf-8\?B\?/);
    const b64 = encoded.replace(/^=\?utf-8\?B\?/, '').replace(/\?=$/, '');
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('Café Söder');
  });

  it('splits long non-ASCII values into folded encoded-words', () => {
    const long = 'é'.repeat(80);
    const encoded = encodeHeaderValue(long);
    const words = encoded.split('\r\n ');

    expect(words.length).toBeGreaterThan(1);
    // Every encoded word must stay within the RFC 2047 75-character limit...
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    // ...and round-trip without a multi-byte character split across words.
    const decoded = words
      .map((w) => Buffer.from(w.replace(/^=\?utf-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe(long);
  });
});
