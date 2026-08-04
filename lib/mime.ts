/**
 * RFC 5322 MIME message construction for outbound email.
 *
 * WHY THIS EXISTS: Microsoft Graph's JSON `sendMail` takes a single
 * `body.contentType`, so it can only send HTML *or* plain text — never both.
 * Every template in lib/email.ts writes a plain-text alternative, and all of it
 * was being discarded, which meant every message we sent was HTML-only. That is
 * a well-known spam signal, and Gmail was rejecting our mail outright.
 *
 * Graph also accepts a raw base64-encoded MIME message, which supports
 * `multipart/alternative` (text + HTML) and headers the JSON form won't set —
 * notably `List-Unsubscribe`. This module builds that message.
 *
 * Pure so it can be unit-tested without a network or a database; the caller
 * supplies everything, including the boundary when determinism is wanted.
 *
 * Uses only Web-standard APIs (TextEncoder / btoa / globalThis.crypto) — no
 * `crypto` or `Buffer` import. lib/email.ts is reachable from a server-action
 * module, so anything it imports gets bundled where Node builtins don't
 * resolve; importing `crypto` here fails `next build` outright. Same lesson as
 * lib/agentSessionEdge.ts. Relative imports only (lessons-learned §17).
 */

export interface MimeMessageInput {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  /** Plain-text alternative. Always sent — that's the point of this module. */
  text: string;
  html: string;
  /** e.g. `<mailto:leads@example.com?subject=Unsubscribe>`. Consumer mail only. */
  listUnsubscribe?: string;
  /** Injectable for deterministic tests. */
  date?: Date;
  boundary?: string;
}

/** MIME requires CRLF line endings; a bare LF can truncate a part at some hosts. */
const CRLF = '\r\n';

const ENCODER = new TextEncoder();

/** UTF-8 base64 without Buffer. Chunked — spreading a big array overflows the stack. */
export function toBase64(input: string): string {
  const bytes = ENCODER.encode(input);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function byteLength(s: string): number {
  return ENCODER.encode(s).length;
}

/**
 * A boundary only has to not collide with the body, and the bodies are
 * base64-encoded — so this needs uniqueness, not cryptographic strength.
 * Web Crypto when available, otherwise time + random.
 */
function randomBoundary(): string {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `----=_Part_${id.replace(/-/g, '')}`;
}

/**
 * Strip CR/LF from a header value. Without this, a newline in any
 * caller-supplied string (a subject, a lead's name) would let the rest of that
 * value be read as additional headers — the classic header-injection hole.
 */
function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/**
 * Encode a header value as RFC 2047 encoded-words when it isn't plain ASCII
 * (city and owner names can carry accents). Encoded words are capped at 75
 * characters, so long values are split — and split on CHARACTER boundaries,
 * because RFC 2047 forbids a multi-byte character straddling two words.
 */
export function encodeHeaderValue(raw: string): string {
  const value = sanitize(raw);
  if (isAscii(value)) return value;

  // "=?utf-8?B?" + "?=" is 12 chars, leaving 63 for base64; 45 input bytes
  // encode to exactly 60 base64 chars, which stays comfortably inside that.
  const MAX_BYTES = 45;
  const words: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const char of value) {
    const size = byteLength(char);
    if (bytes + size > MAX_BYTES) {
      words.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += char;
    bytes += size;
  }
  if (chunk) words.push(chunk);

  // Continuation lines are folded with CRLF + a single space.
  return words.map((w) => `=?utf-8?B?${toBase64(w)}?=`).join(`${CRLF} `);
}

/** Base64 body content, wrapped at 76 characters as MIME requires. */
function base64Body(content: string): string {
  const encoded = toBase64(content);
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines.join(CRLF);
}

/**
 * Build a `multipart/alternative` message carrying both the plain-text and HTML
 * versions. Both parts are base64-encoded, which sidesteps quoted-printable's
 * line-length and leading-dot escaping rules entirely.
 *
 * Part order matters: least-rich first. Clients render the LAST part they
 * understand, so HTML must come second or every recipient sees plain text.
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  const boundary = input.boundary ?? randomBoundary();
  const date = input.date ?? new Date();

  const headers: string[] = [
    `From: ${sanitize(input.from)}`,
    `To: ${input.to.map(sanitize).filter(Boolean).join(', ')}`,
  ];
  const cc = (input.cc ?? []).map(sanitize).filter(Boolean);
  if (cc.length) headers.push(`Cc: ${cc.join(', ')}`);
  if (input.replyTo) headers.push(`Reply-To: ${sanitize(input.replyTo)}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`Date: ${date.toUTCString()}`);
  if (input.listUnsubscribe) headers.push(`List-Unsubscribe: ${sanitize(input.listUnsubscribe)}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const part = (contentType: string, body: string): string =>
    [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset="utf-8"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Body(body),
      '',
    ].join(CRLF);

  return [
    headers.join(CRLF),
    '',
    part('text/plain', input.text),
    part('text/html', input.html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}
