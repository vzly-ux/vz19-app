/* VZ-19 Pro Max v5.0 */

/* ── UTILS ── */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const showLoader = t => { $("loaderText").textContent = t || "Chargement..."; $("loaderOverlay").classList.remove("hidden"); };
const hideLoader = () => $("loaderOverlay").classList.add("hidden");
const showCard = id => { $(id).classList.remove("hidden"); setTimeout(() => $(id).scrollIntoView({behavior:"smooth",block:"start"}), 100); };


/* ── VERSION DYNAMIQUE ── */
(function() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const build = "13.0"; const label = `v${build} · ${pad(now.getDate())}/${pad(now.getMonth()+1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ["versionTag", "versionTag2"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
})();

/* ── PWA ── */
let dp;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); dp = e; $("installBtn").classList.remove("hidden"); });
$("installBtn").addEventListener("click", async () => { if(dp){ dp.prompt(); await dp.userChoice; dp=null; } });
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});

/* ── TABS ── */
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    $("tab-" + tab.dataset.tab).classList.add("active");
    if(tab.dataset.tab === "historique") renderHistorique();
  });
});

/* ── SPORTS TOGGLE ── */
const activeSports = { Foot: true, Basket: true, Tennis: true };
window.toggleSport = function(el, sport) {
  activeSports[sport] = !activeSports[sport];
  el.classList.toggle("active", activeSports[sport]);
};

/* ── STATE ── */
let selectedMatch = null;
let claudeAnalysis = "";
let currentVerdict = null;
let allMatchesData = [];

/* ── SPORT EMOJI ── */
function sportEmoji(sport) {
  if(!sport) return "🏅";
  const s = sport.toLowerCase();
  if(s.includes("foot") || s.includes("soccer")) return "⚽";
  if(s.includes("basket") || s.includes("nba")) return "🏀";
  if(s.includes("tennis") || s.includes("atp") || s.includes("wta")) return "🎾";
  return "🏅";
}

/* ── CLAUDE API ── */
async function callClaude(system, user, webSearch) {
  const body = {
    system,
    messages: [{ role: "user", content: user }],
    web_search: webSearch === true
  };
  const res = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch(e) { throw new Error("Réponse invalide: " + raw.slice(0,100)); }
  if(data.error) throw new Error(data.error);
  const text = (data.content||[]).map(b => b.type==="text" ? b.text : "").join("").trim();
  if(!text) throw new Error("Pas de réponse.");
  return text;
}

/* ── FETCH MATCHS (via Netlify Function → FlashLive Sports API) ── */
function getToday() {
  return new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

async function fetchMatchesRaw() {
  try {
    const res = await fetch("/.netlify/functions/sports-data");
    if (!res.ok) return { matches: [], errors: [`HTTP ${res.status}`], breakdown: {} };
    const data = await res.json();
    const filtered = (data.matches || []).filter(m => {
      const s = (m.sport || "").toLowerCase();
      if (s.includes("foot")   && !activeSports.Foot)   return false;
      if (s.includes("basket") && !activeSports.Basket) return false;
      if (s.includes("tennis") && !activeSports.Tennis) return false;
      return true;
    });
    return { ...data, matches: filtered };
  } catch(e) {
    return { matches: [], errors: [e.message], breakdown: {} };
  }
}

/* ── FORMAT MATCHES ── */
function formatForClaude(matches) {
  if(!matches.length) return "";
  let txt = "";
  const byS = {};
  matches.forEach(m => { const k = m.sport||"Autre"; byS[k] = byS[k]||[]; byS[k].push(m); });
  Object.entries(byS).forEach(([sport, ms]) => {
    txt += `${sportEmoji(sport)} ${sport.toUpperCase()}\n`;
    ms.forEach(m => { txt += `- ${m.match} | ${m.competition||""} | ${m.date||""} ${m.heure||""}\n`; });
    txt += "\n";
  });
  return txt;
}

/* ── STEP 1: SCOUTING ── */
$("btnAutoScout").addEventListener("click", async () => {
  const sports = Object.entries(activeSports).filter(([,v])=>v).map(([k])=>k);
  if(!sports.length) { alert("Sélectionne au moins un sport."); return; }

  const status = $("scoutStatus");
  status.classList.remove("hidden");
  status.textContent = "⏳ Récupération Sofascore...";
  showLoader("Récupération des matchs...");

  try {
    // 1. Sofascore
    const apiData = await fetchMatchesRaw();
    let matches = apiData.matches || [];
    // Dédupliquer — normaliser A vs B = B vs A
    const seenKeys2 = new Set();
    matches = matches.filter(m => {
      const teams = (m.match || "").toLowerCase().split(" vs ").map(t => t.trim()).sort();
      const key = teams.join("|");
      if (seenKeys2.has(key)) return false;
      seenKeys2.add(key); return true;
    });
    allMatchesData = matches;
    const matchesText = formatForClaude(matches);

    // Lire le breakdown avec erreurs détaillées
    let statusLines = [];
    let bd = {};
    try {
      bd = apiData.breakdown || {};
      const errs = apiData.errors || [];
      const errFoot = errs.find(e => e.startsWith("⚽"));
      const errBasket = errs.find(e => e.startsWith("🏀"));
      const errTennis = errs.find(e => e.startsWith("🎾"));
      if(bd.football > 0) statusLines.push(`✅ Football : ${bd.football} matchs`);
      else statusLines.push(errFoot ? `❌ Football : ${errFoot.replace("⚽ ","").slice(0,120)}` : "ℹ️ Football : aucun match aujourd'hui");
      if(bd.basketball > 0) statusLines.push(`✅ Basket NBA : ${bd.basketball} matchs`);
      else statusLines.push(errBasket ? `❌ NBA : ${errBasket.replace("🏀 ","").slice(0,120)}` : "ℹ️ NBA : aucun match aujourd'hui");
      if(bd.tennis > 0) statusLines.push(`✅ Tennis : ${bd.tennis} matchs`);
      else statusLines.push(errTennis ? `❌ Tennis : ${errTennis.replace("🎾 ","").slice(0,120)}` : "ℹ️ Tennis : aucun match aujourd'hui");
      if(apiData.sofascore > 0) statusLines.push(`📡 SofaScore : ${apiData.sofascore} matchs enrichis`);
      if(apiData.enriched > 0) statusLines.push(`📊 ${apiData.enriched}/${apiData.total} matchs avec stats`);
    } catch(e) {
      statusLines = [matches.length ? `✅ ${matches.length} matchs récupérés` : `❌ Erreur lecture réponse API: ${e.message}`];
    }
    status.textContent = statusLines.join("\n");

    // 2. Claude sélectionne
    $("loaderText").textContent = "🤖 Claude sélectionne les meilleurs matchs...";

    const today = new Date().toLocaleDateString("fr-FR", {
      weekday:"long", day:"numeric", month:"long", year:"numeric", timeZone:"Europe/Paris"
    });

    // BLOCAGE STRICT : si pas de données API réelles, on arrête ici
    if (!matchesText || matchesText.trim().length < 20) {
      hideLoader();
      // N'afficher l'alerte que si AUCUN sport n'a de données
      const hasAnyData = (bd.football || 0) + (bd.basketball || 0) + (bd.tennis || 0) > 0;
      const noDataMsg = !hasAnyData
        ? "\n⛔ APIs indisponibles — réessaie dans quelques minutes."
        : "\nℹ️ Aucun match dans les sports sélectionnés.";
      status.textContent = (status.textContent || "") + noDataMsg;
      $("scoutStatus").classList.remove("hidden");
      return;
    }

    const system = `Tu es un expert paris sportifs VZ-19. RÈGLE ABSOLUE : tu réponds UNIQUEMENT avec du JSON brut valide, AUCUN texte avant ou après, AUCUN backtick, AUCUNE explication. Tu ne peux JAMAIS inventer ou deviner des matchs — si un match n'est pas dans la liste fournie, il n'existe pas.`;

    const user = `Date: ${today}. Sports demandés: ${sports.join(", ")}.
Matchs réels du jour fournis par Sofascore:
${matchesText.slice(0, 1500)}

RÈGLE ABSOLUE : sélectionne UNIQUEMENT des matchs présents dans cette liste. JAMAIS inventer.
Sélectionne jusqu'à 6 matchs UNIQUEMENT parmi la liste fournie (n'invente rien).
RÈGLE OBLIGATOIRE : si des matchs Tennis et Basket NBA sont dans la liste, tu DOIS en inclure au moins 1 de chaque sport disponible.
Structure idéale : 2 Football SAFE + 1 Tennis SAFE + 1 NBA SAFE + 1 VALUE (n'importe quel sport) + 1 FUN (grosse cote).
- SAFE : favori logique, faible risque
- VALUE : cote sous-évaluée par le marché
- FUN : grosse cote crédible, upset possible

Retourne UNIQUEMENT du JSON valide:
{"selections":[{"type":"SAFE","match":"Equipe1 vs Equipe2","sport":"Football","heure":"20h45","competition":"Ligue 1","reason":"raison courte"}]}`;

    const raw = await callClaude(system, user, false);
    hideLoader();

    // Parser le JSON - très tolérant
    let selections = [];
    try {
      // Essai 1: JSON complet
      const m1 = raw.match(/\{[\s\S]*?"selections"[\s\S]*?\]/);
      if(m1) {
        const jsonStr = m1[0] + "}";
        try { selections = JSON.parse(jsonStr).selections || []; } catch(e) {}
      }
      // Essai 2: extraire chaque objet selection individuellement
      if(!selections.length) {
        const items = raw.matchAll(/\{[^{}]*"type"[^{}]*"match"[^{}]*\}/g);
        for(const item of items) {
          try { selections.push(JSON.parse(item[0])); } catch(e) {}
        }
      }
      // Essai 3: parsing ligne par ligne
      if(!selections.length) {
        const types = ["SAFE","VALUE","LIVE","FUN"];
        const lines = raw.split("\n");
        lines.forEach(line => {
          const tMatch = types.find(t => line.toUpperCase().includes(t));
          const mMatch = line.match(/[-–]\s*(.+?vs.+?)[\|,]/i) || line.match(/match["\s:]+([^"\n,]+vs[^"\n,]+)/i);
          if(tMatch && mMatch) {
            selections.push({
              type: tMatch,
              match: mMatch[1].trim(),
              sport: line.toLowerCase().includes("tennis")?"Tennis":line.toLowerCase().includes("basket")||line.toLowerCase().includes("nba")?"Basket NBA":"Football",
              heure: (line.match(/\d{1,2}h\d{2}/) || [""])[0],
              competition: "",
              reason: line.slice(0, 80)
            });
          }
        });
      }
    } catch(e) {}

    if(!selections.length) {
      // Dernier recours: demander à Claude sans web search avec prompt ultra simple
      try {
        $("loaderText").textContent = "🔄 Nouvelle tentative...";
        const today2 = new Date().toLocaleDateString("fr-FR", {day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Paris"});
        const raw2 = await callClaude(
          "Tu es un expert paris sportifs. Réponds UNIQUEMENT avec du JSON valide, rien d'autre.",
          `Date: ${today2}. Sports: ${sports.join(", ")}. Donne 5 vrais matchs du jour en JSON: {"selections":[{"type":"SAFE","match":"X vs Y","sport":"Football","heure":"20h45","competition":"Ligue 1","reason":"Raison"},{"type":"SAFE","match":"A vs B","sport":"Tennis","heure":"14h00","competition":"ATP","reason":"Raison"},{"type":"SAFE","match":"C vs D","sport":"Basket NBA","heure":"02h00","competition":"NBA","reason":"Raison"},{"type":"VALUE","match":"E vs F","sport":"Football","heure":"18h30","competition":"PL","reason":"Raison"},{"type":"LIVE","match":"G vs H","sport":"Tennis","heure":"11h00","competition":"WTA","reason":"Raison"}]}`,
          false
        );
        const m2 = raw2.match(/\{[\s\S]*"selections"[\s\S]*?\]/);
        if(m2) {
          try { selections = JSON.parse(m2[0]+"}").selections || []; } catch(e) {}
        }
      } catch(e2) {}
    }

    if(!selections.length) {
      status.textContent += "\n❌ Impossible d'obtenir les matchs. Réessaie dans quelques secondes.";
      return;
    }

    // Exclure matchs terminés (status OU timestamp > 3h passé)
    const nowMs = Date.now();
    matches = matches.filter(m => {
      const s = (m.status || "").toLowerCase();
      if (["ft","aet","ap","finished","ended","match finished"].some(k => s === k || s.includes("finished"))) return false;
      if (m.finished) return false;
      return true;
    });

    // Dédupliquer — même match = même clé (A vs B OU B vs A)
    // Mais si même match avec types différents, garder le premier uniquement
    const seenSel = new Set();
    selections = selections.filter(s => {
      const teams = (s.match || "").toLowerCase().split(" vs ").map(t => t.trim()).sort();
      const key = teams.join("|");
      if (seenSel.has(key)) return false;
      seenSel.add(key); return true;
    });
    // Limiter à 6 max
    if (selections.length > 6) selections = selections.slice(0, 6);

    // Enrichir avec date depuis allMatchesData
    selections = selections.map(s => {
      const apiMatch = allMatchesData.find(m => {
        const sTeams = (s.match || "").toLowerCase().split(" vs ").map(t => t.trim()).sort();
        const mTeams = (m.match || "").toLowerCase().split(" vs ").map(t => t.trim()).sort();
        return sTeams[0] && mTeams[0] && (
          sTeams[0].slice(0,6) === mTeams[0].slice(0,6) ||
          sTeams[1]?.slice(0,6) === mTeams[1]?.slice(0,6)
        );
      });
      return {
        ...s,
        date: apiMatch?.date || "",
        heure: s.heure || apiMatch?.heure || "",
        homeId: apiMatch?.homeId,
        awayId: apiMatch?.awayId
      };
    });

    // Afficher les cartes
    $("matchCount").textContent = selections.length + " matchs";
    renderCards(selections);
    showCard("cardStep2");

  } catch(err) {
    hideLoader();
    status.textContent = "❌ Erreur : " + err.message;
  }
});

/* ── RENDER CARDS ── */
function renderCards(selections) {
  window._selections = selections;
  $("matchCards").innerHTML = selections.map((s, i) => `
    <div class="match-card ${s.type.toLowerCase()}" onclick="selectMatch(${i})" style="cursor:pointer">
      <div class="mc-top">
        <span class="mc-sport">${sportEmoji(s.sport)}</span>
        <span class="mc-badge ${s.type.toLowerCase()}">${s.type}</span>
      </div>
      <div class="mc-match">${esc((s.match||"").replace(/\*\*/g,""))}</div>
      <div class="mc-meta">${s.date ? esc(s.date)+" · " : ""}${esc(s.heure||"")}${s.competition?" · "+esc(s.competition):""}</div>
      <div class="mc-reason">${esc(s.reason||"")}</div>
      <div class="mc-cta">Appuie pour analyser →</div>
    </div>`).join("");
}

/* ── SELECT MATCH ── */
window.selectMatch = async function(i) {
  selectedMatch = window._selections[i];
  document.querySelectorAll(".match-card").forEach((c,j) => {
    c.style.opacity = j===i ? "1" : "0.45";
  });
  $("selectedMatchBadge").innerHTML = `
    <div class="selected-badge" style="margin-bottom:12px">
      <div class="sb-sport">${sportEmoji(selectedMatch.sport)}</div>
      <div>
        <div class="sb-match">${esc((selectedMatch.match||"").replace(/\*\*/g,""))}</div>
        <div class="sb-meta">${selectedMatch.date ? esc(selectedMatch.date) + " · " : ""}${esc(selectedMatch.sport)} · ${esc(selectedMatch.heure||"")} · <span style="color:${selectedMatch.type==="SAFE"?"var(--accent)":selectedMatch.type==="VALUE"?"var(--warn)":selectedMatch.type==="FUN"?"#c084fc":"var(--blue2)"}">${selectedMatch.type}</span></div>
      </div>
    </div>`;

  // Enrichissement stats au clic
  const m = allMatchesData.find(x => x.match === selectedMatch.match);
  if (m && !m.stats) {
    try {
      const enriched = await enrichMatch(m);
      if (enriched) {
        m.stats = enriched;
        m.enriched = true;
      }
    } catch {}
  }
  $("autoDataBlock").classList.toggle("hidden", !m);
  showCard("cardStep3");
};

/* ── ANALYSE ── */
$("btnAnalyse").addEventListener("click", async () => {
  if(!selectedMatch) { alert("Sélectionne un match."); return; }
  const extra = $("matchGeminiData").value.trim();

  showCard("cardStep4");
  $("claudeOutputStep4").innerHTML = `<div class="loader-inline"><div class="loader-spinner small"></div><span>Claude analyse...</span></div>`;

  try {
    const autoData = allMatchesData.find(x => x.match === selectedMatch.match);
    
    const system = `Tu es un expert VZ-19 (paris sportifs). Applique la méthode à TOUS les sports. Texte simple SANS markdown (pas de **, ##, tableaux). Tirets pour les listes. Concis.`;

    /* ── Formattage intelligent des stats enrichies (SofaScore + APIs) ── */
    let statsBlock = "";
    if (autoData?.stats) {
      const s = autoData.stats;
      const sport = (selectedMatch.sport || "").toLowerCase();
      const isSofa = autoData.sofascore === true;

      if (sport.includes("foot") || sport.includes("basket") || sport.includes("tennis")) {

        // ── Forme récente ──
        const fmtForm = arr => arr && arr.length ? arr.map(r => `${r.result}(${r.score} vs ${r.vs}${r.home?" [dom]":" [ext]"})`).join(", ") : null;
        const hf = fmtForm(s.homeForm);
        const af = fmtForm(s.awayForm);
        if (hf || af) {
          statsBlock += `\n[FORME 5 DERNIERS MATCHS]\n`;
          if (hf) statsBlock += `- ${autoData.home} : ${hf}\n`;
          if (af) statsBlock += `- ${autoData.away} : ${af}\n`;
        } else if (s.home?.recentForm) {
          statsBlock += `\n[FORME RÉCENTE]\n- ${autoData.home} : ${s.home.recentForm}\n`;
          if (s.away?.recentForm) statsBlock += `- ${autoData.away} : ${s.away.recentForm}\n`;
        }

        // ── Bilan saison (api-football uniquement) ──
        if (!isSofa && s.home) {
          statsBlock += `\n[STATS SAISON]\n- ${autoData.home} : ${s.home.wins}V ${s.home.draws}N ${s.home.loses}D — ${s.home.avgGoalsFor} buts/m marqués, ${s.home.avgGoalsAgainst} encaissés — CS: ${s.home.cleanSheets}\n`;
          if (s.away) statsBlock += `- ${autoData.away} : ${s.away.wins}V ${s.away.draws}N ${s.away.loses}D — ${s.away.avgGoalsFor} buts/m marqués, ${s.away.avgGoalsAgainst} encaissés — CS: ${s.away.cleanSheets}\n`;
        }

        // ── Cotes marché ──
        if (s.odds) {
          statsBlock += `\n[COTES MARCHÉ]\n- ${autoData.home} : ${s.odds["Home"] || "N/A"} | Nul : ${s.odds["Draw"] || "N/A"} | ${autoData.away} : ${s.odds["Away"] || "N/A"}\n`;
        }

        // ── H2H ──
        if (s.h2h?.length) {
          statsBlock += `\n[H2H 6 DERNIERS]\n`;
          s.h2h.forEach(m => {
            const score = m.scoreHome !== undefined ? `${m.scoreHome}-${m.scoreAway}` : (m.score || "?-?");
            const winner = m.winner ? ` (${m.winner})` : "";
            statsBlock += `- ${m.date} : ${m.home} vs ${m.away} → ${score}${winner}\n`;
          });
        }

        // ── Lineups (SofaScore exclusif) ──
        if (isSofa && s.lineups) {
          const fmtLineup = (side, name) => {
            if (!side) return "";
            const conf = side.confirmed ? "✅ CONFIRMÉ" : "⏳ probable";
            const starters = side.starters?.join(", ") || "N/A";
            return `- ${name} [${conf}] Formation: ${side.formation || "?"}\n  Titulaires: ${starters}\n`;
          };
          statsBlock += `\n[COMPOSITIONS]\n${fmtLineup(s.lineups.home, autoData.home)}${fmtLineup(s.lineups.away, autoData.away)}`;
        }

        // ── Stats de match (SofaScore — tous les items) ──
        if (s.matchStats) {
          const ms = s.matchStats;
          const fmt = (obj) => obj ? `${obj.home} - ${obj.away}` : null;
          const lines = [
            ms.xg             && `- xG : ${fmt(ms.xg)}`,
            ms.possession     && `- Possession : ${ms.possession.home}% - ${ms.possession.away}%`,
            ms.totalShots     && `- Tirs totaux : ${fmt(ms.totalShots)}`,
            ms.shotsOnTarget  && `- Tirs cadrés : ${fmt(ms.shotsOnTarget)}`,
            ms.shotsOffTarget && `- Tirs non cadrés : ${fmt(ms.shotsOffTarget)}`,
            ms.shotsInsideBox && `- Tirs dans la surface : ${fmt(ms.shotsInsideBox)}`,
            ms.bigChances     && `- Big chances : ${fmt(ms.bigChances)}`,
            ms.bigChancesMissed && `- Big chances manquées : ${fmt(ms.bigChancesMissed)}`,
            ms.corners        && `- Corners : ${fmt(ms.corners)}`,
            ms.fouls          && `- Fautes : ${fmt(ms.fouls)}`,
            ms.yellowCards    && `- Cartons jaunes : ${fmt(ms.yellowCards)}`,
            ms.redCards       && `- Cartons rouges : ${fmt(ms.redCards)}`,
            ms.goalkeeperSaves && `- Arrêts gardien : ${fmt(ms.goalkeeperSaves)}`,
            ms.goalsPrevented  && `- Buts évités (GK) : ${fmt(ms.goalsPrevented)}`,
            ms.counterAttacks  && `- Contre-attaques : ${fmt(ms.counterAttacks)}`,
            ms.offsides        && `- Hors-jeux : ${fmt(ms.offsides)}`
          ].filter(Boolean);
          if (lines.length) statsBlock += `\n[STATS SOFASCORE]\n` + lines.join("\n") + "\n";
        }

        // ── Blessés (api-football) ──
        if (s.injuries?.length) {
          statsBlock += `\n[BLESSÉS / SUSPENDUS]\n`;
          s.injuries.forEach(p => { statsBlock += `- ${p.team} : ${p.player} (${p.type})\n`; });
        }

      } else if (sport.includes("basket") || sport.includes("nba")) {
        const fmt = (t) => t ? `${t.wins||"?"}V-${t.losses||"?"}D | PPG:${t.ppg||"?"} | Conc:${t.oppg||"?"} | FG%:${t.fg_pct||"?"} | 3P%:${t.tp_pct||"?"} | Série:${t.streak||"?"}` : "N/A";
        statsBlock += `\n[STATS NBA]\n- ${autoData.home} : ${fmt(s.home)}\n- ${autoData.away} : ${fmt(s.away)}\n`;
        if (s.home?.home_record) statsBlock += `- Dom. ${autoData.home} : ${s.home.home_record} | Ext. ${autoData.away} : ${s.away?.away_record||"?"}\n`;

      } else if (sport.includes("tennis")) {
        if (s.surface) statsBlock += `\n[SURFACE] ${s.surface}\n`;
        const fmtPlayer = (p, name) => {
          if (!p) return "";
          return `- ${name} : Classement #${p.ranking||"?"} | Points: ${p.points||"?"} | Bilan: ${p.wins||"?"}V-${p.losses||"?"}D | Forme: ${p.recentForm||"N/A"}\n`;
        };
        statsBlock += `\n[JOUEURS]\n${fmtPlayer(s.home, autoData.home)}${fmtPlayer(s.away, autoData.away)}`;
        if (s.h2h?.length) {
          statsBlock += `\n[H2H]\n`;
          s.h2h.forEach(m => {
            if (isSofa) {
              statsBlock += `- ${m.date} → Vainqueur: ${m.winner==="home"?autoData.home:autoData.away} (${m.scoreHome}-${m.scoreAway})\n`;
            } else {
              statsBlock += `- ${m.date} (${m.tournament||""}) → ${m.winner} · ${m.score}\n`;
            }
          });
        }
      }

      if (isSofa) statsBlock = `📡 Source: SofaScore\n` + statsBlock;
    }

    // Limiter la taille totale pour éviter rate limit (max ~3000 chars input)
    if (statsBlock.length > 1200) statsBlock = statsBlock.slice(0, 1200) + "\n[...tronqué]";
    const extraTrunc = extra ? extra.slice(0, 400) : "";

    const user = `Match : ${selectedMatch.sport} — ${selectedMatch.match}
Compétition : ${selectedMatch.competition||""} | Heure : ${selectedMatch.heure||""}
Raison scouting : ${selectedMatch.reason||""}
${statsBlock || (autoData ? "Données brutes : " + JSON.stringify(autoData).slice(0, 400) : "")}
${extraTrunc ? "\nDonnées Gemini :\n" + extraTrunc : ""}

Analyse VZ-19 (texte simple, sans markdown) :

SCORE VZ-19 /100
Camp A : X/100
Camp B : X/100

FILTRES
IR Réplication : X/10 - [pattern basé sur forme + H2H]
IC Chaos : X/10 - [blessés, classement, surface]
IQ : X/10
Blowout : X/10

NIVEAU RÉEL vs MARCHÉ
[analyse cotes vs performance réelle]

VERDICT
Classification : SAFE / VALUE / NO BET / LIVE ONLY
Marché : [précis]
Cote min : X.XX
Timing : pré-match ou LIVE
Risques : [liste basée sur les stats]

VZ_JSON={"scoreA":50,"scoreB":50,"ir":5,"ic":3,"iq":5,"blowout":2,"verdict":"VALUE","market":"marché précis","minOdds":"1.80","timing":"pré-match","risk":"risque1, risque2"}`;

    const response = await callClaude(system, user, false);
    claudeAnalysis = response;
    $("claudeOutputStep4").innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.7">${esc(response)}</pre>`;
    currentVerdict = parseVerdict(response);
    applyVerdict();

  } catch(err) {
    $("claudeOutputStep4").innerHTML = `<div style="color:var(--danger)">❌ ${esc(err.message)}</div>`;
  }
});

