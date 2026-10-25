const { checkAge, parseBirthDate, MIN_AGE, AGE_MESSAGES } = require('../.test-build/lib/age.js')
let pass = 0, fail = 0
const ok = (name, c, extra = '') => { c ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }

// Local-time dates, matching how the app reads "today" in the visitor's own calendar.
const on = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0)
const born = (y, m, d) => ({ year: y, month: m, day: d })
const today = on(2026, 10, 25)

ok('the minimum age is 16', MIN_AGE === 16)

// ── The boundary, to the day ──
ok('exactly 16 today is allowed', checkAge(born(2010, 10, 25), today) === 'ok')
ok('turns 16 tomorrow is not allowed yet', checkAge(born(2010, 10, 26), today) === 'too_young')
ok('turned 16 yesterday is allowed', checkAge(born(2010, 10, 24), today) === 'ok')
ok('15 years 11 months is not allowed', checkAge(born(2010, 11, 25), today) === 'too_young')
ok('an adult is allowed', checkAge(born(1974, 3, 9), today) === 'ok')
ok('a young child is not allowed', checkAge(born(2020, 1, 1), today) === 'too_young')
ok('very old but valid is allowed', checkAge(born(1901, 1, 1), today) === 'ok')

// ── Month and year edges ──
ok('last day of the year boundary: born 31 Dec, turns 16 on 31 Dec', checkAge(born(2009, 12, 31), on(2025, 12, 31)) === 'ok' && checkAge(born(2009, 12, 31), on(2025, 12, 30)) === 'too_young')
ok('first day of the year boundary', checkAge(born(2010, 1, 1), on(2026, 1, 1)) === 'ok' && checkAge(born(2010, 1, 1), on(2025, 12, 31)) === 'too_young')

// ── 29 February birthdays: never let someone in a day early ──
ok('29 Feb 2008 is 16 on 29 Feb 2024 (leap year)', checkAge(born(2008, 2, 29), on(2024, 2, 29)) === 'ok')
ok('29 Feb 2008 is not 16 on 28 Feb 2024', checkAge(born(2008, 2, 29), on(2024, 2, 28)) === 'too_young')
ok('29 Feb 2012 is not 16 on 28 Feb 2028 (still leap), is on 29 Feb', checkAge(born(2012, 2, 29), on(2028, 2, 28)) === 'too_young' && checkAge(born(2012, 2, 29), on(2028, 2, 29)) === 'ok')
ok('29 Feb 2008 counts as 1 March in a non-leap year when checking against 18 (min override)', checkAge(born(2008, 2, 29), on(2026, 2, 28), 18) === 'too_young' && checkAge(born(2008, 2, 29), on(2026, 3, 1), 18) === 'ok')

// ── Nonsense is rejected, not guessed at ──
ok('no date is invalid', checkAge(null, today) === 'invalid')
ok('a birth date in the future is invalid', checkAge(born(2027, 1, 1), today) === 'invalid')
ok('tomorrow is invalid', checkAge(born(2026, 10, 26), today) === 'invalid')

// ── Parsing the three boxes ──
const p = (y, m, d) => parseBirthDate(y, m, d)
ok('parses a normal date', JSON.stringify(p('1990', '7', '4')) === JSON.stringify(born(1990, 7, 4)))
ok('accepts leading zeros', JSON.stringify(p('1990', '07', '04')) === JSON.stringify(born(1990, 7, 4)))
ok('trims spaces', p(' 1990 ', ' 7 ', ' 4 ') !== null)
ok('rejects a two-digit year (no guessing the century)', p('90', '7', '4') === null)
ok('rejects a year before 1900', p('1899', '1', '1') === null)
ok('rejects month 0 and 13', p('1990', '0', '4') === null && p('1990', '13', '4') === null)
ok('rejects day 0 and 32', p('1990', '7', '0') === null && p('1990', '7', '32') === null)
ok('rejects 31 April and 30 February', p('1990', '4', '31') === null && p('1990', '2', '30') === null)
ok('rejects 29 Feb in a non-leap year, accepts it in a leap year', p('2009', '2', '29') === null && p('2008', '2', '29') !== null)
ok('rejects letters, blanks, decimals, signs', p('abcd', '7', '4') === null && p('', '', '') === null && p('1990', '7.5', '4') === null && p('1990', '-7', '4') === null && p('1990', '7', '4e1') === null)
ok('rejects a five-digit year', p('19900', '7', '4') === null)

// ── Messages ──
ok('the under-age message names the age and does not blame', /16/.test(AGE_MESSAGES.too_young) && !/lie|fake|cheat/i.test(AGE_MESSAGES.too_young))
ok('the locked message says browsing still works', /browse/i.test(AGE_MESSAGES.locked))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
