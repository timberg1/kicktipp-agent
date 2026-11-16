// ===== Kicktipp-Agent: Tipps berechnen (n8n Code-Node, "Run Once for All Items") =====
// Eingabe: ein Item pro Spiel aus der Odds API (h2h, optional totals; Dezimalquoten).
// Ausgabe: ein Item mit der fertigen Tippliste ("nachricht") und den Details ("spiele").
// Modell: Poisson mit Dixon-Coles-Korrektur, an 1X2 (optional + Über/Unter 2,5) kalibriert,
// Tipp = höchster Erwartungswert unter dem Punkteschema der Runde.

const PUNKTE = { exakt: 4, diff: 3, tendenz: 2 }; // Punkteschema deiner Runde
const RHO_STANDARD = -0.11;
const MAXTORE = 9;
const MAX_TIPP = 6;

// ---------- Modell ----------
const fak = [1];
for (let i = 1; i <= MAXTORE; i++) fak[i] = fak[i - 1] * i;
const poisson = (k, lam) => Math.exp(-lam) * Math.pow(lam, k) / fak[k];

function tau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function matrix(lh, la, rho) {
  const m = [];
  let s = 0;
  for (let x = 0; x <= MAXTORE; x++) {
    m.push([]);
    for (let y = 0; y <= MAXTORE; y++) {
      const w = poisson(x, lh) * poisson(y, la) * tau(x, y, lh, la, rho);
      m[x].push(w);
      s += w;
    }
  }
  return m.map(z => z.map(w => w / s));
}

function kennzahlen(m) {
  let h = 0, r = 0, a = 0, over = 0;
  m.forEach((z, x) => z.forEach((w, y) => {
    if (x > y) h += w; else if (x === y) r += w; else a += w;
    if (x + y > 2.5) over += w;
  }));
  return { h, r, a, over };
}

function passeAn(p1, px, p2, pOver) {
  const fehler = (lh, la, rho) => {
    const k = kennzahlen(matrix(lh, la, rho));
    let f = (k.h - p1) ** 2 + (k.r - px) ** 2 + (k.a - p2) ** 2;
    if (pOver !== null) f += (k.over - pOver) ** 2;
    return f;
  };
  const fitLambdas = rho => {
    let best = [1.5, 1.2], bestF = Infinity;
    let g = [0.15, 4.6, 0.10, 4.2], schritt = 0.10;
    for (let stufe = 0; stufe < 3; stufe++) {
      for (let lh = g[0]; lh <= g[1] + 1e-9; lh += schritt) {
        for (let la = g[2]; la <= g[3] + 1e-9; la += schritt) {
          const f = fehler(lh, la, rho);
          if (f < bestF) { bestF = f; best = [lh, la]; }
        }
      }
      g = [Math.max(0.05, best[0] - schritt), best[0] + schritt,
           Math.max(0.05, best[1] - schritt), best[1] + schritt];
      schritt /= 10;
    }
    return { best, bestF };
  };
  if (pOver === null) {
    const { best } = fitLambdas(RHO_STANDARD);
    return [best[0], best[1], RHO_STANDARD];
  }
  let erg = null, ergF = Infinity;
  for (let i = 0; i < 15; i++) {
    const rho = -0.26 + 0.02 * i;
    const { best, bestF } = fitLambdas(rho);
    if (bestF < ergF) { ergF = bestF; erg = [best[0], best[1], rho]; }
  }
  return erg;
}

function rangliste(m) {
  const sgn = v => (v > 0) - (v < 0);
  const liste = [];
  for (let tx = 0; tx <= MAX_TIPP; tx++) {
    for (let ty = 0; ty <= MAX_TIPP; ty++) {
      let ev = 0, pExakt = 0;
      m.forEach((z, x) => z.forEach((w, y) => {
        if (x === tx && y === ty) { ev += PUNKTE.exakt * w; pExakt = w; }
        else if (x - y === tx - ty) ev += PUNKTE.diff * w;
        else if (sgn(x - y) === sgn(tx - ty)) ev += PUNKTE.tendenz * w;
      }));
      liste.push({ tipp: `${tx}:${ty}`, ev, pExakt });
    }
  }
  return liste.sort((a, b) => b.ev - a.ev);
}

