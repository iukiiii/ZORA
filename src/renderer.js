const tabsEl = document.getElementById("tabs");
const address = document.getElementById("address");
const notice = document.getElementById("notice");
const backButton = document.getElementById("back");
const forwardButton = document.getElementById("forward");
const loading = document.getElementById("loading");
let currentTabs = [];
let activeId = null;
let toastTimer;
let currentDownloads = [];
let historyItems = [];
let currentTheme = "light";
let privateMode = false;
let draggedTabId = null;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
function renderDownloads(downloads) {
  currentDownloads = Array.isArray(downloads) ? downloads : [];
  const list = document.getElementById("downloadsList");
  const count = document.getElementById("downloadsCount");
  const activeCount = currentDownloads.filter(item => ["A transferir", "A escolher destino", "Em pausa"].includes(item.state)).length;
  count.textContent = String(activeCount);
  count.hidden = activeCount === 0;
  if (!currentDownloads.length) {
    list.innerHTML = '<p class="downloads-empty">Ainda não existem transferências.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of [...currentDownloads].reverse()) {
    const row = document.createElement("article"); row.className = "download-item";
    const name = document.createElement("div"); name.className = "download-name";
    name.textContent = item.filename || "Transferência"; name.title = item.filename || ""; row.appendChild(name);
    const meta = document.createElement("div"); meta.className = "download-meta";
    if (item.total > 0) {
      const percent = Math.min(100, Math.round((item.received / item.total) * 100));
      meta.textContent = `${item.state} · ${formatBytes(item.received)} / ${formatBytes(item.total)} · ${percent}%`;
      const track = document.createElement("div"); track.className = "download-progress";
      const fill = document.createElement("div"); fill.className = "download-progress-fill"; fill.style.width = `${percent}%`;
      track.appendChild(fill); row.appendChild(meta); row.appendChild(track);
    } else { meta.textContent = `${item.state} · ${formatBytes(item.received)}`; row.appendChild(meta); }
    if (item.error) { const error = document.createElement("div"); error.className = "download-error"; error.textContent = item.error; row.appendChild(error); }
    const actions = document.createElement("div"); actions.className = "download-actions";
    if (["A transferir", "A escolher destino", "Em pausa"].includes(item.state)) {
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancelar";
      cancel.addEventListener("click", () => window.zora.cancelDownload(item.id)); actions.appendChild(cancel);
    }
    if (item.state === "Concluída") {
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Abrir";
      open.addEventListener("click", () => window.zora.openDownload(item.id)); actions.appendChild(open);
      const folder = document.createElement("button"); folder.type = "button"; folder.textContent = "Mostrar na pasta";
      folder.addEventListener("click", () => window.zora.showDownloadFolder(item.id)); actions.appendChild(folder);
    }
    if (actions.childElementCount) row.appendChild(actions);
    fragment.appendChild(row);
  }
  list.replaceChildren(fragment);
}
function displayAddress(url) {
  return typeof url === "string" && url.startsWith("file://") ? "" : (url || "");
}
function showNotice(message) {
  notice.textContent = message; notice.classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => notice.classList.remove("show"), 3200);
}
function renderTabs(tabs) {
  currentTabs = Array.isArray(tabs) ? tabs : [];
  const fragment = document.createDocumentFragment();
  const active = currentTabs.find(tab => tab.active);
  activeId = active ? active.id : null;
  for (const tab of currentTabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${tab.active ? " active" : ""}${tab.isPrivate ? " private-tab" : ""}`;
    button.draggable = true;
    button.dataset.tabId = String(tab.id);
    button.addEventListener("dragstart", event => {
      if (event.target.closest(".close-tab, .tab-audio")) { event.preventDefault(); return; }
      draggedTabId = tab.id;
      button.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(tab.id));
    });
    button.addEventListener("dragend", () => {
      draggedTabId = null;
      tabsEl.querySelectorAll(".tab").forEach(item => item.classList.remove("dragging", "drop-before", "drop-after"));
    });
    button.addEventListener("dragover", event => {
      if (draggedTabId === null || draggedTabId === tab.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = button.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      button.classList.toggle("drop-before", !after);
      button.classList.toggle("drop-after", after);
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-before", "drop-after"));
    button.addEventListener("drop", event => {
      event.preventDefault();
      const sourceId = Number(event.dataTransfer.getData("text/plain")) || draggedTabId;
      if (sourceId !== null && sourceId !== tab.id) {
        const rect = button.getBoundingClientRect();
        const insertAfter = event.clientX > rect.left + rect.width / 2;
        window.zora.reorderTabs(sourceId, tab.id, insertAfter);
      }
      tabsEl.querySelectorAll(".tab").forEach(item => item.classList.remove("drop-before", "drop-after"));
    });
    button.title = `${tab.title || "Novo separador"}${tab.isPrivate ? " (anónimo)" : ""}`;
    const title = document.createElement("span"); title.className = "tab-title";
    title.textContent = tab.loading ? "A carregar…" : (tab.title || "Novo separador"); button.appendChild(title);
    if (tab.audible || tab.muted) {
      const audio = document.createElement("span");
      audio.className = "tab-audio";
      audio.textContent = tab.muted ? "🔇" : "🔊";
      audio.title = tab.muted ? "Ativar som deste separador" : "Silenciar este separador";
      audio.setAttribute("role", "button");
      audio.setAttribute("tabindex", "0");
      audio.addEventListener("click", event => {
        event.stopPropagation();
        window.zora.toggleTabMute(tab.id);
      });
      audio.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation(); window.zora.toggleTabMute(tab.id);
        }
      });
      button.appendChild(audio);
    }
    const close = document.createElement("span"); close.className = "close-tab"; close.textContent = "×"; close.title = "Fechar separador";
    close.addEventListener("click", event => { event.stopPropagation(); window.zora.closeTab(tab.id); });
    button.appendChild(close);
    button.addEventListener("click", () => { if (!tab.active) window.zora.activateTab(tab.id); });
    fragment.appendChild(button);
  }
  tabsEl.replaceChildren(fragment);
  if (active && document.activeElement !== address) address.value = displayAddress(active.url);
}

function setTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = currentTheme;
  const dark = currentTheme === "dark";
  document.getElementById("themeTitle").textContent = dark ? "Modo claro" : "Modo escuro";
  document.getElementById("themeDescription").textContent = dark ? "Aparência escura ativa" : "Aparência clara ativa";
  document.getElementById("themeIcon").textContent = dark ? "☀" : "☾";
}
function setPrivateState(enabled) {
  privateMode = !!enabled;
  const button = document.getElementById("togglePrivate");
  const state = document.getElementById("privateState");
  document.getElementById("privateDescription").textContent = privateMode ? "Ativada · novos separadores anónimos" : "Desativada";
  state.textContent = privateMode ? "ON" : "OFF";
  state.classList.toggle("active", privateMode);
  button.setAttribute("aria-pressed", String(privateMode));
}
function formatVisitedAt(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function renderHistory() {
  const list = document.getElementById("historyList");
  const query = document.getElementById("historySearch").value.trim().toLocaleLowerCase("pt-PT");
  const filtered = historyItems.filter(item => `${item.title || ""} ${item.url || ""} ${item.searchTerm || ""}`.toLocaleLowerCase("pt-PT").includes(query));
  if (!filtered.length) {
    list.innerHTML = `<p class="history-empty">${historyItems.length ? "Não foram encontrados resultados." : "Ainda não existem páginas no histórico."}</p>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of filtered) {
    const button = document.createElement("button"); button.type = "button"; button.className = "history-entry";
    const title = document.createElement("strong"); title.textContent = item.title || item.url;
    const detail = document.createElement("small"); detail.textContent = `${item.url} · ${formatVisitedAt(item.visitedAt)}`;
    button.append(title, detail);
    button.addEventListener("click", () => {
      window.zora.navigateHistory(item.url);
      document.getElementById("menuPanel").hidden = true;
      document.getElementById("menuButton").setAttribute("aria-expanded", "false");
    });
    fragment.appendChild(button);
  }
  list.replaceChildren(fragment);
}
function updateHistory(items) { historyItems = Array.isArray(items) ? items : []; renderHistory(); }

