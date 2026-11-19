const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, shell, Menu, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const HOME_URL = pathToFileURL(path.join(__dirname, "home.html")).href;
const CHROME_HEIGHT = 104;
const PARTITION = "persist:zora";
const PRIVATE_PARTITION_PREFIX = "zora-private-";
// Lista suplementar para o controlo Anti-Tracking independente.
// A filtragem principal de anúncios usa EasyList através de Ghostery.
const TRACKERS = [
  "google-analytics.com", "googletagmanager.com", "connect.facebook.net",
  "hotjar.com", "clarity.ms", "scorecardresearch.com", "segment.io",
  "segment.com", "mixpanel.com", "amplitude.com", "fullstory.com",
  "newrelic.com", "nr-data.net", "bat.bing.com", "analytics.tiktok.com",
  "pixel.facebook.com", "tr.snapchat.com", "static.ads-twitter.com",
  "analytics.twitter.com", "quantserve.com", "quantcast.com",
  "branch.io", "appsflyer.com", "adjust.com"
];

let win;
let menuWindow = null;
let downloadsWindow = null;
let zWindow = null;
let tabs = [];
let views = new Map();
let activeId = null;
let attachedId = null;
let nextId = 1;
const recentlyClosedTabs = [];
let normalSession;
let privateSession = null;
const privateSessions = new WeakSet();
let privateSessionCounter = 0;
let privateMode = false;
let theme = "light";
let securitySettings = {
  adBlockEnabled: true,
  antiTrackingEnabled: true,
  permissions: { camera: false, microphone: false, geolocation: false, notifications: false }
};
let securityStats = { blockedAds: 0, blockedTrackers: 0 };
let adblockEngine = null;
let adblockStatus = "A preparar filtros…";
let adblockCachePath = null;
const adblockSessions = new Set();
let historyEntries = [];
const recentHistoryRecords = new Map();
let settingsPath;
let historyPath;
const downloads = new Map();
let nextDownloadId = 1;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  } catch (error) { console.error("ZORA: não foi possível guardar dados:", error); }
}
function saveHistory() { writeJson(historyPath, historyEntries); }
function publishHistory() {
  const entries = historyEntries.slice().reverse();
  if (win && !win.isDestroyed()) win.webContents.send("history:update", entries);
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send("history:update", entries);
}
function getTab(id) { return tabs.find(tab => tab.id === id) || null; }
function searchTermFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.endsWith("duckduckgo.com")) return url.searchParams.get("q") || "";
  } catch {}
  return "";
}
function isPrivateTab(id) {
  const tab = getTab(id);
  const wc = views.get(id)?.webContents;
  return !!tab?.isPrivate || (!!wc && privateSessions.has(wc.session));
}
function recordHistory(id, rawUrl) {
  const tab = getTab(id);
  if (!tab || isPrivateTab(id) || rawUrl === HOME_URL || !/^https?:\/\//i.test(rawUrl)) return;
  const wc = views.get(id)?.webContents;
  const now = Date.now();
  let title = wc?.getTitle() || "";
  let hostname = "";
  try { hostname = new URL(rawUrl).hostname; } catch {}
  const searchTerm = searchTermFromUrl(rawUrl);
  if (!title || title === hostname) title = searchTerm ? `Pesquisa: ${searchTerm}` : (hostname || rawUrl);

  // Electron can emit more than one navigation notification for the same
  // destination (for example, did-navigate plus in-page navigation).
  // Coalesce identical searches/URLs arriving almost simultaneously.
  const dedupeKey = searchTerm
    ? `search:${searchTerm.trim().toLocaleLowerCase()}`
    : `url:${rawUrl}`;
  const previous = recentHistoryRecords.get(dedupeKey);
  if (previous && now - previous.time < 5000) {
    const existing = historyEntries[previous.index];
    if (existing && existing.url === rawUrl) {
      existing.visitedAt = now;
      if (title) existing.title = title;
      saveHistory();
      publishHistory();
      return;
    }
    return;
  }
  recentHistoryRecords.set(dedupeKey, { time: now, index: historyEntries.length });
  // Keep the dedupe cache bounded.
  if (recentHistoryRecords.size > 200) {
    for (const [key, value] of recentHistoryRecords) {
      if (now - value.time > 30000) recentHistoryRecords.delete(key);
    }
  }
  historyEntries.push({ url: rawUrl, title, searchTerm, visitedAt: now });
  if (historyEntries.length > 1000) historyEntries = historyEntries.slice(-1000);
  saveHistory();
  publishHistory();
}
function updateHistoryTitle(id) {
  const tab = getTab(id);
  if (!tab || isPrivateTab(id)) return;
  const wc = views.get(id)?.webContents;
  if (!wc || !wc.getURL() || wc.getURL() === HOME_URL) return;
  for (let i = historyEntries.length - 1; i >= 0; i--) {
    if (historyEntries[i].url === wc.getURL()) {
      const searchTerm = historyEntries[i].searchTerm;
      historyEntries[i].title = searchTerm ? `Pesquisa: ${searchTerm}` : (wc.getTitle() || historyEntries[i].title);
      saveHistory();
      publishHistory();
      break;
    }
  }
}

function downloadList() {
  return [...downloads.values()].map(download => ({
    id: download.id, filename: download.filename, savePath: download.savePath,
    received: download.received, total: download.total, state: download.state,
    error: download.error || ""
  }));
}
function publishDownloads() {
  const items = downloadList();
  if (win && !win.isDestroyed()) win.webContents.send("downloads:update", items);
  if (downloadsWindow && !downloadsWindow.isDestroyed()) downloadsWindow.webContents.send("downloads:update", items);
}
function setupDownloads(ses, isPrivate = false) {
  if (ses.__zoraDownloadsReady) return;
  ses.__zoraDownloadsReady = true;
  ses.on("will-download", async (_event, item) => {
    const id = nextDownloadId++;
    const download = {
      id, item, isPrivate, filename: item.getFilename() || "transferencia",
      savePath: "", received: 0, total: item.getTotalBytes() || 0,
      state: "A escolher destino", error: ""
    };
    downloads.set(id, download);
    publishDownloads();
    item.on("updated", (_event, state) => {
      download.filename = item.getFilename() || download.filename;
      download.received = item.getReceivedBytes();
      download.total = item.getTotalBytes() || 0;
      download.state = state === "interrupted" ? "Interrompida" : (item.isPaused() ? "Em pausa" : "A transferir");
      publishDownloads();
    });
    item.once("done", (_event, state) => {
      download.received = item.getReceivedBytes();
      download.total = item.getTotalBytes() || download.total;
      if (state === "completed") { download.state = "Concluída"; download.savePath = item.getSavePath(); }
      else if (state === "cancelled") download.state = "Cancelada";
      else { download.state = "Falhou"; download.error = "A transferência foi interrompida."; }
      publishDownloads();
    });
    try {
      const result = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
        title: "Guardar transferência", defaultPath: download.filename, buttonLabel: "Guardar"
      });
      if (result.canceled || !result.filePath) {
        download.state = "Cancelada";
        item.cancel();
        publishDownloads();
        return;
      }
      download.savePath = result.filePath;
      item.setSavePath(result.filePath);
      download.state = "A transferir";
      publishDownloads();
    } catch (error) {
      download.state = "Falhou";
      download.error = error.message || "Não foi possível escolher o destino.";
      item.cancel();
      publishDownloads();
    }
  });
}