// ---------- Quoten aus der Odds API mitteln ----------
const mittel = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

function marktWahrscheinlichkeiten(spiel) {
  const p1 = [], px = [], p2 = [], pOver = [], margen = [];
  for (const buch of spiel.bookmakers || []) {
    for (const markt of buch.markets || []) {
      if (markt.key === 'h2h') {
        const q = n => markt.outcomes.find(o => o.name === n)?.price;
        const qh = q(spiel.home_team), qa = q(spiel.away_team), qd = q('Draw');
        if (!qh || !qa || !qd) continue;
        const s = 1 / qh + 1 / qd + 1 / qa;
        p1.push(1 / qh / s); px.push(1 / qd / s); p2.push(1 / qa / s); margen.push(s - 1);
      }
      if (markt.key === 'totals') {
        const o = markt.outcomes.find(x => x.name === 'Over' && x.point === 2.5);
        const u = markt.outcomes.find(x => x.name === 'Under' && x.point === 2.5);
        if (o && u) pOver.push((1 / o.price) / (1 / o.price + 1 / u.price));
      }
    }
  }
  if (!p1.length) return null;
  const n = mittel(p1) + mittel(px) + mittel(p2);
  return {
    p1: mittel(p1) / n, px: mittel(px) / n, p2: mittel(p2) / n,
    pOver: pOver.length ? mittel(pOver) : null,
    marge: mittel(margen), buchmacher: p1.length,
  };
}

// ---------- Hauptteil ----------
const fmt = (v, d = 2) => v.toFixed(d).replace('.', ',');
const anstoss = iso => new Date(iso).toLocaleString('de-DE', {
  timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit',
});

const spiele = [];
for (const item of $input.all()) {
  const s = item.json;
  const markt = marktWahrscheinlichkeiten(s);
  if (!markt) continue;
  const [lh, la, rho] = passeAn(markt.p1, markt.px, markt.p2, markt.pOver);
  const rang = rangliste(matrix(lh, la, rho));
  spiele.push({
    heim: s.home_team,
    gast: s.away_team,
    anstoss: s.commence_time,
    tipp: rang[0].tipp,
    ev: Number(rang[0].ev.toFixed(3)),
    pExakt: Number(rang[0].pExakt.toFixed(3)),
    alternative: rang[1].tipp,
    abstandZurAlternative: Number((rang[0].ev - rang[1].ev).toFixed(3)),
    knapp: rang[0].ev - rang[1].ev < 0.05,
    markt: {
      heimsieg: Number(markt.p1.toFixed(3)),
      remis: Number(markt.px.toFixed(3)),
      auswaertssieg: Number(markt.p2.toFixed(3)),
      ueber25: markt.pOver === null ? null : Number(markt.pOver.toFixed(3)),
      buchmacher: markt.buchmacher,
    },
    erwarteteTore: `${fmt(lh)}:${fmt(la)}`,
  });
}
spiele.sort((a, b) => a.anstoss.localeCompare(b.anstoss));

const gesamt = spiele.reduce((s, x) => s + x.ev, 0);
const zeilen = spiele.map(x => `${x.tipp}  ${x.heim} – ${x.gast} (${anstoss(x.anstoss)})${x.knapp ? ' *' : ''}`);
const nachricht = spiele.length
  ? `Kicktipp – deine Tipps\n\n${zeilen.join('\n')}\n\nErwartete Punkte: ${fmt(gesamt, 1)} (${fmt(gesamt / spiele.length)} pro Spiel)` +
    (spiele.some(x => x.knapp) ? '\n* knapp: Alternative fast gleich gut' : '')
  : 'Kicktipp: Für die nächsten Tage wurden keine Bundesliga-Quoten gefunden.';

return [{ json: { nachricht, gesamtEV: Number(gesamt.toFixed(2)), anzahl: spiele.length, spiele } }];
