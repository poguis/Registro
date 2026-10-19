// Prueba de src/services/dateRange.js con casos fijos en UTC-5 (Ecuador).
// Uso (PowerShell):  $env:TZ='America/Guayaquil'; node scripts/test-date-range.mjs
// Uso (bash):        TZ=America/Guayaquil node scripts/test-date-range.mjs
import { getUtcRange, formatSqliteUtc } from '../src/services/dateRange.js';

if (new Date(2026, 0, 15).getTimezoneOffset() !== 300) {
    console.error('Este script debe correr con TZ=America/Guayaquil (UTC-5). Offset actual:', new Date().getTimezoneOffset());
    process.exit(2);
}

let failures = 0;
const check = (name, condition, detail = '') => {
    console.log(`${condition ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures++;
};

// Simula cómo SQLite guarda created_at (UTC, 'YYYY-MM-DD HH:MM:SS') para un instante local.
const createdAt = (y, m, d, hh, mm, ss = 0) => formatSqliteUtc(new Date(y, m - 1, d, hh, mm, ss));
// Misma comparación que hace db.getBalanceHistory: created_at >= start AND created_at <= end
const inRange = (value, { startDate, endDate }) => value >= startDate && value <= endDate;

// 1. Movimiento a las 20:00 locales del día D: aparece en "hoy" de D y no en "hoy" de D+1.
{
    const mov = createdAt(2026, 10, 18, 20, 0);
    const todayD = getUtcRange('today', new Date(2026, 9, 18, 21, 0));
    const todayD1 = getUtcRange('today', new Date(2026, 9, 19, 9, 0));
    check('20:00 local de D está en "hoy" de D', inRange(mov, todayD), `${mov} ∈ [${todayD.startDate}, ${todayD.endDate}]`);
    check('20:00 local de D NO está en "hoy" de D+1', !inRange(mov, todayD1));
}

// 2. Movimiento a las 00:30 locales: pertenece a ese día, no al anterior.
{
    const mov = createdAt(2026, 10, 18, 0, 30);
    check('00:30 local está en "hoy" de ese día', inRange(mov, getUtcRange('today', new Date(2026, 9, 18, 12, 0))));
    check('00:30 local NO está en "hoy" del día anterior', !inRange(mov, getUtcRange('today', new Date(2026, 9, 17, 12, 0))));
}

// 3. Bordes exactos del día: 00:00:00 y 23:59:59 locales.
{
    const today = getUtcRange('today', new Date(2026, 9, 18, 12, 0));
    check('Límites de "hoy" en UTC', today.startDate === '2026-10-18 05:00:00' && today.endDate === '2026-10-19 04:59:59', `${today.startDate} / ${today.endDate}`);
    check('23:59:59 local está en "hoy"', inRange(createdAt(2026, 10, 18, 23, 59, 59), today));
    check('00:00:00 local del día siguiente NO está en "hoy"', !inRange(createdAt(2026, 10, 19, 0, 0, 0), today));
}

// 4. Último día del mes (incluye febrero de año bisiesto y no bisiesto).
{
    const oct = getUtcRange('month', new Date(2026, 9, 5));
    check('31-oct 22:00 local está en "mes" de octubre', inRange(createdAt(2026, 10, 31, 22, 0), oct));
    check('1-nov 00:30 local NO está en "mes" de octubre', !inRange(createdAt(2026, 11, 1, 0, 30), oct));
    const feb = getUtcRange('month', new Date(2028, 1, 10));
    check('29-feb-2028 21:00 local está en "mes" de febrero (bisiesto)', inRange(createdAt(2028, 2, 29, 21, 0), feb), `${feb.startDate} / ${feb.endDate}`);
    const feb27 = getUtcRange('month', new Date(2027, 1, 10));
    check('28-feb-2027 23:00 local está en febrero 2027', inRange(createdAt(2027, 2, 28, 23, 0), feb27));
    check('1-mar-2027 00:10 local NO está en febrero 2027', !inRange(createdAt(2027, 3, 1, 0, 10), feb27));
}

// 5. 31 de diciembre: en "mes" y "año" del año que termina, no en el siguiente.
{
    const mov = createdAt(2026, 12, 31, 23, 30);
    check('31-dic 23:30 local está en "mes" de diciembre', inRange(mov, getUtcRange('month', new Date(2026, 11, 15))));
    check('31-dic 23:30 local está en "año" 2026', inRange(mov, getUtcRange('year', new Date(2026, 5, 1))));
    check('31-dic 23:30 local NO está en "año" 2027', !inRange(mov, getUtcRange('year', new Date(2027, 5, 1))));
    check('1-ene-2027 00:15 local NO está en "año" 2026', !inRange(createdAt(2027, 1, 1, 0, 15), getUtcRange('year', new Date(2026, 5, 1))));
}

// 6. Semana (lunes a domingo) y rango personalizado.
{
    const week = getUtcRange('week', new Date(2026, 9, 18, 10, 0)); // domingo 18-oct-2026
    check('Semana del domingo 18-oct-2026 empieza el lunes 12-oct local', week.startDate === '2026-10-12 05:00:00', week.startDate);
    check('Domingo 18-oct 21:00 local está en esa semana', inRange(createdAt(2026, 10, 18, 21, 0), week));
    const custom = getUtcRange('custom', new Date(), { start: new Date(2026, 9, 1), end: new Date(2026, 9, 3) });
    check('Personalizado 1-3 oct incluye 3-oct 20:00 local', inRange(createdAt(2026, 10, 3, 20, 0), custom));
    check('Personalizado 1-3 oct excluye 4-oct 00:00 local', !inRange(createdAt(2026, 10, 4, 0, 0), custom));
}

// 7. 'all' sin límites.
{
    const all = getUtcRange('all', new Date());
    check('"all" devuelve límites nulos', all.startDate === null && all.endDate === null);
}

console.log(failures === 0 ? '\nTodos los casos pasaron.' : `\n${failures} caso(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
