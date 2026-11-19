const $ = id => document.getElementById(id);
function setTheme(theme) { document.body.dataset.theme = theme === "dark" ? "dark" : "light"; }
function showStatus(message, error = false) {
  const el = $("actionStatus");
  el.textContent = message;
  el.dataset.error = error ? "true" : "false";
}
function renderSecurity(state) {
  if (!state) return;
  $("adBlockEnabled").checked = !!state.adBlockEnabled;
  $("antiTrackingEnabled").checked = !!state.antiTrackingEnabled;
  $("blockedAds").textContent = String(state.blockedAds || 0);
  $("blockedTrackers").textContent = String(state.blockedTrackers || 0);
  $("filterStatus").textContent = state.adblockStatus || "Estado dos filtros desconhecido";
  const permissions = state.permissions || {};
  document.querySelectorAll("[data-permission]").forEach(input => {
    input.checked = !!permissions[input.dataset.permission];
  });
  $("secureState").textContent = state.secureConnection ? "Ligação HTTPS (encriptação em trânsito)" : "Ligação sem HTTPS ou ainda não verificada";
  $("secureState").dataset.secure = state.secureConnection ? "true" : "false";
}
async function saveSecurity(patch) {
  try {
    const state = await window.zora.setSecurityState(patch);
    renderSecurity(state);
    showStatus("Definições atualizadas.");
  } catch {
    showStatus("Não foi possível guardar as definições.", true);
  }
}
$("closeZ").addEventListener("click", () => window.zora.closeZMenu());
$("adBlockEnabled").addEventListener("change", event => saveSecurity({ adBlockEnabled: event.target.checked }));
$("antiTrackingEnabled").addEventListener("change", event => saveSecurity({ antiTrackingEnabled: event.target.checked }));
document.querySelectorAll("[data-permission]").forEach(input => {
  input.addEventListener("change", () => {
    const permissions = {};
    document.querySelectorAll("[data-permission]").forEach(item => {
      permissions[item.dataset.permission] = item.checked;
    });
    saveSecurity({ permissions });
  });
});
$("clearCache").addEventListener("click", async () => {
  showStatus("A limpar cookies e cache…");
  try { await window.zora.clearBrowsingData("all"); showStatus("Cookies e cache limpos."); }
  catch { showStatus("Não foi possível limpar os dados.", true); }
});
$("clearHistory").addEventListener("click", async () => {
  showStatus("A limpar histórico…");
  try { await window.zora.clearBrowsingData("history"); showStatus("Histórico limpo."); }
  catch { showStatus("Não foi possível limpar o histórico.", true); }
});
window.zora.onThemeUpdate(setTheme);
window.zora.onSecurityUpdate(renderSecurity);
Promise.all([window.zora.getTheme(), window.zora.getSecurityState()])
  .then(([theme, security]) => { setTheme(theme); renderSecurity(security); })
  .catch(() => showStatus("Não foi possível carregar as definições.", true));
