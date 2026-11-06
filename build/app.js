"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const LEADS = DATA.leads, META = DATA.meta, B = DATA.build;
const TAX = B.tax_factor || 1.0;   // imposto da mídia paga (Meta Ads) — toggle "Imposto Meta"

/* localStorage é por ORIGEM (scale-ag.github.io é compartilhado por todas as
   dashs da conta): metas e larguras de coluna levam o nome do repo na chave
   para não vazar de/para outra dash. O tema (dm_theme) continua global. */
const LS_NS = (location.pathname.split('/').filter(Boolean)[0]||'local');
const LS_METAS = 'dm_metas:'+LS_NS, LS_COLW = 'dm_colw:'+LS_NS;
function lsGet(k,def){ try{ const v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

/* ---------------- format ---------------- */
const nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl=v=>(v==null||!isFinite(v))?'-':'R$ '+nf2.format(v);
const pct=v=>(v==null||!isFinite(v))?'-':nf2.format(v*100)+'%';
const intf=v=>(v==null||!isFinite(v))?'-':nf0.format(v);
const numf=v=>(v==null||!isFinite(v))?'-':nf1.format(v);
const num2f=v=>(v==null||!isFinite(v))?'-':nf2.format(v);
const dimf=v=>v==null?'-':String(v);
const norm=s=>(s==null?'':String(s)).trim().toLowerCase();
const brdate=d=>{ if(!d) return '-'; const p=d.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const weekday=d=>{ const dt=new Date(d+'T00:00:00'); return isNaN(dt)?'':WD[dt.getDay()]; };

/* ---------------- date helpers ---------------- */
function pad(n){return String(n).padStart(2,'0');}
function dstr(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());}
function addDays(s,n){const dt=new Date(s+'T00:00:00');dt.setDate(dt.getDate()+n);return dstr(dt);}
const TODAY = B.today || B.date_max;

/* ---------------- STATE ---------------- */
const STATE = {
  page:'geral', from:(()=>{const [y,m]=TODAY.split('-'); return `${y}-${m}-01`;})(), to:TODAY, preset:'mes', tax:true,
  selDays:new Set(),
  mSelC:new Set(), mSelA:new Set(), mSelAd:new Set(),
  sort:{}, colw: lsGet(LS_COLW,{}),
};
/* gasto do Meta Ads × imposto (quando o toggle "Imposto Meta" está ligado) —
   usado em toda conta que parte do gasto (derive/gráficos/CPL por dimensão). */
const taxf = ()=> STATE.tax ? TAX : 1;

/* active date test: selDays override the De/Até range */
function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}
const leadsActive = ()=> LEADS.filter(l=>dateActive(l.d));
const metaActive  = ()=> META.filter(m=>dateActive(m.d));

/* ---------------- aggregation ----------------
   sp=gasto (sem imposto) · im=impressões · rc=alcance (reach) · cl=cliques no link ·
   pv=Page Views (Landing Page Views do Meta) · leads=inscrições válidas · mqls=leads
   com faturamento médio mensal acima de R$ 50 mil (q=1, ver build.py::is_mql).
   Funil com LANDING PAGE: Gasto → Impressões → Alcance → Cliques → Page Views →
   Leads → MQLs. Connect Rate = PV/Cliques · CPV = Gasto/PV · ConvLP = Leads/PV ·
   Tx MQL = MQLs/Leads · CPMQL = Gasto/MQLs.
   CPL/CPMQL só existem com gasto > 0 — lead sem mídia correspondente (orgânico
   ou anúncio que não aparece na aba de Queries) não vira "R$ 0,00" (fica "-"). */
function derive(a){
  const g=a.sp*taxf();
  return {gasto:g, impr:a.im, reach:a.rc, clicks:a.cl, pv:a.pv, leads:a.leads, mqls:a.mqls,
    cpm:a.im?g/a.im*1000:null, freq:a.rc?a.im/a.rc:null,
    ctr:a.im?a.cl/a.im:null, cpc:a.cl?g/a.cl:null,
    cr:a.cl?a.pv/a.cl:null, cpv:(a.pv&&a.sp>0)?g/a.pv:null,
    convlp:a.pv?a.leads/a.pv:null,
    cpl:(a.leads&&a.sp>0)?g/a.leads:null,
    txmql:a.leads?a.mqls/a.leads:null,
    cpmql:(a.mqls&&a.sp>0)?g/a.mqls:null};
}
const emptyAgg=()=>({sp:0,im:0,rc:0,cl:0,pv:0,leads:0,mqls:0});
function addMeta(a,r){ a.sp+=r.sp; a.im+=r.im; a.rc+=r.rc; a.cl+=r.cl; a.pv+=(r.pv||0); }
function addLead(a,r){ a.leads+=1; a.mqls+=(r.q||0); }
function buildAgg(fL,fM,dim){
  const m={};
  const get=k=>m[k]||(m[k]=emptyAgg());
  fM.forEach(r=>addMeta(get(r[dim]),r));
  fL.forEach(r=>addLead(get(r[dim]),r));
  return m;
}
function totals(fL,fM){
  const t=emptyAgg(); fM.forEach(r=>addMeta(t,r)); fL.forEach(r=>addLead(t,r));
  return t;
}
/* agregação diária do par (leads, mídia) */
function daily(fL,fM){
  const days={}; const g=d=>days[d]||(days[d]={d, ...emptyAgg()});
  fM.forEach(r=>{if(!r.d)return; addMeta(g(r.d),r);});
  fL.forEach(r=>{if(!r.d)return; addLead(g(r.d),r);});
  return Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
}


/* ---------------- generic interactive table ---------------- */
/* cfg: {id, cols:[{key,label,type,dim?,heat?:'gasto'|'leads',cls?}], rows:[{k,cells:{}, raw?}],
        total:{}, selectable, selSet, onSelect } */
// medição de texto (canvas) p/ auto-largura de coluna — "caiba o nome inteiro" (dim)
// e auto-ajuste em duplo-clique na borda, como Google Sheets / Looker Studio.
let _measureCtx=null;
function textWidth(s, font){
  if(!_measureCtx) _measureCtx=document.createElement('canvas').getContext('2d');
  _measureCtx.font=font;
  // +5%: as células usam font-variant-numeric:tabular-nums (dígitos mais largos
  // que os medidos no canvas) — sem essa folga nomes longos cortavam ~6px.
  return _measureCtx.measureText(s==null?'':String(s)).width*1.05;
}
const fmtStd=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='num2'?num2f(v):t==='date'?brdate(v):t==='html'?'':dimf(v);
const FONT_DIM='500 12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_NUM='12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_HEAD='700 11px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
function autoDimWidth(cfg,c){
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_DIM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_DIM); if(w>max) max=w; }
  return Math.max(140, Math.min(1000, Math.round(max)+34)); // + padding (10+10) + folga p/ seta de ordenação
}
function autoColWidth(cfg,c){
  if(c.type==='dim') return autoDimWidth(cfg,c);
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_NUM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_NUM); if(w>max) max=w; }
  return Math.max(60, Math.min(260, Math.round(max)+24));
}
/* largura MÍNIMA de uma coluna em modo fit (fonte 11px, padding 5+5): o valor
   mais largo da coluna (linhas + Total Geral) cabe inteiro. A tabela fit ocupa
   100% do card, mas nunca fica mais estreita que a soma destas larguras — se o
   card for menor, aparece rolagem lateral em vez de cortar valor com "…". */
const FONT_FIT='11px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_FIT_B='700 11px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_FIT_HEAD='600 10px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
function fitColWidth(cfg,c,i){
  let max=Math.max(0,...String(c.label||'').split(/\s+/).map(w=>textWidth(w.toUpperCase(),FONT_FIT_HEAD)));
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_FIT); if(w>max) max=w; });
  if(cfg.total){ const v=cfg.total[c.key];
    const s=(i===0&&v==null)?'Total Geral':fmtStd(c.type,v); const w=textWidth(s,FONT_FIT_B); if(w>max) max=w; }
  return Math.ceil(max)+16;   // padding 5+5 + folga p/ seta de ordenação
}
function colWidth(cfg,c){ const saved=(STATE.colw[cfg.id]||{})[c.key];
  // dimensão nunca trunca: mesmo com largura salva (redimensionada à mão numa
  // sessão anterior), nunca fica MENOR que o necessário p/ caber o nome mais
  // longo de agora — senão um nome novo/maior que o salvo volta a cortar com "…".
  if(c.type==='dim'){ const auto=autoDimWidth(cfg,c); return saved?Math.max(saved,auto):auto; }
  if(saved) return saved;
  if(c.w) return c.w;
  if(c.type==='date') return 96;
  if(c.type==='brl') return 110;   // "R$ 1.487,42" não cabia nos 92px padrão (cortava com "…")
  return 92; }
/* colunas sticky (cfg.cols[i].stk === 'l'|'r'): posicionadas com position:sticky
   DENTRO da mesma <table> (1 único container de scroll, nativo) — o offset
   (left/right, em px) é a soma acumulada da largura das colunas sticky que vêm
   antes dela (ver stkOffsets). Com sticky nativo numa tabela só, não há nada
   para sincronizar — o navegador cuida da posição em todos os frames. */