$("btnVerdict").addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.querySelector('[data-tab="verdict"]').classList.add("active");
  $("tab-verdict").classList.add("active");
});

$("copyClaude").addEventListener("click", async () => {
  await navigator.clipboard.writeText(claudeAnalysis).catch(()=>{});
  $("copyClaude").textContent = "✅"; setTimeout(() => $("copyClaude").textContent = "📋 Copier", 1200);
});

/* ── PARSE VERDICT ── */
function parseVerdict(text) {
  let j = null;
  // Regex robuste : capture JSON complet ou tronqué
  const jm = text.match(/VZ_JSON\s*=\s*(\{[\s\S]*?\})/m) ||
             text.match(/VZ_JSON\s*=\s*(\{[\s\S]*)/m);
  if(jm) {
    let jsonStr = jm[1];
    if(!jsonStr.trim().endsWith("}")) jsonStr += "}";
    try { j = JSON.parse(jsonStr); } catch(e){
      // Extraction champ par champ si JSON invalide
      const extr = (k) => { const m = jsonStr.match(new RegExp('"' + k + '"\\s*:\\s*([\\d.]+|"[^"]*")')); if(!m) return undefined; return m[1].startsWith('"') ? m[1].slice(1,-1) : parseFloat(m[1]); };
      j = { scoreA:extr("scoreA"), scoreB:extr("scoreB"), ir:extr("ir"), ic:extr("ic"), blowout:extr("blowout"), verdict:extr("verdict"), market:extr("market"), minOdds:extr("minOdds"), timing:extr("timing"), risk:extr("risk") };
    }
  }

  const get = pats => { for(const p of pats){ const m=text.match(p); if(m) return parseInt(m[1]); } return null; };
  // Parsing robuste : extraire scoreA même si JSON tronqué
  let scoreA = 50;
  if (j?.scoreA !== undefined) {
    scoreA = j.scoreA;
  } else {
    // Chercher dans le texte brut : "Camp A ... : XX/100" ou "scoreA":XX
    const m1 = claudeAnalysis.match(/"scoreA"\s*:\s*(\d+)/);
    const m2 = claudeAnalysis.match(/Camp\s*A[^:]*:\s*(\d+)\s*\/\s*100/i);
    if (m1) scoreA = parseInt(m1[1]);
    else if (m2) scoreA = parseInt(m2[1]);
  }
  let scoreB = 50;
  if (j?.scoreB !== undefined) {
    scoreB = j.scoreB;
  } else {
    const m1 = claudeAnalysis.match(/"scoreB"\s*:\s*(\d+)/);
    const m2 = claudeAnalysis.match(/Camp\s*B[^:]*:\s*(\d+)\s*\/\s*100/i);
    if (m1) scoreB = parseInt(m1[1]);
    else if (m2) scoreB = parseInt(m2[1]);
  }

  let vl = (j?.verdict||"").toUpperCase();
  if(!vl) {
    if(/NO.BET/i.test(text)) vl="NO BET";
    else if(/LIVE.ONLY/i.test(text)) vl="LIVE ONLY";
    else if(/\bSAFE\b/i.test(text)) vl="SAFE";
    else if(/\bVALUE\b/i.test(text)) vl="VALUE";
    else vl="LIVE ONLY";
  }
  const vt = /NO.BET/.test(vl)?"nobet":/SAFE/.test(vl)?"safe":/VALUE/.test(vl)?"value":"live";

  const mm = text.match(/[Mm]arch[eé]\s*[:\-]\s*([^\n]+)/);
  const cm = text.match(/[Cc]ote?\s*(?:min[^:]*)\s*[:\-]\s*([^\n]+)/);
  const rm = text.match(/[Rr]isques?\s*[:\-]\s*([^\n]+)/);

  return {
    scoreA, scoreB, gap: Math.abs(scoreA-scoreB),
    verdictType: vt, verdictLabel: vl,
    marche: j?.market || (mm?mm[1].trim():""),
    cote: j?.minOdds || (cm?cm[1].trim():""),
    risques: (Array.isArray(j?.risk) ? j.risk.join(", ") : j?.risk) || (rm?rm[1].trim():""),
    timing: j?.timing || ""
  };
}

/* ── APPLY VERDICT ── */
function applyVerdict() {
  if(!currentVerdict||!selectedMatch) return;
  const {scoreA,scoreB,gap,verdictType,verdictLabel,marche,cote,risques,timing} = currentVerdict;

  $("matchHeader").innerHTML = `
    <div class="mh-sport">${selectedMatch.sport}</div>
    <div>${esc((selectedMatch.match||"").replace(/\*\*/g,""))}</div>
    <div class="mh-odds">${selectedMatch.date ? esc(selectedMatch.date)+" · " : ""}${esc(selectedMatch.heure||"")}${selectedMatch.competition?" · "+esc(selectedMatch.competition):""}</div>`;

  $("scoreA").textContent = scoreA;
  $("scoreB").textContent = scoreB;
  $("gap").textContent = gap;

  // Coloriser les scores selon l'écart
  $("scoreA").style.color = scoreA > scoreB ? "var(--accent)" : scoreA < scoreB ? "var(--danger)" : "var(--warn)";
  $("scoreB").style.color = scoreB > scoreA ? "var(--accent)" : scoreB < scoreA ? "var(--danger)" : "var(--warn)";
  const vBadge = $("verdict");
  vBadge.textContent = verdictLabel;
  vBadge.className = `verdict-badge ${verdictType}`;
  vBadge.style.display = "block";
  // Best bet
  const bestBetEl = $("bestBet");
  const bestBetContentEl = $("bestBetContent");
  if (bestBetEl && bestBetContentEl && (marche || cote)) {
    bestBetEl.style.display = "block";
    bestBetContentEl.innerHTML = `
      ${marche ? `<div style="font-weight:600;color:var(--text);margin-bottom:6px">${esc(marche)}</div>` : ""}
      ${cote ? `<div style="font-family:var(--mono);font-size:13px;color:var(--warn)">💰 Cote min : ${esc(String(cote))}</div>` : ""}
      ${timing ? `<div style="font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:4px">⏱ ${esc(String(timing))}</div>` : ""}
    `;
  }
  // Risques
  const risksEl = $("risks");
  const risksContentEl = $("risksContent");
  if (risksEl && risksContentEl && risques) {
    risksEl.style.display = "block";
    risksContentEl.textContent = risques;
  }
  $("finalPrompt").value = `VZ-19 Pro Max v5.6\nMatch : ${selectedMatch.match}\nSport : ${selectedMatch.sport} | ${selectedMatch.heure||""}\n\nScores : A=${scoreA}/100 | B=${scoreB}/100 | Écart=${gap}\nVerdict : ${verdictLabel}\nMarché : ${marche||"voir analyse"}\nCote min : ${cote||"voir analyse"}\nTiming : ${timing||"voir analyse"}\nRisques : ${risques||"voir analyse"}\n\nANALYSE :\n${claudeAnalysis}`;
}

/* ── COPY/SAVE/NOUVEAU ── */
$("copyFinal").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("finalPrompt").value).catch(()=>{});
  $("copyFinal").textContent = "✅ Copié"; setTimeout(()=>$("copyFinal").textContent="📋 Copier",1200);
});