// Barra de endereço e navegação
 document.getElementById("addressForm").addEventListener("submit", event => {
  event.preventDefault(); const value = address.value.trim();
  if (value) window.zora.navigate(value); address.blur();
});
document.getElementById("newTab").addEventListener("click", () => window.zora.newTab());
backButton.addEventListener("click", () => window.zora.back());
forwardButton.addEventListener("click", () => window.zora.forward());
document.getElementById("reload").addEventListener("click", () => window.zora.reload());
document.getElementById("home").addEventListener("click", () => window.zora.home());
document.getElementById("brandHome").addEventListener("click", () => window.zora.home());

// Menu principal
const menuButton = document.getElementById("menuButton");
const menuPanel = document.getElementById("menuPanel");
menuButton.addEventListener("click", async () => {
  try {
    const opened = await window.zora.toggleMenu();
    menuButton.setAttribute("aria-expanded", String(opened));
  } catch { showNotice("Não foi possível abrir/fechar o menu."); }
});
menuPanel.addEventListener("click", event => event.stopPropagation());
document.addEventListener("click", event => {
  if (!menuPanel.hidden && !menuPanel.contains(event.target) && !menuButton.contains(event.target)) {
    menuPanel.hidden = true; menuButton.setAttribute("aria-expanded", "false");
  }
});
document.getElementById("togglePrivate").addEventListener("click", async () => {
  try {
    const result = await window.zora.togglePrivate();
    setPrivateState(result.privateMode);
    showNotice(result.privateMode ? "Navegação anónima ativada. Abriu-se um separador privado." : "Navegação anónima desativada. Abriu-se um separador normal.");
  } catch { showNotice("Não foi possível alterar o modo de navegação."); }
});
document.getElementById("showHistory").addEventListener("click", async () => {
  const section = document.getElementById("historySection");
  section.hidden = !section.hidden;
  document.getElementById("showHistory").setAttribute("aria-expanded", String(!section.hidden));
  if (!section.hidden) {
    try { updateHistory(await window.zora.listHistory()); }
    catch { showNotice("Não foi possível carregar o histórico."); }
  }
});
document.getElementById("historySearch").addEventListener("input", renderHistory);
document.getElementById("clearHistory").addEventListener("click", async () => {
  if (!historyItems.length) return;
  try { await window.zora.clearHistory(); updateHistory([]); showNotice("Histórico apagado."); }
  catch { showNotice("Não foi possível apagar o histórico."); }
});
document.getElementById("toggleTheme").addEventListener("click", async () => {
  try { setTheme(await window.zora.setTheme(currentTheme === "dark" ? "light" : "dark")); }
  catch { showNotice("Não foi possível alterar o tema."); }
});

