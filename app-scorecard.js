// Carte de score : 1 à 6 joueurs, par/handicap pré-remplis depuis OpenStreetMap quand
// connus (HOLES_DATA, voir data/holes.js), toujours éditables. Persistée dans Supabase
// (table `rounds`) avec un lien partageable (?id=<uuid>), même mécanique que
// selection.js.
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
  const statusEl = document.getElementById("save-status");

  const golfIndex = new Map((typeof GOLF_DATA !== "undefined" ? GOLF_DATA : []).map((g) => [g.id, g]));

  const params = new URLSearchParams(window.location.search);
  let roundId = params.get("id");
  let golf = null;
  let players = ["Joueur 1"];
  let holes = [];
  let scores = {}; // { "<hole number>": [score, score, ...] }
  let saveTimer = null;

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

  async function save() {
    if (!supabase) {
      setStatus("Non sauvegardé (backend non configuré)");
      return;
    }
    const payload = { golf_id: golf.id, holes, players: players.map((name) => ({ name })), scores };
    if (!roundId) {
      const { data, error } = await supabase.from("rounds").insert(payload).select("id").single();
      if (error) {
        console.error("Supabase insert failed:", error);
        setStatus("Erreur de sauvegarde");
        return;
      }
      roundId = data.id;
      const url = new URL(window.location.href);
      url.searchParams.delete("golf");
      url.searchParams.set("id", roundId);
      window.history.replaceState({}, "", url);
      shareBtn.disabled = false;
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
    players.forEach((name, i) => {
      const row = document.createElement("li");
      row.className = "selection-row";
      const input = document.createElement("input");
      input.type = "text";
      input.value = name;
      input.placeholder = `Joueur ${i + 1}`;
      input.className = "selection-day";
      input.style.flex = "1 1 auto";
      input.addEventListener("input", () => {
        players[i] = input.value || `Joueur ${i + 1}`;
        renderTableHeaderNamesOnly();
        scheduleSave();
      });
      row.appendChild(input);
      if (players.length > 1) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "selection-remove";
        removeBtn.textContent = "×";
        removeBtn.setAttribute("aria-label", `Retirer ${name}`);
        removeBtn.addEventListener("click", () => {
          players.splice(i, 1);
          Object.keys(scores).forEach((hole) => {
            if (scores[hole]) scores[hole].splice(i, 1);
          });
          renderPlayers();
          renderTable();
          scheduleSave();
        });
        row.appendChild(removeBtn);
      }
      playerListEl.appendChild(row);
    });
  }

  function renderTableHeaderNamesOnly() {
    tableEl.querySelectorAll("thead th.player-col").forEach((th, i) => {
      th.textContent = players[i] || `Joueur ${i + 1}`;
    });
  }

  function totalFor(playerIndex) {
    let total = 0;
    holes.forEach((h) => {
      const v = (scores[h.number] || [])[playerIndex];
      if (typeof v === "number") total += v;
    });
    return total;
  }

  function renderTable() {
    tableEl.innerHTML = "";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Trou", "Par", "Hcp"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    players.forEach((name, i) => {
      const th = document.createElement("th");
      th.className = "player-col";
      th.textContent = name;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    holes.forEach((h) => {
      const row = document.createElement("tr");
      const numTd = document.createElement("td");
      numTd.textContent = h.number;
      row.appendChild(numTd);

      row.appendChild(numberInputCell(h.par, (v) => { h.par = v; scheduleSave(); }));
      row.appendChild(numberInputCell(h.handicap, (v) => { h.handicap = v; scheduleSave(); }));

      players.forEach((_, i) => {
        const current = (scores[h.number] || [])[i];
        row.appendChild(
          numberInputCell(current, (v) => {
            if (!scores[h.number]) scores[h.number] = [];
            scores[h.number][i] = v;
            renderTotals();
            scheduleSave();
          })
        );
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
    players.forEach((_, i) => {
      const td = document.createElement("td");
      td.className = `total-cell total-${i}`;
      td.textContent = totalFor(i) || "";
      totalRow.appendChild(td);
    });
    tfoot.appendChild(totalRow);
    tableEl.appendChild(tfoot);
  }

  function renderTotals() {
    players.forEach((_, i) => {
      const cell = tableEl.querySelector(`.total-${i}`);
      if (cell) cell.textContent = totalFor(i) || "";
    });
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

  function boot() {
    if (golf) {
      golfNameEl.textContent = golf.name;
      golfLocationEl.textContent = [golf.city, golf.region, golf.country].filter(Boolean).join(", ");
      notFoundEl.hidden = true;
      appEl.hidden = false;
      renderPlayers();
      renderTable();
      shareBtn.disabled = !roundId;
      if (!supabase) setStatus("Non sauvegardé (backend non configuré)");
    } else {
      notFoundEl.hidden = false;
      appEl.hidden = true;
    }
  }

  addPlayerBtn.addEventListener("click", () => {
    if (players.length >= MAX_PLAYERS) return;
    players.push(`Joueur ${players.length + 1}`);
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

  async function init() {
    if (roundId && supabase) {
      const { data, error } = await supabase.from("rounds").select("*").eq("id", roundId).maybeSingle();
      if (!error && data) {
        golf = golfIndex.get(data.golf_id) || null;
        holes = Array.isArray(data.holes) && data.holes.length ? data.holes : buildDefaultHoles(18, data.golf_id);
        players = (data.players || []).map((p) => p.name).slice(0, MAX_PLAYERS);
        if (players.length === 0) players = ["Joueur 1"];
        scores = data.scores || {};
      } else {
        roundId = null;
      }
    }

    if (!golf) {
      const golfId = params.get("golf");
      golf = golfId ? golfIndex.get(golfId) : null;
      if (golf) {
        const count = golf.holes === 9 ? 9 : 18;
        holes = buildDefaultHoles(count, golf.id);
      }
    }

    boot();
  }

  init();
})();