function stkOffsets(cols, widths){
  const leftIdx=[], rightIdx=[];
  cols.forEach((c,i)=>{ if(c.stk==='l') leftIdx.push(i); else if(c.stk==='r') rightIdx.push(i); });
  const leftOff={}, rightOff={};
  let acc=0; leftIdx.forEach(i=>{ leftOff[i]=acc; acc+=widths[i]; });
  acc=0; for(let j=rightIdx.length-1;j>=0;j--){ const i=rightIdx[j]; rightOff[i]=acc; acc+=widths[i]; }
  return {leftOff, rightOff, lastLeft:leftIdx[leftIdx.length-1], firstRight:rightIdx[0]};
}
function renderTable(cfg){
  const table=document.getElementById(cfg.id); if(!table) return;
  table.classList.toggle('dt-center', !!cfg.center);   // Mar01: dados centralizados
  const fit=!!cfg.fit;                                  // fit: cabe 100% da largura, sem scroll
  table.classList.toggle('dt-fit', fit);
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && c.type==='dim'){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      va=(va==null||!isFinite(va))?-Infinity:va; vb=(vb==null||!isFinite(vb))?-Infinity:vb;
      return dir==='asc'?va-vb:vb-va; }); }
  const ext={};
  cfg.cols.forEach(c=>{ if(c.heat){ const vs=rows.map(r=>r.cells[c.key]).filter(v=>v!=null&&isFinite(v)); ext[c.key]=[Math.min(...vs),Math.max(...vs)]; }});
  // métricas de custo sempre com "R$" (mesmo em tabelas densas/fit) — % nas de taxa, sem símbolo nas demais
  const fmt=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='num2'?num2f(v):t==='date'?brdate(v):t==='html'?(v==null?'-':String(v)):dimf(v);
  const widths=fit?[]:cfg.cols.map(c=>colWidth(cfg,c)); const totalW=widths.reduce((a,b)=>a+b,0);
  // modo fit: cada coluna recebe a largura mínima p/ caber o maior valor (fitColWidth);
  // a sobra do card é distribuída proporcionalmente (table-layout:fixed + width:100%).
  const fitWs=fit?cfg.cols.map((c,i)=>Math.max(c.w||0, fitColWidth(cfg,c,i))):[];
  const fitMin=fitWs.reduce((a,b)=>a+b,0);
  const colgroup='<colgroup>'+cfg.cols.map((c,i)=>{
    const w=fit?(fitWs[i]+'px'):(widths[i]+'px'); return `<col${w?` style="width:${w}"`:''}>`;
  }).join('')+'</colgroup>';
  const esc=s=>String(s==null?'':s).replace(/"/g,'&quot;');
  const stkCls=c=>c.stk?' stk-'+c.stk:'';
  const hasStk=cfg.cols.some(c=>c.stk);
  let STK=hasStk?stkOffsets(cfg.cols, fit?cfg.cols.map(c=>c.w||100):widths):null;
  const stkEdgeCls=(c,i)=> STK&&((c.stk==='l'&&i===STK.lastLeft)||(c.stk==='r'&&i===STK.firstRight)) ? ' stk-edge' : '';
  const stkStyle=(c,i)=> !STK?'' : c.stk==='l'?`left:${STK.leftOff[i]}px;` : c.stk==='r'?`right:${STK.rightOff[i]}px;` : '';
  let thead='<thead><tr>'+cfg.cols.map((c,i)=>{
    const sc = sortState&&sortState.key===c.key ? (sortState.dir==='asc'?'sorted-asc':'sorted-desc') : '';
    return `<th class="${c.type==='dim'?'dim ':''}${sc}${stkCls(c)}${stkEdgeCls(c,i)}" data-k="${c.key}" data-ci="${i}" title="${esc(c.label)}" style="${stkStyle(c,i)}">${c.label}${fit?'':'<span class="rsz"></span>'}</th>`;
  }).join('')+'</tr></thead>';
  // title = valor SEMPRE completo (mesmo em fit, onde a célula pode abreviar/cortar) — passe o mouse p/ ver
  let tbody='<tbody>'+rows.map(r=>{
    const sel = cfg.selectable && cfg.selSet && cfg.selSet.has(r.k);
    const tds=cfg.cols.map((c,i)=>{
      const v=r.cells[c.key]; const style=[];
      if(c.heat && ext[c.key]) style.push(`background:${heat(v,ext[c.key][0],ext[c.key][1],c.heat)}`);
      const ss=stkStyle(c,i); if(ss) style.push(ss);
      const cls=(c.type==='dim'?'dim':'')+(c.cls&&c.cls(r)?' '+c.cls(r):'')+stkCls(c)+stkEdgeCls(c,i);
      const ttl=c.type==='html'?'':` title="${esc(fmtStd(c.type,v))}"`;
      return `<td class="${cls}" style="${style.join(';')}" data-ci="${i}"${ttl}>${fmt(c.type,v)}</td>`;
    }).join('');
    return `<tr class="${sel?'sel':''}" data-k="${encodeURIComponent(r.k)}">${tds}</tr>`;
  }).join('')+'</tbody>';
  let tfoot='';
  if(cfg.total){ tfoot='<tfoot><tr>'+cfg.cols.map((c,i)=>{
    const v=cfg.total[c.key]; const isFirst=i===0&&v==null;
    return `<td class="${c.type==='dim'?'dim':''}${stkCls(c)}${stkEdgeCls(c,i)}" data-ci="${i}" style="${stkStyle(c,i)}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
  }).join('')+'</tr></tfoot>'; }
  table.style.width=fit?'100%':totalW+'px';
  table.style.minWidth=fit?fitMin+'px':'';
  table.innerHTML=colgroup+thead+tbody+tfoot;
  const cols=table.querySelector('colgroup').children;
  // sort handlers
  table.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click',e=>{ if(e.target.classList.contains('rsz'))return;
      const k=th.dataset.k, cur=STATE.sort[cfg.id];
      if(!cur||cur.key!==k) STATE.sort[cfg.id]={key:k,dir:'asc'};
      else if(cur.dir==='asc') STATE.sort[cfg.id]={key:k,dir:'desc'};
      else delete STATE.sort[cfg.id];
      renderTable(cfg);
    });
  });
  // resize handlers (drag right border) -> resize the <col>, grow the table
  if(!fit) table.querySelectorAll('thead th .rsz').forEach(g=>{
    g.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, ci=+th.dataset.ci, x0=e.clientX;
      const w0=cols[ci].offsetWidth, tw0=table.offsetWidth;
      document.body.style.userSelect='none';
      const mv=ev=>{ const nw=Math.max(60,w0+(ev.clientX-x0)); cols[ci].style.width=nw+'px'; table.style.width=(tw0-w0+nw)+'px';
        STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
        if(hasStk){ widths[ci]=nw; STK=stkOffsets(cfg.cols,widths);
          table.querySelectorAll('[data-ci]').forEach(el=>{ const i=+el.dataset.ci, cc=cfg.cols[i];
            if(cc.stk==='l') el.style.left=STK.leftOff[i]+'px'; else if(cc.stk==='r') el.style.right=STK.rightOff[i]+'px'; }); } };
      const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); document.body.style.userSelect=''; lsSet(LS_COLW,STATE.colw); };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
    // duplo-clique na borda = auto-ajustar largura ao conteúdo (como Sheets/Looker)
    g.addEventListener('dblclick',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, c=cfg.cols.find(x=>x.key===k);
      const nw=autoColWidth(cfg,c);
      STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
      lsSet(LS_COLW,STATE.colw);
      renderTable(cfg);
    });
  });
  // row select
  if(cfg.selectable && cfg.onSelect){
    table.querySelectorAll('tbody tr').forEach(tr=>{
      tr.addEventListener('click',e=>{ cfg.onSelect(decodeURIComponent(tr.dataset.k), e); });
    });
  }
  // hook pós-renderização (roda de novo em CADA re-render, inclusive ao ordenar,
  // pra chips/cores customizados nunca sumirem ao clicar num cabeçalho)
  if(cfg.afterRender) cfg.afterRender(table, rows);
}
/* Heatmap por coluna: cor FIXA por métrica (definida em identidade-visual.css),
   só a OPACIDADE varia com o valor (maior valor = mais vibrante). */
const HEAT_HUE={gasto:'--heat-gasto', leads:'--heat-leads', mqls:'--heat-mqls'};
function heat(v,lo,hi,kind){
  if(v==null||!isFinite(v)||!HEAT_HUE[kind]) return 'transparent';
  // hi===lo (só 1 dia com valor, ou todos iguais): intensidade máxima, em vez
  // de sumir o heatmap por falta de variação.
  const t=hi===lo?1:Math.max(0,Math.min(1,(v-lo)/(hi-lo)));
  const c=hx2rgb(cvar(HEAT_HUE[kind]));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.06+0.5*t).toFixed(3)})`;
}
function toggleSet(set,key,ctrl,others){
  if(ctrl){ set.has(key)?set.delete(key):set.add(key); }
  else { const only=set.has(key)&&set.size===1; set.clear(); if(!only) set.add(key); }
  if(others) others.forEach(s=>s.clear());
}

/* ---------------- funil ---------------- */
function funnelHTML(steps){ return steps.map(s=>`
    <div class="step ${s[3]?'na':''} ${s[4]||''}"><div class="step-main"><div class="m-label">${s[0]}</div><div class="m-val"${s[5]!=null&&isFinite(s[5])?` data-full="${s[1]}" data-raw="${s[5]}"`:''}>${s[1]}</div></div>
    <div class="secs">${s[2].map(x=>`<div><span class="s-label">${x[0]}</span><span class="s-val">${x[1]}</span></div>`).join('')}</div></div>`).join(''); }
/* Valor monetário do funil: mostra INTEIRO quando cabe; só abrevia ("R$ 53,00 mil") se estourar a largura. */
function shortMoney(v){
  const a=Math.abs(v);
  if(a>=1e6) return 'R$ '+nf2.format(v/1e6)+' mi';
  if(a>=1e3) return 'R$ '+nf2.format(v/1e3)+' mil';
  return null;
}
function fitFunnelValues(){
  document.querySelectorAll('.m-val[data-raw]').forEach(el=>{
    el.textContent=el.dataset.full;
    if(el.scrollWidth>el.clientWidth+1){ const sh=shortMoney(+el.dataset.raw); if(sh) el.textContent=sh; }
  });
}
window.addEventListener('resize',()=>{ try{ fitFunnelValues(); }catch(e){} });
/* Funil da landing page (Visão Geral, Meta Ads e Insights de IA):
   Gasto → Impressões → Alcance → Cliques → Page Views → Leads → MQLs. */
function funnelSteps(t){
  const dv=derive(t), g=dv.gasto;
  return [
    ['Gasto Total', brl(g), [], false, 'hl-gasto', g],
    ['Impressões', intf(t.im), [['CPM',brl(dv.cpm)]]],
    ['Alcance', intf(t.rc), [['Frequência',num2f(dv.freq)]]],
    ['Cliques', intf(t.cl), [['CTR',pct(dv.ctr)],['CPC',brl(dv.cpc)]]],
    ['Page Views', intf(t.pv), [['Connect Rate',pct(dv.cr)],['CPV',brl(dv.cpv)]]],
    ['Leads', intf(t.leads), [['CPL',brl(dv.cpl)],['ConvLP',pct(dv.convlp)]], false, 'hl-lead'],
    ['MQLs', intf(t.mqls), [['CPMQL',brl(dv.cpmql)],['Tx MQL',pct(dv.txmql)]], false, 'hl-mql'],
  ];
}

/* ---------------- charts ---------------- */
const charts={};
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
const CHART_SERIES=['--cc1','--cc2','--cc3','--cc4','--cc5','--cc6','--cc7','--cc8','--cc9','--cc10'];
const chartPalette=()=>CHART_SERIES.map(v=>cvar(v)||'#888888');
const cmuted=()=>cvar('--muted')||'#6B7280', cink=()=>cvar('--ink')||'#1A1D2E', cgrid=()=>cvar('--grid')||'#EEF0F5';
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
const cplOf=x=>(x.leads&&x.sp>0)?+((x.sp*taxf())/x.leads).toFixed(2):null;
const cpmqlOf=x=>(x.mqls&&x.sp>0)?+((x.sp*taxf())/x.mqls).toFixed(2):null;
function comboChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const labels=d.map(x=>x.d.slice(5)), mut=cmuted(), gr=cgrid();
  const cLeads=cvar('--chart-leads'), cMqls=cvar('--chart-mqls'), cGasto=cvar('--chart-gasto'),
        cCpl=cvar('--chart-cpl')||cink(), cCpmql=cvar('--chart-cpmql');
  charts[id]=new Chart(el,{
    data:{labels, datasets:[
      {type:'bar',label:'Leads',data:d.map(x=>x.leads),backgroundColor:cLeads,yAxisID:'y',borderRadius:3,order:4},
      {type:'bar',label:'MQLs',data:d.map(x=>x.mqls),backgroundColor:cMqls,yAxisID:'y',borderRadius:3,order:3},
      {type:'line',label:'Gasto',data:d.map(x=>+(x.sp*taxf()).toFixed(2)),borderColor:cGasto,backgroundColor:cGasto,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:2},
      {type:'line',label:'CPL',data:d.map(cplOf),borderColor:cCpl,backgroundColor:cCpl,yAxisID:'y1',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,order:1},
      {type:'line',label:'CPMQL',data:d.map(cpmqlOf),borderColor:cCpmql,backgroundColor:cCpmql,yAxisID:'y1',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const v=c.raw; return c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(v):intf(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10},precision:0},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Leads · MQLs',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'R$',color:mut,font:{size:10}}}}}
  });
}
/* rótulo longo no eixo (nome de anúncio/resposta do formulário) é abreviado só
   no EIXO — o tooltip mostra o nome completo. O Chart.js limita o eixo Y a
   ~metade da largura do gráfico e CORTA o começo do texto que passa disso;
   aqui o rótulo é medido e abreviado com "…" para caber nessa metade. */
function fitAxisLabel(label, maxPx){
  const font='10px '+((Chart.defaults&&Chart.defaults.font&&Chart.defaults.font.family)||'sans-serif');
  let s=String(label);
  if(textWidth(s,font)<=maxPx) return s;
  // nomes no padrão "A | B | C": o FIM é o que diferencia (ex.: "AUTO | PA BRASIL | AD_10")
  // — tenta cortar segmentos do começo antes de cortar o final.
  const parts=s.split(' | ');
  for(let k=1;k<parts.length;k++){ const t='… | '+parts.slice(k).join(' | '); if(textWidth(t,font)<=maxPx) return t; }
  while(s.length>1 && textWidth(s+'…',font)>maxPx) s=s.slice(0,-1);
  return s.trimEnd()+'…';
}
/* keepOrder=true: mantém a ordem recebida (ex.: faixas de faturamento da menor
   para a maior) em vez de ordenar pelo valor. */
function hbar(id, items, valFn, colorFn, top, unit, keepOrder){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  unit=unit||'leads';
  let arr=keepOrder?items.slice():items.slice().sort((a,b)=>valFn(b)-valFn(a)); if(top) arr=arr.slice(0,top);
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabels],
    data:{labels:arr.map(x=>x.label), datasets:[{label:unit,data:arr.map(valFn),backgroundColor:arr.map(colorFn||(()=>cvar('--chart-leads'))),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:28}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>intf(c.raw)+' '+unit}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,precision:0,font:{size:10}},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10},callback:function(v){ return fitAxisLabel(this.getLabelForValue(v), Math.max(60,(this.chart.width-28)/2-16)); }},grid:{display:false}}}}});
}
const barLabels={id:'barLabels',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(!v)return; ctx.fillText(intf(v),el.x+5,el.y);});ctx.restore();}};

/* Indicadores por dia (aba Meta Ads): séries de taxas calculadas do `daily()`.
   series: [{label,fn(x)->valor|null,type:'brl'|'pct'|'num',axis:'y'|'y1',color}] */
