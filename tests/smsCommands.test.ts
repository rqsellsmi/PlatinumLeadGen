import { describe, it, expect } from 'vitest';
import { parseCommand } from '../lib/smsCommands';

describe('parseCommand — accept/decline', () => {
  it('YES + code', () => {
    expect(parseCommand('YES 5739')).toEqual({ kind: 'accept', code: 5739, notes: '' });
  });
  it('accepts lowercase and # prefix', () => {
    expect(parseCommand('accept #5739')).toEqual({ kind: 'accept', code: 5739, notes: '' });
  });
  it('bare Y with no code', () => {
    expect(parseCommand('Y')).toEqual({ kind: 'accept', code: null, notes: '' });
  });
  it('NO/PASS/DECLINE all decline', () => {
    expect(parseCommand('NO 12').kind).toBe('decline');
    expect(parseCommand('pass 12').kind).toBe('decline');
    expect(parseCommand('DECLINE 12').kind).toBe('decline');
  });
  it('accept with no code keeps full multi-word notes', () => {
    expect(parseCommand('YES thanks bud')).toEqual({ kind: 'accept', code: null, notes: 'thanks bud' });
  });
  it('accept with code and a notes word that looks numeric', () => {
    expect(parseCommand('YES 5739 123 apples')).toEqual({ kind: 'accept', code: 5739, notes: '123 apples' });
  });
});

describe('parseCommand — status (v4 vocabulary)', () => {
  it('CONNECTED with code and notes', () => {
    expect(parseCommand('CONNECTED 5739 left a voicemail, retry tmrw')).toEqual({
      kind: 'status', status: 'connected', code: 5739, notes: 'left a voicemail, retry tmrw',
    });
  });
  it('SPOKE / REACHED map to connected', () => {
    expect(parseCommand('spoke 5739')).toMatchObject({ kind: 'status', status: 'connected', code: 5739 });
    expect(parseCommand('reached 5739')).toMatchObject({ kind: 'status', status: 'connected' });
  });
  it('multi-word LEFT VM maps to attempted_contact', () => {
    expect(parseCommand('left vm 5739 no answer')).toEqual({
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
    expect(parseCommand('CONNECTED left a message')).toEqual({
      kind: 'status', status: 'connected', code: null, notes: 'left a message',
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
  it('unrecognized leading word', () => {
    expect(parseCommand('thanks!')).toEqual({ kind: 'unknown', raw: 'thanks!' });
  });
  it('empty string', () => {
    expect(parseCommand('   ')).toEqual({ kind: 'unknown', raw: '' });
  });
});
