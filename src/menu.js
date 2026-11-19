const $ = id => document.getElementById(id);
let historyItems = [];
let currentTheme = "light";
let privateMode = false;
function formatVisitedAt(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-PT", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
}
function renderHistory() {
  const list = $("historyList");
  const query = $("historySearch").value.trim().toLocaleLowerCase("pt-PT");
  const filtered = historyItems.filter(item => `${item.title||""} ${item.url||""} ${item.searchTerm||""}`.toLocaleLowerCase("pt-PT").includes(query));
  if (!filtered.length) {
    list.innerHTML = `<p class="history-empty">${historyItems.length ? "Não foram encontrados resultados." : "Ainda não existem páginas no histórico."}</p>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of filtered) {
    const button = document.createElement("button"); button.type="button"; button.className="history-entry";
    const title=document.createElement("strong"); title.textContent=item.title||item.url;
    const detail=document.createElement("small"); detail.textContent=`${item.url} · ${formatVisitedAt(item.visitedAt)}`;
    button.append(title,detail);
    button.addEventListener("click", async()=>{ await window.zora.navigateHistory(item.url); await window.zora.closeMenu(); });
    fragment.appendChild(button);
  }
  list.replaceChildren(fragment);
}
function updateHistory(items){historyItems=Array.isArray(items)?items:[];renderHistory();}
function setTheme(theme){
  currentTheme=theme==="dark"?"dark":"light";document.body.dataset.theme=currentTheme;
  const dark=currentTheme==="dark";
  $("themeTitle").textContent=dark?"Modo claro":"Modo escuro";
  $("themeDescription").textContent=dark?"Aparência escura ativa":"Aparência clara ativa";
  $("themeIcon").textContent=dark?"☀":"☾";
}
function setPrivate(state){
  privateMode=!!state.privateMode;
  $("privateDescription").textContent=privateMode?"Ativada · novos separadores anónimos":"Desativada";
  $("privateState").textContent=privateMode?"ON":"OFF";
  $("privateState").classList.toggle("active",privateMode);
}
$("togglePrivate").addEventListener("click",async()=>{
  const result=await window.zora.togglePrivate();setPrivate(result);
});
$("showHistory").addEventListener("click",()=>{
  const section=$("historySection");
  section.hidden=!section.hidden;
  const expanded=!section.hidden;
  $("showHistory").setAttribute("aria-expanded",String(expanded));
  $("showHistory").querySelector(".menu-chevron").textContent=expanded?"⌄":"›";
  window.zora.resizeMenu(expanded);
  if(expanded) $("historySearch").focus();
});
$("historySearch").addEventListener("input",renderHistory);
$("clearHistory").addEventListener("click",async()=>{
  await window.zora.clearHistory();updateHistory([]);
});
$("toggleTheme").addEventListener("click",async()=>{
  const updated=await window.zora.setTheme(currentTheme==="dark"?"light":"dark");setTheme(updated);
});
window.zora.onHistoryUpdate(updateHistory);
window.zora.onThemeUpdate(setTheme);
window.zora.onPrivacyUpdate(setPrivate);
Promise.all([window.zora.listHistory(),window.zora.getTheme(),window.zora.getPrivacyState()])
  .then(([history,theme,privacy])=>{updateHistory(history);setTheme(theme);setPrivate(privacy);});
