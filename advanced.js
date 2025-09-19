// Advanced Mode — reads transactions from localStorage and computes simple KPIs.

// --- Robust cross-page TXN loader ---
function readTxns() {
  const candidates = [
    'spendlite_txns_json_v7',
    'spendlite_txns_json_v6627',
    'spendlite_txns_json',
    'spendlite_txns'
  ];
  // Also scan localStorage for any spendlite*txns* keys
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /spendlite.*txns/i.test(k)) candidates.push(k);
    }
  } catch {}
  // Deduplicate while preserving order
  const seen = new Set(); const keys = candidates.filter(k => !seen.has(k) && seen.add(k));
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length >= 0) return arr;
    } catch {}
  }
  return [];
}
catch{return[]}};
function parseDateSafe(s){if(!s)return null;const d1=new Date(s);if(!isNaN(d1))return d1;const m=String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(m){const dd=+m[1],mm=+m[2],yy=+m[3];const y4=yy<100?2000+yy:yy;return new Date(y4,mm-1,dd)}return null}
function startOfDay(d){const x=new Date(d);x.setHours(0,0,0,0);return x}function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function startOfMonth(d){const x=new Date(d);return new Date(x.getFullYear(),x.getMonth(),1)}function startOfYear(d){const x=new Date(d);return new Date(x.getFullYear(),0,1)}
function formatMoney(v){return '$'+(v||0).toFixed(2)}function filterByRange(txns,from,to){const a=startOfDay(from),b=startOfDay(to);return txns.filter(t=>{const d=parseDateSafe(t.date);return d&&d>=a&&d<=b})}
function sumSpend(txns){return txns.reduce((acc,t)=>acc+(t.amount>0?t.amount:0),0)}function countTxns(txns){return txns.length}
function computeCompare(range){const now=new Date();let aFrom,aTo;switch(range){case'last7':aTo=startOfDay(now);aFrom=addDays(aTo,-6);break;case'last30':aTo=startOfDay(now);aFrom=addDays(aTo,-29);break;case'thisMonth':aFrom=startOfMonth(now);aTo=startOfDay(now);break;case'ytd':aFrom=startOfYear(now);aTo=startOfDay(now);break;default:aFrom=startOfMonth(now);aTo=startOfDay(now)}const days=Math.max(1,Math.round((aTo-aFrom)/86400000)+1);const bTo=addDays(aFrom,-1);const bFrom=addDays(bTo,-(days-1));return{aFrom,aTo,bFrom,bTo}}
function render(){const txns=readTxns();const container=document.querySelector('.adv-container');if(!txns.length){const div=document.createElement('div');div.className='card';div.innerHTML='<p class="muted">Load a CSV on the Simple screen first; data will appear here automatically.</p>';container.prepend(div)}const selected=window.localStorage.getItem('adv_range')||'thisMonth';document.querySelectorAll('.chip').forEach(ch=>{const tag=ch.textContent.toLowerCase();const key=tag.includes('7')?'last7':tag.includes('30')?'last30':tag.includes('year')?'ytd':tag.includes('month')?'thisMonth':'custom';ch.classList.toggle('active',key===selected);ch.addEventListener('click',()=>{if(key!=='custom'){localStorage.setItem('adv_range',key);render()}})});const {aFrom,aTo,bFrom,bTo}=computeCompare(selected);const inRangeA=filterByRange(txns,aFrom,aTo);const inRangeB=filterByRange(txns,bFrom,bTo);const aSpend=sumSpend(inRangeA),bSpend=sumSpend(inRangeB);const aCount=countTxns(inRangeA),bCount=countTxns(inRangeB);const boxes=document.querySelectorAll('.period-box');const aBox=boxes[0];aBox.querySelectorAll('.kpi .kpi-value')[0].textContent=formatMoney(aSpend);aBox.querySelectorAll('.kpi .kpi-value')[1].textContent=String(aCount);const bBox=boxes[1];bBox.querySelectorAll('.kpi .kpi-value')[0].textContent=formatMoney(bSpend);bBox.querySelectorAll('.kpi .kpi-value')[1].textContent=String(bCount);const delta=document.querySelector('.kpi.delta .kpi-value');const diff=bSpend-aSpend;delta.textContent=(diff>=0?'+':'-')+formatMoney(Math.abs(diff));const fmt=d=>d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});document.querySelectorAll('.period-box h3')[0].innerHTML=`Period A <small>(${fmt(aFrom)}–${fmt(aTo)})</small>`;document.querySelectorAll('.period-box h3')[1].innerHTML=`Period B <small>(${fmt(bFrom)}–${fmt(bTo)})</small>`}
document.addEventListener('DOMContentLoaded',render);
// Show a note if no transactions are found
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.adv-container') || document.body;
  try {
    const tx = readTxns();
    if (!tx || tx.length === 0) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.style.margin = '8px 0';
      note.textContent = 'No saved transactions found. Load a CSV in Simple mode first.';
      container.insertBefore(note, container.firstChild);
    }
  } catch {}
});


// Show number of transactions found prominently
document.addEventListener('DOMContentLoaded', () => {
  try {
    const tx = readTxns() || [];
    const el = document.getElementById('txnCount');
    if (el) el.textContent = `${tx.length} transactions loaded`;
  } catch {}
});
