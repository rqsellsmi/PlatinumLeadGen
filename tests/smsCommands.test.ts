import { describe, it, expect } from 'vitest';
import { parseCommand } from '../lib/smsCommands';

describe('parseCommand — accept/decline', () => {
  it('YES + code', () => {
    expect(parseCommand('YES 5739')).toEqual({
      kind: 'accept', code: 5739, codeExplicit: false, notes: '',
    });
  });
  it('accepts lowercase and # prefix', () => {
    expect(parseCommand('accept #5739')).toEqual({
      kind: 'accept', code: 5739, codeExplicit: true, notes: '',
    });
  });
  it('bare Y with no code', () => {
    expect(parseCommand('Y')).toEqual({
      kind: 'accept', code: null, codeExplicit: false, notes: '',
    });
  });
  it('NO/PASS/DECLINE all decline', () => {
    expect(parseCommand('NO 12').kind).toBe('decline');
    expect(parseCommand('pass 12').kind).toBe('decline');
    expect(parseCommand('DECLINE 12').kind).toBe('decline');
  });
  it('accept with no code keeps full multi-word notes', () => {
    expect(parseCommand('YES thanks bud')).toMatchObject({
      kind: 'accept', code: null, notes: 'thanks bud',
    });
  });
  it('accept with code and a notes word that looks numeric', () => {
    expect(parseCommand('YES 5739 123 apples')).toMatchObject({
      kind: 'accept', code: 5739, notes: '123 apples',
    });
  });
});

describe('parseCommand — status (v4 vocabulary)', () => {
  it('CONNECTED with code and notes', () => {
    expect(parseCommand('CONNECTED 5739 left a voicemail, retry tmrw')).toMatchObject({
      kind: 'status', status: 'connected', code: 5739, notes: 'left a voicemail, retry tmrw',
    });
  });
  it('SPOKE / REACHED map to connected', () => {
    expect(parseCommand('spoke 5739')).toMatchObject({ kind: 'status', status: 'connected', code: 5739 });
    expect(parseCommand('reached 5739')).toMatchObject({ kind: 'status', status: 'connected' });
  });
  it('multi-word LEFT VM maps to attempted_contact', () => {
    expect(parseCommand('left vm 5739 no answer')).toMatchObject({
      kind: 'status', status: 'attempted_contact', code: 5739, notes: 'no answer',
    });
  });
  it('CALLED and ATTEMPTED map to attempted_contact', () => {
    expect(parseCommand('called 1')).toMatchObject({ kind: 'status', status: 'attempted_contact' });
    expect(parseCommand('attempted 1')).toMatchObject({ kind: 'status', status: 'attempted_contact' });
  });
  it('NURTURING / APPOINTMENT SET / SIGNED / CLOSED / LOST map through', () => {
    expect(parseCommand('nurturing 1')).toMatchObject({ kind: 'status', status: 'nurturing' });
    expect(parseCommand('appointment set 1')).toMatchObject({ kind: 'status', status: 'appointment_set' });
    expect(parseCommand('appt 1')).toMatchObject({ kind: 'status', status: 'appointment_set' });
    expect(parseCommand('signed 1')).toMatchObject({ kind: 'status', status: 'signed' });
    expect(parseCommand('closed won 1')).toMatchObject({ kind: 'status', status: 'closed' });
    expect(parseCommand('closed 1')).toMatchObject({ kind: 'status', status: 'closed' });
    expect(parseCommand('lost 1')).toMatchObject({ kind: 'status', status: 'lost' });
  });
  it('status with no code → code null, remainder is notes', () => {
    expect(parseCommand('CONNECTED left a message')).toMatchObject({
      kind: 'status', status: 'connected', code: null, notes: 'left a message',
    });
  });
});

/**
 * The regression this grammar exists for. "ATTEMPTED CONTACT 53 …" is the
 * phrasing an agent reads straight off the portal, and the old parser matched
 * only the word "attempted", failed to read "contact" as a number, and swept the
 * lead id into the notes — so the update landed on whatever their single active
 * lead happened to be.
 */