$("openGemini2").addEventListener("click", () => window.open("https://gemini.google.com/app/03f3c4e19225396d","_blank"));
$("copyAnalysePrompt").addEventListener("click", async () => {
  if(!selectedMatch) return;
  const txt = `Donne les stats détaillées pour : ${selectedMatch.sport} — ${selectedMatch.match} (${selectedMatch.competition||""}, ${selectedMatch.heure||""}).\nForme récente, absences, H2H, stats clés. Pas de pronostic.`;
  await navigator.clipboard.writeText(txt).catch(()=>{});
  $("copyAnalysePrompt").textContent = "✅ Copié !"; setTimeout(()=>$("copyAnalysePrompt").textContent="📋 Enrichir via Gemini",1500);
});

$("saveMatch").addEventListener("click", () => {
  if(!currentVerdict||!selectedMatch) { alert("Lance d'abord une analyse."); return; }
  const h = JSON.parse(localStorage.getItem("vz19-history")||"[]");
  h.unshift({ date:new Date().toLocaleDateString("fr-FR"), match:selectedMatch.match, sport:selectedMatch.sport, heure:selectedMatch.heure, verdict:currentVerdict.verdictLabel, verdictType:currentVerdict.verdictType, analyse:claudeAnalysis, final:$("finalPrompt").value });
  localStorage.setItem("vz19-history", JSON.stringify(h.slice(0,20)));
  $("saveMatch").textContent = "✅ Sauvegardé"; setTimeout(()=>$("saveMatch").textContent="💾 Sauvegarder",1500);
});