const fmtByType=t=> t==='brl'?brl : t==='num'?num2f : pct;
function indChart(id, d, series){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const mut=cmuted(), dual=series.some(s=>s.axis==='y1');
  const tick=t=>v=>fmtByType(t)(v);
  charts[id]=new Chart(el,{type:'line',
    data:{labels:d.map(x=>x.d.slice(5)), datasets:series.map(s=>({label:s.label,
      data:d.map(x=>{const v=s.fn(x); return v==null||!isFinite(v)?null:v;}),
      borderColor:s.color,backgroundColor:s.color,yAxisID:s.axis||'y',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25}))},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const s=series[c.datasetIndex]; return s.label+': '+(c.raw==null?'-':fmtByType(s.type)(c.raw));}}}},
      scales:Object.assign({x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',beginAtZero:true,ticks:{color:mut,font:{size:10},callback:tick(series[0].type)},grid:{color:cgrid()}}},
        dual?{y1:{position:'right',beginAtZero:true,ticks:{color:mut,font:{size:10},callback:tick(series.find(s=>s.axis==='y1').type)},grid:{display:false}}}:{})}});
}
function renderIndicadores(d){
  const pal=chartPalette(), dd=x=>derive(x);
  indChart('mIndCpmCtr', d, [
    {label:'CPM',fn:x=>dd(x).cpm,type:'brl',axis:'y',color:cvar('--chart-gasto')||pal[2]},
    {label:'CTR',fn:x=>dd(x).ctr,type:'pct',axis:'y1',color:pal[0]}]);
  indChart('mIndConv', d, [
    {label:'Connect Rate',fn:x=>dd(x).cr,type:'pct',axis:'y',color:pal[1]},
    {label:'ConvLP',fn:x=>dd(x).convlp,type:'pct',axis:'y1',color:pal[3]}]);
  indChart('mIndCpl', d, [
    {label:'CPL',fn:x=>dd(x).cpl,type:'brl',axis:'y',color:cvar('--chart-cpl')||pal[4]},
    {label:'CPMQL',fn:x=>dd(x).cpmql,type:'brl',axis:'y',color:cvar('--chart-cpmql')||pal[3]}]);
}

/* Donut de conversão da landing page (Page View → lead): verde = visitas que
   viraram lead · cinza = não converteram. ConvLP = Leads/Page Views. */
function donutConv(id, leads, pv){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const naoConv=Math.max(0,pv-leads);
  charts[id]=new Chart(el,{type:'doughnut',
    data:{labels:['Virou lead','Não converteu'],datasets:[{data:[leads,naoConv],
      backgroundColor:[cvar('--good'),cvar('--bar-noq')],borderColor:cvar('--surface'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+intf(c.raw)+(pv?' ('+pct(c.raw/pv)+')':'')}}}}});
  const el2=document.getElementById('mConvPct'); if(el2) el2.textContent=pct(pv?leads/pv:null);
}
/* CPL por dimensão (campanha/conjunto/anúncio) por dia — 1 linha por membro.
   Legenda é um painel HTML próprio (fora do canvas) — a legenda NATIVA do Chart.js
   quebra/trunca nomes longos porque respeita a largura do canvas; a nossa não.
   Formato de cada linha: [quadrado da cor] Nome completo ... CPL.
   Clique numa linha da legenda OU numa linha do gráfico filtra a tabela (selDim);
   quando a tabela já tem seleção (STATE.mSel*), o gráfico plota SÓ as linhas
   selecionadas (a legenda continua listando todas p/ dar pra trocar a seleção). */
function cplByDimChart(id, fL, fM, agg, dim, selSet){
  destroy(id); const el=document.getElementById(id); const legEl=document.getElementById(id+'Legend');
  if(!el) return;
  const days=[...new Set([...fL,...fM].filter(r=>r.d).map(r=>r.d))].sort();
  // ordena por CPL (melhor primeiro; sem lead/gasto fica no fim) — ordem estável p/ cor e legenda
  const members=[...new Set(fL.map(r=>r[dim]))].sort((a,b)=>{
    const ca=agg[a]?derive(agg[a]).cpl:null, cb=agg[b]?derive(agg[b]).cpl:null;
    if(ca==null&&cb==null) return 0; if(ca==null) return 1; if(cb==null) return -1; return ca-cb;
  });
  const pal=chartPalette(), mut=cmuted();
  const dimChar={'camp':'C','adset':'A','ad':'D'}[dim]||'C';
  const plotMembers = (selSet&&selSet.size) ? members.filter(m=>selSet.has(m)) : members;
  // métrica do gráfico: CUSTO POR LEAD por dia (gasto do dia / leads do dia), não contagem
  const dsets=plotMembers.map(mv=>{
    const idx=members.indexOf(mv);
    const spDay={}, leadDay={}; days.forEach(d=>{spDay[d]=0; leadDay[d]=0;});
    fM.forEach(r=>{ if(r[dim]===mv && r.d!=null && spDay[r.d]!=null) spDay[r.d]+=r.sp; });
    fL.forEach(r=>{ if(r[dim]===mv && r.d!=null && leadDay[r.d]!=null) leadDay[r.d]+=1; });
    const data=days.map(d=> (leadDay[d]>0&&spDay[d]>0) ? +((spDay[d]*taxf())/leadDay[d]).toFixed(2) : null);
    const col=pal[idx%pal.length];
    return {label:String(mv), data, borderColor:col, backgroundColor:col, borderWidth:2, pointRadius:2, tension:.25, spanGaps:true};
  });
  charts[id]=new Chart(el,{type:'line',
    data:{labels:days.map(d=>d.slice(5)), datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},
      // clique em qualquer ponto/linha do gráfico filtra igual clicar na linha da tabela
      onClick:(e,act)=>{ if(act.length){ const idx=act[0].datasetIndex;
        if(idx!=null&&dsets[idx]) selDim(dimChar,dsets[idx].label,false); } },
      plugins:{
        legend:{display:false},   // legenda nativa desligada — usamos o painel HTML abaixo
        // tooltip: nome COMPLETO do dataset + CPL do dia (array = 2 linhas, nunca trunca)
        tooltip:{displayColors:true,
          callbacks:{title:()=>'', label:c=>[c.dataset.label, (c.raw==null?'-':brl(c.raw))+' / lead']}}
      },
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:mut,font:{size:9},callback:v=>'R$'+nf0.format(v)},grid:{color:cgrid()},beginAtZero:true}}
    }
  });
  // painel de legenda HTML: quadrado da cor | nome completo (1 linha, nunca corta) | CPL
  if(legEl){
    legEl.innerHTML = members.map((mv,idx)=>{
      const col=pal[idx%pal.length];
      const cpl = agg[mv]!=null ? derive(agg[mv]).cpl : null;
      const sel = !!(selSet && selSet.has(mv));
      return `<div class="cl-row${sel?' sel':''}" data-mv="${escHtml(mv)}" title="${escHtml(mv)}">`
        +`<span class="cl-swatch" style="background:${col}"></span>`
        +`<span class="cl-name">${escHtml(mv)}</span>`
        +`<span class="cl-val">${brl(cpl)}</span></div>`;
    }).join('');
    legEl.querySelectorAll('.cl-row').forEach(row=>{
      row.addEventListener('click',()=>selDim(dimChar,row.dataset.mv,false));
    });
  }
}

/* ---------------- KPI cards ---------------- */
function kpiCard(k){ return `<div class="kpi ${k.hero?'hero':''}"><div class="kl"><span>${k.label}</span>${k.pill?`<span class="pill q">${k.pill}</span>`:''}</div><div class="kv ${k.cls||''}">${k.val}</div><div class="ka">${k.aux||''}</div></div>`; }

/* ---------------- PAGE 1: Visão Geral ---------------- */
/* IDs dos elementos por página — a Visão Geral e o Insights de IA compartilham o
   MESMO corpo (renderGeralCore), só mudam os alvos no DOM. */
const GERAL_IDS={funnel:'geralFunnel',kpis2:'geralKpis2',combo:'gCombo',daily:'gDaily',
  adset:'gAdset',fat:'gFat',papel:'gPapel',desafio:'gDesafio',mqlAd:'gMqlAd',mqlAdset:'gMqlAdset',orig:'gOrig',comp:'gComp'};
const REL_IDS  ={funnel:'relFunnel', kpis2:'relKpis2', combo:'rCombo',daily:'rDaily',
  adset:'rAdset',fat:'rFat',papel:'rPapel',desafio:'rDesafio',mqlAd:'rMqlAd',mqlAdset:'rMqlAdset',orig:'rOrig',comp:'rComp'};
/* rótulos entre parênteses ("(orgânico · sem anúncio)", "(sem UTM de anúncio)")
   não são anúncios reais — ficam fora dos rankings de anúncio. */
const isRealDim=k=>!!k && String(k).charAt(0)!=='(';
/* rótulo curto da faixa de faturamento p/ o eixo do gráfico:
   "De R$ 50 mil a R$ 100 mil" -> "R$ 50 a 100 mil" · "De R$ 500 mil a R$ 1 milhão" -> "R$ 500 mil a 1 mi" */
