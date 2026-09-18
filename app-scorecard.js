// Carte de score : 1 à 6 joueurs (nom + index), par/handicap pré-remplis depuis
// OpenStreetMap quand connus (HOLES_DATA, voir data/holes.js), toujours éditables.
// Calcule trou par trou le score brut, les putts, le Stableford brut et le Stableford
// net (à partir de l'index du joueur et du slope du parcours), plus les totaux.
// Persistée dans Supabase (table `rounds`) avec un lien partageable (?id=<uuid>).
(function () {
  const SUPABASE_URL = "https://pkqmrqffkcswbifhrqri.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrcW1ycWZma2Nzd2JpZmhycXJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mjg4ODAsImV4cCI6MjEwNTMwNDg4MH0.gRPVLts7SoPWxQpzc-3o_fMKs2x240SuXoI94bXfDzY";
  const MAX_PLAYERS = 6;

  const configured = /^https:\/\//.test(SUPABASE_URL) && window.supabase;
  const supabase = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  const golfNameEl = document.getElementById("golf-name");
  const golfLocationEl = document.getElementById("golf-location");
  const notFoundEl = document.getElementById("not-found");
  const appEl = document.getElementById("scorecard-app");
  const playerListEl = document.getElementById("player-list");
  const playerCountEl = document.getElementById("player-count");
  const addPlayerBtn = document.getElementById("add-player");
  const tableEl = document.getElementById("score-table");
  const shareBtn = document.getElementById("share-round");
  const deleteBtn = document.getElementById("delete-round");
  const statusEl = document.getElementById("save-status");
  const rosterChipsEl = document.getElementById("roster-chips");
  const slopeInput = document.getElementById("slope-input");

  const golfIndex = new Map((typeof GOLF_DATA !== "undefined" ? GOLF_DATA : []).map((g) => [g.id, g]));

  const params = new URLSearchParams(window.location.search);
  let roundId = params.get("id");
  let golf = null;
  let players = [{ name: "Joueur 1", index: null }];
  let holes = [];
  let scores = {}; // { "<hole number>": [score, score, ...] }
  let putts = {}; // { "<hole number>": [putts, putts, ...] }
  let slope = null;
  let saveTimer = null;

  // --- Calculs Stableford ---------------------------------------------------

  function playingHandicap(playerIndex) {
    if (playerIndex == null || slope == null) return null;
    return Math.round((playerIndex * slope) / 113);
  }

  function strokesReceived(ph, holeHandicap) {
    if (ph == null) return null;
    if (holeHandicap == null) return null;
    const base = Math.floor(ph / 18);
    const extra = ph % 18;
    return base + (holeHandicap <= extra ? 1 : 0);
  }

  function stablefordPoints(score, par) {
    if (score == null || par == null) return null;
    return Math.max(0, 2 - (score - par));
  }

  function grossStableford(hole, score) {
    return stablefordPoints(score, hole.par);
  }

  function netStableford(hole, score, playerIndex) {
    if (score == null) return null;
    const ph = playingHandicap(playerIndex);
    const sr = strokesReceived(ph, hole.handicap);
    if (sr == null) return null;
    return stablefordPoints(score - sr, hole.par);
  }

  // --- Liste de joueurs enregistrés (persistée une fois, réutilisable sur toutes les
  // cartes de score, indépendante des joueurs propres à chaque carte) ---
  let roster = []; // [{ name, index }]
  let rosterId = null;

  function normalizeRosterEntry(entry) {
    return typeof entry === "string" ? { name: entry, index: null } : { name: entry.name, index: entry.index ?? null };
  }

  async function loadRoster() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("player_roster")
      .select("id, names")
      .order("updated_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Supabase roster load failed:", error);
      return;
    }
    if (data) {
      rosterId = data.id;
      roster = (data.names || []).map(normalizeRosterEntry);
    } else {
      const { data: created, error: insertError } = await supabase
        .from("player_roster")
        .insert({ names: [] })
        .select("id, names")
        .single();
      if (!insertError) {
        rosterId = created.id;
        roster = (created.names || []).map(normalizeRosterEntry);
      }
    }
    renderRoster();
  }

  async function saveRoster() {
    if (!supabase || !rosterId) return;
    await supabase.from("player_roster").update({ names: roster, updated_at: new Date().toISOString() }).eq("id", rosterId);
  }

  function upsertRoster(name, indexValue) {
    const trimmed = (name || "").trim();
    if (!trimmed || /^Joueur \d+$/.test(trimmed)) return;
    const existing = roster.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (indexValue != null && indexValue !== existing.index) {
        existing.index = indexValue;
        renderRoster();
        saveRoster();
      }
    } else {
      roster.push({ name: trimmed, index: indexValue != null ? indexValue : null });
      renderRoster();
      saveRoster();
    }
  }

  function removeFromRoster(name) {
    roster = roster.filter((r) => r.name !== name);
    renderRoster();
    saveRoster();
  }

  function renderRoster() {
    if (!rosterChipsEl) return;
    rosterChipsEl.innerHTML = "";
    roster.forEach((entry) => {
      const chip = document.createElement("span");
      const alreadyInRound = players.some((p) => p.name === entry.name);
      chip.className = `chip roster-chip${alreadyInRound ? " is-added" : ""}`;

      const label = document.createElement("button");
      label.type = "button";
      label.className = "roster-chip-label";
      label.textContent = entry.index != null ? `${entry.name} (${entry.index})` : entry.name;
      label.disabled = alreadyInRound || players.length >= MAX_PLAYERS;
      label.addEventListener("click", () => {
        const newPlayer = { name: entry.name, index: entry.index };
        const emptySlot = players.findIndex((p) => /^Joueur \d+$/.test(p.name));
        if (emptySlot !== -1) {
          players[emptySlot] = newPlayer;
        } else if (players.length < MAX_PLAYERS) {
          players.push(newPlayer);
        } else {
          return;
        }
        renderPlayers();
        renderTable();
        renderRoster();
        scheduleSave();
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "roster-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Oublier ${entry.name} de la liste enregistrée`);
      removeBtn.addEventListener("click", () => removeFromRoster(entry.name));

      chip.append(label, removeBtn);
      rosterChipsEl.appendChild(chip);
    });
  }

  function buildDefaultHoles(count, golfId) {
    const ref = (typeof HOLES_DATA !== "undefined" && HOLES_DATA[golfId]) || [];
    const byNumber = new Map(ref.map((h) => [h.number, h]));
    const list = [];
    for (let n = 1; n <= count; n++) {
      const known = byNumber.get(n);
      list.push({ number: n, par: known ? known.par : null, handicap: known ? known.handicap : null });
    }
    return list;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function scheduleSave() {
    setStatus("Enregistrement…");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  }

  function setRoundIdInUrl(id) {
    const url = new URL(window.location.href);
    url.searchParams.delete("golf");
    url.searchParams.set("id", id);
    window.history.replaceState({}, "", url);
  }

  async function save() {
    if (!supabase) {
      setStatus("Non sauvegardé (backend non configuré)");
      return;
    }
    const payload = { golf_id: golf.id, holes, players, scores, putts, slope };
    if (!roundId) {
      const { data, error } = await supabase.from("rounds").insert(payload).select("id").single();
      if (error) {
        if (error.code === "23505") {
          // Une autre carte a été créée entre-temps pour ce golf (contrainte unique
          // golf_id) : on bascule dessus au lieu d'échouer.
          const { data: existing } = await supabase
            .from("rounds")
            .select("id")
            .eq("golf_id", golf.id)
            .maybeSingle();
          if (existing) {
            roundId = existing.id;
            setRoundIdInUrl(roundId);
            shareBtn.disabled = false;
            deleteBtn.disabled = false;
            return save();
          }
        }
        console.error("Supabase insert failed:", error);
        setStatus("Erreur de sauvegarde");
        return;
      }
      roundId = data.id;
      setRoundIdInUrl(roundId);
      shareBtn.disabled = false;
      deleteBtn.disabled = false;
    } else {
      const { error } = await supabase
        .from("rounds")
        .update(Object.assign({ updated_at: new Date().toISOString() }, payload))
        .eq("id", roundId);
      if (error) {
        console.error("Supabase update failed:", error);
        setStatus("Erreur de sauvegarde");
        return;
      }
    }
    setStatus("Enregistré ✓");
  }

  function renderPlayers() {
    playerCountEl.textContent = `${players.length}/${MAX_PLAYERS}`;
    addPlayerBtn.disabled = players.length >= MAX_PLAYERS;
    playerListEl.innerHTML = "";
    players.forEach((player, i) => {
      const row = document.createElement("li");
      row.className = "selection-row";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = player.name;
      nameInput.placeholder = `Joueur ${i + 1}`;
      nameInput.className = "selection-day";
      nameInput.style.flex = "1 1 auto";
      nameInput.addEventListener("input", () => {
        players[i].name = nameInput.value || `Joueur ${i + 1}`;
        renderTableHeaderNamesOnly();
        scheduleSave();
      });
      nameInput.addEventListener("blur", () => upsertRoster(players[i].name, players[i].index));
      row.appendChild(nameInput);

      const indexInput = document.createElement("input");
      indexInput.type = "number";
      indexInput.step = "0.1";
      indexInput.placeholder = "Index";
      indexInput.title = "Index de handicap du joueur";
      indexInput.className = "selection-day player-index-input";
      indexInput.value = player.index == null ? "" : player.index;
      indexInput.addEventListener("input", () => {
        players[i].index = indexInput.value === "" ? null : parseFloat(indexInput.value);
        renderTotals();
        scheduleSave();
      });
      indexInput.addEventListener("blur", () => upsertRoster(players[i].name, players[i].index));
      row.appendChild(indexInput);

      if (players.length > 1) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "selection-remove";
        removeBtn.textContent = "×";
        removeBtn.setAttribute("aria-label", `Retirer ${player.name}`);
        removeBtn.addEventListener("click", () => {
          players.splice(i, 1);
          Object.keys(scores).forEach((hole) => {
            if (scores[hole]) scores[hole].splice(i, 1);
          });
          Object.keys(putts).forEach((hole) => {
            if (putts[hole]) putts[hole].splice(i, 1);
          });
          renderPlayers();
          renderTable();
          renderRoster();
          scheduleSave();
        });
        row.appendChild(removeBtn);
      }
      playerListEl.appendChild(row);
    });
    renderRoster();
  }

  function renderTableHeaderNamesOnly() {
    tableEl.querySelectorAll("thead .player-group-name").forEach((th, i) => {
      const p = players[i];
      th.textContent = p ? p.name : `Joueur ${i + 1}`;
    });
  }

  function totalsFor(playerIndex, player) {
    let gross = 0;
    let puttsTotal = 0;
    let stabBrut = 0;
    let stabNet = 0;
    holes.forEach((h) => {
      const score = (scores[h.number] || [])[playerIndex];
      const putt = (putts[h.number] || [])[playerIndex];
      if (typeof score === "number") gross += score;
      if (typeof putt === "number") puttsTotal += putt;
      const gb = grossStableford(h, score);
      if (gb != null) stabBrut += gb;
      const nb = netStableford(h, score, player.index);
      if (nb != null) stabNet += nb;
    });
    return { gross, puttsTotal, stabBrut, stabNet };
  }

  function renderTable() {
    tableEl.innerHTML = "";
    const thead = document.createElement("thead");

    const row1 = document.createElement("tr");
    ["Trou", "Par", "Hcp"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      th.rowSpan = 2;
      row1.appendChild(th);
    });
    players.forEach((player) => {
      const th = document.createElement("th");
      th.colSpan = 4;
      th.className = "player-group-name";
      th.textContent = player.name;
      row1.appendChild(th);
    });
    thead.appendChild(row1);

    const row2 = document.createElement("tr");
    players.forEach(() => {
      ["Brut", "Putts", "Stab.B", "Stab.N"].forEach((label) => {
        const th = document.createElement("th");
        th.className = "player-sub-col";
        th.textContent = label;
        row2.appendChild(th);
      });
    });
    thead.appendChild(row2);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    holes.forEach((h) => {
      const row = document.createElement("tr");
      const numTd = document.createElement("td");
      numTd.textContent = h.number;
      row.appendChild(numTd);

      row.appendChild(
        numberInputCell(h.par, (v) => {
          h.par = v;
          renderTotals();
          scheduleSave();
        })
      );
      row.appendChild(
        numberInputCell(h.handicap, (v) => {
          h.handicap = v;
          renderTotals();
          scheduleSave();
        })
      );

      players.forEach((player, i) => {
        const score = (scores[h.number] || [])[i];
        const putt = (putts[h.number] || [])[i];

        row.appendChild(
          numberInputCell(score, (v) => {
            if (!scores[h.number]) scores[h.number] = [];
            scores[h.number][i] = v;
            renderTotals();
            scheduleSave();
          })
        );
        row.appendChild(
          numberInputCell(putt, (v) => {
            if (!putts[h.number]) putts[h.number] = [];
            putts[h.number][i] = v;
            renderTotals();
            scheduleSave();
          })
        );
        row.appendChild(readonlyCell(grossStableford(h, score), `stab-brut-${h.number}-${i}`));
        row.appendChild(readonlyCell(netStableford(h, score, player.index), `stab-net-${h.number}-${i}`));
      });
      tbody.appendChild(row);
    });
    tableEl.appendChild(tbody);

    const tfoot = document.createElement("tfoot");
    const totalRow = document.createElement("tr");
    const totalLabel = document.createElement("td");
    totalLabel.colSpan = 3;
    totalLabel.textContent = "Total";
    totalRow.appendChild(totalLabel);
    players.forEach((player, i) => {
      const t = totalsFor(i, player);
      totalRow.appendChild(totalCell(t.gross, `total-gross-${i}`));
      totalRow.appendChild(totalCell(t.puttsTotal, `total-putts-${i}`));
      totalRow.appendChild(totalCell(t.stabBrut, `total-stabbrut-${i}`));
      totalRow.appendChild(totalCell(t.stabNet, `total-stabnet-${i}`));
    });
    tfoot.appendChild(totalRow);
    tableEl.appendChild(tfoot);
  }

  function renderTotals() {
    // Recalcule uniquement les cellules Stableford (dépendantes) et les totaux, sans
    // reconstruire toute la table (évite de perdre le focus pendant la saisie).
    holes.forEach((h) => {
      players.forEach((player, i) => {
        const score = (scores[h.number] || [])[i];
        const brutCell = tableEl.querySelector(`[data-cell="stab-brut-${h.number}-${i}"]`);
        if (brutCell) brutCell.textContent = fmt(grossStableford(h, score));
        const netCell = tableEl.querySelector(`[data-cell="stab-net-${h.number}-${i}"]`);
        if (netCell) netCell.textContent = fmt(netStableford(h, score, player.index));
      });
    });
    players.forEach((player, i) => {
      const t = totalsFor(i, player);
      setTotalCell(`total-gross-${i}`, t.gross);
      setTotalCell(`total-putts-${i}`, t.puttsTotal);
      setTotalCell(`total-stabbrut-${i}`, t.stabBrut);
      setTotalCell(`total-stabnet-${i}`, t.stabNet);
    });
  }

  function setTotalCell(key, value) {
    const cell = tableEl.querySelector(`[data-cell="${key}"]`);
    if (cell) cell.textContent = value || "";
  }

  function fmt(v) {
    return v == null ? "–" : String(v);
  }

  function numberInputCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.className = "score-input";
    input.value = value == null ? "" : value;
    input.addEventListener("input", () => {
      const v = input.value === "" ? null : parseInt(input.value, 10);
      onChange(v);
    });
    td.appendChild(input);
    return td;
  }

  function readonlyCell(value, key) {
    const td = document.createElement("td");
    td.className = "stableford-cell";
    td.dataset.cell = key;
    td.textContent = fmt(value);
    return td;
  }

  function totalCell(value, key) {
    const td = document.createElement("td");
    td.className = "total-cell";
    td.dataset.cell = key;
    td.textContent = value || "";
    return td;
  }

  function boot() {
    if (golf) {
      golfNameEl.textContent = golf.name;
      golfLocationEl.textContent = [golf.city, golf.region, golf.country].filter(Boolean).join(", ");
      notFoundEl.hidden = true;
      appEl.hidden = false;
      slopeInput.value = slope == null ? "" : slope;
      renderPlayers();
      renderTable();
      shareBtn.disabled = !roundId;
      deleteBtn.disabled = !roundId;
      if (!supabase) setStatus("Non sauvegardé (backend non configuré)");
    } else {
      notFoundEl.hidden = false;
      appEl.hidden = true;
    }
  }

  slopeInput.addEventListener("input", () => {
    slope = slopeInput.value === "" ? null : parseInt(slopeInput.value, 10);
    renderTotals();
    scheduleSave();
  });

  addPlayerBtn.addEventListener("click", () => {
    if (players.length >= MAX_PLAYERS) return;
    players.push({ name: `Joueur ${players.length + 1}`, index: null });
    renderPlayers();
    renderTable();
    scheduleSave();
  });

  shareBtn.addEventListener("click", async () => {
    if (!roundId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("golf");
    url.searchParams.set("id", roundId);
    try {
      await navigator.clipboard.writeText(url.toString());
      shareBtn.textContent = "Lien copié !";
    } catch (e) {
      window.prompt("Copie ce lien :", url.toString());
    }
    setTimeout(() => {
      shareBtn.textContent = "Copier le lien à partager";
    }, 1600);
  });

  deleteBtn.addEventListener("click", async () => {
    if (!roundId) return;
    const ok = window.confirm(
      `Supprimer définitivement la carte de score de ${golf.name} ? Cette action est irréversible.`
    );
    if (!ok) return;
    if (supabase) {
      const { error } = await supabase.from("rounds").delete().eq("id", roundId);
      if (error) {
        console.error("Supabase delete failed:", error);
        setStatus("Erreur lors de la suppression");
        return;
      }
    }
    resetToBlankRound();
    const url = new URL(window.location.href);
    url.searchParams.delete("id");
    url.searchParams.set("golf", golf.id);
    window.history.replaceState({}, "", url);
    setStatus("");
    boot();
  });

  function applyRoundData(data) {
    golf = golfIndex.get(data.golf_id) || null;
    holes = Array.isArray(data.holes) && data.holes.length ? data.holes : buildDefaultHoles(18, data.golf_id);
    players = (data.players || []).map((p, i) =>
      typeof p === "string" ? { name: p, index: null } : { name: p.name || `Joueur ${i + 1}`, index: p.index ?? null }
    ).slice(0, MAX_PLAYERS);
    if (players.length === 0) players = [{ name: "Joueur 1", index: null }];
    scores = data.scores || {};
    putts = data.putts || {};
    slope = data.slope != null ? data.slope : (golf ? golf.slope : null);
  }

  function resetToBlankRound() {
    roundId = null;
    players = [{ name: "Joueur 1", index: null }];
    scores = {};
    putts = {};
    slope = golf ? golf.slope : null;
    if (golf) {
      const count = golf.holes === 9 ? 9 : 18;
      holes = buildDefaultHoles(count, golf.id);
    }
  }

  async function init() {
    loadRoster();
    if (roundId && supabase) {
      const { data, error } = await supabase.from("rounds").select("*").eq("id", roundId).maybeSingle();
      if (!error && data) {
        applyRoundData(data);
      } else {
        roundId = null;
      }
    }

    if (!golf) {
      const golfId = params.get("golf");
      golf = golfId ? golfIndex.get(golfId) : null;

      // Une seule carte de référence par golf : si une carte existe déjà pour ce golf,
      // on la recharge au lieu d'en proposer une neuve.
      if (golf && supabase) {
        const { data } = await supabase.from("rounds").select("*").eq("golf_id", golf.id).maybeSingle();
        if (data) {
          roundId = data.id;
          applyRoundData(data);
          setRoundIdInUrl(roundId);
        }
      }

      if (golf && !roundId) {
        const count = golf.holes === 9 ? 9 : 18;
        holes = buildDefaultHoles(count, golf.id);
        slope = golf.slope != null ? golf.slope : null;
      }
    }

    boot();
  }

  init();
})();