$("newAnalyse").addEventListener("click", () => {
  if(!confirm("Nouvelle analyse ?")) return;
  selectedMatch=null; claudeAnalysis=""; currentVerdict=null; allMatchesData=[];
  $("matchGeminiData").value=""; $("scoutStatus").classList.add("hidden");
  ["cardStep2","cardStep3","cardStep4"].forEach(id=>$(id).classList.add("hidden"));
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
  document.querySelector('[data-tab="scout"]').classList.add("active");
  $("tab-scout").classList.add("active");
});

/* ── HISTORIQUE ── */
function renderHistorique() {
  const h = JSON.parse(localStorage.getItem("vz19-history")||"[]");
  const el = $("historiqueList");
  if(!h.length) { el.innerHTML=`<div class="ai-placeholder">Aucune analyse.</div>`; return; }
  el.innerHTML = h.map((x,i)=>`
    <div class="histo-item" onclick="loadHistorique(${i})">
      <div class="histo-match">${sportEmoji(x.sport)} ${esc(x.match||"?")}</div>
      <div class="histo-meta">${x.date||""} · ${esc(x.sport||"")}</div>
      <div class="histo-verdict" style="color:${x.verdictType==="safe"?"var(--accent)":x.verdictType==="value"?"var(--warn)":x.verdictType==="fun"?"#c084fc":x.verdictType==="nobet"?"var(--danger)":"var(--blue2)"}">${x.verdict||""}</div>
    </div>`).join("");
}

window.loadHistorique = function(i) {
  const h = JSON.parse(localStorage.getItem("vz19-history")||"[]")[i];
  if(!h) return;
  selectedMatch={match:h.match,sport:h.sport,heure:h.heure,competition:"",type:h.verdictType?.toUpperCase(),reason:""};
  claudeAnalysis=h.analyse||"";
  currentVerdict=parseVerdict(h.analyse||"");
  if(currentVerdict){currentVerdict.verdictLabel=h.verdict;currentVerdict.verdictType=h.verdictType;}
  $("finalPrompt").value=h.final||"";
  applyVerdict();
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
  document.querySelector('[data-tab="verdict"]').classList.add("active");
  $("tab-verdict").classList.add("active");
};

$("clearHistory").addEventListener("click",()=>{
  if(!confirm("Vider l'historique ?")) return;
  localStorage.removeItem("vz19-history");
  renderHistorique();
});
