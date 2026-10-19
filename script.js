/* =========================================================
   CineClásico Go — script.js
   Consumo de OMDb API + personalización + GPS + notificaciones
   + telemetría (user_activity_logs) guardada en localStorage.
========================================================= */

const OMDB_BASE = "https://www.omdbapi.com/";

const MOCK_CINEMAS = [
  { name: "Filmoteca Central",        lat: 4.6097, lng: -74.0817, feature: "Función clásica: Casablanca, 8:00pm" },
  { name: "Autocine Retro Norte",     lat: 4.6970, lng: -74.0430, feature: "Doble función Film Noir" },
  { name: "Sala de Arte La Cinemateca", lat: 4.6280, lng: -74.0650, feature: "Ciclo de Cine Mudo" },
  { name: "Teatro Colón — Cine Foro", lat: 4.5981, lng: -74.0705, feature: "Retrospectiva Hitchcock" },
];


const Store = {
  getPrefs() {
    return JSON.parse(localStorage.getItem("user_preferences")) || {
      theme: "vintage", fontSize: "medium", layout: "grid",
      decades: [], genres: [], parentalAge: "0", subtitleLang: "es"
    };
  },
  savePrefs(prefs) { localStorage.setItem("user_preferences", JSON.stringify(prefs)); },

  getWatchlist() { return JSON.parse(localStorage.getItem("local_watchlist")) || []; },
  saveWatchlist(list) { localStorage.setItem("local_watchlist", JSON.stringify(list)); },

  getApiKey() { return localStorage.getItem("omdb_api_key") || ""; },
  saveApiKey(key) { localStorage.setItem("omdb_api_key", key); },

  getCache() { return JSON.parse(localStorage.getItem("omdb_cache")) || {}; },
  saveCache(cache) { localStorage.setItem("omdb_cache", JSON.stringify(cache)); },
};

function reportActivity(screen_name, action_type, detail = {}) {
  const entry = {
    user_id: "demo-user-local",
    timestamp: new Date().toISOString(),
    screen_name,
    action_type,               // SEARCH, VIEW_MOVIE, CHANGE_THEME, GPS_SCAN, ADD_WATCHLIST, NOTIFICATION...
    detail,
  };
  const logs = JSON.parse(localStorage.getItem("user_activity_logs")) || [];
  logs.unshift(entry);
  localStorage.setItem("user_activity_logs", JSON.stringify(logs.slice(0, 200)));
  renderActivityLog();

}