function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}
function resolveAddress(raw) {
  const value = String(raw || "").trim();
  if (!value) return HOME_URL;
  if (value === HOME_URL) return HOME_URL;
  const hostLike = /^(localhost(?::\d+)?|(\[[\da-f:]+\]|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:[/?#].*)?)$/i.test(value);
  if (!/^https?:\/\//i.test(value) && !hostLike)
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  const result = safeUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  return result || `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}
function saveSettings() {
  writeJson(settingsPath, { theme, security: securitySettings });
}
function publishSecurityState() {
  const wc = getWC();
  let secureConnection = false;
  try { secureConnection = new URL(wc?.getURL() || "").protocol === "https:"; } catch {}
  const state = {
    ...securitySettings,
    permissions: { ...securitySettings.permissions },
    blockedAds: securityStats.blockedAds,
    blockedTrackers: securityStats.blockedTrackers,
    secureConnection,
    adblockStatus
  };
  for (const target of [win, zWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send("security:update", state);
  }
}
function domainMatches(host, domains) {
  return domains.some(domain => host === domain || host.endsWith("." + domain));
}
function permissionAllowed(permission, details = {}) {
  const p = securitySettings.permissions;
  if (permission === "geolocation") return !!p.geolocation;
  if (permission === "notifications") return !!p.notifications;
  if (permission === "media") {
    const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    if (types.includes("video") && !p.camera) return false;
    if (types.includes("audio") && !p.microphone) return false;
    return types.length > 0 && types.every(type => type === "video" ? p.camera : type === "audio" ? p.microphone : false);
  }
  return false;
}
function configureSession(ses) {
  // Não registar um segundo webRequest.onBeforeRequest: o Ghostery instala
  // o motor de filtros no mesmo evento e o Electron só permite um listener.
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permissionAllowed(permission, details));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    return permissionAllowed(permission, details);
  });
  applyAdblockerToSession(ses);
}

function removeAdblockerFromSession(ses) {
  if (!adblockEngine || !adblockSessions.has(ses)) return;
  try {
    if (ses === normalSession && adblockEngine.isBlockingEnabled(ses)) {
      adblockEngine.disableBlockingInSession(ses);
    } else {
      // O Ghostery regista handlers IPC globais para filtros cosméticos.
      // A sessão privada usa os mesmos filtros de rede sem registar uma
      // segunda cópia desses handlers globais (que colidiria no Electron).
      ses.webRequest.onBeforeRequest(null);
      ses.webRequest.onHeadersReceived(null);
    }
  } catch (error) {
    console.error("ZORA AdBlocker cleanup error:", error);
  }
  adblockSessions.delete(ses);
}

function applyAdblockerToSession(ses) {
  if (!adblockEngine) return;
  const enabled = securitySettings.adBlockEnabled || securitySettings.antiTrackingEnabled;
  const alreadyEnabled = adblockSessions.has(ses);
  if (!enabled || alreadyEnabled) return;

  try {
    if (ses === normalSession) {
      // Sessão normal: bloqueio de rede + filtros cosméticos.
      adblockEngine.enableBlockingInSession(ses);
    } else {
      // Sessão privada: bloqueio de rede. Evita duplicar os IPC handlers
      // globais que o pacote instala para a filtragem cosmética.
      ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, adblockEngine.onHeadersReceived);
      ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, adblockEngine.onBeforeRequest);
    }
    adblockSessions.add(ses);
  } catch (error) {
    console.error("ZORA AdBlocker session error:", error);
    adblockStatus = "Erro ao aplicar filtros";
  }
}

function instrumentAdblocker(engine) {
  const original = engine.onBeforeRequest.bind(engine);
  engine.onBeforeRequest = (details, callback) => original(details, result => {
    if (result?.cancel) {
      let host = "";
      try { host = new URL(details.url).hostname.toLowerCase(); } catch {}
      // A classificação por categoria é aproximada: regras de listas podem
      // bloquear trackers alojados em domínios que não são exclusivos de tracking.
      if (domainMatches(host, TRACKERS)) securityStats.blockedTrackers++;
      else securityStats.blockedAds++;
      publishSecurityState();
    }
    callback(result);
  });
}

async function rebuildAdblocker() {
  const activeLists = [];
  if (securitySettings.adBlockEnabled) activeLists.push("https://easylist.to/easylist/easylist.txt");
  if (securitySettings.antiTrackingEnabled) activeLists.push("https://easylist.to/easylist/easyprivacy.txt");

  // Desliga o motor anterior antes de o substituir (um listener por evento
  // webRequest é permitido por sessão no Electron).
  for (const ses of [...adblockSessions]) removeAdblockerFromSession(ses);
  adblockEngine = null;

  if (activeLists.length === 0) {
    adblockStatus = "Bloqueio desativado";
    publishSecurityState();
    return;
  }

  adblockStatus = "A atualizar listas de filtros…";
  publishSecurityState();
  const cacheKey = `${securitySettings.adBlockEnabled ? "ads" : ""}-${securitySettings.antiTrackingEnabled ? "privacy" : ""}` || "none";
  const cachePath = path.join(app.getPath("userData"), `adblock-${cacheKey}.bin`);
  try {
    const { ElectronBlocker } = await import("@ghostery/adblocker-electron");
    let loadedFromCache = false;

    // A cache válida começa a bloquear imediatamente, sem esperar pela rede.
    if (fs.existsSync(cachePath)) {
      try {
        adblockEngine = ElectronBlocker.deserialize(await fs.promises.readFile(cachePath));
        instrumentAdblocker(adblockEngine);
        for (const ses of [normalSession, privateSession].filter(Boolean)) applyAdblockerToSession(ses);
        adblockStatus = "Filtros guardados — a verificar atualizações";
        loadedFromCache = true;
        publishSecurityState();
      } catch (cacheError) {
        console.warn("ZORA: cache de filtros inválida; será reconstruída.", cacheError);
        adblockEngine = null;
      }
    }

    try {
      const filterFetch = (url, options = {}) => fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20000)
      });
      const updatedEngine = await ElectronBlocker.fromLists(filterFetch, activeLists);
      // Substitui a instância antiga apenas depois de a nova estar pronta.
      for (const ses of [...adblockSessions]) removeAdblockerFromSession(ses);
      adblockEngine = updatedEngine;
      instrumentAdblocker(adblockEngine);
      await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.promises.writeFile(cachePath, adblockEngine.serialize());
      const loadedNames = [
        securitySettings.adBlockEnabled ? "EasyList" : null,
        securitySettings.antiTrackingEnabled ? "EasyPrivacy" : null
      ].filter(Boolean).join(" + ");
      adblockStatus = `Filtros atualizados: ${loadedNames}`;
      for (const ses of [normalSession, privateSession].filter(Boolean)) applyAdblockerToSession(ses);
    } catch (networkError) {
      if (loadedFromCache) {
        adblockStatus = "Filtros guardados — não foi possível atualizar";
      } else {
        throw networkError;
      }
    }
  } catch (error) {
    adblockEngine = null;
    adblockStatus = "Filtros avançados indisponíveis";
    console.error("ZORA AdBlocker initialization failed:", error);
  }
  publishSecurityState();
}

async function initializeAdblocker() {
  await rebuildAdblocker();
}
function ensurePrivateSession() {
  if (privateSession) return privateSession;
  privateSession = session.fromPartition(`${PRIVATE_PARTITION_PREFIX}${++privateSessionCounter}`);
  privateSessions.add(privateSession);
  configureSession(privateSession);
  setupDownloads(privateSession, true);
  return privateSession;
}
function cleanupPrivateSessionIfUnused() {
  if (tabs.some(tab => tab.isPrivate) || !privateSession) return;
  const oldSession = privateSession;
  removeAdblockerFromSession(oldSession);
  privateSession = null;
  for (const [id, download] of downloads) {
    if (download.isPrivate) {
      if (["A transferir", "A escolher destino", "Em pausa"].includes(download.state)) {
        try { download.item.cancel(); } catch {}
      }
      downloads.delete(id);
    }
  }
  Promise.allSettled([oldSession.clearStorageData(), oldSession.clearCache()]).then(publishDownloads);
}
function applyThemeToHome(view) {
  if (!view || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  if (wc.getURL() === HOME_URL) {
    wc.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)};`).catch(() => {});
  }
}
function applyThemeToAllHomes() { for (const view of views.values()) applyThemeToHome(view); }
function getView(id = activeId) { return views.get(id) || null; }
function getWC(id = activeId) {
  const wc = getView(id)?.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}
function publish() {
  if (!win || win.isDestroyed()) return;
  const list = tabs.map(tab => {
    const wc = getWC(tab.id);
    return {
      id: tab.id, title: wc?.getTitle() || "Novo separador", url: wc?.getURL() || "",
      loading: !!wc?.isLoading(), active: tab.id === activeId, isPrivate: tab.isPrivate,
      audible: !!wc?.isCurrentlyAudible(), muted: !!wc?.isAudioMuted()
    };
  });
  win.webContents.send("tabs:update", list);
  const wc = getWC();
  win.webContents.send("browser:state", {
    url: wc?.getURL() || "", canGoBack: !!wc?.canGoBack(),
    canGoForward: !!wc?.canGoForward(), loading: !!wc?.isLoading(),
    privateMode, isPrivate: !!getTab(activeId)?.isPrivate
  });
  publishSecurityState();
}
function setViewBounds() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const view = getView();
  if (view) view.setBounds({ x: 0, y: CHROME_HEIGHT, width: Math.max(1, width), height: Math.max(1, height - CHROME_HEIGHT) });
}
function activate(id) {
  if (!views.has(id) || !win || win.isDestroyed()) return false;
  const previous = getView(attachedId);
  if (previous) { try { win.contentView.removeChildView(previous); } catch {} }
  activeId = id;
  const selected = getView(id);
  try { win.contentView.addChildView(selected); attachedId = id; }
  catch (error) { console.error("Could not attach tab view:", error); return false; }
  setViewBounds();
  publish();
  return true;
}

async function saveCurrentPage(wc) {
  if (!wc || wc.isDestroyed()) return;
  const suggested = (() => {
    try { return `${new URL(wc.getURL()).hostname || "pagina"}.html`; }
    catch { return "pagina.html"; }
  })();
  const result = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
    title: "Guardar página", defaultPath: suggested,
    filters: [{ name: "Página web completa", extensions: ["html"] }]
  });
  if (result.canceled || !result.filePath || wc.isDestroyed()) return;
  try {
    await wc.savePage(result.filePath, "HTMLComplete");
  } catch (error) {
    console.error("ZORA: erro ao guardar página:", error);
    if (win && !win.isDestroyed()) win.webContents.send("browser:error", `Não foi possível guardar a página: ${error.message}`);
  }
}

