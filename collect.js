#!/usr/bin/env node
// Один прогін збору. Пише рядок JSONL на вендора у data/YYYY-MM.jsonl.
//
// Дві незалежні лінії свідчень, і в цьому весь сенс:
//   status — що вендор САМ каже про себе (його statuspage);
//   probe  — що показує пряма проба його API без облікових даних.
// Продукт — не кожна лінія окремо, а РОЗБІЖНІСТЬ між ними: статус каже
// «All Systems Operational», а проба повертає 5xx. Виміряно 07.09.2026:
// 6 із 7 скарг «застосунок лежить» не мали визнаного інциденту (n=7,
// орієнтир, не доказ) — саме цю розбіжність і треба записувати наживо.
//
// Жодного секрету, жодних облікових даних, жодних дозволів у чужому Jira.
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(here, 'feeds.json'), 'utf8'));
const UA = { 'User-Agent': 'app-uptime/0.1 (independent availability record)', Accept: 'application/json' };
const TIMEOUT_MS = 20_000;

async function timed(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow',
                                 signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
    return { status: r.status, ms: Date.now() - t0, body: r };
  } catch (e) {
    // Таймаут і мережева відмова — це НЕ «невідомо», це спостереження:
    // сервіс не відповів. Але воно може бути й нашою мережею, тому
    // позначаємо окремим кодом, а не 0 чи 500.
    return { status: null, ms: Date.now() - t0, error: String(e.name || e).slice(0, 40) };
  }
}

// Статус-сторінка. summary.json дає статус, компоненти й ВІДКРИТІ
// інциденти одним запитом; окремого unresolved.json не існує — він
// віддає HTML-404, і саме через це перший прогін мовчки писав null.
async function readStatus(base) {
  const r = await timed(base + '/api/v2/summary.json');
  if (r.status !== 200) return { reachable: false, httpStatus: r.status, ms: r.ms, error: r.error };
  let j;
  try { j = await r.body.json(); }
  catch { return { reachable: false, httpStatus: r.status, ms: r.ms, error: 'non-json' }; }
  const comps = (j.components ?? []).filter(c => c.status && c.status !== 'operational');
  return {
    reachable: true, ms: r.ms,
    indicator: j.status?.indicator ?? null,
    description: j.status?.description ?? null,
    openIncidents: (j.incidents ?? []).map(i => ({
      id: i.id, name: i.name, impact: i.impact, started: i.created_at, status: i.status })),
    degradedComponents: comps.map(c => ({ name: c.name, status: c.status }))
  };
}

// Пряма проба. 401/403 означає ЖИВИЙ: сервіс відповів і попросив ключ.
// 5xx і відсутність відповіді означають, що не працює саме він.
async function probe(url, liveCodes) {
  const r = await timed(url);
  const verdict =
    r.status === null                      ? 'no-response' :
    liveCodes.includes(r.status)           ? 'live' :
    r.status >= 500                        ? 'server-error' :
    r.status >= 200 && r.status < 400      ? 'live' : 'unexpected';
  return { verdict, httpStatus: r.status, ms: r.ms, error: r.error ?? null };
}

const now = new Date().toISOString();
const outDir = join(here, 'data');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, now.slice(0, 7) + '.jsonl');

let wrote = 0, divergences = 0;
for (const v of CFG.vendors) {
  const rec = { at: now, vendor: v.id, name: v.name, status: null, probe: null, divergence: null };
  if (v.status) rec.status = await readStatus(v.status);
  if (v.probe)  rec.probe  = await probe(v.probe, v.liveCodes);

  // Розбіжність фіксуємо лише коли обидві лінії реально є.
  if (rec.status?.reachable && rec.probe) {
    const saysFine = rec.status.indicator === 'none' && (rec.status.openIncidents?.length ?? 0) === 0;
    const looksBroken = rec.probe.verdict === 'server-error' || rec.probe.verdict === 'no-response';
    rec.divergence = saysFine && looksBroken ? 'status-says-ok-probe-fails' : null;
    if (rec.divergence) divergences++;
  }
  appendFileSync(outFile, JSON.stringify(rec) + '\n');
  wrote++;
  const s = rec.status ? `${rec.status.indicator ?? '—'}/${rec.status.openIncidents?.length ?? '—'}` : '—';
  const p = rec.probe ? `${rec.probe.verdict}(${rec.probe.httpStatus ?? '-'} ${rec.probe.ms}ms)` : '—';
  console.log(`${v.id.padEnd(18)} статус=${String(s).padEnd(10)} проба=${p}${rec.divergence ? '  <== РОЗБІЖНІСТЬ' : ''}`);
}
console.log(`\nзаписано ${wrote} рядків -> ${outFile}${divergences ? `  розбіжностей: ${divergences}` : ''}`);
