const s = require('../.test-build/lib/schedule.js')
let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`))
}
const dates = (sched, from, to) => {            // all matching dates in [from, to]
  const out = []; let d = from
  while (d <= to) { if (s.occursOn(sched, d)) out.push(d); d = nextDay(d) }
  return out
}
const nextDay = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }

// Oct 24 2026 is a Saturday (known). Oct Tuesdays: 6,13,20,27  Thursdays: 1,8,15,22,29  Fridays: 2,9,16,23,30
const everyTue = { dayOfWeek: 2, weeksOfMonth: [] }
eq('every Tuesday in Oct', dates(everyTue, '2026-10-01', '2026-10-31'), ['2026-10-06','2026-10-13','2026-10-20','2026-10-27'])
eq('1st & 3rd Thu in Oct', dates({ dayOfWeek: 4, weeksOfMonth: [1,3] }, '2026-10-01', '2026-10-31'), ['2026-10-01','2026-10-15'])
eq('5th Thu in Oct',       dates({ dayOfWeek: 4, weeksOfMonth: [5] },   '2026-10-01', '2026-10-31'), ['2026-10-29'])
eq('last Fri in Oct (5th and last coincide)', dates({ dayOfWeek: 5, weeksOfMonth: [-1] }, '2026-10-01', '2026-10-31'), ['2026-10-30'])
// Sep 2026 Fridays: 4,11,18,25 → last is the 4th one
eq('last Fri in Sep (4th == last)', dates({ dayOfWeek: 5, weeksOfMonth: [-1] }, '2026-09-01', '2026-09-30'), ['2026-09-25'])
eq('5th Fri in Sep does not exist',  dates({ dayOfWeek: 5, weeksOfMonth: [5] },  '2026-09-01', '2026-09-30'), [])
// Leap day: Feb 29 2028 is a Tuesday
eq('last Tue Feb 2028 (leap)', dates({ dayOfWeek: 2, weeksOfMonth: [-1] }, '2028-02-01', '2028-02-29'), ['2028-02-29'])
eq('last Tue Feb 2027 (non-leap)', dates({ dayOfWeek: 2, weeksOfMonth: [-1] }, '2027-02-01', '2027-02-28'), ['2027-02-23'])
// Wrong weekday never matches
eq('Monday-only schedule on a Saturday', s.occursOn({ dayOfWeek: 1, weeksOfMonth: [] }, '2026-10-24'), false)

// nextOccurrence from Sat Oct 24 2026
eq('next every Tue',        s.nextOccurrence(everyTue, '2026-10-24'), '2026-10-27')
eq('next 1st&3rd Thu',      s.nextOccurrence({ dayOfWeek: 4, weeksOfMonth: [1,3] }, '2026-10-24'), '2026-11-05')
eq('next last Fri',         s.nextOccurrence({ dayOfWeek: 5, weeksOfMonth: [-1] }, '2026-10-24'), '2026-10-30')
eq('from == occurrence date counts', s.nextOccurrence(everyTue, '2026-10-27'), '2026-10-27')
// Year rollover
eq('next 1st Tue across year end', s.nextOccurrence({ dayOfWeek: 2, weeksOfMonth: [1] }, '2026-12-20'), '2027-01-05')

// Seasonal window
const seasonal = { dayOfWeek: 2, weeksOfMonth: [], startsOn: '2027-06-01', endsOn: '2027-08-31' }
const n = s.nextOccurrence(seasonal, '2026-10-24')
eq('seasonal next is in window and a Tuesday', n >= '2027-06-01' && n <= '2027-08-31' && new Date(n + 'T00:00:00Z').getUTCDay() === 2, true)
eq('seasonal after end → null', s.nextOccurrence(seasonal, '2027-09-01'), null)
eq('seasonal excludes before start', s.occursOn(seasonal, '2027-05-25'), false)

// Timezone: 2026-10-25T02:00Z is still Sat Oct 24 evening in New York, already Sun Oct 25 in Tokyo
const inst = new Date('2026-10-25T02:00:00Z')
eq('today in New York', s.todayInTz('America/New_York', inst), '2026-10-24')
eq('today in Tokyo',    s.todayInTz('Asia/Tokyo', inst), '2026-10-25')
eq('isTonight NY Saturday-schedule', s.isTonight({ dayOfWeek: 6, weeksOfMonth: [] }, 'America/New_York', inst), true)
eq('isTonight Tokyo Saturday-schedule', s.isTonight({ dayOfWeek: 6, weeksOfMonth: [] }, 'Asia/Tokyo', inst), false)
eq('isTonight Tokyo Sunday-schedule', s.isTonight({ dayOfWeek: 0, weeksOfMonth: [] }, 'Asia/Tokyo', inst), true)
// DST change day (US: Nov 1 2026, clocks fall back at 2am). 05:30Z = 1:30am EDT on Nov 1 → still Sunday Nov 1
eq('DST fall-back day', s.todayInTz('America/New_York', new Date('2026-11-01T05:30:00Z')), '2026-11-01')

// Descriptions
eq('desc every',        s.describeRecurrence({ dayOfWeek: 2, weeksOfMonth: [] }), 'Every Tuesday')
eq('desc 1st&3rd',      s.describeRecurrence({ dayOfWeek: 4, weeksOfMonth: [3,1] }), '1st & 3rd Thursdays')
eq('desc last',         s.describeRecurrence({ dayOfWeek: 5, weeksOfMonth: [-1] }), 'Last Friday')
eq('desc three',        s.describeRecurrence({ dayOfWeek: 3, weeksOfMonth: [1,2,3] }), '1st, 2nd & 3rd Wednesdays')
eq('desc 2nd & last',   s.describeRecurrence({ dayOfWeek: 5, weeksOfMonth: [-1,2] }), '2nd & last Fridays')
eq('desc single 2nd',   s.describeRecurrence({ dayOfWeek: 0, weeksOfMonth: [2] }), '2nd Sundays')

// Time formatting
eq('time 19:30:00', s.formatTime('19:30:00'), '7:30 PM')
eq('time 12:00',    s.formatTime('12:00'), '12:00 PM')
eq('time 00:15',    s.formatTime('00:15'), '12:15 AM')
eq('time 23:59:00', s.formatTime('23:59:00'), '11:59 PM')
eq('time 09:05',    s.formatTime('09:05'), '9:05 AM')

// Staleness
const now = new Date('2026-10-24T12:00:00Z')
eq('verified today',     s.verifiedAgo('2026-10-24T08:00:00Z', now), 'Verified today')
eq('verified 3 days',    s.verifiedAgo('2026-10-21T12:00:00Z', now), 'Verified 3 days ago')
eq('never verified',     s.verifiedAgo(undefined, now), 'Not verified yet')
eq('stale never',        s.isStale(undefined, now), true)
eq('stale 200 days',     s.isStale('2026-04-07T12:00:00Z', now), true)
eq('fresh 10 days',      s.isStale('2026-10-14T12:00:00Z', now), false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