function installContextMenu(wc, tabId) {
  wc.on("context-menu", (_event, params) => {
    const tab = getTab(tabId);
    if (!tab || !win || win.isDestroyed()) return;

    const template = [];
    if (params.linkURL) {
      const link = safeUrl(params.linkURL);
      template.push(
        { label: "Abrir ligação num novo separador", enabled: !!link, click: () => { if (link) createTab(link, !!getTab(tabId)?.isPrivate); } },
        { label: "Abrir ligação", enabled: !!link, click: () => { if (link && !wc.isDestroyed()) wc.loadURL(link); } },
        { label: "Copiar endereço da ligação", click: () => clipboard.writeText(params.linkURL) },
        { label: "Transferir ligação", enabled: !!link, click: () => { if (link && !wc.isDestroyed()) wc.downloadURL(link); } },
        { type: "separator" }
      );
    }

    if (params.hasImageContents && params.srcURL) {
      const imageUrl = safeUrl(params.srcURL);
      template.push(
        { label: "Abrir imagem num novo separador", enabled: !!imageUrl, click: () => { if (imageUrl) createTab(imageUrl, !!getTab(tabId)?.isPrivate); } },
        { label: "Copiar imagem", click: () => { if (!wc.isDestroyed()) wc.copyImageAt(params.x, params.y); } },
        { label: "Copiar endereço da imagem", click: () => clipboard.writeText(params.srcURL) },
        { label: "Guardar imagem como…", click: () => { if (!wc.isDestroyed()) wc.downloadURL(params.srcURL); } },
        { type: "separator" }
      );
    }

    if (params.selectionText) {
      const selectedText = String(params.selectionText).trim();
      template.push(
        { label: "Copiar texto selecionado", click: () => clipboard.writeText(selectedText) },
        { label: "Pesquisar texto selecionado", click: () => {
          if (selectedText) createTab(`https://duckduckgo.com/?q=${encodeURIComponent(selectedText)}`, !!getTab(tabId)?.isPrivate);
        }},
        { type: "separator" }
      );
    }

    if (params.isEditable) {
      template.push(
        { label: "Anular", role: "undo", enabled: !!params.editFlags?.canUndo },
        { label: "Refazer", role: "redo", enabled: !!params.editFlags?.canRedo },
        { type: "separator" },
        { label: "Cortar", role: "cut", enabled: !!params.editFlags?.canCut },
        { label: "Copiar", role: "copy", enabled: !!params.editFlags?.canCopy },
        { label: "Colar", role: "paste", enabled: !!params.editFlags?.canPaste },
        { label: "Selecionar tudo", role: "selectAll" },
        { type: "separator" }
      );
    } else if (params.selectionText) {
      template.push({ label: "Selecionar tudo", role: "selectAll" }, { type: "separator" });
    }

    template.push(
      { label: "Voltar", enabled: wc.canGoBack(), click: () => { if (!wc.isDestroyed() && wc.canGoBack()) wc.goBack(); } },
      { label: "Avançar", enabled: wc.canGoForward(), click: () => { if (!wc.isDestroyed() && wc.canGoForward()) wc.goForward(); } },
      { label: "Atualizar", click: () => { if (!wc.isDestroyed()) wc.reload(); } },
      { label: "Atualização forçada", click: () => { if (!wc.isDestroyed()) wc.reloadIgnoringCache(); } },
      { type: "separator" },
      { label: "Guardar página como…", click: () => saveCurrentPage(wc) },
      { label: "Imprimir…", click: () => { if (!wc.isDestroyed()) wc.print({ printBackground: true }); } },
      { type: "separator" },
      { label: "Inspecionar", click: () => { if (!wc.isDestroyed()) wc.inspectElement(params.x, params.y); } }
    );

    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function handleBrowserShortcut(input, targetWc = getWC()) {
  if (input.type !== "keyDown") return;
  const key = String(input.key || "").toLowerCase();
  const control = !!(input.control || input.meta);
  const shift = !!input.shift;
  const alt = !!input.alt;
  const wc = targetWc && !targetWc.isDestroyed() ? targetWc : getWC();

  if ((control && shift && key === "i") || key === "f12") {
    if (wc) {
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: "detach" });
    }
    return true;
  }
  if (control && shift && key === "r") { wc?.reloadIgnoringCache(); return true; }
  if (control && shift && key === "t") {
    const previous = recentlyClosedTabs.pop();
    if (previous && !previous.isPrivate) createTab(previous.url, false);
    return true;
  }
  if (control && key === "t") { createTab(HOME_URL, privateMode); return true; }
  if (control && key === "w") { if (activeId !== null) closeTab(activeId); return true; }
  if (control && key === "l") { win?.webContents.send("browser:focus-address"); return true; }
  if (control && key === "r" || key === "f5") { wc?.reload(); return true; }
  if (control && key === "j") { openDownloadsWindow(); return true; }
  if (control && key === "p") { wc?.print({ printBackground: true }); return true; }
  if (control && key === "s") { saveCurrentPage(wc); return true; }
  if (control && key === "tab") {
    if (tabs.length > 1) {
      const index = tabs.findIndex(tab => tab.id === activeId);
      const step = shift ? -1 : 1;
      activate(tabs[(index + step + tabs.length) % tabs.length].id);
    }
    return true;
  }
  if (alt && key === "arrowleft") { if (wc?.canGoBack()) wc.goBack(); return true; }
  if (alt && key === "arrowright") { if (wc?.canGoForward()) wc.goForward(); return true; }
  if (control && (key === "=" || key === "+" || key === "add")) { wc?.setZoomLevel(Math.min(5, (wc.getZoomLevel() || 0) + 0.5)); return true; }
  if (control && (key === "-" || key === "subtract")) { wc?.setZoomLevel(Math.max(-5, (wc.getZoomLevel() || 0) - 0.5)); return true; }
  if (control && key === "0") { wc?.setZoomLevel(0); return true; }
}

function createTab(raw = HOME_URL, isPrivate = privateMode) {
  if (!win || win.isDestroyed()) return;
  const id = nextId++;
  const ses = isPrivate ? ensurePrivateSession() : normalSession;
  const view = new WebContentsView({ webPreferences: {
    session: ses, contextIsolation: true, nodeIntegration: false,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false
  }});
  const wc = view.webContents;
  installContextMenu(wc, id);
  wc.on("before-input-event", (event, input) => { if (handleBrowserShortcut(input, wc)) event.preventDefault(); });
  views.set(id, view);
  tabs.push({ id, isPrivate: !!isPrivate });
  wc.setWindowOpenHandler(({ url }) => {
    const safe = safeUrl(url);
    if (safe) createTab(safe, !!getTab(id)?.isPrivate);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => { if (url !== HOME_URL && !safeUrl(url)) event.preventDefault(); });
  wc.on("will-redirect", (event, url) => { if (!safeUrl(url)) event.preventDefault(); });
  const refresh = () => { if (win && !win.isDestroyed()) publish(); };
  wc.on("did-navigate", (_event, url) => { recordHistory(id, url); refresh(); });
  wc.on("did-navigate-in-page", (_event, url) => { recordHistory(id, url); refresh(); });
  wc.on("page-title-updated", () => { updateHistoryTitle(id); refresh(); });
  wc.on("audio-state-changed", refresh);
  for (const eventName of ["did-start-loading", "did-stop-loading", "did-finish-load"]) wc.on(eventName, () => {
    if (eventName === "did-finish-load") applyThemeToHome(view);
    refresh();
  });
  wc.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && win && !win.isDestroyed())
      win.webContents.send("browser:error", `Não foi possível abrir a página (${code}): ${description}`);
  });
  activate(id);
  wc.loadURL(raw === HOME_URL ? HOME_URL : resolveAddress(raw)).catch(error => {
    if (win && !win.isDestroyed()) win.webContents.send("browser:error", `Erro ao abrir a página: ${error.message}`);
  });
  publish();
  return id;
}
function reorderTabs(sourceId, targetId, insertAfter = false) {
  const from = tabs.findIndex(tab => tab.id === Number(sourceId));
  const to = tabs.findIndex(tab => tab.id === Number(targetId));
  if (from < 0 || to < 0 || from === to) return false;
  const [moved] = tabs.splice(from, 1);
  let destination = tabs.findIndex(tab => tab.id === Number(targetId));
  if (destination < 0) return false;
  if (insertAfter) destination += 1;
  tabs.splice(destination, 0, moved);
  publish();
  return true;
}

