// "Ma sélection" (programme de la semaine) — jusqu'à 10 golfs, partagée via un lien
// (?plan=<uuid>) et stockée dans Supabase pour survivre au changement d'appareil ou
// être partagée entre plusieurs personnes. Sans configuration Supabase (constantes
// ci-dessous laissées à leur valeur par défaut), la sélection fonctionne quand même en
// mémoire pour la session en cours, mais n'est pas sauvegardée.
//
// Pour activer la persistance : créer un projet sur https://supabase.com, exécuter le
// SQL fourni (table `weekly_plans` + policies), puis remplacer SUPABASE_URL et
// SUPABASE_ANON_KEY ci-dessous par les valeurs de Settings → API de ce projet.
(function () {
  const SUPABASE_URL = "YOUR_SUPABASE_URL";
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
  const MAX_SELECTION = 10;
  const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const LAST_PLAN_KEY = "golf-finder:last-plan";

  const configured =
    /^https:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";

  const supabase =
    configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  const panel = document.getElementById("selection-panel");
  if (!panel) return; // page without the selection feature

  const listEl = document.getElementById("selection-list");
  const countEl = document.getElementById("selection-count");
  const emptyEl = document.getElementById("selection-empty");
  const shareBtn = document.getElementById("selection-share");
  const warningEl = document.getElementById("selection-warning");

  let planId = null;
  let items = []; // [{ id, day }]
  let golfIndex = null;

  function index() {
    if (!golfIndex) {
      golfIndex = new Map();
      (typeof GOLF_DATA !== "undefined" ? GOLF_DATA : []).forEach((g) => golfIndex.set(g.id, g));
    }
    return golfIndex;
  }

  function isSelected(id) {
    return items.some((it) => it.id === id);
  }

  function notifyChange() {
    document.dispatchEvent(new CustomEvent("golf-selection:change"));
  }

  function setPlanIdInUrl(id) {
    const url = new URL(window.location.href);
    url.searchParams.set("plan", id);
    window.history.replaceState({}, "", url);
  }

  async function persist() {
    if (!supabase) return;
    if (!planId) {
      const { data, error } = await supabase.from("weekly_plans").insert({ golf_ids: items }).select("id").single();
      if (error) {
        console.error("Supabase insert failed:", error);
        return;
      }
      planId = data.id;
      localStorage.setItem(LAST_PLAN_KEY, planId);
      setPlanIdInUrl(planId);
    } else {
      const { error } = await supabase
        .from("weekly_plans")
        .update({ golf_ids: items, updated_at: new Date().toISOString() })
        .eq("id", planId);
      if (error) console.error("Supabase update failed:", error);
    }
  }

  async function addGolf(id) {
    if (isSelected(id) || items.length >= MAX_SELECTION) return;
    items.push({ id, day: null });
    render();
    await persist();
  }

  async function removeGolf(id) {
    items = items.filter((it) => it.id !== id);
    render();
    await persist();
  }

  async function setDay(id, day) {
    const it = items.find((it2) => it2.id === id);
    if (it) it.day = day || null;
    await persist();
  }

  function render() {
    countEl.textContent = `${items.length}/${MAX_SELECTION}`;
    listEl.innerHTML = "";
    emptyEl.hidden = items.length !== 0;
    shareBtn.disabled = !planId;

    items.forEach((it) => {
      const golf = index().get(it.id);
      const row = document.createElement("li");
      row.className = "selection-row";

      const name = document.createElement("span");
      name.className = "selection-name";
      name.textContent = golf ? golf.name : it.id;

      const daySelect = document.createElement("select");
      daySelect.className = "selection-day";
      daySelect.setAttribute("aria-label", `Jour pour ${golf ? golf.name : "ce golf"}`);
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "Jour ?";
      daySelect.appendChild(noneOpt);
      DAYS.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = d;
        if (it.day === d) opt.selected = true;
        daySelect.appendChild(opt);
      });
      daySelect.addEventListener("change", () => setDay(it.id, daySelect.value));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "selection-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Retirer ${golf ? golf.name : "ce golf"}`);
      removeBtn.addEventListener("click", () => removeGolf(it.id));

      row.append(name, daySelect, removeBtn);
      listEl.appendChild(row);
    });

    document.querySelectorAll(".select-toggle").forEach((btn) => {
      const selected = isSelected(btn.dataset.golfId);
      btn.textContent = selected ? "✓ Dans ma sélection" : "+ Ajouter à ma sélection";
      btn.classList.toggle("is-selected", selected);
      btn.disabled = !selected && items.length >= MAX_SELECTION;
    });

    notifyChange();
  }

  async function loadPlan() {
    if (!supabase) {
      warningEl.hidden = false;
      warningEl.textContent = configured
        ? "Bibliothèque Supabase indisponible — la sélection ne sera pas sauvegardée cette fois-ci."
        : "Sélection partagée pas encore configurée (backend Supabase manquant) — fonctionne pour cette visite mais ne sera pas sauvegardée.";
      render();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    planId = params.get("plan") || localStorage.getItem(LAST_PLAN_KEY);
    if (!planId) {
      render();
      return;
    }
    const { data, error } = await supabase.from("weekly_plans").select("id, golf_ids").eq("id", planId).maybeSingle();
    if (error || !data) {
      planId = null;
      localStorage.removeItem(LAST_PLAN_KEY);
      render();
      return;
    }
    planId = data.id;
    items = Array.isArray(data.golf_ids) ? data.golf_ids : [];
    localStorage.setItem(LAST_PLAN_KEY, planId);
    setPlanIdInUrl(planId);
    render();
  }

  shareBtn.addEventListener("click", async () => {
    if (!planId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("plan", planId);
    const text = url.toString();
    try {
      await navigator.clipboard.writeText(text);
      shareBtn.textContent = "Lien copié !";
    } catch (e) {
      window.prompt("Copie ce lien :", text);
    }
    setTimeout(() => {
      shareBtn.textContent = "Copier le lien à partager";
    }, 1600);
  });

  window.GolfSelection = { addGolf, removeGolf, isSelected };
  loadPlan();
})();
