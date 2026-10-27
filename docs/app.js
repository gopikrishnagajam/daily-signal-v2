/* Daily Signal v2 — source-linked, accessible, no dependencies.
 * Feed data is public; saved article snapshots never leave this browser.
 */
(() => {
  'use strict';
  const CATEGORIES = [
    ['All','All stories'],['immigration','Visa & DHS'],['us','USA'],['india','India'],
    ['world','World'],['technology','Tech & AI'],['football','Football'],['cricket','Cricket'],['f1','F1'],['Saved','Saved ☆']
  ];
  const LABELS = Object.fromEntries(CATEGORIES);
  const ARCHIVE_KEY = 'daily-signal-v2-archive';
  const FEED_CACHE_KEY = 'daily-signal-v2-last-feed';
  const AGE_MS = 48 * 60 * 60 * 1000;
  const LIMIT = 65;
  const byId = (id) => document.getElementById(id);
  let mode = 'All', query = '', feed = {articles:[], updatedAt:null}, archive = new Map(), toastTimer;
  const preview = !!window.__DS_PREVIEW__;

  function safeRead(key, fallback) {
    try { const data = JSON.parse(localStorage.getItem(key) || 'null'); return data ?? fallback; }
    catch { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
  function safeUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } }
  function validArticle(a) {
    return !!a && typeof a === 'object' && typeof a.id === 'string' && a.id.length < 120 &&
      typeof a.title === 'string' && a.title.trim() && a.title.length < 400 &&
      typeof a.section === 'string' && CATEGORIES.some(c => c[0] === a.section) &&
      typeof a.publishedAt === 'string' && Number.isFinite(Date.parse(a.publishedAt)) &&
      typeof a.url === 'string' && !!safeUrl(a.url);
  }
  function sanitize(a) {
    return {id:a.id, title:a.title.trim(), excerpt:String(a.excerpt || '').slice(0,1000),
      section:a.section, source:String(a.source || 'Publisher').slice(0,120),
      url:safeUrl(a.url), publishedAt:a.publishedAt, officialSource:!!a.officialSource,
      kind:a.kind === 'project' ? 'project' : 'news'};
  }
  function dateLabel(iso) {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'}).format(d) + ' CT' : 'Date unknown';
  }
  function relativeAge(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return 'Date unknown';
    if (ms < 60*60*1000) return Math.max(1,Math.floor(ms/60000)) + 'm ago';
    if (ms < 24*60*60*1000) return Math.floor(ms/3600000) + 'h ago';
    return Math.floor(ms/86400000) + 'd ago';
  }
  function fresh(a) { const t = Date.parse(a.publishedAt); return Number.isFinite(t) && t <= Date.now() + 600000 && t >= Date.now()-AGE_MS; }
  function cleanFeed(input) {
    const list = Array.isArray(input?.articles) ? input.articles : [];
    const seen = new Set();
    return {updatedAt:typeof input?.updatedAt === 'string' ? input.updatedAt : null,
      articles:list.filter(validArticle).filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; }).slice(0,LIMIT*2).map(sanitize)};
  }
  function orderForAll(articles) {
    const groups = new Map(CATEGORIES.slice(1,-1).map(c => [c[0], []]));
    for (const a of articles) if (groups.has(a.section)) groups.get(a.section).push(a);
    for (const g of groups.values()) g.sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
    const out = [];
    for (let i=0;i<16;i++) for (const [cat] of CATEGORIES.slice(1,-1)) {
      const next = groups.get(cat)?.[i]; if (next) out.push(next);
    }
    return out;
  }
  function selectedItems() {
    const data = mode === 'Saved' ? [...archive.values()].sort((a,b)=>Date.parse(b.savedAt || b.publishedAt)-Date.parse(a.savedAt || a.publishedAt)) :
      orderForAll(feed.articles.filter(fresh)).filter(a => mode === 'All' || a.section === mode);
    const q = query.trim().toLowerCase();
    return q ? data.filter(a => [a.title,a.excerpt,a.source,a.section].join(' ').toLowerCase().includes(q)) : data;
  }
  function element(tag, cls, text) { const el=document.createElement(tag); if(cls) el.className=cls; if(text !== undefined) el.textContent=text; return el; }
  function toast(text) { const t=byId('toast'); t.textContent=text; t.classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('visible'),2400); }
  function persistArchive() { if (!save(ARCHIVE_KEY,[...archive.values()])) toast('Saving is unavailable in this browser.'); }
  function setArchive(a, force) {
    const shouldSave=typeof force === 'boolean' ? force : !archive.has(a.id);
    if(shouldSave) archive.set(a.id,{...sanitize(a),savedAt:new Date().toISOString()});
    else archive.delete(a.id);
    persistArchive(); render(); toast(shouldSave?'Saved to your archive':'Removed from saved');
  }
  function renderCategories() {
    const nav=byId('categories'); nav.replaceChildren();
    for(const [key,label] of CATEGORIES) {
      const button=element('button', 'pill' + (key===mode?' active':''),label);
      button.type='button';button.setAttribute('aria-pressed',String(key===mode));
      button.addEventListener('click',()=>setMode(key));nav.appendChild(button);
    }
    document.querySelectorAll('.bottom-item[data-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode||(mode!=='Saved'&&btn.dataset.mode==='All')));
  }
  function setMode(next) { mode=next; query=''; byId('searchInput').value=''; byId('searchBar').hidden=true; render(); byId('feedTitle').scrollIntoView({behavior:'smooth',block:'start'}); }
  function makeCard(a, featured) {
    const card=element('article','article'+(featured?' featured':''));
    const top=element('div','article-top');
    top.appendChild(element('span','article-tag',a.kind==='project'?'OPEN SOURCE FIND':(LABELS[a.section]||a.section).toUpperCase()));
    const age=element('span','source-time',relativeAge(a.publishedAt));age.title=dateLabel(a.publishedAt);top.appendChild(age);card.appendChild(top);
    card.appendChild(element('h3','',a.title));
    card.appendChild(element('p','',a.excerpt||'Read the original publisher report for verified details and context.'));
    card.appendChild(element('div','article-spacer'));
    const foot=element('div','article-footer');const source=element('div','article-source');
    source.appendChild(element('strong','',a.source));source.appendChild(element('span','',dateLabel(a.publishedAt)));foot.appendChild(source);
    const actions=element('div','article-actions');const saved=element('button','save-btn'+(archive.has(a.id)?' is-saved':''),archive.has(a.id)?'★':'☆');
    saved.type='button'; saved.title=archive.has(a.id)?'Remove saved story':'Save story';saved.setAttribute('aria-label',saved.title);
    saved.addEventListener('click',()=>setArchive(a));actions.appendChild(saved);
    const read=element('button','read-btn','↗');read.type='button';read.title='Read article summary';read.setAttribute('aria-label','Read: '+a.title);
    read.addEventListener('click',()=>openStory(a));actions.appendChild(read);foot.appendChild(actions);card.appendChild(foot);
    return card;
  }
  function showEmpty() {
    const box=element('div','empty');box.appendChild(element('div','empty-symbol','✳'));
    const noneSaved=mode==='Saved';const noFeed=feed.articles.filter(fresh).length===0;
    box.appendChild(element('h3','',noneSaved?'Your collection starts here.':query?'No matching stories.':noFeed?'Waiting for the first live refresh.':'No new stories in this section.'));
    box.appendChild(element('p','',noneSaved?'Tap the star on a story to keep a saved copy in this browser. Only saved stories appear here.':query?'Try a different keyword or clear your search.':noFeed?'The scheduler publishes dated, sourced headlines every 12 hours. No invented sample stories are shown as live news.':'Try another section or check after the next scheduled refresh.'));
    const button=element('button','',noneSaved?'Explore stories':query?'Clear search':'All stories');button.type='button';button.addEventListener('click',()=>{ if(query){query='';byId('searchInput').value='';render();}else setMode('All'); });box.appendChild(button);return box;
  }
  function render() {
    renderCategories(); byId('savedCount').textContent=String(archive.size);
    byId('feedTitle').textContent=mode==='Saved'?'Your archive':mode==='All'?'The briefing':LABELS[mode]||mode;
    byId('feedTitle').appendChild(element('span','title-dot','.'));
    byId('currentSectionLabel').textContent=mode==='Saved'?'KEEP WHAT MATTERS':mode==='All'?'CURATED HEADLINES':'TOPICAL BRIEFING';
    const list=selectedItems();byId('feedCount').textContent=String(list.length).padStart(2,'0') + (list.length===1?' STORY':' STORIES');
    const node=byId('feed');node.replaceChildren();
    if(!list.length){node.appendChild(showEmpty());return;}
    list.forEach((a,i)=>node.appendChild(makeCard(a, i===0 && mode!=='Saved' && !query)));
  }
  function storyLink(a) { const l=element('a','primary-link',preview?'Sample content':'Read original source ↗');l.href=preview?'https://example.org/':a.url;l.target='_blank';l.rel='noopener noreferrer';if(preview){l.addEventListener('click',e=>e.preventDefault());l.setAttribute('aria-disabled','true');}return l; }
  function openStory(a) {
    const d=byId('storyDialog'),c=byId('storyContent');c.replaceChildren();
    c.appendChild(element('div','story-eyebrow',a.kind==='project'?'REPOSITORY SPOTLIGHT':(LABELS[a.section]||a.section).toUpperCase()));
    c.appendChild(element('h2','story-title',a.title));
    c.appendChild(element('div','story-meta',a.source+' · Published '+dateLabel(a.publishedAt)));
    c.appendChild(element('p','story-summary',a.excerpt||'Publisher excerpt not available. Open the original source for the complete story.'));
    c.appendChild(element('div','source-note',preview?'This is design-preview content, not current reporting.':'This brief contains only publisher-provided text. It is not an independently verified full report; always read the original source before acting, especially on immigration or legal changes.'));
    const actions=element('div','story-actions');actions.appendChild(storyLink(a));
    const saveButton=element('button','secondary-action',archive.has(a.id)?'★ Remove saved':'☆ Save story');saveButton.type='button';saveButton.addEventListener('click',()=>{setArchive(a);saveButton.textContent=archive.has(a.id)?'★ Remove saved':'☆ Save story';});actions.appendChild(saveButton);c.appendChild(actions);
    if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');
  }
  function closeStory() { const d=byId('storyDialog');if(typeof d.close==='function' && d.open)d.close();else d.removeAttribute('open'); }
  function updateStatus() {
    const freshCount=feed.articles.filter(fresh).length;
    const validTime=feed.updatedAt && Number.isFinite(Date.parse(feed.updatedAt));
    const hoursOld=validTime?(Date.now()-Date.parse(feed.updatedAt))/3600000:Infinity;
    byId('lastUpdated').textContent=validTime?'Last sync: '+dateLabel(feed.updatedAt):'Last sync: unavailable';
    if(preview){byId('liveStatus').textContent='Design preview';byId('liveDescription').textContent='Sample layout only. No live headlines in preview.';return;}
    if(!freshCount){byId('liveStatus').textContent='Awaiting fresh stories';byId('liveDescription').textContent=validTime?'No dated headlines within the last 48 hours.':'The news feed has not published its first successful refresh.';return;}
    byId('liveStatus').textContent=hoursOld > 15?'Feed update delayed':'Latest feed ready';
    byId('liveDescription').textContent=freshCount+' attributed stories available'+(hoursOld>15?'. Awaiting next successful scheduled run.':'. Sources and publication dates included.');
  }
  async function loadFeed() {
    if(preview){feed=cleanFeed(window.__DS_PREVIEW__);updateStatus();render();return;}
    byId('refresh').disabled=true;
    try {
      const response=await fetch('./feed.json?v='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const next=cleanFeed(await response.json());feed=next;save(FEED_CACHE_KEY,next);
    } catch(e) {feed=cleanFeed(safeRead(FEED_CACHE_KEY,{articles:[]})); if(!feed.articles.length) console.warn('Feed unavailable',e);}
    byId('refresh').disabled=false;updateStatus();render();
  }
  function exportSaved() {
    const data=JSON.stringify({format:'daily-signal-v2-archive',exportedAt:new Date().toISOString(),articles:[...archive.values()]},null,2);
    const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='daily-signal-saved-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Saved stories exported');
  }
  async function importSaved(file) {
    if(!file) return;
    if(file.size>2_000_000){toast('Archive file is too large');return;}
    try {const obj=JSON.parse(await file.text());if(obj?.format!=='daily-signal-v2-archive'||!Array.isArray(obj.articles))throw Error('Unrecognized format');
      let n=0; for(const item of obj.articles.slice(0,500)){if(validArticle(item)){archive.set(item.id,{...sanitize(item),savedAt:item.savedAt||new Date().toISOString()});n++;}}
      persistArchive();render();toast('Imported '+n+' saved stories');
    } catch {toast('Could not import this archive');} finally{byId('importSaved').value='';}
  }
  function about() {
    const d=byId('storyDialog'),c=byId('storyContent');c.replaceChildren();c.appendChild(element('div','story-eyebrow','ABOUT DAILY SIGNAL'));
    c.appendChild(element('h2','story-title','The important stuff. Nothing invented.'));
    c.appendChild(element('p','story-summary','Daily Signal brings together headlines and short excerpts from attributed public RSS feeds. It is a news discovery tool, not a source of legal or immigration advice. Individual publishers are responsible for their reporting.'));
    c.appendChild(element('div','source-note','Saved articles live only in this browser, on this site address. They are not sent to a server or synced between devices. Use Export saved to make a backup before changing domains or clearing browser data. Unsaved news expires from the feed after 48 hours.'));
    if(typeof d.showModal==='function') d.showModal(); else d.setAttribute('open','');
  }
  function showSearch() {const bar=byId('searchBar');bar.hidden=false;bar.scrollIntoView({behavior:'smooth',block:'center'});byId('searchInput').focus();}
  function init() {
    const archiveItems=safeRead(ARCHIVE_KEY,[]);if(Array.isArray(archiveItems)) for(const a of archiveItems.slice(0,500)) if(validArticle(a)) archive.set(a.id,{...sanitize(a),savedAt:a.savedAt});
    byId('year').textContent=new Date().getFullYear();byId('currentDate').textContent=new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'}).format(new Date()).toUpperCase();
    byId('searchToggle').addEventListener('click',showSearch);byId('bottomSearch').addEventListener('click',showSearch);
    byId('clearSearch').addEventListener('click',()=>{query='';byId('searchInput').value='';render();});
    byId('searchInput').addEventListener('input',e=>{query=e.target.value;render();});
    byId('topSaved').addEventListener('click',()=>setMode('Saved'));
    document.querySelectorAll('.bottom-item[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
    byId('refresh').addEventListener('click',()=>{loadFeed();toast(preview?'Preview content':'Checking latest published feed');});
    byId('exportSaved').addEventListener('click',exportSaved);byId('importSaved').addEventListener('change',e=>importSaved(e.target.files?.[0]));
    byId('about').addEventListener('click',about);byId('closeStory').addEventListener('click',closeStory);
    byId('storyDialog').addEventListener('click',e=>{if(e.target===byId('storyDialog'))closeStory();});
    byId('brandLink').addEventListener('click',e=>{e.preventDefault();setMode('All');window.scrollTo({top:0,behavior:'smooth'});});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden && !preview)loadFeed();});
    render();loadFeed();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
