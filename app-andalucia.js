(function () {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-btn");
  const resultsEl = document.getElementById("results");
  const emptyStateEl = document.getElementById("empty-state");
  const countEl = document.getElementById("result-count");
  const chipsEl = document.getElementById("province-chips");
  const dbCountEl = document.getElementById("db-count");
  const verifiedCountEl = document.getElementById("verified-count");

  const PROVINCE_CAPITALS = [
    { name: "Séville", lat: 37.3891, lon: -5.9845 },
    { name: "Málaga", lat: 36.7213, lon: -4.4214 },
    { name: "Cadix", lat: 36.5297, lon: -6.2925 },
    { name: "Grenade", lat: 37.1773, lon: -3.5986 },
    { name: "Cordoue", lat: 37.8882, lon: -4.7794 },
    { name: "Huelva", lat: 37.2614, lon: -6.9447 },
    { name: "Jaén", lat: 37.7796, lon: -3.7849 },
    { name: "Almería", lat: 36.834, lon: -2.4637 }
  ];

  function nearestProvince(lat, lon) {
    if (lat == null || lon == null) return null;
    let best = null;
    let bestD = Infinity;
    PROVINCE_CAPITALS.forEach((c) => {
      const dx = lat - c.lat;
      const dy = lon - c.lon;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c.name;
      }
    });
    return best;
  }

  function inMarbellaZone(lat, lon) {
    return lat >= 36.38 && lat <= 36.62 && lon >= -5.15 && lon <= -4.75;
  }

  const ANDALUSIA = GOLF_DATA.filter((g) => g.region === "Andalousie").map((g, i) => {
    const province = nearestProvince(g.lat, g.lon);
    const zoneTags = [];
    if (g.lat != null && inMarbellaZone(g.lat, g.lon)) zoneTags.push("costa del sol", "marbella");
    return Object.assign({}, g, { province, zoneTags });
  });

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
    const fields = [golf.name, golf.city, golf.province, ...golf.zoneTags];
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
    const parts = [golf.name, golf.city, "Andalucía", "green fee tarif"].filter(Boolean);
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
    card.id = `card-${golf.id}`;

    const badge = document.createElement("span");
    badge.className = golf.verified ? "badge badge-verified" : "badge badge-unverified";
    badge.textContent = golf.verified ? "Tarifs vérifiés" : "Infos non vérifiées";

    const title = document.createElement("h2");
    title.className = "card-title";
    title.textContent = golf.name;

    const location = document.createElement("p");
    location.className = "card-location";
    location.textContent = [golf.city, golf.province ? `province de ${golf.province}` : null]
      .filter(Boolean)
      .join(", ");

    const statRow = document.createElement("div");
    statRow.className = "stat-row";
    const feeText = formatGreenFee(golf.greenFee);
    [
      statBlock("Green fee", feeText || "Non renseigné"),
      statBlock("Slope", golf.slope != null ? String(golf.slope) : "Non renseigné")
    ]
      .concat(
        golf.holes
          ? [statBlock("Parcours", `${golf.holes} trous${golf.par ? ` · par ${golf.par}` : ""}`)]
          : []
      )
      .forEach((s) => s && statRow.appendChild(s));

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

    if (window.GolfSelection) {
      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "select-toggle";
      selectBtn.dataset.golfId = golf.id;
      selectBtn.textContent = window.GolfSelection.isSelected(golf.id)
        ? "✓ Dans ma sélection"
        : "+ Ajouter à ma sélection";
      selectBtn.addEventListener("click", () => {
        if (window.GolfSelection.isSelected(golf.id)) {
          window.GolfSelection.removeGolf(golf.id);
        } else {
          window.GolfSelection.addGolf(golf.id);
        }
      });
      card.appendChild(selectBtn);
    }

    card.addEventListener("mouseenter", () => setActiveDot(golf.id));
    card.addEventListener("mouseleave", () => setActiveDot(null));

    return card;
  }

  function renderChips() {
    const provinces = [...new Set(ANDALUSIA.map((g) => g.province).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "fr")
    );
    chipsEl.innerHTML = "";
    ["Costa del Sol"].concat(provinces).forEach((label) => {
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

  const map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
  }).addTo(map);

  const rootStyles = getComputedStyle(document.documentElement);
  const COLOR_VERIFIED = rootStyles.getPropertyValue("--accent").trim() || "#2f6b46";
  const COLOR_UNVERIFIED = rootStyles.getPropertyValue("--sand").trim() || "#96723d";

  const markers = new Map();
  const allLatLngs = [];

  ANDALUSIA.forEach((golf) => {
    if (golf.lat == null || golf.lon == null) return;
    allLatLngs.push([golf.lat, golf.lon]);
    const marker = L.circleMarker([golf.lat, golf.lon], {
      radius: 7,
      weight: 1.5,
      color: "#fff",
      fillColor: golf.verified ? COLOR_VERIFIED : COLOR_UNVERIFIED,
      fillOpacity: 0.9,
      opacity: 1
    });
    const fee = formatGreenFee(golf.greenFee);
    marker.bindTooltip(
      `<strong>${golf.name}</strong>${fee ? ` · ${fee}` : ""}${golf.slope != null ? ` · slope ${golf.slope}` : ""}`
    );
    marker.on("click", () => {
      const card = document.getElementById(`card-${golf.id}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("is-highlighted");
        setTimeout(() => card.classList.remove("is-highlighted"), 1500);
      }
    });
    marker.addTo(map);
    markers.set(golf.id, marker);
  });

  const FULL_BOUNDS = L.latLngBounds(allLatLngs);
  map.fitBounds(FULL_BOUNDS, { padding: [30, 30] });

  function setActiveDot(id) {
    markers.forEach((marker, markerId) => {
      marker.setStyle({ weight: markerId === id ? 3 : 1.5 });
    });
  }

  function updateMarkers(visibleIds) {
    markers.forEach((marker, id) => {
      const visible = visibleIds.has(id);
      marker.setStyle({ opacity: visible ? 1 : 0.15, fillOpacity: visible ? 0.9 : 0.1 });
    });
  }

  function zoomToSelection(filtered) {
    const coords = filtered.filter((g) => g.lat != null && g.lon != null).map((g) => [g.lat, g.lon]);
    const bounds = coords.length ? L.latLngBounds(coords) : FULL_BOUNDS;
    map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 14, duration: 0.6 });
  }

  function render() {
    const rawQuery = input.value.trim();
    const query = normalize(rawQuery);
    clearBtn.hidden = query.length === 0;

    const filtered = ANDALUSIA.filter((g) => matches(g, query));
    const visibleIds = new Set(filtered.map((g) => g.id));

    updateMarkers(visibleIds);
    zoomToSelection(query ? filtered : ANDALUSIA);

    resultsEl.innerHTML = "";
    filtered.forEach((g) => resultsEl.appendChild(cardTemplate(g)));

    emptyStateEl.hidden = filtered.length !== 0;
    resultsEl.hidden = filtered.length === 0;

    countEl.textContent = query
      ? `${filtered.length} golf(s) trouvé(s) pour "${rawQuery}".`
      : `${filtered.length} golfs en Andalousie.`;
  }

  clearBtn.addEventListener("click", () => {
    input.value = "";
    render();
    input.focus();
  });

  input.addEventListener("input", render);
  document.addEventListener("golf-selection:change", render);

  dbCountEl.textContent = String(ANDALUSIA.length);
  verifiedCountEl.textContent = String(ANDALUSIA.filter((g) => g.verified).length);
  renderChips();
  render();
})();
