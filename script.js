
// Hardened CSV loader + visible status + pretty export
const PAGE_SIZE = 10;
let CURRENT_TXNS = [];
let CURRENT_RULES = [];
let CURRENT_FILTER = null;
let MONTH_FILTER = "";

// Try to detect columns from header names; fallback to known Qudos export layout
const FALLBACK_COL = { DATE: 2, DEBIT: 5, LONGDESC: 9 };

function detectColumns(firstRow) {
  const header = (firstRow || []).map(c => String(c||'').trim().toLowerCase());
  const idx = (nameCandidates) => {
    const list = Array.isArray(nameCandidates) ? nameCandidates : [nameCandidates];
    for (const cand of list) {
      const i = header.indexOf(cand);
      if (i !== -1) return i;
    }
    return -1;
  };
  const DATE = idx(['effective date','date','transaction date']);
  const DEBIT = idx(['debit','amount','debit amount']);
  const LONGDESC = idx(['long description','description','narrative','details']);
  if (DATE>=0 && DEBIT>=0 && LONGDESC>=0) {
    return {DATE, DEBIT, LONGDESC};
  }
  return FALLBACK_COL;
}

function parseAmount(s) {
  if (s == null) return 0;
  s = String(s).replace(/[^\d\-,.]/g, '').replace(/,/g, '');
  // handle numbers like "-123.45" or "123.45"
  return Number(s) || 0;
}

function parseDateSmart(s) {
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d;
  const m1 = String(s).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const a=+m1[1], b=+m1[2], y=+m1[3];
    const day = a>12 ? a : (b>12 ? b : a);
    const month = a>12 ? b : a;
    return new Date(y, month-1, day);
  }
  const s2 = String(s).replace(/^\d{1,2}:\d{2}\s*(am|pm)\s*/i, '');
  const m2 = s2.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})/i);
  if (m2) {
    const day = parseInt(m2[2],10);
    const mo = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11}[m2[3].toLowerCase()];
    return new Date(parseInt(m2[4],10), mo, day);
  }
  return null;
}
function yyyymm(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function formatMonthLabel(ym){
  if (!ym) return 'All months';
  const [y,m]=ym.split('-').map(Number);
  return new Date(y,m-1,1).toLocaleString(undefined,{month:'long',year:'numeric'});
}
function friendlyMonthOrAll(label){ if(!label) return 'All months'; if(/^\d{4}-\d{2}$/.test(label)) return formatMonthLabel(label); return String(label); }
function forFilename(label){ return String(label).replace(/\s+/g,'_'); }
function toTitleCase(s){ return String(s||'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b([a-z])/g,(m,p)=>p.toUpperCase()); }

function loadCsvText(csvText) {
  const status = document.getElementById('loadStatus');
  try {
    // Auto-detect delimiter (comma or semicolon) by counting
    const head = String(csvText).slice(0, 2000);
    const comma = (head.match(/,/g)||[]).length;
    const semi  = (head.match(/;/g)||[]).length;
    const delimiter = semi > comma*1.2 ? ';' : ','; // pick semicolon if clearly dominant

    const parsed = Papa.parse(csvText.trim(), { delimiter, skipEmptyLines: true });
    const rows = parsed.data || [];
    if (!rows.length) throw new Error('No rows found');
    const COL = detectColumns(rows[0]);
    const startIdx = isNaN(parseAmount(rows[0][COL.DEBIT])) ? 1 : 0;

    const txns = [];
    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < Math.max(COL.DATE, COL.DEBIT, COL.LONGDESC)+1) continue;
      const effectiveDate = r[COL.DATE] || '';
      const debit = parseAmount(r[COL.DEBIT]);
      const longDesc = (r[COL.LONGDESC] || '').trim();
      if (!effectiveDate && !longDesc) continue;
      txns.push({ date: effectiveDate, amount: debit, description: longDesc });
    }
    CURRENT_TXNS = txns;
    rebuildMonthDropdown();
    applyRulesAndRender();
    status.textContent = `Loaded ${txns.length} transactions · delimiter="${delimiter}" · columns = ${JSON.stringify(COL)}`;
  } catch (e) {
    status.textContent = 'Load failed: ' + (e && e.message ? e.message : String(e));
  }
  return CURRENT_TXNS;
}

function parseRules(text) {
  const lines = String(text || "").split(/\r?\n/);
  const rules = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(/=>/i);
    if (parts.length >= 2) {
      const keyword = parts[0].trim().toLowerCase();
      const category = parts[1].trim().toUpperCase();
      if (keyword && category) rules.push({ keyword, category });
    }
  }
  return rules;
}

// flexible matcher to support multi-word (e.g., "paypal pypl")
function matchesKeyword(descLower, keywordLower){
  if (!keywordLower) return false;
  const parts = String(keywordLower).split(/\s+/).filter(Boolean);
  let pos = 0;
  for (const p of parts){
    const i = descLower.indexOf(p, pos);
    if (i === -1) return false;
    pos = i + p.length;
  }
  return true;
}

