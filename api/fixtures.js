// api/fixtures.js
// Esta función corre en el servidor de Vercel, nunca en el navegador.
// Por eso el token nunca queda expuesto al usuario final.

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const BASE = "https://api.football-data.org/v4";
const COMPETITIONS = ["PL", "PD", "CL"]; // Premier League, La Liga, Champions League

async function fd(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Auth-Token": TOKEN }
  });
  if (!res.ok) throw new Error(`football-data.org error ${res.status} on ${path}`);
  return res.json();
}

// Heurística simple de confianza: diferencia de posición en la tabla.
// No es un modelo real, solo un punto de partida.
function buildMarkets(home, away, posHome, posAway, standingsMap) {
  const gap = posAway - posHome; // positivo = home es favorito
  const favoriteIsHome = gap >= 0;
  const score = Math.min(99, 55 + Math.abs(gap) * 3);

  const h = standingsMap[home.id];
  const a = standingsMap[away.id];
  const avgGoalsHome = h ? (h.goalsFor / Math.max(h.playedGames, 1)) : 1.2;
  const avgGoalsAway = a ? (a.goalsFor / Math.max(a.playedGames, 1)) : 1.0;
  const avgConcededHome = h ? (h.goalsAgainst / Math.max(h.playedGames, 1)) : 1.0;
  const avgConcededAway = a ? (a.goalsAgainst / Math.max(a.playedGames, 1)) : 1.0;

  const totalGoalsExp = avgGoalsHome + avgGoalsAway;
  const favTeamGoalsExp = favoriteIsHome ? avgGoalsHome : avgGoalsAway;
  const bttsLikely = (avgGoalsHome > 0.9 && avgConcededAway > 0.9) &&
                      (avgGoalsAway > 0.8 && avgConcededHome > 0.8);

  return {
    score: Math.round(score),
    dcPick: favoriteIsHome ? 0 : 2, // 0 = 1X, 2 = X2
    favoriteTeam: favoriteIsHome ? home.name : away.name,
    teamGoalsPick: favTeamGoalsExp > 1.4 ? 1 : 0, // 1 = "Más de 1.5"
    totalGoalsPick: totalGoalsExp > 2.6 ? 1 : 0,   // 1 = "Más de 2.5"
    bttsPick: bttsLikely ? 1 : 0
  };
}

export default async function handler(req, res) {
  if (!TOKEN) {
    return res.status(500).json({ error: "Falta configurar FOOTBALL_DATA_TOKEN en Vercel." });
  }
  try {
    const dateFrom = new Date().toISOString().slice(0, 10);
    const dateTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const results = [];
    for (const comp of COMPETITIONS) {
      const [matches, standings] = await Promise.all([
        fd(`/competitions/${comp}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED`),
        fd(`/competitions/${comp}/standings`).catch(() => null)
      ]);

      const standingsMap = {};
      if (standings) {
        const table = standings.standings.find(s => s.type === "TOTAL")?.table || [];
        table.forEach(row => { standingsMap[row.team.id] = row; });
      }

      for (const m of matches.matches || []) {
        const posHome = standingsMap[m.homeTeam.id]?.position ?? 10;
        const posAway = standingsMap[m.awayTeam.id]?.position ?? 10;
        const markets = buildMarkets(m.homeTeam, m.awayTeam, posHome, posAway, standingsMap);
        results.push({
          league: matches.competition.name,
          home: m.homeTeam.name,
          away: m.awayTeam.name,
          utcDate: m.utcDate,
          ...markets
        });
      }
    }

    // top 2 por score, solo lo más próximo en el tiempo si hay muchos
    const top2 = results.sort((a, b) => b.score - a.score).slice(0, 2);
    res.status(200).json({ picks: top2, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
