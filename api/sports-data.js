const https = require("https");

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "5523bea532msh3cdb2e87e4e2072p1b2bd1jsn91c4d440f923";

/* ══════════════════════════════════════════
   HTTP HELPER
   ══════════════════════════════════════════ */
function fetchAPI(hostname, path, customUA) {
  return new Promise((resolve, reject) => {
    // Pour Sofascore : headers navigateur, pas RapidAPI
    const isSofa = hostname.includes("sofascore");
    const headers = isSofa ? {
      "User-Agent": customUA || "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/121.0 Mobile Safari/537.36",
      "Accept": "application/json",
      "Referer": "https://www.sofascore.com/",
      "Origin": "https://www.sofascore.com"
    } : {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": hostname,
      "Content-Type": "application/json"
    };
    const req = https.request({
      hostname, path, method: "GET", headers
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(13000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function safeJSON(str) { try { return JSON.parse(str); } catch { return null; } }

function getToday() {
  return new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

// Retourne [today, tomorrow] si l'heure actuelle > 18h (Paris), sinon [today]
// Logique : après 18h, la plupart des matchs du jour sont terminés → inclure demain
function getDatesToFetch() {
  const now = new Date();
  const hourParis = parseInt(now.toLocaleTimeString("fr-FR", {
    hour: "2-digit", timeZone: "Europe/Paris"
  }));
  const today = getToday();
  const tomorrow = getTomorrow();
  // Après 18h → chercher aujourd'hui + demain
  return hourParis >= 18 ? [today, tomorrow] : [today];
}

function formatTime(ts) {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}

// Retourne true si le match est clairement terminé (démarré il y a plus de 3h)
function isMatchOver(ts) {
  if (!ts) return false;
  const matchTime = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
  const now = Date.now();
  return now > matchTime + (3 * 60 * 60 * 1000); // 3 heures après le début
}

function formatDate(ts) {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return "";
  // "mercredi 7 mai"
  return d.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris"
  });
}

/* ══════════════════════════════════════════
   FLASHLIVE SPORTS — flashlive-sports.p.rapidapi.com
   Couvre : Football, Basket, Tennis
   ══════════════════════════════════════════ */
const FLASH = "flashlive-sports.p.rapidapi.com";

// Sport IDs FlashLive : 1=Football, 3=Basketball, 2=Tennis
async function getFlashEvents(sportId, sportName) {
  const dates = getDatesToFetch();
  const allEvents = [];

  for (let i = 0; i < dates.length; i++) {
    // indent_days=0 = aujourd'hui, indent_days=1 = demain
    const r = await fetchAPI(FLASH, `/v1/events/list?sport_id=${sportId}&indent_days=${i}&timezone=1&locale=fr_FR`);
    if (r.status !== 200) {
      if (i === 0) throw new Error(`FlashLive ${sportName} HTTP ${r.status}: ${r.body.slice(0, 120)}`);
      continue; // demain optionnel
    }
    const data = safeJSON(r.body);
    const stages = data?.DATA || data?.data || [];
    (Array.isArray(stages) ? stages : []).forEach(stage => {
      (stage.Events || stage.events || []).forEach(ev => allEvents.push({ ev, stage }));
    });
    if (i < dates.length - 1) await new Promise(r => setTimeout(r, 300)); // délai entre appels
  }
  return allEvents;
}

/* ── FOOTBALL ── */
const MAJOR_COMPETITIONS = [
  "ligue 1", "premier league", "la liga", "bundesliga", "serie a",
  "champions league", "europa league", "conference league", "ligue des champions",
  "primera division", "primeira liga"
];

async function getFootball() {
  const events = await getFlashEvents(1, "Football");

  if (!events.length) throw new Error("FlashLive Football: 0 événements retournés");

  // Log des compétitions disponibles pour debug
  const compsAvailable = [...new Set(events.map(({stage}) => stage.Cnm || stage.Name || "?"))].slice(0, 20);
  console.log("[VZ19] Compétitions FlashLive disponibles:", compsAvailable.join(", "));

  const filtered = events.filter(({ ev, stage }) => {
    // Exclure seulement si clairement terminé ET timestamp dans le passé
    const status = ev.Eps || ev.status || "";
    const ts = ev.Esd || ev.timestamp || 0;
    const now = Math.floor(Date.now() / 1000);
    if (["FT","AET","AP"].includes(status) && ts > 0 && now > ts + 7200) return false;
    const comp = (stage.Cnm || stage.cnm || stage.Name || stage.Scd || "").toLowerCase();
    // Filtre élargi — inclure toutes les grandes ligues européennes + Coupes
    return MAJOR_COMPETITIONS.some(c => comp.includes(c)) ||
           comp.includes("cup") || comp.includes("coupe") || comp.includes("copa") ||
           comp.includes("league") || comp.includes("liga") || comp.includes("division");
  }).slice(0, 20);

  // Si toujours rien, prendre les 5 premiers matchs disponibles
  const final = filtered.length ? filtered : events.slice(0, 8);
  
  if (!final.length) throw new Error(`FlashLive Football: aucun match. Compétitions dispo: ${compsAvailable.join(", ")}`);

  return final.map(({ ev, stage }) => {
    const home = ev.T1?.[0]?.Nm || ev.home || "";
    const away = ev.T2?.[0]?.Nm || ev.away || "";
    const competition = stage.Cnm || stage.Name || "";
    const ts = ev.Esd || ev.timestamp;
    const status = ev.Eps || ev.status || "";
    return {
      sport: "Football", competition, home, away,
      match: `${home} vs ${away}`,
      heure: ts ? formatTime(ts) : "",
      date: ts ? formatDate(ts) : "",
      status, id: ev.Eid || ev.id,
      homeId: ev.T1?.[0]?.ID,
      awayId: ev.T2?.[0]?.ID,
      stats: null
    };
  }).filter(m => m.home && m.away);
}

/* ── BASKETBALL ── */
async function getBasketball() {
  const events = await getFlashEvents(2, "Basketball");

  const nba = events.filter(({ ev, stage }) => {
    const status = ev.Eps || ev.status || "";
    const ts = ev.Esd || ev.timestamp || 0;
    const now = Math.floor(Date.now() / 1000);
    if (["FT","AET","AP"].includes(status) && ts > 0 && now > ts + 7200) return false;
    const comp = (stage.Cnm || stage.Name || "").toLowerCase();
    return comp.includes("nba");
  }).slice(0, 15);

  if (!nba.length) throw new Error("FlashLive Basketball: aucun match NBA aujourd'hui");

  return nba.map(({ ev, stage }) => {
    const home = ev.T1?.[0]?.Nm || "";
    const away = ev.T2?.[0]?.Nm || "";
    const ts = ev.Esd || ev.timestamp;
    return {
      sport: "Basket NBA", competition: "NBA", home, away,
      match: `${home} vs ${away}`,
      heure: ts ? formatTime(ts) : "",
      status: ev.Eps || "", id: ev.Eid || ev.id,
      homeId: ev.T1?.[0]?.ID, awayId: ev.T2?.[0]?.ID,
      stats: null
    };
  }).filter(m => m.home && m.away);
}

/* ── TENNIS ── */
// Exclure uniquement les tournois mineurs (ITF futures, juniors, fauteuil)
const TENNIS_EXCLUDE = ["itf", "junior", "wheelchair", "doubles only", "qualifying"];

async function getTennis() {
  const allTennis = [];

  // Source principale : FlashLive sport_id=2 (Tennis) — même API que Foot/Basket
  try {
    const events = await getFlashEvents(2, "Tennis");
    console.log(`[VZ19] FlashLive Tennis: ${events.length} événements bruts`);

    const comps = [...new Set(events.map(({stage}) => stage.Cnm || stage.Name || "?"))].slice(0, 15);
    console.log("[VZ19] Tennis comps:", comps.join(", "));

    const filtered = events.filter(({ ev, stage }) => {
      const status = ev.Eps || ev.status || "";
      const ts = ev.Esd || ev.timestamp || 0;
      const now = Math.floor(Date.now() / 1000);
      if (["FT","AET","AP"].includes(status) && ts > 0 && now > ts + 7200) return false;
      const comp = (stage.Cnm || stage.Name || stage.Scd || "").toLowerCase();
      if (TENNIS_EXCLUDE.some(ex => comp.includes(ex))) return false;
      return true;
    }).slice(0, 20);

    filtered.forEach(({ ev, stage }) => {
      const home = ev.T1?.[0]?.Nm || "";
      const away = ev.T2?.[0]?.Nm || "";
      if (!home || !away) return;
      const ts = ev.Esd || ev.timestamp;
      const surface = detectSurface(stage.Cnm || stage.Name || "");
      allTennis.push({
        sport: "Tennis", competition: stage.Cnm || stage.Name || "",
        home, away, match: `${home} vs ${away}`,
        heure: ts ? formatTime(ts) : "",
        date: ts ? formatDate(ts) : "",
        status: ev.Eps || "", id: ev.Eid || ev.id,
        homeId: ev.T1?.[0]?.ID, awayId: ev.T2?.[0]?.ID,
        stats: { surface, h2h: [], homeForm: [], awayForm: [] }
      });
    });

    if (allTennis.length) {
      console.log(`[VZ19] FlashLive Tennis: ${allTennis.length} matchs retenus`);
      return allTennis;
    }
  } catch(e) { console.log(`[VZ19] FlashLive Tennis err: ${e.message}`); }

  // Fallback : SportAPI7 active-tournaments
  try {
    const today = getToday();
    const SPORTAPI7_HOST = "sportapi7.p.rapidapi.com";
    const rTourneys = await fetchAPI(SPORTAPI7_HOST, `/api/v1/sport/tennis/active-tournaments?date=${today}`);
    console.log(`[VZ19] SportAPI7 tennis: HTTP ${rTourneys.status}`);
    if (rTourneys.status === 200) {
      const data = safeJSON(rTourneys.body);
      const tournaments = data?.uniqueTournaments || data?.tournaments || data?.data || [];
      const majorFilter = ["atp", "wta", "grand slam", "rome", "madrid", "roland", "wimbledon", "masters"];
      const majorTourneys = tournaments.filter(t => {
        const name = (t.name || t.displayName || "").toLowerCase();
        return majorFilter.some(k => name.includes(k));
      }).slice(0, 5);

      for (const tourney of majorTourneys) {
        const tid = tourney.id || tourney.uniqueTournamentId;
        if (!tid) continue;
        const rEvents = await fetchAPI(SPORTAPI7_HOST, `/api/v1/unique-tournament/${tid}/events/next/0`);
        if (rEvents.status === 200) {
          (safeJSON(rEvents.body)?.events || []).forEach(ev => {
            const home = ev.homeTeam?.name || ev.homePlayer?.name || "";
            const away = ev.awayTeam?.name || ev.awayPlayer?.name || "";
            if (!home || !away) return;
            const ts = ev.startTimestamp;
            if (ts && Date.now() > ts * 1000 + 3 * 60 * 60 * 1000) return;
            allTennis.push({
              sport: "Tennis", competition: tourney.name || "Tennis",
              home, away, match: `${home} vs ${away}`,
              heure: ts ? formatTime(ts) : "", date: ts ? formatDate(ts) : today,
              status: ev.status?.type || "", id: ev.id,
              stats: { surface: detectSurface(tourney.name || ""), h2h: [], homeForm: [], awayForm: [] }
            });
          });
        }
        if (allTennis.length >= 15) break;
      }
    }
    if (allTennis.length) {
      console.log(`[VZ19] SportAPI7 tennis: ${allTennis.length} matchs`);
      return allTennis.slice(0, 15);
    }
  } catch(e) { console.log(`[VZ19] SportAPI7 tennis err: ${e.message}`); }

  throw new Error("Tennis: 0 événements (FlashLive + SportAPI7)");
}


/* ══════════════════════════════════════════
   LIVESCORE SPORTS — livescore-sports.p.rapidapi.com
   Fallback si FlashLive échoue
   ══════════════════════════════════════════ */
const LIVE = "livescore-sports.p.rapidapi.com";

// TheSportsDB — fallback gratuit, CORS ok côté serveur
async function fetchTheSportsDB(leagueId, date) {
  const r = await fetchAPI("www.thesportsdb.com", `/api/v1/json/3/eventsday.php?d=${date}&l=${leagueId}`);
  if (r.status !== 200) return [];
  const data = safeJSON(r.body);
  return (data?.events || []).map(ev => ({
    sport: "Football",
    competition: ev.strLeague || "",
    home: ev.strHomeTeam || "",
    away: ev.strAwayTeam || "",
    match: `${ev.strHomeTeam} vs ${ev.strAwayTeam}`,
    finished: ["FT","Match Finished","After Extra Time"].includes(ev.strStatus) || isMatchOver(parseInt(ev.strTimestamp) || (ev.dateEvent && ev.strTime ? new Date(ev.dateEvent+"T"+ev.strTime+"Z") : null)),
    heure: (() => {
      if (ev.strTimestamp && parseInt(ev.strTimestamp) > 1000000) {
        return formatTime(parseInt(ev.strTimestamp));
      }
      if (ev.dateEvent && ev.strTime && ev.strTime !== "00:00:00") {
        return formatTime(new Date(ev.dateEvent + "T" + ev.strTime + "Z"));
      }
      return "";
    })(),
    date: (() => {
      if (ev.strTimestamp && parseInt(ev.strTimestamp) > 1000000) {
        return formatDate(parseInt(ev.strTimestamp));
      }
      if (ev.dateEvent) {
        return formatDate(new Date(ev.dateEvent + "T" + (ev.strTime || "12:00:00") + "Z"));
      }
      return "";
    })(),
    status: ev.strStatus || "",
    id: ev.idEvent,
    homeId: ev.idHomeTeam,
    awayId: ev.idAwayTeam,
    stats: null
  })).filter(m => m.home && m.away);
}

async function getFootballFallback() {
  const leagueIds = ["4328","4334","4335","4332","4331","4480","4481","4399","4406","4392","4397"];
  const dates = getDatesToFetch();
  const allMatches = [];
  
  for (const date of dates) {
    const results = await Promise.allSettled(leagueIds.map(id => fetchTheSportsDB(id, date)));
    results.forEach(r => { if (r.status === "fulfilled") allMatches.push(...r.value); });
  }
  
  if (!allMatches.length) throw new Error("Aucun match Football dans les grandes ligues (24h)");
  // Trier par heure
  return allMatches.sort((a, b) => (a.heure || "").localeCompare(b.heure || "")).slice(0, 20);
}

/* ══════════════════════════════════════════
   ENRICHISSEMENT H2H + FORME (FlashLive)
   ══════════════════════════════════════════ */
async function getH2H(eventId) {
  if (!eventId) return [];
  const r = await fetchAPI(FLASH, `/v1/events/h2h?event_id=${eventId}&locale=fr_FR`);
  if (r.status !== 200) return [];
  const data = safeJSON(r.body);
  const matches = data?.DATA?.H2H || data?.DATA?.h2h || data?.h2h || [];
  return matches.slice(0, 6).map(m => ({
    date: m.Esd ? new Date(m.Esd * 1000).toISOString().slice(0, 20) : "",
    home: m.T1?.[0]?.Nm || "", away: m.T2?.[0]?.Nm || "",
    scoreHome: m.Tr1 ?? "?", scoreAway: m.Tr2 ?? "?"
  }));
}

async function getTeamForm(teamId) {
  if (!teamId) return [];
  const r = await fetchAPI(FLASH, `/v1/teams/results?team_id=${teamId}&locale=fr_FR&page_num=1`);
  if (r.status !== 200) return [];
  const data = safeJSON(r.body);
  const events = data?.DATA || data?.events || [];
  return events.slice(0, 8).map(ev => {
    const isHome = ev.T1?.[0]?.ID === teamId;
    const myScore = parseInt(isHome ? ev.Tr1 : ev.Tr2) || 0;
    const oppScore = parseInt(isHome ? ev.Tr2 : ev.Tr1) || 0;
    const result = myScore > oppScore ? "W" : myScore === oppScore ? "D" : "L";
    const opp = isHome ? (ev.T2?.[0]?.Nm || "") : (ev.T1?.[0]?.Nm || "");
    return { result, score: `${myScore}-${oppScore}`, vs: opp, home: isHome };
  });
}

function detectSurface(str) {
  const s = (str || "").toLowerCase();
  if (s.includes("clay") || s.includes("terre") || s.includes("roland")) return "Terre battue";
  if (s.includes("grass") || s.includes("wimbledon")) return "Gazon";
  if (s.includes("hard") || s.includes("indoor")) return "Dur";
  return "Inconnu";
}

/* ══════════════════════════════════════════
   HANDLER PRINCIPAL
   ══════════════════════════════════════════ */
module.exports = async (req, res) => {
  const event = { httpMethod: req.method };
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Origin","*"); return res.status(200).end(); }

  // Espacer les appels FlashLive pour éviter le 429
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const footR = await Promise.allSettled([getFootball().catch(() => getFootballFallback())]);
  await sleep(300);
  const basketR = await Promise.allSettled([getBasketball()]);
  await sleep(300);
  const tennisR = await Promise.allSettled([getTennis()]);

  const [foot_]   = footR;
  const [basket_] = basketR;
  const [tennis_] = tennisR;

  const foot   = foot_.status   === "fulfilled" ? foot_.value   : [];
  let basket = basket_.status === "fulfilled" ? basket_.value : [];

  // Fallback AllSports basket si FlashLive vide
  if (!basket.length) {
    try {
      const dates = getDatesToFetch();
      const allBasket = [];
      for (const date of dates) {
        const r = await fetchAPI("www.thesportsdb.com", `/api/v1/json/3/eventsday.php?d=${date}&l=4387`);
        if (r.status === 200) {
          (safeJSON(r.body)?.events || []).forEach(e => {
            const home = e.strHomeTeam || "", away = e.strAwayTeam || "";
            if (!home || !away) return;
            const ts = e.strTimestamp && parseInt(e.strTimestamp) > 1000000 ? parseInt(e.strTimestamp) : (e.dateEvent && e.strTime ? new Date(e.dateEvent + "T" + e.strTime + "Z") : null);
            allBasket.push({
              sport: "Basket NBA", competition: "NBA",
              home, away, match: `${home} vs ${away}`,
              heure: ts ? formatTime(ts) : "",
              date: ts ? formatDate(ts) : (e.dateEvent || ""),
              status: e.strStatus || "", id: e.idEvent, stats: null
            });
          });
        }
      }
      if (allBasket.length) {
        basket = allBasket.slice(0, 10);
        console.log(`[VZ19] AllSports basket fallback: ${basket.length} matchs`);
      }
    } catch(e) { console.log("[VZ19] AllSports basket err:", e.message); }
  }
  let tennis = tennis_.status === "fulfilled" ? tennis_.value : [];

  // Fallback : Sofascore public API via fetch() natif Node 18
  if (!tennis.length) {
    try {
      const dates = getDatesToFetch();
      const allTennis = [];
      const majorTennis = ["atp 1000", "atp 500", "wta 1000", "wta 500", "grand slam", "roland", "rome", "madrid", "wimbledon", "australian", "us open", "internazionali", "mutua", "open de", "masters"];
      
      for (const date of dates) {
        // Essai avec différents User-Agents pour contourner le blocage Sofascore
        const userAgents = [
          "Googlebot/2.1 (+http://www.google.com/bot.html)",
          "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
          "curl/7.88.1"
        ];
        
        for (const ua of userAgents) {
          const r = await fetchAPI("api.sofascore.com", `/api/v1/sport/tennis/scheduled-events/${date}`, ua);
          if (r.status === 200) {
            const events = safeJSON(r.body)?.events || [];
            console.log(`[VZ19] Sofascore tennis ${date} via ${ua.slice(0,10)}: ${events.length} events`);
            events.filter(ev => {
              const name = (ev.tournament?.uniqueTournament?.name || ev.tournament?.name || "").toLowerCase();
              return majorTennis.some(k => name.includes(k));
            }).forEach(ev => {
              const home = ev.homeTeam?.name || ev.homePlayer?.name || "";
              const away = ev.awayTeam?.name || ev.awayPlayer?.name || "";
              if (!home || !away) return;
              const ts = ev.startTimestamp;
              allTennis.push({
                sport: "Tennis",
                competition: ev.tournament?.uniqueTournament?.name || ev.tournament?.name || "Tennis",
                home, away, match: `${home} vs ${away}`,
        