function closeTab(id) {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0) return;
  const closingTab = tabs[index];
  const closing = views.get(id);
  if (!closingTab.isPrivate && closing && !closing.webContents.isDestroyed()) {
    const lastUrl = closing.webContents.getURL();
    if (safeUrl(lastUrl) && lastUrl !== HOME_URL) {
      recentlyClosedTabs.push({ url: lastUrl, isPrivate: false });
      if (recentlyClosedTabs.length > 10) recentlyClosedTabs.shift();
    }
  }
  if (id === attachedId && closing && win && !win.isDestroyed()) {
    try { win.contentView.removeChildView(closing); } catch {}
    attachedId = null;
  }
  tabs.splice(index, 1);
  views.delete(id);
  if (closing && !closing.webContents.isDestroyed()) closing.webContents.close();
  if (tabs.length === 0) { activeId = null; createTab(HOME_URL, privateMode); }
  else if (id === activeId) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    activeId = null; activate(next.id);
  } else publish();
  if (closingTab.isPrivate) cleanupPrivateSessionIfUnused();
}


function closeMenuWindow() {
  // Mantém a janela carregada em memória para abrir instantaneamente da próxima vez.
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.hide();
}

function closeDownloadsWindow() {
  // Mantém a janela carregada em memória para evitar recriar o renderer a cada abertura.
  if (downloadsWindow && !downloadsWindow.isDestroyed()) downloadsWindow.hide();
}
function openDownloadsWindow() {
  if (!win || win.isDestroyed()) return;
  closeMenuWindow();
  closeZWindow();
  if (downloadsWindow && !downloadsWindow.isDestroyed()) {
    downloadsWindow.show();
    downloadsWindow.focus();
    publishDownloads();
    return;
  }
  const bounds = win.getContentBounds();
  const width = 380;
  const height = Math.min(560, Math.max(300, bounds.height - 20));
  const x = Math.round(bounds.x + bounds.width - width - 15);
  const y = Math.round(bounds.y + 48);
  downloadsWindow = new BrowserWindow({
    parent: win, x, y, width, height,
    frame: false, resizable: false, minimizable: false, maximizable: false,
    show: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: theme === "dark" ? "#30322c" : "#fbfbf8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  downloadsWindow.loadFile(path.join(__dirname, "downloads.html")).then(() => {
    if (!downloadsWindow || downloadsWindow.isDestroyed()) return;
    downloadsWindow.webContents.send("theme:update", theme);
    publishDownloads();
    downloadsWindow.show();
  }).catch(error => console.error("ZORA downloads panel error:", error));
  downloadsWindow.on("blur", () => {
    if (downloadsWindow && !downloadsWindow.isDestroyed()) downloadsWindow.hide();
  });
  downloadsWindow.on("closed", () => { downloadsWindow = null; });
}