// Transferências
const downloadsButton = document.getElementById("downloadsButton");
const zButton = document.getElementById("zButton");
zButton.addEventListener("click", () => {
  window.zora.openZMenu().catch(() => showNotice("Não foi possível abrir o menu Z."));
});
const downloadsPanel = document.getElementById("downloadsPanel");
downloadsButton.addEventListener("click", () => {
  window.zora.openDownloadsPanel().catch(() => showNotice("Não foi possível abrir as transferências."));
});
document.getElementById("closeDownloads").addEventListener("click", () => {
  window.zora.closeDownloadsPanel();
});
window.zora.onDownloadsUpdate(renderDownloads);
window.zora.listDownloads().then(renderDownloads).catch(() => showNotice("Não foi possível carregar as transferências."));

// Eventos do processo principal
window.zora.onTabsUpdate(renderTabs);
window.zora.onFocusAddress(() => { address.focus(); address.select(); });
window.zora.onBrowserState(state => {
  backButton.disabled = !state.canGoBack; forwardButton.disabled = !state.canGoForward;
  loading.hidden = !state.loading;
  if (document.activeElement !== address) address.value = displayAddress(state.url);
  if (typeof state.privateMode === "boolean") setPrivateState(state.privateMode);
});
window.zora.onError(showNotice);
window.zora.onSecurityUpdate(() => {});
window.zora.onThemeUpdate(setTheme);
window.zora.onHistoryUpdate(updateHistory);
Promise.all([window.zora.listTabs(), window.zora.getTheme(), window.zora.getPrivacyState(), window.zora.listHistory()])
  .then(([tabs, theme, privacy, history]) => {
    renderTabs(tabs); setTheme(theme); setPrivateState(privacy.privateMode); updateHistory(history);
  })
  .catch(() => showNotice("Não foi possível carregar algumas definições da ZORA."));

// O processo principal trata os atalhos também quando o foco está na página web.
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    window.zora.closeMenu();
    downloadsPanel.hidden = true; downloadsButton.setAttribute("aria-expanded", "false");
  }
});