function renderActivityLog() {
  const logs = JSON.parse(localStorage.getItem("user_activity_logs")) || [];
  const tbody = document.querySelector("#logTable tbody");
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${l.screen_name}</td>
      <td>${l.action_type}</td>
      <td>${escapeHtml(JSON.stringify(l.detail))}</td>
    </tr>`).join("");
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function omdbSearch(query) {
  const key = Store.getApiKey();
  const url = `${OMDB_BASE}?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(query)}&type=movie`;
  const res = await fetch(url);
  return res.json();
}

async function omdbDetail(imdbID) {
  const cache = Store.getCache();
  if (cache[imdbID] && (Date.now() - cache[imdbID].cached_at) < 1000 * 60 * 60 * 24) {
    return cache[imdbID].json_data; // cache de 24h, como omdb_cache
  }
  const key = Store.getApiKey();
  const url = `${OMDB_BASE}?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbID)}&plot=full`;
  const res = await fetch(url);
  const data = await res.json();
  cache[imdbID] = { imdb_id: imdbID, json_data: data, cached_at: Date.now() };
  Store.saveCache(cache);
  return data;
}

async function handleSearch() {
  const q = document.getElementById("searchInput").value.trim();
  const status = document.getElementById("searchStatus");
  const grid = document.getElementById("results");
  if (!q) return;
  if (!Store.getApiKey()) { document.getElementById("apiKeyBanner").classList.remove("hidden"); return; }

  status.textContent = "Buscando…";
  grid.innerHTML = "";
  reportActivity("Buscador OMDb", "SEARCH", { query: q });

  try {
    const data = await omdbSearch(q);
    if (data.Response === "False") {
      status.textContent = data.Error || "Sin resultados.";
      return;
    }
    let items = data.Search;
    if (document.getElementById("onlyClassics").checked) {
      items = items.filter(m => parseInt(m.Year) < 1990);
    }
    status.textContent = `${items.length} resultado(s).`;
    grid.innerHTML = items.map(movieCardHtml).join("");
    attachCardEvents(grid);
  } catch (e) {
    status.textContent = "Error al conectar con OMDb. Revisa tu API key o tu conexión.";
  }
}

function movieCardHtml(m) {
  const poster = m.Poster && m.Poster !== "N/A" ? m.Poster : "";
  return `
    <div class="movie-card" data-id="${m.imdbID}">
      ${poster ? `<img src="${poster}" alt="${m.Title}">` : `<div style="aspect-ratio:2/3;background:var(--bg-2);"></div>`}
      <div class="info">
        <h4>${m.Title}</h4>
        <span>${m.Year}</span><br>
        <button class="fav-btn" data-id="${m.imdbID}" data-title="${m.Title}" data-year="${m.Year}" data-poster="${poster}">+ Watchlist</button>
      </div>
    </div>`;
}

function attachCardEvents(container) {
  container.querySelectorAll(".movie-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("fav-btn")) return;
      openDetail(card.dataset.id);
    });
  });
  container.querySelectorAll(".fav-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToWatchlist(btn.dataset.id, btn.dataset.title, btn.dataset.year, btn.dataset.poster);
    });
  });
}

async function openDetail(imdbID) {
  reportActivity("Detalle Película", "VIEW_MOVIE", { imdb_id: imdbID });
  const modal = document.getElementById("detailModal");
  const body = document.getElementById("detailBody");
  body.innerHTML = "Cargando…";
  modal.classList.remove("hidden");
  try {
    const m = await omdbDetail(imdbID);
    body.innerHTML = `
      ${m.Poster && m.Poster !== "N/A" ? `<img class="detail-poster" src="${m.Poster}" alt="${m.Title}">` : ""}
      <h3 class="detail-title">${m.Title} (${m.Year})</h3>
      <p class="detail-meta">${m.Genre || ""} · ${m.Runtime || ""} · Dir. ${m.Director || "—"}</p>
      <p>${m.Plot || "Sin sinopsis disponible."}</p>
      <p class="detail-meta">Reparto: ${m.Actors || "—"}</p>
      <p class="detail-meta">IMDb: ${m.imdbRating || "N/A"} · Rotten Tomatoes: ${(m.Ratings || []).find(r => r.Source === "Rotten Tomatoes")?.Value || "N/A"} · Metacritic: ${m.Metascore || "N/A"}</p>
      <button class="btn-primary" onclick="addToWatchlist('${m.imdbID}', '${(m.Title||"").replace(/'/g,"")}', '${m.Year}', '${m.Poster || ""}')">+ Añadir a Watchlist</button>
    `;
  } catch (e) {
    body.innerHTML = "No se pudo cargar el detalle.";
  }
}

function addToWatchlist(imdbID, title, year, poster) {
  const list = Store.getWatchlist();
  if (list.find(m => m.imdb_id === imdbID)) return;
  list.push({ imdb_id: imdbID, title, year, poster_url: poster, added_at: new Date().toISOString() });
  Store.saveWatchlist(list);
  reportActivity("Watchlist", "ADD_WATCHLIST", { imdb_id: imdbID, title });
  renderWatchlist();
}

function renderWatchlist() {
  const list = Store.getWatchlist();
  const grid = document.getElementById("watchlistGrid");
  if (!list.length) { grid.innerHTML = `<p class="hint">Aún no has guardado nada.</p>`; return; }
  grid.innerHTML = list.map(m => `
    <div class="movie-card" data-id="${m.imdb_id}">
      ${m.poster_url ? `<img src="${m.poster_url}" alt="${m.title}">` : `<div style="aspect-ratio:2/3;background:var(--bg-2);"></div>`}
      <div class="info">
        <h4>${m.title}</h4><span>${m.year}</span>
      </div>
    </div>`).join("");
  attachCardEvents(grid);
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function handleGpsSearch() {
  const status = document.getElementById("gpsStatus");
  if (!navigator.geolocation) { status.textContent = "Tu navegador no soporta geolocalización."; return; }
  status.textContent = "Obteniendo tu ubicación…";
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    reportActivity("Mapa GPS", "GPS_SCAN", { lat: latitude, lng: longitude });
    status.textContent = `Ubicación obtenida (${latitude.toFixed(3)}, ${longitude.toFixed(3)}).`;
    renderCinemaList(latitude, longitude);
  }, err => {
    status.textContent = "No se pudo obtener tu ubicación: " + err.message;
  });
}

function renderCinemaList(lat, lng) {
  const list = document.getElementById("cinemaList");
  const withDist = MOCK_CINEMAS.map(c => ({ ...c, dist: distanceKm(lat, lng, c.lat, c.lng) }))
    .sort((a, b) => a.dist - b.dist);
  list.innerHTML = withDist.map(c => `
    <li>
      <div><strong>${c.name}</strong><br><span class="hint">${c.feature}</span></div>
      <span class="dist">${c.dist.toFixed(1)} km</span>
    </li>`).join("");
}

let geofenceWatchId = null;
function toggleGeofence() {
  const status = document.getElementById("geofenceStatus");
  const btn = document.getElementById("geofenceBtn");
  if (geofenceWatchId !== null) {
    navigator.geolocation.clearWatch(geofenceWatchId);
    geofenceWatchId = null;
    status.textContent = "Geofencing desactivado.";
    btn.textContent = "Activar geofencing";
    return;
  }
  if (!navigator.geolocation) { status.textContent = "GPS no disponible."; return; }
  btn.textContent = "Desactivar geofencing";
  status.textContent = "Vigilando tu posición…";
  geofenceWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude } = pos.coords;
    const near = MOCK_CINEMAS.find(c => distanceKm(latitude, longitude, c.lat, c.lng) < 2);
    if (near) {
      status.textContent = `📍 Estás cerca de ${near.name} — ${near.feature}`;
      triggerNotification("Cine cerca de ti", `${near.name}: ${near.feature}`);
      reportActivity("Geofencing", "GPS_SCAN", { near: near.name });
    }
  }, () => { status.textContent = "No se pudo activar el rastreo."; });
}

function triggerNotification(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "" });
  }
}

function requestNotifPermission() {
  const status = document.getElementById("notifStatus");
  if (!("Notification" in window)) { status.textContent = "Este navegador no soporta notificaciones."; return; }
  Notification.requestPermission().then(perm => {
    status.textContent = perm === "granted" ? "Notificaciones activadas." : "Permiso denegado.";
    reportActivity("Ajustes", "NOTIFICATIONS_PERMISSION", { permission: perm });
  });
}

function scheduleDailyRecommendation() {
  const status = document.getElementById("notifStatus");
  const list = Store.getWatchlist();
  const pick = list.length ? list[Math.floor(Math.random() * list.length)].title : "Casablanca";
  status.textContent = "Recomendación programada (demo: en 10 segundos).";
  reportActivity("Ajustes", "NOTIFICATION_SCHEDULED", { pick });
  setTimeout(() => triggerNotification("Película Clásica Recomendada del Día", pick), 10000);
}

function simulatePush() {
  triggerNotification("Función especial cerca de ti", "Nueva función en la Watchlist de tu director favorito.");
  reportActivity("Push (Firebase)", "NOTIFICATION_PUSH", { simulated: true });
}

function loadPrefsIntoUI() {
  const p = Store.getPrefs();
  document.getElementById("themeSelect").value = p.theme;
  document.getElementById("fontSizeSelect").value = p.fontSize;
  document.getElementById("layoutSelect").value = p.layout;
  document.getElementById("parentalSelect").value = p.parentalAge;
  document.getElementById("subtitleSelect").value = p.subtitleLang;
  setMultiSelect("decadesSelect", p.decades);
  setMultiSelect("genresSelect", p.genres);
  applyPrefsToDOM(p);
}

function setMultiSelect(id, values) {
  [...document.getElementById(id).options].forEach(o => o.selected = values.includes(o.value));
}
function getMultiSelect(id) {
  return [...document.getElementById(id).selectedOptions].map(o => o.value);
}

function applyPrefsToDOM(p) {
  document.body.dataset.theme = p.theme;
  document.body.dataset.fontsize = p.fontSize;
  document.body.dataset.layout = p.layout;
}

function saveSettings() {
  const prefs = {
    theme: document.getElementById("themeSelect").value,
    fontSize: document.getElementById("fontSizeSelect").value,
    layout: document.getElementById("layoutSelect").value,
    decades: getMultiSelect("decadesSelect"),
    genres: getMultiSelect("genresSelect"),
    parentalAge: document.getElementById("parentalSelect").value,
    subtitleLang: document.getElementById("subtitleSelect").value,
  };
  Store.savePrefs(prefs);
  applyPrefsToDOM(prefs);
  document.getElementById("settingsStatus").textContent = "Preferencias guardadas.";
  reportActivity("Ajustes de perfil", "CHANGE_THEME", prefs);
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      reportActivity(btn.dataset.tab, "NAVIGATE", {});
      if (btn.dataset.tab === "watchlist") renderWatchlist();
      if (btn.dataset.tab === "actividad") renderActivityLog();
    });
  });
}

function setupApiKeyUI() {
  const key = Store.getApiKey();
  document.getElementById("apiKeyBanner").classList.toggle("hidden", !!key);
  document.getElementById("apiKeyInput").value = key;
  document.getElementById("apiKeyInput2").value = key;
  const save = (val) => {
    Store.saveApiKey(val.trim());
    document.getElementById("apiKeyBanner").classList.add("hidden");
  };
  document.getElementById("saveApiKey").addEventListener("click", () => save(document.getElementById("apiKeyInput").value));
  document.getElementById("saveApiKey2").addEventListener("click", () => save(document.getElementById("apiKeyInput2").value));
}

window.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupApiKeyUI();
  loadPrefsIntoUI();
  renderWatchlist();
  renderActivityLog();

  document.getElementById("searchBtn").addEventListener("click", handleSearch);
  document.getElementById("searchInput").addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });

  document.getElementById("gpsBtn").addEventListener("click", handleGpsSearch);
  document.getElementById("geofenceBtn").addEventListener("click", toggleGeofence);

  document.getElementById("saveSettings").addEventListener("click", saveSettings);
  document.getElementById("notifPermBtn").addEventListener("click", requestNotifPermission);
  document.getElementById("notifDailyBtn").addEventListener("click", scheduleDailyRecommendation);
  document.getElementById("notifPushBtn").addEventListener("click", simulatePush);

  document.getElementById("closeModal").addEventListener("click", () => document.getElementById("detailModal").classList.add("hidden"));
  document.getElementById("detailModal").addEventListener("click", (e) => { if (e.target.id === "detailModal") e.currentTarget.classList.add("hidden"); });

  document.getElementById("clearLogBtn").addEventListener("click", () => {
    localStorage.removeItem("user_activity_logs");
    renderActivityLog();
  });

  reportActivity("App", "APP_OPEN", {});
});