function closeZWindow() {
  // A janela Z também fica em cache; só é escondida quando não está em uso.
  if (zWindow && !zWindow.isDestroyed()) zWindow.hide();
}
function openZWindow() {
  if (!win || win.isDestroyed()) return;
  closeMenuWindow();
  closeDownloadsWindow();
  if (zWindow && !zWindow.isDestroyed()) {
    publishSecurityState();
    zWindow.show();
    zWindow.focus();
    return;
  }
  const bounds = win.getContentBounds();
  const width = 360;
  const height = Math.min(590, Math.max(480, bounds.height - 30));
  const x = Math.round(bounds.x + bounds.width - width - 165);
  const y = Math.round(bounds.y + 48);
  zWindow = new BrowserWindow({
    parent: win, x, y, width, height,
    frame: false, resizable: false, minimizable: false, maximizable: false,
    show: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: theme === "dark" ? "#30322c" : "#fbfbf8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  zWindow.loadFile(path.join(__dirname, "zmenu.html")).then(() => {
    if (!zWindow || zWindow.isDestroyed()) return;
    zWindow.webContents.send("theme:update", theme);
    publishSecurityState();
    zWindow.show();
  }).catch(error => console.error("ZORA Z menu error:", error));
  zWindow.on("blur", () => {
    if (zWindow && !zWindow.isDestroyed()) zWindow.hide();
  });
  zWindow.on("closed", () => { zWindow = null; });
}

