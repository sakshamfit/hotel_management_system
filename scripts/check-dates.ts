import { enumerateNights, addDays, nightsBetween, isValidStay, roomNightId, todayDateOnly } from '../src/utils/dates';

const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
  if (!ok) process.exitCode = 1;
};

eq('1 night', enumerateNights('2026-09-01', '2026-09-02'), ['2026-09-01']);
eq('3 nights', enumerateNights('2026-09-01', '2026-09-04'), ['2026-09-01','2026-09-02','2026-09-03']);
eq('checkout day NOT charged', enumerateNights('2026-09-01','2026-09-02').includes('2026-09-02'), false);
eq('month boundary', enumerateNights('2026-08-30','2026-09-02'), ['2026-08-30','2026-08-31','2026-09-01']);
eq('year boundary', enumerateNights('2026-12-30','2027-01-02'), ['2026-12-30','2026-12-31','2027-01-01']);
eq('leap day', enumerateNights('2028-02-27','2028-03-01'), ['2028-02-27','2028-02-28','2028-02-29']);
eq('nightsBetween', nightsBetween('2026-09-01','2026-09-04'), 3);
eq('addDays +1', addDays('2026-09-01', 1), '2026-09-02');
eq('addDays -1 across month', addDays('2026-10-01', -1), '2026-09-30');
eq('roomNightId', roomNightId('rm1','2026-09-01'), 'rm1_2026-09-01');
eq('valid stay', isValidStay('2026-09-01','2026-09-02').ok, true);
eq('same-day rejected', isValidStay('2026-09-01','2026-09-01').ok, false);
eq('backwards rejected', isValidStay('2026-09-05','2026-09-01').ok, false);
eq('bad format rejected', isValidStay('01-09-2026','2026-09-02').ok, false);
// Half-open: a guest leaving on the 4th frees the room for an arrival on the 4th
const a = enumerateNights('2026-09-01','2026-09-04');
const b = enumerateNights('2026-09-04','2026-09-06');
eq('no overlap on checkout day', a.filter(d => b.includes(d)), []);
eq('today is date-only', /^\d{4}-\d{2}-\d{2}$/.test(todayDateOnly()), true);
eq('today in a timezone', /^\d{4}-\d{2}-\d{2}$/.test(todayDateOnly('Asia/Kolkata')), true);