function shortFat(s){
  const t=String(s||'').replace(/milh(ão|ões|ao|oes)/gi,'mi').replace(/\s+/g,' ').trim();
  const m=t.match(/^de r\$ ?([\d.,]+) ?(mil|mi)? a r\$ ?([\d.,]+) ?(mil|mi)?$/i);
  if(!m) return t.replace(/R\$ /g,'R$ ');
  const u1=m[2]||'', u2=m[4]||'';
  return u1===u2 ? `R$ ${m[1]} a ${m[3]}${u2?' '+u2:''}` : `R$ ${m[1]}${u1?' '+u1:''} a ${m[3]}${u2?' '+u2:''}`;
}
function renderGeral(){ renderGeralCore(GERAL_IDS); }
function renderGeralCore(ids){
  const fL=leadsActive(), fM=metaActive();
  const t=totals(fL,fM), dv=derive(t), g=dv.gasto;
  document.getElementById(ids.funnel).innerHTML=funnelHTML(funnelSteps(t)); fitFunnelValues();
  // ---- métricas secundárias (não repetem o funil) ----
  const dd=daily(fL,fM), nDays=dd.length||1;
  const fLpago=fL.filter(l=>l.src==='meta'), nSocial=fL.length-fLpago.length;
  const adAgg=buildAgg(fLpago,fM,'ad');
  let topAd=null, bestAd=null, bestAdMql=null, nAdsAtivos=0;
  Object.entries(adAgg).forEach(([ad,a])=>{
    if(a.sp>0) nAdsAtivos++;
    if(!isRealDim(ad)) return;
    if(a.leads>0&&(topAd==null||a.leads>topAd.m)) topAd={ad,m:a.leads};
    if(a.leads>0&&a.sp>0){ const c=(a.sp*taxf())/a.leads; if(bestAd==null||c<bestAd.v) bestAd={ad,v:c}; }
    if(a.mqls>0&&a.sp>0){ const c=(a.sp*taxf())/a.mqls; if(bestAdMql==null||c<bestAdMql.v) bestAdMql={ad,v:c,m:a.mqls}; }
  });
  const nCampAtivas=Object.values(buildAgg(fLpago,fM,'camp')).filter(a=>a.sp>0).length;
  const concTop=(fLpago.length&&topAd)?topAd.m/fLpago.length:null;
  const nTrk=fLpago.filter(l=>l.trk).length;
  const comCpl=dd.filter(x=>x.leads>0&&x.sp>0).map(x=>({d:x.d, v:(x.sp*taxf())/x.leads}));
  const melhorDia=comCpl.length?comCpl.reduce((a,b)=>b.v<a.v?b:a):null;
  const adShort=s=>{ s=String(s||'—'); return s.length>22?s.slice(0,21)+'…':s; };
  const k2=[
    {label:'Leads por dia (média)',val:numf(t.leads/nDays),aux:brl(g/nDays)+' de gasto/dia'},
    {label:'MQLs por dia (média)',val:numf(t.mqls/nDays),aux:'Tx MQL '+pct(dv.txmql)+' dos leads'},
    {label:'Melhor CPL (anúncio)',val:bestAd?brl(bestAd.v):'-',aux:bestAd?adShort(bestAd.ad):'—'},
    {label:'Melhor CPMQL (anúncio)',val:bestAdMql?brl(bestAdMql.v):'-',aux:bestAdMql?adShort(bestAdMql.ad)+' · '+intf(bestAdMql.m)+' MQL':'—'},
    {label:'Melhor dia (CPL)',val:melhorDia?brl(melhorDia.v):'-',aux:melhorDia?brdate(melhorDia.d)+' · '+weekday(melhorDia.d):'—'},
    {label:'Top anúncio (leads)',val:topAd?intf(topAd.m):'-',aux:topAd?adShort(topAd.ad):'—'},
    {label:'Concentração top anúncio',val:pct(concTop),aux:'% dos leads pagos no top anúncio'},
    {label:'Anúncios ativos',val:intf(nAdsAtivos),aux:intf(nCampAtivas)+' campanhas c/ gasto'},
    {label:'% Eficácia Rastr.',val:pct(fLpago.length?nTrk/fLpago.length:null),aux:'Leads pagos c/ anúncio (UTMs) na aba de Queries'},
    {label:'Origem dos leads',val:intf(fLpago.length)+' : '+intf(nSocial),aux:'Tráfego pago : Social (orgânico)'},
  ];
  document.getElementById(ids.kpis2).innerHTML=k2.map(kpiCard).join('');
  comboChart(ids.combo, dd);
  // distribuição: contagem de leads (ou MQLs) por uma dimensão do lead
  const countBy=(arr,key)=>{ const m={}; arr.forEach(l=>{ const k=l[key]||'Sem resposta'; m[k]=(m[k]||0)+1; });
    return Object.entries(m).map(([label,leads])=>({label,leads})); };
  const fLmql=fL.filter(l=>l.q);
  hbar(ids.adset, countBy(fLpago,'adset'), x=>x.leads, ()=>cvar('--chart-leads'), 10);
  // faixas de faturamento da menor para a maior; verde = faixa MQL (acima de R$ 50 mil)
  const fatMap={}; fL.forEach(l=>{ const k=l.fat||'Sem resposta';
    const it=fatMap[k]||(fatMap[k]={label:shortFat(k),leads:0,v:(l.fatv==null?Infinity:l.fatv),q:l.q}); it.leads+=1; });
  hbar(ids.fat, Object.values(fatMap).sort((a,b)=>a.v-b.v), x=>x.leads, x=>x.q?cvar('--bar-q'):cvar('--bar-noq'), null, 'leads', true);
  hbar(ids.papel, countBy(fL,'papel'), x=>x.leads, ()=>cvar('--chart-leads'));
  hbar(ids.desafio, countBy(fL,'desafio'), x=>x.leads, ()=>cvar('--chart-leads'), 10);
  hbar(ids.mqlAd, countBy(fLmql.filter(l=>l.src==='meta'),'ad'), x=>x.leads, ()=>cvar('--chart-mqls'), 10, 'MQLs');
  hbar(ids.mqlAdset, countBy(fLmql.filter(l=>l.src==='meta'),'adset'), x=>x.leads, ()=>cvar('--chart-mqls'), 10, 'MQLs');
  hbar(ids.orig, countBy(fL,'orig'), x=>x.leads, ()=>cvar('--chart-leads'));
  hbar(ids.comp, countBy(fL,'comp'), x=>x.leads, ()=>cvar('--chart-leads'));
  // tabela diaria (todos os leads), ultimo dia no topo + heatmap
  const dl=dd.slice().reverse();
  renderTable({id:ids.daily, cols:DAILY_COLS, center:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:(()=>{const d=derive(t);return dailyCells({...t,d:null},d,true);})(),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
}
/* ---------------- PAGE 3: Insights de IA ----------------
   Espelha a Visão Geral (renderGeralCore com IDs próprios) e, abaixo, acrescenta
   Metas & parâmetros · Top Anúncios · Insights de Tráfego. */
const SAMPLE_MIN_SPEND = (B.sample_min_spend!=null?B.sample_min_spend:100);
const SAMPLE_MIN_LEADS = (B.sample_min_leads!=null?B.sample_min_leads:3);
const escHtml=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ---- Metas & parâmetros (painel editável) — ajusta cores/status AO VIVO ----
   Defaults vêm do build.py; o usuário edita no painel (persistido em
   localStorage) e a tabela de anúncios recolore o CPL e reavalia o status na
   hora. Meta null = "não definida" (métrica fica sem cor). */
const METAS_DEFAULT = {
  cpl:   (B.meta_cpl!=null?B.meta_cpl:null),
  cpmql: (B.meta_cpmql!=null?B.meta_cpmql:null),
  volMin:(B.volume_min_amostral!=null?B.volume_min_amostral:SAMPLE_MIN_LEADS),
  nDias: (B.n_dias_corte!=null?B.n_dias_corte:5),
};
function loadMetas(){
  const saved=lsGet(LS_METAS,{})||{};
  const m={...METAS_DEFAULT};
  if(saved.cpl!=null&&isFinite(saved.cpl)) m.cpl=saved.cpl; else if('cpl' in saved && saved.cpl===null) m.cpl=null;
  if(saved.cpmql!=null&&isFinite(saved.cpmql)) m.cpmql=saved.cpmql; else if('cpmql' in saved && saved.cpmql===null) m.cpmql=null;
  if(saved.volMin!=null&&isFinite(saved.volMin)&&saved.volMin>=1) m.volMin=saved.volMin;
  if(saved.nDias!=null&&isFinite(saved.nDias)&&saved.nDias>=1) m.nDias=saved.nDias;
  return m;
}
const METAS = loadMetas();
function saveMetas(){ lsSet(LS_METAS, METAS); }
/* código de cor de um CUSTO vs meta (menor=melhor): verde ≤ meta; amarelo até
   meta×1,3 (atenção); vermelho acima (teto). Meta não definida => sem cor. */
function metaColorClass(v, meta){
  if(meta==null||v==null||!isFinite(v)||!isFinite(meta)||meta<=0) return '';
  if(v<=meta) return 'mc-green';
  if(v<=meta*1.3) return 'mc-yellow';
  return 'mc-red';
}

/* ad -> (campanha, conjunto) dominantes por gasto no Meta (fallback: lead).
   Um anúncio pode rodar em mais de uma campanha/conjunto; fica com a combinação
   de maior gasto. */
function adStructMap(fM,fL){
  const acc={};
  fM.forEach(r=>{ const byCamp=acc[r.ad]=acc[r.ad]||{};
    const byAdset=byCamp[r.camp]=byCamp[r.camp]||{};
    byAdset[r.adset]=(byAdset[r.adset]||0)+r.sp; });
  const out={};
  Object.entries(acc).forEach(([ad,byCamp])=>{
    let best=null;
    Object.entries(byCamp).forEach(([camp,byAdset])=>{
      Object.entries(byAdset).forEach(([adset,sp])=>{
        if(!best||sp>best.sp) best={camp,adset,sp};
      });
    });
    out[ad]={camp:best.camp,adset:best.adset};
  });
  fL.forEach(r=>{ if(!out[r.ad]) out[r.ad]={camp:r.camp,adset:r.adset}; });
  return out;
}
/* amostra relevante para JULGAR o anúncio (senão: "Observar"). O limiar de
   leads vem do painel de metas (volume mínimo amostral), editável ao vivo. */
function adSampleOk(a){ return a.sp>=SAMPLE_MIN_SPEND && a.leads>=METAS.volMin; }
/* O resultado mais profundo desta dash é o MQL: mais MQLs primeiro, depois mais
   leads e, no empate, menor CPL. */
function cmpBest(a,b){                       // <0 => a antes (melhor)
  if(a.mqls!==b.mqls) return b.mqls-a.mqls;
  if(a.leads!==b.leads) return b.leads-a.leads;
  const ca=derive(a).cpl, cb=derive(b).cpl;
  return (ca==null?Infinity:ca)-(cb==null?Infinity:cb); }

function adRowCells(ad,a,struct){
  const d=derive(a);
  return {ad, camp:struct.camp, adset:struct.adset,
    gasto:d.gasto, im:a.im, cpm:d.cpm, rc:a.rc, freq:d.freq,
    cl:a.cl, ctr:d.ctr, cpc:d.cpc, pv:a.pv, cr:d.cr, convlp:d.convlp,
    leads:a.leads, cpl:d.cpl, txmql:d.txmql, mqls:a.mqls, cpmql:d.cpmql,
    _cpl:d.cpl, _cpmql:d.cpmql, status:null};   // valores crus p/ colorir vs meta
}
/* status do anúncio (Top Anúncios) vs. meta de CPL do painel. Sem amostra
   relevante => "Observar"; com amostra, a cor de metaColorClass (verde/amarelo/
   vermelho vs meta) mapeia para Escalar/Manter/Cortar; sem meta definida
   (metaColorClass vazio) fica "Manter" (neutro). */
function adStatusState(a){
  if(!adSampleOk(a)) return 'observar';
  const mc = metaColorClass(derive(a).cpl, METAS.cpl);
  if(mc==='mc-green') return 'escalar';
  if(mc==='mc-red') return 'cortar';
  return 'manter';
}
const STATUS_CHIP={
  escalar:'<span class="rel-chip c-green">Escalar</span>',
  manter:'<span class="rel-chip c-blue">Manter</span>',
  observar:'<span class="rel-chip c-yellow">Observar</span>',
  cortar:'<span class="rel-chip c-red">Cortar</span>',
};
const statusChip=state=>STATUS_CHIP[state]||STATUS_CHIP.observar;
function relRenderAdTable(id,list){
  const el=document.getElementById(id); if(!el) return;
  const cols=[
    {key:'ad',label:'Anúncio',type:'dim',big:true,stk:'l'},{key:'status',label:'Status',type:'dim',w:110},
    {key:'camp',label:'Campanha',type:'dim',big:true},{key:'adset',label:'Conjunto',type:'dim',big:true},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
    {key:'rc',label:'Alcance',type:'int'},{key:'freq',label:'Freq.',type:'num2'},
    {key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},{key:'cpc',label:'CPC',type:'brl'},
    {key:'pv',label:'Page Views',type:'int'},{key:'cr',label:'Connect',type:'pct'},{key:'convlp',label:'ConvLP',type:'pct'},
    {key:'leads',label:'Leads',type:'int'},{key:'cpl',label:'CPL',type:'brl'},
    {key:'txmql',label:'Tx MQL',type:'pct'},{key:'mqls',label:'MQLs',type:'int'},{key:'cpmql',label:'CPMQL',type:'brl'},
  ];
  const rows=list.map(item=>{
    const cells=adRowCells(item.ad,item.a,item.struct);
    cells.status='';  // placeholder textual; o chip real entra via afterRender
    return {k:item.ad, cells, _state:adStatusState(item.a), _cpl:cells._cpl, _cpmql:cells._cpmql};
  });
  renderTable({
    id, cols, rows, center:true,   // Mar10: só as MÉTRICAS centralizam; dim fica à esquerda (CSS .dt-center)
    // roda em TODA renderização (inclusive ao ordenar por um cabeçalho) — chip de
    // status e cor de meta (CPL) nunca somem ao clicar pra ordenar
    afterRender:(table,sortedRows)=>{
      table.querySelectorAll('tbody tr').forEach((tr,idx)=>{
        const item=sortedRows[idx]; if(!item) return;
        const tds=tr.querySelectorAll('td');
        cols.forEach((c,ci)=>{
          if(ci>=tds.length) return;
          const td=tds[ci];
          if(c.key==='status') td.innerHTML=statusChip(item._state);
          if(c.key==='cpl'){ const mc=metaColorClass(item._cpl,METAS.cpl); if(mc) td.classList.add(mc); }
          if(c.key==='cpmql'){ const mc=metaColorClass(item._cpmql,METAS.cpmql); if(mc) td.classList.add(mc); }
        });
      });
    }
  });
}

function relBriefKey(){ if(STATE.selDays.size) return null; return STATE.preset||null; }

/* Nota de saúde do funil: cor por faixa (mesmas faixas de build/relatorio_lib.py::_classificacao) */
function healthClass(nota){
  if(nota==null) return 'rh-none';
  if(nota>=8) return 'rh-excelente';
  if(nota>=6.5) return 'rh-saudavel';
  if(nota>=5) return 'rh-atencao';
  if(nota>=3) return 'rh-critico';
  return 'rh-critico-grave';
}

function renderHealthBadge(ns){
  if(!ns) return '';
  const cls=healthClass(ns.nota);
  const notaTxt = ns.nota==null ? '—/10' : nf1.format(ns.nota)+'/10';
  const prov = ns.provisoria ? '<span class="rh-prov">Nota provisória</span>' : '';
  const motivo = ns.motivo ? `<p class="rh-motivo">${ns.motivo}</p>` : '';
  const subnotas = ns.subnotas ? Object.entries(ns.subnotas)
    .map(([k,v])=>`<span class="rh-sub">${k.replace(/_/g,' ')}: ${v==null?'—':nf1.format(v)}</span>`).join('') : '';
  return `<div class="rel-health ${cls}">
    <div class="rh-top"><span class="rh-nota">${notaTxt}</span><span class="rh-classe">${ns.classificacao||''}</span>${prov}</div>
    ${motivo}
    <div class="rh-subs">${subnotas}</div>
  </div>`;
}

function renderWhatsappBlock(texto){
  if(!texto) return '';
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div class="rel-wa">
    <div class="rel-wa-head"><b>Bloco para copiar (WhatsApp)</b>
      <button type="button" class="rel-wa-copy" onclick="copyWhatsappBlock(this)">Copiar</button>
    </div>
    <pre class="rel-wa-box" id="relWaText">${esc(texto)}</pre>
  </div>`;
}

function copyWhatsappBlock(btn){
  const el=document.getElementById('relWaText'); if(!el) return;
  const text=el.textContent;
  const done=()=>{ const old=btn.textContent; btn.textContent='Copiado!'; setTimeout(()=>{btn.textContent=old;},1500); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done)); }
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); }catch(e){}
  document.body.removeChild(ta);
}

const QUAD_TITLES={
  quadro1_resumo:'1 · Resumo executivo e saúde do funil',
  quadro2_diagnostico:'2 · Diagnóstico do funil',
  quadro3_campeoes:'3 · Campanhas, estruturas e anúncios campeões',
  quadro4_acoes:'4 · Ações priorizadas',
};

function renderRelBrief(){
  const wrap=document.getElementById('relBrief'), stampEl=document.getElementById('relBriefStamp');
  const bf=DATA.briefings||{}, per=bf.periodos||{}, key=relBriefKey();
  stampEl.textContent = bf.generated_at ? `Insights gerados por IA · última atualização ${bf.generated_at} · atualiza 1×/dia (23h59 BRT)` : '';
  if(!Object.keys(per).length){
    wrap.innerHTML='<div class="rel-brief-empty">Os insights por IA ainda não foram gerados. São atualizados automaticamente 1×/dia.</div>'; return; }
  if(!key || !per[key]){
    wrap.innerHTML='<div class="rel-brief-empty">Insights disponíveis para os períodos predefinidos (Hoje, Ontem, 3, 7, 14, 30 dias, Este mês, Mês passado, Todo período). Selecione um desses no seletor de período.</div>'; return; }
  const item=per[key];

  // Schema novo (4 quadrantes + nota de saúde + bloco WhatsApp)
  const temQuadrantes = item.quadro1_resumo || item.quadro2_diagnostico || item.quadro3_campeoes || item.quadro4_acoes;
  if(temQuadrantes){
    const quads = Object.keys(QUAD_TITLES).map(k=>
      `<div class="rel-quad-card"><h4>${QUAD_TITLES[k]}</h4><div class="rel-quad-body rel-brief">${item[k]||'<p>—</p>'}</div></div>`
    ).join('');
    wrap.innerHTML = renderHealthBadge(item.nota_saude) + renderWhatsappBlock(item.whatsapp) +
      `<div class="rel-quad-grid">${quads}</div>`;
    return;
  }

  // Fallback: schema antigo (bloco único de html/texto)
  wrap.innerHTML = item.html || item.texto || '<div class="rel-brief-empty">Sem conteúdo.</div>';
}

/* Top Anúncios (separado p/ recolorir sem re-renderizar os gráficos quando o
   usuário edita as metas). Considera todos os leads + gasto do período e mostra
   TODOS os anúncios com gasto (com amostra relevante primeiro, depois pelo
   volume de leads/CPL). O pill do título mostra quantos foram avaliados DE
   quantos anúncios no total. */
function renderRelAds(){
  const fL=leadsActive(), fM=metaActive();
  const struct=adStructMap(fM,fL);
  const agg=buildAgg(fL,fM,'ad');
  const pool=Object.entries(agg).filter(([ad,a])=>a.sp>0).map(([ad,a])=>({ad, a, struct:struct[ad]||{camp:'—',adset:'—'}}));

  const all=pool.slice().sort((x,y)=>{ const sx=adSampleOk(x.a), sy=adSampleOk(y.a);
    if(sx!==sy) return sx?-1:1; return cmpBest(x.a,y.a); });
  const avaliados=all.filter(it=>adSampleOk(it.a)).length;

  relRenderAdTable('relTop',all);
  document.getElementById('relTopCount').textContent =
    avaliados+' avaliado'+(avaliados===1?'':'s')+' de '+all.length+' anúncio'+(all.length===1?'':'s')+' com gasto';
}

/* nota de referência do painel de metas (mostra as metas ativas + legenda de cor) */
function renderMetasNote(){
  const el=document.getElementById('relMetasNote'); if(!el) return;
  const cpl=METAS.cpl==null?'<b>não definida</b>':('<b>'+brl(METAS.cpl)+'</b>');
  const cpmql=METAS.cpmql==null?'<b>não definida</b>':('<b>'+brl(METAS.cpmql)+'</b>');
  el.innerHTML=`Referência ativa — Meta CPL: ${cpl} · Meta CPMQL: ${cpmql} · Amostra mínima: <b>${brl(SAMPLE_MIN_SPEND)}</b> de gasto e <b>${intf(METAS.volMin)} leads</b> · Corte após <b>${intf(METAS.nDias)} dias</b> acima do teto. `
    +(METAS.cpl==null?'Preencha a meta de CPL para colorir o CPL e classificar Escalar/Cortar na tabela de anúncios (a meta de CPMQL colore a coluna CPMQL).':'')
    +' Código de cor (CPL/CPMQL): <span class="mc-lg mc-green">verde ≤ meta</span> <span class="mc-lg mc-yellow">amarelo até +30%</span> <span class="mc-lg mc-red">vermelho acima</span>.';
}
function syncMetasInputs(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=(v==null?'':v); };
  set('metaCpl',METAS.cpl); set('metaCpmql',METAS.cpmql); set('metaVolMin',METAS.volMin); set('metaNdias',METAS.nDias);
  renderMetasNote();
}

function renderRelatorio(){
  renderGeralCore(REL_IDS);   // espelho da Visão Geral (funil, KPIs, gráficos, tabela diária)

  // cabeçalho do período
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  document.getElementById('relPeriodName').textContent = STATE.selDays.size?'Dias selecionados':(pr?pr[1]:'Personalizado');
  let rangeTxt='';
  if(STATE.from&&STATE.to){ const nD=Math.round((new Date(STATE.to+'T00:00:00')-new Date(STATE.from+'T00:00:00'))/86400000)+1;
    rangeTxt=`${brdate(STATE.from)} a ${brdate(STATE.to)}`+(nD>0?` · ${nD} dia${nD>1?'s':''}`:''); }
  document.getElementById('relPeriodRange').textContent=rangeTxt;

  renderMetasNote();
  renderRelAds();
  renderRelBrief();
}

/* colunas padrão das tabelas de heatmap por dia (ordem do template:
   Data · Dia · Gasto · CPM · CTR · <etapa da LP> · conversão · Leads · CPL · Tx MQL · MQLs · CPMQL) */
const DAILY_COLS=[
  {key:'date',label:'Data',type:'date'},{key:'wd',label:'Dia',type:'dim',w:44},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto'},{key:'cpm',label:'CPM',type:'brl'},
  {key:'ctr',label:'CTR',type:'pct'},{key:'cr',label:'Connect',type:'pct'},
  {key:'convlp',label:'ConvLP',type:'pct'},
  {key:'leads',label:'Leads',type:'int',heat:'leads'},{key:'cpl',label:'CPL',type:'brl'},
  {key:'txmql',label:'Tx MQL',type:'pct'},{key:'mqls',label:'MQLs',type:'int',heat:'mqls'},{key:'cpmql',label:'CPMQL',type:'brl'},
];
function dailyCells(x,d,isTotal){
  return {date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d), gasto:d.gasto, cpm:d.cpm,
    ctr:d.ctr, cr:d.cr, convlp:d.convlp, leads:x.leads, cpl:d.cpl,
    txmql:d.txmql, mqls:x.mqls, cpmql:d.cpmql};
}

/* ---------------- PAGE 2: Meta Ads ---------------- */
/* A aba de mídia paga olha SÓ os leads de tráfego pago (utm_medium =
   trafego-pago, src="meta") — os leads "social" (orgânicos) entram na Visão
   Geral, mas não têm campanha/anúncio para cruzar com o gasto. Filtro cruzado
   por Campanha/Conjunto/Anúncio. */
function metaScope(ex){ let fL=leadsActive().filter(l=>l.src==='meta'), fM=metaActive();
  if(ex!=='C'&&STATE.mSelC.size){ fL=fL.filter(r=>STATE.mSelC.has(r.camp)); fM=fM.filter(r=>STATE.mSelC.has(r.camp)); }
  if(ex!=='A'&&STATE.mSelA.size){ fL=fL.filter(r=>STATE.mSelA.has(r.adset)); fM=fM.filter(r=>STATE.mSelA.has(r.adset)); }
  if(ex!=='D'&&STATE.mSelAd.size){ fL=fL.filter(r=>STATE.mSelAd.has(r.ad)); fM=fM.filter(r=>STATE.mSelAd.has(r.ad)); }
  return {fL,fM}; }
/* selecao multipla: Ctrl adiciona (OR) sem sumir as demais linhas; clique simples troca a ancora */
function selDim(dim,key,ctrl){
  const sets={C:STATE.mSelC,A:STATE.mSelA,D:STATE.mSelAd}, s=sets[dim];
  if(ctrl){ s.has(key)?s.delete(key):s.add(key); }
  else { const sole=s.has(key)&&s.size===1&&!Object.entries(sets).some(([k2,x])=>k2!==dim&&x.size);
    Object.values(sets).forEach(x=>x.clear()); if(!sole) s.add(key); }
  renderMeta();
}
function renderMeta(){
  const F=metaScope(null), fL=F.fL, fM=F.fM;   // KPIs, funil, graficos e tabela diaria
  const t=totals(fL,fM);
  document.getElementById('metaFunnel').innerHTML=funnelHTML(funnelSteps(t)); fitFunnelValues();

  const dMeta=daily(fL,fM);
  comboChart('mCombo', dMeta);
  renderIndicadores(dMeta);
  // barras de leads por anúncio (top 10)
  const leadsByAd={}; fL.forEach(l=>{ leadsByAd[l.ad]=(leadsByAd[l.ad]||0)+1; });
  hbar('mLeadAd', Object.entries(leadsByAd).map(([label,leads])=>({label,leads})), x=>x.leads, ()=>cvar('--chart-leads'), 10, 'leads');
  // donut de conversão da landing page (page view -> lead)
  donutConv('mConvDonut', t.leads, t.pv);
  // Compilado dos Anúncios — menor CPL no topo (só anúncio com gasto E lead:
  // sem gasto não há CPL; sem lead o CPL é indefinido)
  const adAggM=buildAgg(fL,fM,'ad');
  const topCplRows=Object.entries(adAggM).filter(([,a])=>a.sp>0&&a.leads>0).map(([ad,a])=>{const d=derive(a);
    return {k:ad, cells:{dim:ad,gasto:d.gasto,pv:a.pv,leads:a.leads,convlp:d.convlp,cpl:d.cpl,mqls:a.mqls,cpmql:d.cpmql}, _ord:d.cpl};})
    .sort((a,b)=>a._ord-b._ord).slice(0,10);
  // sem fit: largura automática por coluna + scroll horizontal dentro do próprio card
  renderTable({id:'mTopCpl', center:true,
    cols:[{key:'dim',label:'Anúncios',type:'dim',big:true},{key:'leads',label:'Leads',type:'int'},
      {key:'cpl',label:'CPL',type:'brl'},{key:'mqls',label:'MQLs',type:'int'},{key:'cpmql',label:'CPMQL',type:'brl'},
      {key:'gasto',label:'Gasto',type:'brl'},{key:'pv',label:'Page Views',type:'int'},{key:'convlp',label:'ConvLP',type:'pct'}],
    rows:topCplRows});

  const dl=dMeta.slice().reverse();
  renderTable({id:'tDaily', cols:DAILY_COLS, center:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:(()=>{const d=derive(t);return dailyCells({...t,d:null},d,true);})(),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });

  // hierarquia — cada tabela vem do escopo que exclui a PRÓPRIA dimensão,
  // então todas as linhas irmãs continuam visíveis para multi-seleção (Ctrl).
  // dim+Gasto ficam sticky (stk:'l') na borda esquerda; as demais colunas
  // rolam horizontalmente dentro da MESMA tabela (ver stkOffsets em renderTable).
  const hcols=[
    {key:'dim',label:'',type:'dim',big:true,stk:'l'},{key:'gasto',label:'Gasto',type:'brl',stk:'l'},
    {key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
    {key:'rc',label:'Alcance',type:'int'},{key:'freq',label:'Freq.',type:'num2'},
    {key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},{key:'cpc',label:'CPC',type:'brl'},
    {key:'pv',label:'Page Views',type:'int'},{key:'cr',label:'Connect',type:'pct'},{key:'cpv',label:'CPV',type:'brl'},
    {key:'convlp',label:'ConvLP',type:'pct'},
    {key:'leads',label:'Leads',type:'int'},{key:'cpl',label:'CPL',type:'brl'},
    {key:'txmql',label:'Tx MQL',type:'pct'},{key:'mqls',label:'MQLs',type:'int'},{key:'cpmql',label:'CPMQL',type:'brl'},
  ];
  const hcells=(k,a)=>{const d=derive(a);
    return {dim:k,gasto:d.gasto,im:a.im,cpm:d.cpm,rc:a.rc,freq:d.freq,cl:a.cl,ctr:d.ctr,cpc:d.cpc,
      pv:a.pv,cr:d.cr,cpv:d.cpv,convlp:d.convlp,leads:a.leads,cpl:d.cpl,txmql:d.txmql,mqls:a.mqls,cpmql:d.cpmql};};
  function hierRows(map){ return Object.entries(map).map(([k,a])=>({k, cells:hcells(k,a)})); }
  function totRowOf(tt){ return hcells(null,tt); }
  const Sc=metaScope('C'), Sa=metaScope('A'), Sd=metaScope('D');
  const aggC=buildAgg(Sc.fL,Sc.fM,'camp'), aggA=buildAgg(Sa.fL,Sa.fM,'adset'), aggD=buildAgg(Sd.fL,Sd.fM,'ad');
  // Tabelas hierárquicas: NÃO usam "fit" — a dimensão (campanha/conjunto/anúncio)
  // tem largura automática p/ caber o nome INTEIRO por padrão, nunca quebra linha,
  // é redimensionável (arrastar borda) e 2 cliques na borda auto-ajusta (Sheets/Looker).
  renderTable({id:'tCamp', cols:hcols.map((c,i)=>i===0?{...c,label:'Campanha'}:c), rows:hierRows(aggC), total:totRowOf(totals(Sc.fL,Sc.fM)),
    selectable:true, selSet:STATE.mSelC, onSelect:(k,e)=>selDim('C',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAdset', cols:hcols.map((c,i)=>i===0?{...c,label:'Conjunto',big:true}:c), rows:hierRows(aggA), total:totRowOf(totals(Sa.fL,Sa.fM)),
    selectable:true, selSet:STATE.mSelA, onSelect:(k,e)=>selDim('A',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAd', cols:hcols.map((c,i)=>i===0?{...c,label:'Anúncio'}:c), rows:hierRows(aggD), total:totRowOf(totals(Sd.fL,Sd.fM)),
    selectable:true, selSet:STATE.mSelAd, onSelect:(k,e)=>selDim('D',k,e&&(e.ctrlKey||e.metaKey))});

  // cada gráfico varia a dimensão da sua tabela — CPL por dia, 1 linha por
  // membro, com legenda própria (cor · nome completo · CPL) e filtro
  // bidirecional com a tabela (STATE.mSel* determina quais linhas o gráfico plota).
  cplByDimChart('chCamp', Sc.fL, Sc.fM, aggC, 'camp', STATE.mSelC);
  cplByDimChart('chAdset', Sa.fL, Sa.fM, aggA, 'adset', STATE.mSelA);
  cplByDimChart('chAd', Sd.fL, Sd.fM, aggD, 'ad', STATE.mSelAd);

  // lista de leads do período (só tráfego pago — ver metaScope), mais recente no topo
  const q=fL.slice().sort((a,b)=>{ const ka=(a.d||'')+' '+(a.h||''), kb=(b.d||'')+' '+(b.h||''); return ka<kb?1:ka>kb?-1:0; });
  const nQ=q.filter(l=>l.q).length;
  document.getElementById('qCount').textContent=q.length+' leads · '+nQ+' MQL'+(nQ===1?'':'s');
  renderTable({id:'tLeads',
    cols:[{key:'d',label:'Data',type:'date'},{key:'h',label:'Hora',type:'dim',w:64},{key:'nm',label:'Nome',type:'dim'},
      {key:'mql',label:'MQL',type:'dim',w:64},{key:'fat',label:'Faturamento mensal',type:'dim'},
      {key:'papel',label:'Papel na empresa',type:'dim'},{key:'desafio',label:'Maior desafio comercial',type:'dim'},
      {key:'ad',label:'Anúncio',type:'dim'},{key:'adset',label:'Conjunto',type:'dim'},
      {key:'camp',label:'Campanha',type:'dim',big:true},{key:'em',label:'E‑mail',type:'dim',w:200},{key:'ph',label:'Telefone',type:'dim',w:110}],
    rows:q.map((l,i)=>({k:'l'+i, cells:{d:l.d,h:l.h||'-',nm:l.nm,mql:l.q?'Sim':'Não',fat:l.fat,papel:l.papel,desafio:l.desafio,
      ad:l.ad,adset:l.adset,camp:l.camp,em:l.em,ph:l.ph}}))});
}

/* ---------------- PAGE: Metas & Pacing ----------------
   Metas e cronograma do briefing (B.plano, definido em build.py::PLANO). Este
   painel NÃO segue o filtro de período: é sempre do início do plano até hoje.
   - Verba planejada: orcamento_mensal (cada mês dividido pelos dias do plano
     dentro dele) ou, se não definido, linear por dia (orçamento ÷ dias do plano).
   - Curva de vagas: média simples dentro de cada fase (como no briefing).
   - Ritmos/projeções: média dos últimos 7 dias FECHADOS (hoje é parcial e entra
     só no acumulado). Gasto segue o toggle "Imposto Meta" (taxf). */
const PL = B.plano || null;
const VENDAS = DATA.vendas || [];
const dayDiff=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);  // b - a, em dias
const daysIncl=(a,b)=>dayDiff(a,b)+1;
function dateList(a,b){ const out=[]; if(!a||!b||a>b) return out; for(let d=a; d<=b; d=addDays(d,1)) out.push(d); return out; }
const ddmm=d=>d.slice(8,10)+'/'+d.slice(5,7);
const MES_PT=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const mesLabel=m=>MES_PT[+m.slice(5,7)-1]+'/'+m.slice(2,4);
const paceCls=(r,lo,hi,lo2,hi2)=> r==null||!isFinite(r)?'' : (r>=lo&&r<=hi)?'pc-good' : (r>=lo2&&r<=hi2)?'pc-warn' : 'pc-bad';
function planDailyMap(){
  const days=dateList(PL.inicio, PL.fim_verba), map={};
  const om=PL.orcamento_mensal;
  if(!om){ const v=PL.orcamento_total/days.length; days.forEach(d=>map[d]=v); return map; }
  const perMonth={}; days.forEach(d=>{ const m=d.slice(0,7); perMonth[m]=(perMonth[m]||0)+1; });
  days.forEach(d=>{ const m=d.slice(0,7); const v=om[m]; map[d]=(v!=null&&perMonth[m])?v/perMonth[m]:0; });
  return map;
}
/* vagas esperadas acumuladas até o fim do dia d ('meta' | 'super') */
function expectedVagas(d,key){
  let tot=0;
  (PL.fases||[]).forEach(f=>{ if(d>=f.fim) tot+=f[key]; else if(d>=f.inicio) tot+=f[key]*daysIncl(f.inicio,d)/daysIncl(f.inicio,f.fim); });
  return tot;
}
function paceLineChart(id, labels, sets, yfmt){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'line',
    data:{labels, datasets:sets.map(s=>({label:s.label,data:s.data,borderColor:s.color,backgroundColor:s.color,
      borderWidth:s.w||2,borderDash:s.dash||[],pointRadius:0,pointHoverRadius:3,tension:0,spanGaps:false}))},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{filter:c=>c.raw!=null,callbacks:{label:c=>c.dataset.label+': '+yfmt(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:10},maxTicksLimit:10,autoSkip:true},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:mut,font:{size:10},callback:v=>yfmt(v)},grid:{color:cgrid()}}}}});
}
function renderPace(){
  const sub=document.getElementById('paceSub');
  if(!PL){ sub.textContent='Metas do briefing não configuradas (build.py::PLANO).'; return; }
  const today=TODAY<PL.inicio?PL.inicio:(TODAY>PL.fim_verba?PL.fim_verba:TODAY);
  const ontem=addDays(today,-1);
  const PLAN_DAYS=daysIncl(PL.inicio,PL.fim_verba);
  const metaV=PL.meta_vagas, superV=PL.super_vagas;
  const cacAlvo=PL.orcamento_total/metaV, cacAlvoSuper=PL.orcamento_total/superV;
  const temVendas=!!B.vendas_fonte;
  const planD=planDailyMap();
  // ---- séries diárias realizadas (todo o histórico, sem filtro de período) ----
  const act={}; const g=d=>act[d]||(act[d]={sp:0,leads:0,mqls:0,vendas:0});
  META.forEach(r=>{ if(r.d) g(r.d).sp+=r.sp*taxf(); });
  LEADS.forEach(l=>{ if(l.d){ const a=g(l.d); a.leads+=1; a.mqls+=(l.q||0); } });
  VENDAS.forEach(v=>{ if(v.d) g(v.d).vendas+=1; });
  const val=(d,k)=>act[d]?act[d][k]:0;
  const sumRange=(a,b,k)=>dateList(a,b).reduce((s,d)=>s+val(d,k),0);
  const planRange=(a,b)=>dateList(a,b).reduce((s,d)=>s+(planD[d]||0),0);
  // acumulados até agora (inclui dados anteriores ao início do plano, se houver)
  const allDays=Object.keys(act).filter(d=>d<=today);
  const totK=k=>allDays.reduce((s,d)=>s+act[d][k],0);
  const gastoTot=totK('sp'), leadsTot=totK('leads'), mqlsTot=totK('mqls'), vendasTot=totK('vendas');
  // ---- ritmo: últimos 7 dias fechados dentro do plano ----
  const wIni=addDays(ontem,-6)<PL.inicio?PL.inicio:addDays(ontem,-6);
  const nW=ontem>=wIni?daysIncl(wIni,ontem):0;
  const rate=k=>nW?sumRange(wIni,ontem,k)/nW:null;
  const rSp=rate('sp'), rLeads=rate('leads'), rMqls=rate('mqls');
  const restVendas=Math.max(0,dayDiff(today,PL.fim_vendas));   // dias a partir de amanhã
  const restVerba=Math.max(0,dayDiff(today,PL.fim_verba));
  const projSp=rSp==null?null:gastoTot+rSp*restVerba;
  const projLeads=rLeads==null?null:leadsTot+rLeads*restVendas;
  const projMqls=rMqls==null?null:mqlsTot+rMqls*restVendas;
  // ---- pacing até ontem ----
  const planOntem=ontem>=PL.inicio?planRange(PL.inicio,ontem):0;
  const gastoOntem=ontem>=PL.inicio?sumRange(PL.inicio,ontem,'sp'):0;
  const pacVerba=planOntem?gastoOntem/planOntem:null;
  const expMeta=ontem>=PL.inicio?expectedVagas(ontem,'meta'):0, expSuper=ontem>=PL.inicio?expectedVagas(ontem,'super'):0;
  const vendasOntem=ontem>=PL.inicio?sumRange(PL.inicio,ontem,'vendas'):0;
  const faseHoje=(PL.fases||[]).find(f=>today>=f.inicio&&today<=f.fim);
  const ritmoSem=f=>f?[f.meta/(daysIncl(f.inicio,f.fim)/7), f.super/(daysIncl(f.inicio,f.fim)/7)]:[null,null];
  const cpmql=(mqlsTot&&gastoTot>0)?gastoTot/mqlsTot:null;
  const diaN=daysIncl(PL.inicio,today);
  sub.textContent=`Hoje ${brdate(today)} (${weekday(today)}) · dia ${diaN} de ${PLAN_DAYS} do plano · faltam ${restVendas} dias para o fim das vendas (${brdate(PL.fim_vendas)}) e ${dayDiff(today,PL.imersao)} para a imersão (${brdate(PL.imersao)})`;
  document.getElementById('paceTopNote').innerHTML=
    `Sempre do início do plano (${brdate(PL.inicio)}) até hoje — <b>não segue o filtro de período</b>. Gasto ${STATE.tax?'<b>com</b>':'<b>sem</b>'} o imposto Meta (toggle no topo). `
    +`Verba planejada: ${PL.orcamento_mensal?'<b>divisão mensal definida</b>':'<b>plano linear</b> ('+brl(PL.orcamento_total/PLAN_DAYS)+'/dia) até o Rafael definir a divisão por mês'}. `
    +`Ritmos e projeções = média dos últimos 7 dias fechados (${nW?brdate(wIni)+' a '+brdate(ontem):'sem dias fechados ainda'}). `
    +(temVendas?'':'<b>Vendas: ainda sem fonte de dados</b> — conecte a planilha de vendas do comercial para ver vendido × meta. ')
    +`Conversões MQL→venda supõem que as vendas saem dos MQLs.`;
  // ---- KPIs: vagas ----
  const [rsM,rsS]=ritmoSem(faseHoje);
  const kv=[
    {label:'Vagas vendidas',val:temVendas?intf(vendasTot)+' / '+intf(metaV):'—',
      aux:temVendas?pct(vendasTot/metaV)+' da meta · '+pct(vendasTot/superV)+' da super meta':'Sem fonte de vendas conectada',
      cls:temVendas?paceCls(expMeta?vendasOntem/expMeta:null,1,9e9,0.85,1):''},
    {label:'Vagas esperadas até ontem',val:numf(expMeta)+' <small>meta</small>',
      aux:numf(expSuper)+' na super meta · '+(faseHoje?faseHoje.nome+': '+numf(rsM)+' a '+numf(rsS)+' vendas/semana':'fora das fases de venda')},
    {label:'Vagas/dia necessárias',val:restVendas?num2f(Math.max(0,metaV-vendasTot)/restVendas)+'/dia':'-',
      aux:(restVendas?'super meta: '+num2f(Math.max(0,superV-vendasTot)/restVendas)+'/dia · ':'')+restVendas+' dias até '+brdate(PL.fim_vendas).slice(0,5)+(temVendas?'':' (0 vendas registradas)')},
    {label:'MQL→venda p/ bater a meta',val:projMqls?pct(metaV/projMqls):'-',
      aux:projMqls?'super meta: '+pct(superV/projMqls)+' · '+intf(projMqls)+' MQLs projetados':'sem ritmo de MQLs ainda'},
    {label:'MQL→venda p/ custo ≤ '+brl(cacAlvo),val:cpmql?pct(cpmql/cacAlvo):'-',
      aux:cpmql?'CPMQL atual '+brl(cpmql)+' · super meta ('+brl(cacAlvoSuper)+'): '+pct(cpmql/cacAlvoSuper):'sem MQL ainda'},
  ];
  document.getElementById('paceKpisVagas').innerHTML=kv.map(kpiCard).join('');
  // ---- KPIs: verba & funil ----
  const dev=projSp==null?null:projSp/PL.orcamento_total;
  const amanha=addDays(today,1);
  const kb=[
    {label:'Investido até agora',val:brl(gastoTot),aux:pct(gastoTot/PL.orcamento_total)+' da verba · '+pct(diaN/PLAN_DAYS)+' do período'},
    {label:'Pacing da verba (até ontem)',val:pct(pacVerba),aux:brl(gastoOntem)+' gasto × '+brl(planOntem)+' planejado',
      cls:paceCls(pacVerba,0.9,1.1,0.75,1.25)},
    {label:'Projeção de gasto até '+brdate(PL.fim_verba).slice(0,5),val:brl(projSp),
      aux:projSp==null?'sem ritmo ainda':((projSp>=PL.orcamento_total?'+':'−')+brl(Math.abs(projSp-PL.orcamento_total))+' vs orçamento · ritmo '+brl(rSp)+'/dia'),
      cls:paceCls(dev,0.9,1.1,0.75,1.25)},
    {label:'Verba disponível por dia',val:restVerba?brl(Math.max(0,PL.orcamento_total-gastoTot)/restVerba):'-',
      aux:'a partir de amanhã · plano: '+brl(planD[amanha]!=null?planD[amanha]:PL.orcamento_total/PLAN_DAYS)+'/dia'},
    {label:'Leads · MQLs projetados até '+brdate(PL.fim_vendas).slice(0,5),val:projLeads==null?'-':intf(projLeads)+' · '+intf(projMqls),
      aux:rLeads==null?'sem ritmo ainda':'ritmo: '+numf(rLeads)+' leads/dia · '+numf(rMqls)+' MQLs/dia'},
  ];
  document.getElementById('paceKpisVerba').innerHTML=kb.map(kpiCard).join('');
  // ---- curvas ----
  const dVerba=dateList(PL.inicio,PL.fim_verba), dVend=dateList(PL.inicio,PL.fim_vendas);
  const firstAct=Object.keys(act).sort()[0]; const pre=k=>firstAct&&firstAct<PL.inicio?sumRange(firstAct,addDays(PL.inicio,-1),k):0;
  const cum=(days,fnDay,start)=>{ let s=start||0; return days.map(d=>{ s+=fnDay(d); return s; }); };
  const planCum=cum(dVerba,d=>planD[d]||0);
  const spCum=cum(dVerba,d=>val(d,'sp'),pre('sp'));
  const cBad=cvar('--chart-gasto'), cMut=cvar('--muted'), cL=cvar('--chart-leads'), cQ=cvar('--chart-mqls'), cG=cvar('--good');
  paceLineChart('paceChVerba', dVerba.map(ddmm), [
    {label:'Planejado',data:planCum,color:cMut,dash:[5,4]},
    {label:'Realizado',data:dVerba.map((d,i)=>d<=today?spCum[i]:null),color:cBad,w:2.5},
    {label:'Projeção',data:dVerba.map((d,i)=>d<today||rSp==null?null:gastoTot+rSp*dayDiff(today,d)),color:cBad,dash:[2,3]},
  ], v=>brl(v).replace(',00',''));
  const vendCum=cum(dVend,d=>val(d,'vendas'),pre('vendas'));
  const setsV=[
    {label:'Meta (100)',data:dVend.map(d=>+expectedVagas(d,'meta').toFixed(1)),color:cL,dash:[5,4]},
    {label:'Super meta (150)',data:dVend.map(d=>+expectedVagas(d,'super').toFixed(1)),color:cQ,dash:[5,4]},
  ];
  if(temVendas) setsV.push({label:'Vendas',data:dVend.map((d,i)=>d<=today?vendCum[i]:null),color:cG,w:2.5});
  paceLineChart('paceChVagas', dVend.map(ddmm), setsV, v=>numf(v));
  const lCum=cum(dVend,d=>val(d,'leads'),pre('leads')), qCum=cum(dVend,d=>val(d,'mqls'),pre('mqls'));
  paceLineChart('paceChFunil', dVend.map(ddmm), [
    {label:'Leads',data:dVend.map((d,i)=>d<=today?lCum[i]:null),color:cL,w:2.5},
    {label:'MQLs',data:dVend.map((d,i)=>d<=today?qCum[i]:null),color:cQ,w:2.5},
    {label:'Projeção leads',data:dVend.map(d=>d<today||rLeads==null?null:+(leadsTot+rLeads*dayDiff(today,d)).toFixed(1)),color:cL,dash:[2,3]},
    {label:'Projeção MQLs',data:dVend.map(d=>d<today||rMqls==null?null:+(mqlsTot+rMqls*dayDiff(today,d)).toFixed(1)),color:cQ,dash:[2,3]},
  ], v=>numf(v));
  // ---- metas por fase ----
  const faseRow=(nome,ini,fim,meta,sup)=>{ const n=daysIncl(ini,fim), w=n/7, ate=ontem<ini?null:(ontem>fim?fim:ontem);
    const pv=planRange(ini,fim), gs=today<ini?0:sumRange(ini,today>fim?fim:today,'sp');
    return {k:nome, cells:{fase:nome,periodo:brdate(ini).slice(0,5)+' a '+brdate(fim),dias:n,
      meta:meta,sup:sup,rm:meta!=null?meta/w:null,rs:sup!=null?sup/w:null,
      esp:meta!=null&&ate?meta*daysIncl(ini,ate)/n:(meta!=null?0:null),
      vend:temVendas&&meta!=null?(today<ini?0:sumRange(ini,today>fim?fim:today,'vendas')):null,
      plan:pv,gasto:gs,uso:pv?gs/pv:null}}; };
  const fRows=(PL.fases||[]).map(f=>faseRow(f.nome,f.inicio,f.fim,f.meta,f.super));
  const lastF=(PL.fases||[]).slice(-1)[0];
  if(lastF && lastF.fim<PL.fim_verba) fRows.push(faseRow('Só conteúdo',addDays(lastF.fim,1),PL.fim_verba,null,null));
  const tot={fase:null,periodo:brdate(PL.inicio).slice(0,5)+' a '+brdate(PL.fim_verba),dias:PLAN_DAYS,meta:metaV,sup:superV,rm:null,rs:null,
    esp:expMeta,vend:temVendas?vendasTot:null,plan:planRange(PL.inicio,PL.fim_verba),gasto:gastoTot,uso:gastoTot/PL.orcamento_total};
  renderTable({id:'paceFases', center:true, fit:true, rows:fRows, total:tot, cols:[
    {key:'fase',label:'Fase',type:'dim'},{key:'periodo',label:'Período',type:'dim'},{key:'dias',label:'Dias',type:'int'},
    {key:'meta',label:'Meta (vagas)',type:'int'},{key:'sup',label:'Super meta',type:'int'},
    {key:'rm',label:'Ritmo/sem (meta)',type:'num'},{key:'rs',label:'Ritmo/sem (super)',type:'num'},
    {key:'esp',label:'Esperado até ontem',type:'num'},{key:'vend',label:'Vendido',type:'int'},
    {key:'plan',label:'Verba planejada',type:'brl'},{key:'gasto',label:'Gasto',type:'brl'},{key:'uso',label:'% da verba usada',type:'pct'}]});
  // ---- verba por mês ----
  const meses=[...new Set(dVerba.map(d=>d.slice(0,7)))];
  const mRows=meses.map(m=>{ const ds=dVerba.filter(d=>d.slice(0,7)===m), ini=ds[0], fim=ds[ds.length-1];
    const pv=planRange(ini,fim), gs=today<ini?0:sumRange(ini,today>fim?fim:today,'sp');
    const po=ontem<ini?0:planRange(ini,ontem>fim?fim:ontem), go=ontem<ini?0:sumRange(ini,ontem>fim?fim:ontem,'sp');
    return {k:m, cells:{mes:mesLabel(m),dias:ds.length,plan:pv,gasto:gs,uso:pv?gs/pv:null,po:po,go:go,pac:po?go/po:null}}; });
  renderTable({id:'paceMeses', center:true, fit:true, rows:mRows,
    total:{mes:null,dias:PLAN_DAYS,plan:planRange(PL.inicio,PL.fim_verba),gasto:gastoTot,uso:gastoTot/PL.orcamento_total,po:planOntem,go:gastoOntem,pac:pacVerba},
    cols:[{key:'mes',label:'Mês',type:'dim'},{key:'dias',label:'Dias no plano',type:'int'},{key:'plan',label:'Verba planejada',type:'brl'},
      {key:'gasto',label:'Gasto',type:'brl'},{key:'uso',label:'% usado',type:'pct'},
      {key:'po',label:'Planejado até ontem',type:'brl'},{key:'go',label:'Gasto até ontem',type:'brl'},{key:'pac',label:'Pacing',type:'pct'}]});
  document.getElementById('paceMesesNote').innerHTML=PL.orcamento_mensal
    ?'Divisão mensal definida em <code>build.py → PLANO["orcamento_mensal"]</code>; cada mês é distribuído igualmente pelos seus dias.'
    :'<b>Plano provisório linear</b> ('+brl(PL.orcamento_total/PLAN_DAYS)+'/dia). O briefing espera a maior parte da captação em novembro e dezembro e pede que o Rafael proponha a divisão: assim que ela existir, o planejado por mês é atualizado aqui.';
  // ---- pacing diário ----
  const dShow=dateList(PL.inicio,today);
  let cS=pre('sp'), cP=0, cL2=pre('leads'), cQ2=pre('mqls'), cV=pre('vendas');
  const dRows=dShow.map(d=>{ cS+=val(d,'sp'); cP+=planD[d]||0; cL2+=val(d,'leads'); cQ2+=val(d,'mqls'); cV+=val(d,'vendas');
    return {k:d, cells:{date:d,wd:weekday(d)+(d===today?' · hoje':''),gasto:val(d,'sp'),gac:cS,pac:cP,pc:cP?cS/cP:null,
      leads:val(d,'leads'),lac:cL2,mqls:val(d,'mqls'),qac:cQ2,esp:expectedVagas(d,'meta'),vac:temVendas?cV:null}}; }).reverse();
  renderTable({id:'paceDaily', center:true, fit:true, rows:dRows, cols:[
    {key:'date',label:'Data',type:'date'},{key:'wd',label:'Dia',type:'dim'},
    {key:'gasto',label:'Gasto',type:'brl',heat:'gasto'},{key:'gac',label:'Gasto acum.',type:'brl'},{key:'pac',label:'Planejado acum.',type:'brl'},
    {key:'pc',label:'Pacing',type:'pct'},{key:'leads',label:'Leads',type:'int',heat:'leads'},{key:'lac',label:'Leads acum.',type:'int'},
    {key:'mqls',label:'MQLs',type:'int',heat:'mqls'},{key:'qac',label:'MQLs acum.',type:'int'},
    {key:'esp',label:'Vagas esperadas (meta)',type:'num'},{key:'vac',label:'Vendas acum.',type:'int'}]});
}

/* ---------------- date presets ---------------- */
const PRESETS=[
  ['hoje','Hoje',()=>[TODAY,TODAY]],
  ['ontem','Ontem',()=>[addDays(TODAY,-1),addDays(TODAY,-1)]],
  ['3d','3 dias',()=>[addDays(TODAY,-2),TODAY]],
  ['7d','7 dias',()=>[addDays(TODAY,-6),TODAY]],
  ['14d','14 dias',()=>[addDays(TODAY,-13),TODAY]],
  ['30d','30 dias',()=>[addDays(TODAY,-29),TODAY]],
  ['mes','Este mês',()=>{const [y,m]=TODAY.split('-');return [`${y}-${m}-01`,TODAY];}],
  ['mespass','Mês passado',()=>{const dt=new Date(TODAY+'T00:00:00');const f=new Date(dt.getFullYear(),dt.getMonth()-1,1);const l=new Date(dt.getFullYear(),dt.getMonth(),0);return [dstr(f),dstr(l)];}],
  ['todo','Todo período',()=>[B.date_min,B.date_max]],
];
/* rótulo do botão de período — mostra o intervalo aplicado dentro do próprio botão */
function syncDateInputs(){
  const el=document.getElementById('periodBtnLabel'); if(!el) return;
  if(STATE.selDays.size){ el.textContent=STATE.selDays.size+(STATE.selDays.size>1?' dias selecionados':' dia selecionado'); return; }
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  if(STATE.from&&STATE.to) el.textContent=brdate(STATE.from)+' – '+brdate(STATE.to)+(pr?' · '+pr[1]:'');
  else el.textContent='Selecionar período';
}
function applyPreset(id){ const p=PRESETS.find(x=>x[0]===id); if(!p)return; const [f,t]=p[2]();
  STATE.from=f; STATE.to=t; STATE.preset=id; STATE.selDays.clear(); ppClose(); syncDateInputs(); renderAll(); }

/* ---- popover do seletor de período (estilo Data Studio) ---- */
const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_PT=['D','S','T','Q','Q','S','S'];
const PP={from:null,to:null,preset:'',fromView:'',toView:''};
function ymView(ds){ return (ds||TODAY).slice(0,7); }
function shiftView(view,delta){ const [y,m]=view.split('-').map(Number); const dt=new Date(y,m-1+delta,1); return dt.getFullYear()+'-'+pad(dt.getMonth()+1); }
function ppIsOpen(){ const pop=document.getElementById('periodPop'); return pop && !pop.hidden; }
function ppOpen(){
  PP.from=STATE.from; PP.to=STATE.to; PP.preset=STATE.selDays.size?'':STATE.preset;
  PP.fromView=ymView(STATE.from); PP.toView=ymView(STATE.to);
  document.getElementById('periodPop').hidden=false;
  document.getElementById('periodBtn').setAttribute('aria-expanded','true');
  ppRenderAll();
}
function ppClose(){ const pop=document.getElementById('periodPop'); if(pop) pop.hidden=true;
  const b=document.getElementById('periodBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function ppRenderAll(){ ppRenderPresets(); ppRenderCal('from'); ppRenderCal('to'); ppRenderRange(); }
function ppRenderPresets(){
  const host=document.getElementById('ppPresets');
  host.innerHTML=PRESETS.map(p=>`<button class="pp-preset ${PP.preset===p[0]?'active':''}" data-p="${p[0]}">${p[1]}</button>`).join('');
  host.querySelectorAll('.pp-preset').forEach(c=>c.addEventListener('click',()=>{
    const p=PRESETS.find(x=>x[0]===c.dataset.p); const [f,t]=p[2]();
    PP.from=f; PP.to=t; PP.preset=p[0]; PP.fromView=ymView(f); PP.toView=ymView(t); ppRenderAll();
  }));
}
function ppRenderCal(side){
  const host=document.getElementById(side==='from'?'ppCalFrom':'ppCalTo');
  const view=side==='from'?PP.fromView:PP.toView;
  const [y,m]=view.split('-').map(Number);
  const startDow=new Date(y,m-1,1).getDay(), dim=new Date(y,m,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<span class="pp-day empty"></span>';
  for(let d=1;d<=dim;d++){
    const ds=view+'-'+pad(d);
    const inR=PP.from&&PP.to&&ds>=PP.from&&ds<=PP.to, isEdge=(ds===PP.from||ds===PP.to);
    const cls=['pp-day']; if(inR) cls.push('in'); if(ds===PP.from) cls.push('edge-l'); if(ds===PP.to) cls.push('edge-r'); if(isEdge) cls.push('sel');
    cells+=`<button class="${cls.join(' ')}" data-side="${side}" data-d="${ds}">${d}</button>`;
  }
  host.innerHTML=`<div class="pp-cal-head"><span class="pp-cal-title">${side==='from'?'Data de início':'Data de término'}</span></div>
    <div class="pp-cal-nav"><button class="pp-nav" data-nav="-1">‹</button><span class="pp-cal-month">${MONTHS_PT[m-1]} ${y}</span><button class="pp-nav" data-nav="1">›</button></div>
    <div class="pp-dow">${DOW_PT.map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="pp-grid">${cells}</div>`;
  host.querySelectorAll('.pp-nav').forEach(b=>b.addEventListener('click',()=>{
    const nv=shiftView(view,+b.dataset.nav); if(side==='from') PP.fromView=nv; else PP.toView=nv; ppRenderCal(side);
  }));
  host.querySelectorAll('.pp-day[data-d]').forEach(b=>b.addEventListener('click',()=>ppPickDay(side,b.dataset.d)));
}
function ppPickDay(side,ds){
  PP.preset='';
  if(side==='from'){ PP.from=ds; if(PP.to&&PP.from>PP.to) PP.to=PP.from; }
  else { PP.to=ds; if(PP.from&&PP.to<PP.from) PP.from=PP.to; }
  ppRenderAll();
}
function ppRenderRange(){
  const el=document.getElementById('ppRange');
  if(PP.from&&PP.to){ const n=Math.round((new Date(PP.to+'T00:00:00')-new Date(PP.from+'T00:00:00'))/86400000)+1;
    el.textContent=brdate(PP.from)+' – '+brdate(PP.to)+(n>0?' · '+n+(n>1?' dias':' dia'):''); }
  else el.textContent='Selecione as datas';
}
function ppApply(){
  if(!PP.from||!PP.to){ ppClose(); return; }
  STATE.from=PP.from; STATE.to=PP.to; STATE.preset=PP.preset||''; STATE.selDays.clear();
  ppClose(); syncDateInputs(); renderAll();
}

/* ---------------- navigation & boot ---------------- */
function setPage(p){ STATE.page=p;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  document.getElementById('page-geral').classList.toggle('active',p==='geral');
  document.getElementById('page-meta').classList.toggle('active',p==='meta');
  document.getElementById('page-rel').classList.toggle('active',p==='rel');
  document.getElementById('page-pace').classList.toggle('active',p==='pace');
  document.getElementById('ptitle').textContent = {meta:'Meta Ads',rel:'Insights de IA',pace:'Metas & Pacing'}[p]||'Visão Geral';
  document.getElementById('navToggle').checked=false;
  history.replaceState(null,'', '#'+(['meta','rel','pace'].includes(p)?p:'geral'));
  renderAll();
}
function renderAll(){ if(STATE.page==='meta') renderMeta(); else if(STATE.page==='rel') renderRelatorio(); else if(STATE.page==='pace') renderPace(); else renderGeral(); }

function applyTheme(){ const t=localStorage.getItem('dm_theme'); if(t==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark'); }
applyTheme();
document.getElementById('themeBtn').addEventListener('click',()=>{ const dark=document.documentElement.getAttribute('data-theme')==='dark'; localStorage.setItem('dm_theme',dark?'light':'dark'); applyTheme(); renderAll(); });

document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.page)));
/* toggle "Imposto Meta": liga/desliga o fator TAX_FACTOR sobre o gasto do Meta Ads
   (e tudo que deriva dele: CPM, CPC, CPL). Começa LIGADO. */
document.getElementById('taxToggle').addEventListener('click',function(){ STATE.tax=!STATE.tax; this.classList.toggle('on',STATE.tax); renderAll(); });
/* seletor de período: abre/fecha popover, aplicar/cancelar, fechar ao clicar fora/Esc */
document.getElementById('periodBtn').addEventListener('click',e=>{ e.stopPropagation(); ppIsOpen()?ppClose():ppOpen(); });
document.getElementById('ppApply').addEventListener('click',ppApply);
document.getElementById('ppCancel').addEventListener('click',ppClose);
document.getElementById('periodPop').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{ if(ppIsOpen()) ppClose(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&ppIsOpen()) ppClose(); });
document.getElementById('clearBtn').addEventListener('click',()=>{ STATE.mSelC.clear();STATE.mSelA.clear();STATE.mSelAd.clear();STATE.selDays.clear(); applyPreset('mes'); });
document.getElementById('refreshBtn').addEventListener('click',function(){ this.classList.add('loading'); location.href=location.pathname+'?t='+Date.now()+location.hash; });

/* painel de Metas & parâmetros — edita ao vivo, salva em localStorage e recolore
   a tabela de anúncios (sem re-renderizar os gráficos) */
(function wireMetas(){
  const num=el=>{ const s=(el&&el.value||'').trim(); if(s==='') return null; const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
  const onEdit=()=>{
    METAS.cpl=num(document.getElementById('metaCpl'));
    METAS.cpmql=num(document.getElementById('metaCpmql'));
    const vm=num(document.getElementById('metaVolMin')); METAS.volMin=(vm!=null&&vm>=1)?Math.round(vm):METAS_DEFAULT.volMin;
    const nd=num(document.getElementById('metaNdias')); METAS.nDias=(nd!=null&&nd>=1)?Math.round(nd):METAS_DEFAULT.nDias;
    saveMetas(); renderMetasNote();
    if(STATE.page==='rel') renderRelAds();   // só a tabela, sem mexer nos gráficos
  };
  ['metaCpl','metaCpmql','metaVolMin','metaNdias'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',onEdit); });
  const rb=document.getElementById('relMetasReset');
  if(rb) rb.addEventListener('click',()=>{ METAS.cpl=METAS_DEFAULT.cpl; METAS.cpmql=METAS_DEFAULT.cpmql; METAS.volMin=METAS_DEFAULT.volMin; METAS.nDias=METAS_DEFAULT.nDias;
    try{ localStorage.removeItem(LS_METAS); }catch(e){} syncMetasInputs(); if(STATE.page==='rel') renderRelAds(); });
  syncMetasInputs();
})();

document.getElementById('updated').innerHTML='Última atualização:<br>'+B.generated_at_brt+' (BRT)';
document.getElementById('buildFoot').textContent='build __BUILD_ID__';
document.getElementById('buildFoot2').textContent='· build __BUILD_ID__';

syncDateInputs();
setPage({'#meta':'meta','#rel':'rel','#pace':'pace'}[location.hash]||'geral');

/* auto-refresh com cache-bust ~30 min */
setTimeout(()=>{ location.href=location.pathname+'?t='+Date.now()+location.hash; }, 30*60*1000);