function openMenuWindow() {
  if (!win || win.isDestroyed()) return;
  closeDownloadsWindow();
  closeZWindow();
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.webContents.send("privacy:update", { privateMode, isPrivate: !!getTab(activeId)?.isPrivate });
    publishHistory();
    menuWindow.show();
    menuWindow.focus();
    return;
  }
  const bounds = win.getContentBounds();
  const width = 340;
  const height = 245;
  const x = Math.round(bounds.x + bounds.width - width - 15);
  const y = Math.round(bounds.y + 48);
  menuWindow = new BrowserWindow({
    parent: win,
    x, y, width, height,
    frame: false, resizable: false, minimizable: false, maximizable: false,
    show: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: theme === "dark" ? "#30322c" : "#fbfbf8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  menuWindow.loadFile(path.join(__dirname, "menu.html")).then(() => {
    if (!menuWindow || menuWindow.isDestroyed()) return;
    menuWindow.webContents.send("theme:update", theme);
    menuWindow.webContents.send("privacy:update", { privateMode, isPrivate: !!getTab(activeId)?.isPrivate });
    publishHistory();
    menuWindow.show();
  }).catch(error => console.error("ZORA menu error:", error));
  menuWindow.on("blur", () => {
    // Atraso curto para permitir que o clique nas três barras chegue ao renderer.
    // Se o utilizador clicar fora, o menu fecha automaticamente.
    const blurredWindow = menuWindow;
    setTimeout(() => {
      if (menuWindow === blurredWindow && blurredWindow && !blurredWindow.isDestroyed() && !blurredWindow.isFocused()) {
        closeMenuWindow();
      }
    }, 180);
  });
  menuWindow.on("closed", () => { menuWindow = null; });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 700, minHeight: 500,
    backgroundColor: theme === "dark" ? "#171815" : "#f5f5f2", title: "ZORA",
    icon: path.join(__dirname, "assets", "zora-icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on("before-input-event", (event, input) => { if (handleBrowserShortcut(input, getWC())) event.preventDefault(); });
  await win.loadFile(path.join(__dirname, "index.html"));
  win.removeMenu();
  win.webContents.send("theme:update", theme);
  win.on("resize", setViewBounds);
  win.on("closed", () => {
    closeMenuWindow();
    closeDownloadsWindow();
    closeZWindow();
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    views.clear(); tabs = []; activeId = null; attachedId = null; win = null;
  });
  createTab(HOME_URL, false);
}

