(function () {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-btn");
  const resultsEl = document.getElementById("results");
  const emptyStateEl = document.getElementById("empty-state");
  const promptStateEl = document.getElementById("prompt-state");
  const countEl = document.getElementById("result-count");
  const chipsEl = document.getElementById("region-chips");
  const dbCountEl = document.getElementById("db-count");
  const verifiedCountEl = document.getElementById("verified-count");

  const MAX_RENDERED = 150;
  const DEFAULT_CENTER = [44, -1];
  const DEFAULT_ZOOM = 5;

  // Same alt-spelling map as the Fairway Finder list app (app.js), so a search
  // works regardless of which language the user types the region in.
  const REGION_ALIASES = {
    "Île-de-France": ["ile de france", "idf"],
    "Auvergne-Rhône-Alpes": ["auvergne", "rhone alpes", "ara"],
    "Bourgogne-Franche-Comté": ["bourgogne", "franche comte", "bfc"],
    "Bretagne": ["brittany"],
    "Centre-Val de Loire": ["centre val de loire", "val de loire"],
    "Corse": ["corsica"],
    "Grand Est": ["alsace", "lorraine", "champagne"],
    "Hauts-de-France": ["nord pas de calais", "picardie", "hdf"],
    "Normandie": ["normandy"],
    "Nouvelle-Aquitaine": ["aquitaine", "landes", "poitou charentes", "limousin"],
    "Occitanie": ["languedoc", "midi pyrenees", "toulouse"],
    "Pays de la Loire": ["loire atlantique", "vendee", "nantes"],
    "Provence-Alpes-Côte d'Azur": ["paca", "provence", "cote d azur", "var", "alpes maritimes"],
    "Andalousie": ["andalucia", "andalusia", "costa del sol"],
    "Aragon": ["aragon"],
    "Asturies": ["asturias"],
    "Canaries": ["canarias", "canary islands", "tenerife", "gran canaria"],
    "Cantabrie": ["cantabria"],
    "Castille-La Manche": ["castilla la mancha"],
    "Castille-et-León": ["castilla y leon"],
    "Catalogne": ["catalunya", "cataluna", "catalonia", "costa brava", "barcelone", "barcelona", "girona", "gerona"],
    "Estrémadure": ["extremadura"],
    "Galice": ["galicia"],
    "Îles Baléares": ["islas baleares", "baleares", "mallorca", "majorque", "ibiza", "menorca"],
    "La Rioja": ["rioja"],
    "Communauté de Madrid": ["comunidad de madrid", "madrid"],
    "Murcie": ["murcia", "region de murcia"],
    "Navarre": ["navarra"],
    "Pays basque": ["euskadi", "pais vasco", "basque country", "bilbao", "san sebastian"],
    "Communauté valencienne": ["comunidad valenciana", "valencia", "alicante", "costa blanca"]
  };

  const GOLFS = GOLF_DATA.map((g, i) => Object.assign({}, g, { _id: `g${i}` }));

  function normalize(str) {
    return (str || "")
      .toString()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’]/g, " ")
      .toLowerCase()
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] =
          a[i - 1] === b[j - 1]
            ? prev[j - 1]
            : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[n];
  }

  function fuzzyThreshold(len) {
    if (len <= 4) return 0;
    if (len <= 7) return 1;
    return 2;
  }

  function matches(golf, query) {
    if (!query) return true;
    const fields = [
      golf.region,
      golf.country,
      golf.city,
      golf.name,
      ...(REGION_ALIASES[golf.region] || [])
    ];
    const normFields = fields.map(normalize);
    if (normFields.some((f) => f.includes(query))) return true;

    // Fuzzy fallback: tolerate small typos (1-2 letters) word by word, so a
    // misspelled search ("Valderama" for "Valderrama") still finds a match.
    const queryWords = query.split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return false;
    const haystackWords = normFields.flatMap((f) => f.split(/[^a-z0-9]+/).filter(Boolean));
    return queryWords.every((qw) =>
      haystackWords.some((hw) => {
        if (hw.includes(qw)) return true;
        const threshold = fuzzyThreshold(qw.length);
        return threshold > 0 && Math.abs(hw.length - qw.length) <= threshold && levenshtein(hw, qw) <= threshold;
      })
    );
  }

  function formatGreenFee(fee) {
    if (!fee || fee.low == null || fee.high == null) return null;
    const symbol = fee.currency === "EUR" ? "€" : fee.currency;
    if (fee.low === fee.high) return `${fee.low} ${symbol}`;
    return `${fee.low}–${fee.high} ${symbol}`;
  }

  function searchFallbackUrl(golf) {
    const parts = [golf.name, golf.city, golf.region, "green fee tarif"].filter(Boolean);
    return `https://www.google.com/search?q=${encodeURIComponent(parts.join(" "))}`;
  }

  function statBlock(label, value) {
    if (value == null) return "";
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `${label}<strong></strong>`;
    div.querySelector("strong").textContent = value;
    return div;
  }

  function cardTemplate(golf) {
    const card = document.createElement("article");
    card.className = "card";
    card.id = `card-${golf._id}`;

    const badge = document.createElement("span");
    badge.className = golf.verified ? "badge badge-verified" : "badge badge-unverified";
    badge.textContent = golf.verified ? "Tarifs vérifiés" : "Infos non vérifiées";

    const title = document.createElement("h2");
    title.className = "card-title";
    title.textContent = golf.name;

    const location = document.createElement("p");
    location.className = "card-location";
    location.textContent = [golf.city, golf.region, golf.country].filter(Boolean).join(", ");

    const statRow = document.createElement("div");
    statRow.className = "stat-row";
    const feeText = formatGreenFee(golf.greenFee);
    const stats = [
      statBlock("Green fee", feeText || "Non renseigné"),
      statBlock("Slope", golf.slope != null ? String(golf.slope) : "Non renseigné")
    ];
    if (golf.holes) {
      const parText = golf.par ? ` · par ${golf.par}` : "";
      stats.push(statBlock("Parcours", `${golf.holes} trous${parText}`));
    }
    stats.forEach((s) => s && statRow.appendChild(s));

    card.append(badge, title, location, statRow);

    if (golf.note) {
      const note = document.createElement("p");
      note.className = "card-note";
      note.textContent = golf.note;
      card.appendChild(note);
    }

    const link = document.createElement("a");
    link.className = "card-link";
    if (golf.website) {
      link.href = golf.website;
      link.textContent = "Voir le site du golf →";
    } else {
      link.href = searchFallbackUrl(golf);
      link.textContent = "Chercher les tarifs en ligne →";
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.appendChild(link);

    card.addEventListener("mouseenter", () => setActiveMarker(golf._id));
    card.addEventListener("mouseleave", () => setActiveMarker(null));

    return card;
  }

  function renderChips() {
    const regions = [...new Set(GOLFS.map((g) => g.region).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "fr")
    );
    chipsEl.innerHTML = "";
    ["France", "Espagne"].concat(regions).forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        input.value = label;
        render();
        input.focus();
      });
      chipsEl.appendChild(btn);
    });
  }

  // --- Map -------------------------------------------------------------

  const map = L.map("map").setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
  }).addTo(map);

  const rootStyles = getComputedStyle(document.documentElement);
  const COLOR_VERIFIED = rootStyles.getPropertyValue("--accent").trim() || "#2f6b46";
  const COLOR_UNVERIFIED = rootStyles.getPropertyValue("--sand").trim() || "#96723d";

  const markers = new Map();

  GOLFS.forEach((golf) => {
    if (golf.lat == null || golf.lon == null) return;
    const marker = L.circleMarker([golf.lat, golf.lon], {
      radius: 5,
      weight: 1.2,
      color: "#fff",
      fillColor: golf.verified ? COLOR_VERIFIED : COLOR_UNVERIFIED,
      fillOpacity: 0.85,
      opacity: 1
    });
    const fee = formatGreenFee(golf.greenFee);
    marker.bindTooltip(
      `<strong>${golf.name}</strong>${fee ? ` · ${fee}` : ""}${golf.slope != null ? ` · slope ${golf.slope}` : ""}`
    );
    marker.on("click", () => {
      const card = document.getElementById(`card-${golf._id}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("is-highlighted");
        setTimeout(() => card.classList.remove("is-highlighted"), 1500);
      } else {
        // Not in the currently-rendered (capped) list: search for it by name
        // so its card appears, then scroll to it.
        input.value = golf.name;
        render();
        requestAnimationFrame(() => {
          const c = document.getElementById(`card-${golf._id}`);
          if (c) {
            c.scrollIntoView({ behavior: "smooth", block: "center" });
            c.classList.add("is-highlighted");
            setTimeout(() => c.classList.remove("is-highlighted"), 1500);
          }
        });
      }
    });
    marker.addTo(map);
    markers.set(golf._id, marker);
  });

  function setActiveMarker(id) {
    markers.forEach((marker, markerId) => {
      marker.setStyle({ weight: markerId === id ? 3 : 1.2 });
    });
  }

  function updateMarkers(visibleIds) {
    markers.forEach((marker, id) => {
      const visible = visibleIds.has(id);
      marker.setStyle({ opacity: visible ? 1 : 0.15, fillOpacity: visible ? 0.85 : 0.08 });
    });
  }

  function zoomToSelection(filtered) {
    if (!filtered) {
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.6 });
      return;
    }
    const coords = filtered.filter((g) => g.lat != null && g.lon != null).map((g) => [g.lat, g.lon]);
    if (coords.length === 0) return;
    map.flyToBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 14, duration: 0.6 });
  }

  // --- List / search -----------------------------------------------------

  function render() {
    const rawQuery = input.value.trim();
    const query = normalize(rawQuery);
    clearBtn.hidden = query.length === 0;

    const filtered = GOLFS.filter((g) => matches(g, query));
    const visibleIds = new Set(filtered.map((g) => g._id));
    updateMarkers(visibleIds);
    zoomToSelection(query ? filtered : null);

    if (!query) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      emptyStateEl.hidden = true;
      promptStateEl.hidden = false;
      countEl.textContent = `${GOLFS.length} golfs au total sur la carte.`;
      return;
    }
    promptStateEl.hidden = true;

    const toRender = filtered.slice(0, MAX_RENDERED);
    resultsEl.innerHTML = "";
    toRender.forEach((g) => resultsEl.appendChild(cardTemplate(g)));

    emptyStateEl.hidden = filtered.length !== 0;
    resultsEl.hidden = filtered.length === 0;

    if (filtered.length > MAX_RENDERED) {
      countEl.textContent = `${filtered.length} golf(s) trouvé(s) pour "${rawQuery}" — affichage des ${MAX_RENDERED} premiers dans la liste (tous sont visibles sur la carte).`;
    } else {
      countEl.textContent = `${filtered.length} golf(s) trouvé(s) pour "${rawQuery}".`;
    }
  }

  clearBtn.addEventListener("click", () => {
    input.value = "";
    render();
    input.focus();
  });

  input.addEventListener("input", render);

  dbCountEl.textContent = String(GOLFS.length);
  verifiedCountEl.textContent = String(GOLFS.filter((g) => g.verified).length);
  renderChips();
  render();
})();