function categorise(txns, rules){
  for (const t of txns){
    const descLower = (t.description||'').toLowerCase();
    let matched = 'UNCATEGORISED';
    for (const r of rules){
      if (matchesKeyword(descLower, r.keyword)) { matched = r.category; break; }
    }
    t.category = matched;
  }
  return txns;
}

function computeCategoryTotals(txns){
  const byCat = new Map();
  for (const t of txns){
    const cat = (t.category || 'UNCATEGORISED').toUpperCase();
    byCat.set(cat, (byCat.get(cat)||0) + (Number(t.amount)||0));
  }
  const rows = [...byCat.entries()].sort((a,b)=>b[1]-a[1]);
  const grand = rows.reduce((a,[,v])=>a+v,0);
  return {rows, grand};
}

function renderCategoryTotals(txns){
  const {rows, grand} = computeCategoryTotals(txns);
  const div = document.getElementById('categoryTotals');
  let html = '<table class="table cats"><colgroup><col class="col-cat"><col class="col-total"><col class="col-pct"></colgroup><thead><tr><th>Category</th><th class="num">Total</th><th class="num">%</th></tr></thead><tbody>';
  for (const [cat,total] of rows){
    html += `<tr><td><a class="catlink" data-cat="${cat}"><span class="category-name">${toTitleCase(cat)}</span></a></td><td class="num">${total.toFixed(2)}</td><td class="num">${(grand? (total/grand*100):0).toFixed(1)}%</td></tr>`;
  }
  html += `</tbody><tfoot><tr><td>Total</td><td class="num">${grand.toFixed(2)}</td><td class="num">100%</td></tr></tfoot></table>`;
  div.innerHTML = html;
  div.querySelectorAll('a.catlink').forEach(a=>{
    a.addEventListener('click', ()=>{
      CURRENT_FILTER = a.getAttribute('data-cat');
      updateFilterUI(); CURRENT_PAGE=1; renderTransactionsTable();
    });
  });
}

function getFilteredTxns(txns){ if(!CURRENT_FILTER) return txns; return txns.filter(t => (t.category||'UNCATEGORISED').toUpperCase()===CURRENT_FILTER); }

function renderMonthTotals(){
  const txns = getFilteredTxns(monthFilteredTxns());
  let debit=0, credit=0;
  for (const t of txns){ const v = Number(t.amount)||0; if (v>0) debit+=v; else credit+=Math.abs(v); }
  const net = debit-credit;
  const el = document.getElementById('monthTotals');
  if (el){
    const cat = CURRENT_FILTER ? ` + category "${CURRENT_FILTER}"` : "";
    el.innerHTML = `Showing <span class="badge">${txns.length}</span> transactions for <strong>${friendlyMonthOrAll(MONTH_FILTER)}${cat}</strong> · Debit: <strong>$${debit.toFixed(2)}</strong> · Credit: <strong>$${credit.toFixed(2)}</strong> · Net: <strong>$${net.toFixed(2)}</strong>`;
  }
}

function monthFilteredTxns(){
  if (!MONTH_FILTER) return CURRENT_TXNS;
  return CURRENT_TXNS.filter(t => {
    const d = parseDateSmart(t.date);
    return d && yyyymm(d) === MONTH_FILTER;
  });
}