ipcMain.handle("menu:resize", (_event, expanded) => {
  if (!menuWindow || menuWindow.isDestroyed()) return false;
  const bounds = win && !win.isDestroyed() ? win.getContentBounds() : menuWindow.getBounds();
  const width = 340;
  const height = expanded ? Math.min(620, Math.max(420, bounds.height - 20)) : 245;
  const x = Math.round(bounds.x + bounds.width - width - 15);
  const y = Math.round(bounds.y + 48);
  menuWindow.setBounds({ x, y, width, height }, true);
  return true;
});

ipcMain.handle("menu:open", () => { openMenuWindow(); return true; });
ipcMain.handle("menu:toggle", () => {
  if (menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()) {
    closeMenuWindow();
    return false;
  }
  openMenuWindow();
  return true;
});
ipcMain.handle("downloads:panel-open", () => { openDownloadsWindow(); return true; });
ipcMain.handle("downloads:panel-close", () => { closeDownloadsWindow(); return true; });
ipcMain.handle("zmenu:open", () => { openZWindow(); return true; });
ipcMain.handle("zmenu:close", () => { closeZWindow(); return true; });
ipcMain.handle("menu:close", () => { closeMenuWindow(); return true; });
ipcMain.handle("tabs:list", () => tabs.map(tab => {
  const wc = getWC(tab.id);
  return { id: tab.id, title: wc?.getTitle() || "Novo separador", url: wc?.getURL() || "", loading: !!wc?.isLoading(), active: tab.id === activeId, isPrivate: tab.isPrivate };
}));
ipcMain.handle("tab:new", (_event, url) => createTab(url || HOME_URL, privateMode));
ipcMain.handle("tab:activate", (_event, id) => activate(Number(id)));
ipcMain.handle("tab:close", (_event, id) => closeTab(Number(id)));
ipcMain.handle("tab:reorder", (event, sourceId, targetId, insertAfter) => {
  if (!win || event.sender !== win.webContents) return false;
  return reorderTabs(sourceId, targetId, insertAfter === true);
});
ipcMain.handle("tab:toggle-mute", (_event, id) => {
  const wc = getWC(Number(id));
  if (!wc) return false;
  wc.setAudioMuted(!wc.isAudioMuted());
  publish();
  return wc.isAudioMuted();
});
ipcMain.handle("browser:navigate", (_event, value) => getWC()?.loadURL(resolveAddress(value)));
ipcMain.handle("browser:back", () => { const wc = getWC(); if (wc?.canGoBack()) wc.goBack(); });
ipcMain.handle("browser:forward", () => { const wc = getWC(); if (wc?.canGoForward()) wc.goForward(); });
ipcMain.handle("browser:reload", () => getWC()?.reload());
ipcMain.handle("browser:home", () => getWC()?.loadURL(HOME_URL));
ipcMain.handle("downloads:list", () => downloadList());
ipcMain.handle("downloads:cancel", (_event, id) => {
  const download = downloads.get(Number(id));
  if (!download || !download.item || !["A transferir", "A escolher destino", "Em pausa"].includes(download.state)) return false;
  download.item.cancel(); return true;
});
ipcMain.handle("downloads:open", async (_event, id) => {
  const download = downloads.get(Number(id));
  if (!download || download.state !== "Concluída" || !download.savePath) return false;
  const error = await shell.openPath(download.savePath);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle("downloads:show-folder", (_event, id) => {
  const download = downloads.get(Number(id));
  if (!download || !download.savePath) return false;
  shell.showItemInFolder(download.savePath); return true;
});
ipcMain.handle("privacy:toggle", () => {
  privateMode = !privateMode;
  createTab(HOME_URL, privateMode);
  publish();
  const state = { privateMode, isPrivate: !!getTab(activeId)?.isPrivate };
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send("privacy:update", state);
  return { privateMode };
});
ipcMain.handle("privacy:state", () => ({ privateMode, isPrivate: !!getTab(activeId)?.isPrivate }));
ipcMain.handle("history:list", () => historyEntries.slice().reverse());
ipcMain.handle("history:clear", async () => {
  historyEntries = [];
  saveHistory();
  publishHistory();
  return true;
});
ipcMain.handle("history:navigate", (_event, url) => {
  const safe = safeUrl(url);
  if (safe) return getWC()?.loadURL(safe);
  return false;
});
ipcMain.handle("security:get", () => ({
  ...securitySettings, permissions: { ...securitySettings.permissions },
  blockedAds: securityStats.blockedAds, blockedTrackers: securityStats.blockedTrackers,
  adblockStatus
}));
ipcMain.handle("security:set", async (_event, patch) => {
  if (!patch || typeof patch !== "object") return false;
  const previousFilterSettings = `${securitySettings.adBlockEnabled}:${securitySettings.antiTrackingEnabled}`;
  if (typeof patch.adBlockEnabled === "boolean") securitySettings.adBlockEnabled = patch.adBlockEnabled;
  if (typeof patch.antiTrackingEnabled === "boolean") securitySettings.antiTrackingEnabled = patch.antiTrackingEnabled;
  if (patch.permissions && typeof patch.permissions === "object") {
    for (const key of ["camera", "microphone", "geolocation", "notifications"]) {
      if (typeof patch.permissions[key] === "boolean") securitySettings.permissions[key] = patch.permissions[key];
    }
  }
  saveSettings();
  const nextFilterSettings = `${securitySettings.adBlockEnabled}:${securitySettings.antiTrackingEnabled}`;
  if (previousFilterSettings !== nextFilterSettings) await rebuildAdblocker();
  publishSecurityState();
  return { ...securitySettings, permissions: { ...securitySettings.permissions }, adblockStatus };
});
ipcMain.handle("security:clear-data", async (_event, kind) => {
  const targets = [normalSession, privateSession].filter(Boolean);
  if (kind === "history") {
    historyEntries = [];
    saveHistory();
    publishHistory();
    return true;
  }
  const storage = kind === "cookies"
    ? { storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] }
    : { storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage", "websql", "filesystem"] };
  await Promise.all(targets.map(async ses => {
    await ses.clearStorageData(storage);
    if (kind !== "cookies") await ses.clearCache();
  }));
  return true;
});
ipcMain.handle("theme:get", () => theme);
ipcMain.handle("theme:set", (_event, value) => {
  if (value !== "light" && value !== "dark") return theme;
  theme = value;
  saveSettings();
  if (win && !win.isDestroyed()) win.webContents.send("theme:update", theme);
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send("theme:update", theme);
  if (downloadsWindow && !downloadsWindow.isDestroyed()) downloadsWindow.webContents.send("theme:update", theme);
  if (zWindow && !zWindow.isDestroyed()) zWindow.webContents.send("theme:update", theme);
  applyThemeToAllHomes();
  return theme;
});

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  settingsPath = path.join(userData, "settings.json");
  historyPath = path.join(userData, "history.json");
  const settings = readJson(settingsPath, {});
  theme = settings.theme === "dark" ? "dark" : "light";
  if (settings.security && typeof settings.security === "object") {
    securitySettings.adBlockEnabled = settings.security.adBlockEnabled !== false;
    securitySettings.antiTrackingEnabled = settings.security.antiTrackingEnabled !== false;
    for (const key of ["camera", "microphone", "geolocation", "notifications"]) {
      securitySettings.permissions[key] = settings.security.permissions?.[key] === true;
    }
  }
  const savedHistory = readJson(historyPath, []);
  historyEntries = Array.isArray(savedHistory) ? savedHistory.slice(-1000) : [];
  normalSession = session.fromPartition(PARTITION);
  configureSession(normalSession);
  setupDownloads(normalSession, false);
  initializeAdblocker();
  createWindow().catch(error => console.error("ZORA startup error:", error));
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
