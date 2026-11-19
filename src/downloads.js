const $=id=>document.getElementById(id);
function formatBytes(bytes){
  if(!Number.isFinite(bytes)||bytes<=0)return "0 B";
  const units=["B","KB","MB","GB"];let value=bytes,index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index++;}
  return `${value.toFixed(index===0?0:1)} ${units[index]}`;
}
function renderDownloads(items){
  const list=$("downloadsList");
  const downloads=Array.isArray(items)?items:[];
  if(!downloads.length){list.innerHTML='<p class="downloads-empty">Ainda não existem transferências.</p>';return;}
  const fragment=document.createDocumentFragment();
  for(const item of [...downloads].reverse()){
    const row=document.createElement("article");row.className="download-item";
    const name=document.createElement("div");name.className="download-name";name.textContent=item.filename||"Transferência";name.title=item.filename||"";row.appendChild(name);
    const meta=document.createElement("div");meta.className="download-meta";
    if(item.total>0){
      const percent=Math.min(100,Math.round((item.received/item.total)*100));
      meta.textContent=`${item.state} · ${formatBytes(item.received)} / ${formatBytes(item.total)} · ${percent}%`;
      const track=document.createElement("div");track.className="download-progress";
      const fill=document.createElement("div");fill.className="download-progress-fill";fill.style.width=`${percent}%`;
      track.appendChild(fill);row.append(meta,track);
    }else{meta.textContent=`${item.state} · ${formatBytes(item.received)}`;row.appendChild(meta);}
    if(item.error){const error=document.createElement("div");error.className="download-error";error.textContent=item.error;row.appendChild(error);}
    const actions=document.createElement("div");actions.className="download-actions";
    if(["A transferir","A escolher destino","Em pausa"].includes(item.state)){
      const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Cancelar";
      cancel.addEventListener("click",()=>window.zora.cancelDownload(item.id));actions.appendChild(cancel);
    }
    if(item.state==="Concluída"){
      const open=document.createElement("button");open.type="button";open.textContent="Abrir";
      open.addEventListener("click",()=>window.zora.openDownload(item.id));actions.appendChild(open);
      const folder=document.createElement("button");folder.type="button";folder.textContent="Mostrar na pasta";
      folder.addEventListener("click",()=>window.zora.showDownloadFolder(item.id));actions.appendChild(folder);
    }
    if(actions.childElementCount)row.appendChild(actions);
    fragment.appendChild(row);
  }
  list.replaceChildren(fragment);
}
$("closeDownloads").addEventListener("click",()=>window.zora.closeDownloadsPanel());
window.zora.onDownloadsUpdate(renderDownloads);
window.zora.onThemeUpdate(theme=>{document.body.dataset.theme=theme==="dark"?"dark":"light";});
Promise.all([window.zora.listDownloads(),window.zora.getTheme()])
  .then(([items,theme])=>{renderDownloads(items);document.body.dataset.theme=theme==="dark"?"dark":"light";});