function renderTransactionsTable(txns = monthFilteredTxns()){
  const filtered = getFilteredTxns(txns);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (window.CURRENT_PAGE > totalPages) window.CURRENT_PAGE = totalPages;
  if (!window.CURRENT_PAGE || window.CURRENT_PAGE<1) window.CURRENT_PAGE = 1;
  const start = (window.CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const table = document.getElementById('transactionsTable');
  let html = '<tr><th>Date</th><th>Amount</th><th>Category</th><th>Description</th></tr>';
  pageItems.forEach((t) => {
    const cat = (t.category || 'UNCATEGORISED').toUpperCase();
    html += `<tr><td>${t.date}</td><td>${(Number(t.amount)||0).toFixed(2)}</td><td><span class="category-name">${toTitleCase(cat)}</span></td><td>${t.description}</td></tr>`;
  });
  table.innerHTML = html;
  renderPager(totalPages);
}

function renderPager(totalPages){
  const pager = document.getElementById('pager'); if(!pager) return;
  const pages = totalPages||1, cur = window.CURRENT_PAGE||1;
  function btn(label,page,disabled=false,active=false){
    return `<button class="page-btn${active?' active':''}" data-page="${page}" ${disabled?'disabled':''}>${label}</button>`;
  }
  let html = '';
  html += btn('First',1,cur===1);
  html += btn('Prev',Math.max(1,cur-1),cur===1);
  const windowSize=5; let start=Math.max(1,cur-Math.floor(windowSize/2)); let end=Math.min(pages,start+windowSize-1); start=Math.max(1,Math.min(start,end-windowSize+1));
  for(let p=start;p<=end;p++){ html += btn(String(p),p,false,p===cur); }
  html += btn('Next',Math.min(pages,cur+1),cur===pages);
  html += btn('Last',pages,cur===pages);
  html += `<span style="margin-left:8px">Page ${cur} / ${pages}</span>`;
  pager.innerHTML = html;
  pager.querySelectorAll('button.page-btn').forEach(b=>{
    b.addEventListener('click', (e)=>{ const page = Number(e.currentTarget.getAttribute('data-page')); if (!page||page===window.CURRENT_PAGE) return; window.CURRENT_PAGE = page; renderTransactionsTable(); });
  });
}

function rebuildMonthDropdown(){
  const sel = document.getElementById('monthFilter');
  const months = new Set();
  for (const t of CURRENT_TXNS){ const d = parseDateSmart(t.date); if (d) months.add(yyyymm(d)); }
  const list = Array.from(months).sort();
  const current = MONTH_FILTER;
  sel.innerHTML = `<option value="">All months</option>` + list.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
  sel.value = current && list.includes(current) ? current : "";
  updateMonthBanner();
}

function updateFilterUI(){
  const label = document.getElementById('activeFilter');
  const btn = document.getElementById('clearFilterBtn');
  if (CURRENT_FILTER){ label.textContent = `— filtered by "${CURRENT_FILTER}"`; btn.style.display=''; }
  else { label.textContent=''; btn.style.display='none'; }
}

function updateMonthBanner(){ const banner = document.getElementById('monthBanner'); banner.textContent = `— ${friendlyMonthOrAll(MONTH_FILTER)}`; }

function applyRulesAndRender(){
  CURRENT_RULES = parseRules(document.getElementById('rulesBox').value);
  const txns = monthFilteredTxns();
  categorise(txns, CURRENT_RULES);
  renderMonthTotals();
  renderCategoryTotals(txns);
  renderTransactionsTable(txns);
  try { updateMonthBanner(); } catch {}
}

function exportTotals(){
  const txns = monthFilteredTxns();
  const { rows, grand } = computeCategoryTotals(txns);
  const label = friendlyMonthOrAll(MONTH_FILTER || (txns[0] && parseDateSmart(txns[0].date) ? yyyymm(parseDateSmart(txns[0].date)) : new Date()));
  const header = `SpendLite Category Totals (${label})`;

  const catWidth = Math.max(8, ...rows.map(([cat]) => toTitleCase(cat).length), 'Category'.length);
  const amtWidth = 12;
  const pctWidth = 6;

  const lines = [];
  lines.push(header);
  lines.push('='.repeat(header.length));
  lines.push('Category'.padEnd(catWidth) + ' ' + 'Amount'.padStart(amtWidth) + ' ' + '%'.padStart(pctWidth));
  for (const [cat,total] of rows){
    const pct = grand ? (total/grand*100) : 0;
    lines.push(toTitleCase(cat).padEnd(catWidth) + ' ' + total.toFixed(2).padStart(amtWidth) + ' ' + (pct.toFixed(1)+'%').padStart(pctWidth));
  }
  lines.push('');
  lines.push('TOTAL'.padEnd(catWidth) + ' ' + grand.toFixed(2).padStart(amtWidth) + ' ' + '100%'.padStart(pctWidth));

  const blob = new Blob([lines.join('\n')], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `category_totals_${forFilename(label)}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
}

// UI wiring
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('csvFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { loadCsvText(reader.result); };
    reader.readAsText(f);
  });
  document.getElementById('exportRulesBtn').addEventListener('click', () => {
    const text = document.getElementById('rulesBox').value || '';
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'rules.txt'; document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById('importRulesBtn').addEventListener('click', () => document.getElementById('importRulesInput').click());
  document.getElementById('importRulesInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rdr = new FileReader(); rdr.onload = () => { document.getElementById('rulesBox').value = rdr.result || ''; applyRulesAndRender(); };
    rdr.readAsText(f);
  });
  document.getElementById('exportTotalsBtn').addEventListener('click', exportTotals);
  document.getElementById('clearFilterBtn').addEventListener('click', () => { CURRENT_FILTER = null; updateFilterUI(); renderTransactionsTable(); renderMonthTotals(); });
  document.getElementById('clearMonthBtn').addEventListener('click', () => { MONTH_FILTER = ""; document.getElementById('monthFilter').value = ""; updateMonthBanner(); applyRulesAndRender(); });
  document.getElementById('monthFilter').addEventListener('change', (e) => { MONTH_FILTER = e.target.value || ""; updateMonthBanner(); applyRulesAndRender(); });
  document.getElementById('txnsToggleBtn').addEventListener('click', () => {
    const body = document.getElementById('transactionsBody');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? '' : 'none';
    document.getElementById('txnsToggleBtn').textContent = isHidden ? 'Hide transactions' : 'Show transactions';
  });
});