describe('parseCommand — multi-word phrases keep the lead code', () => {
  it('ATTEMPTED CONTACT + code + notes', () => {
    expect(parseCommand('attempted contact 53 left another message')).toMatchObject({
      kind: 'status', status: 'attempted_contact', code: 53, notes: 'left another message',
    });
  });
  it('is case-insensitive', () => {
    expect(parseCommand('ATTEMPTED CONTACT 53')).toMatchObject({
      kind: 'status', status: 'attempted_contact', code: 53, notes: '',
    });
  });
  it('other multi-word stage names keep their code', () => {
    expect(parseCommand('appointment set 53 tuesday 2pm')).toMatchObject({
      kind: 'status', status: 'appointment_set', code: 53, notes: 'tuesday 2pm',
    });
    expect(parseCommand('listing signed 53')).toMatchObject({
      kind: 'status', status: 'signed', code: 53,
    });
    expect(parseCommand('made contact 53 she called back')).toMatchObject({
      kind: 'status', status: 'connected', code: 53, notes: 'she called back',
    });
  });
  it('CONTACTED is an alias for connected (v4 renamed the stage)', () => {
    expect(parseCommand('contacted 53 spoke with her')).toMatchObject({
      kind: 'status', status: 'connected', code: 53, notes: 'spoke with her',
    });
  });
  it('trailing punctuation on the phrase still matches', () => {
    expect(parseCommand('connected, 53 all good')).toMatchObject({
      kind: 'status', status: 'connected', code: 53,
    });
  });
});

describe('parseCommand — lead code detection', () => {
  it('an explicit #code is definitive wherever it sits', () => {
    expect(parseCommand('connected #53 spoke')).toMatchObject({
      kind: 'status', status: 'connected', code: 53, codeExplicit: true, notes: 'spoke',
    });
  });
  it('a bare number is NOT a code unless an exact phrase precedes it', () => {
    // "3" here is part of the message, not a lead id — the words before it are
    // not a known command phrase.
    expect(parseCommand('nurture still thinking 3 months')).toMatchObject({
      kind: 'status', status: 'nurturing', code: null, notes: 'still thinking 3 months',
    });
  });
  it('a leading number is content, never a code', () => {
    expect(parseCommand('53 no answer again').kind).toBe('unknown');
  });
  it('only the first bare number can be the code', () => {
    expect(parseCommand('connected 53 offered 425000')).toMatchObject({
      kind: 'status', status: 'connected', code: 53, notes: 'offered 425000',
    });
  });
});

describe('parseCommand — same-stage check-ins', () => {
  it('a bare stage word with no code parses (single-active-lead case)', () => {
    expect(parseCommand('nurture')).toMatchObject({
      kind: 'status', status: 'nurturing', code: null, notes: '',
    });
  });
  it('a stage word with a code and no notes parses', () => {
    expect(parseCommand('NURTURE 53')).toMatchObject({
      kind: 'status', status: 'nurturing', code: 53, notes: '',
    });
  });
});

describe('parseCommand — compliance', () => {
  it('STOP and synonyms (whole message only)', () => {
    expect(parseCommand('STOP')).toEqual({ kind: 'stop' });
    expect(parseCommand('unsubscribe')).toEqual({ kind: 'stop' });
    expect(parseCommand('  Quit ')).toEqual({ kind: 'stop' });
  });
  it('START/HELP', () => {
    expect(parseCommand('start')).toEqual({ kind: 'start' });
    expect(parseCommand('HELP')).toEqual({ kind: 'help' });
  });
  it('does not treat "stop by the house" as opt-out', () => {
    expect(parseCommand('stop by the house 5739').kind).toBe('unknown');
  });
});

describe('parseCommand — unknown', () => {
  it('unrecognized leading word, phrase captured for the admin log', () => {
    expect(parseCommand('thanks!')).toMatchObject({
      kind: 'unknown', raw: 'thanks!', phrase: 'thanks',
    });
  });
  it('captures at most the first few words as the phrase', () => {
    const r = parseCommand('who is this person texting me anyway');
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.phrase.split(' ').length).toBeLessThanOrEqual(4);
  });
  it('a free-text note with no command word is unknown', () => {
    expect(parseCommand('left another message').kind).toBe('unknown');
  });
  it('empty string', () => {
    expect(parseCommand('   ')).toMatchObject({ kind: 'unknown', raw: '' });
  });
});
