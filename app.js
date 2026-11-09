const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const portrait = '<svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="27" r="13" stroke="currentColor" stroke-width="1.5"/><path d="M14 69c0-18 11-27 26-27s26 9 26 27" stroke="currentColor" stroke-width="1.5"/></svg>';
const config = window.STAGE_CONFIG || {};
const connected = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let scriptDraft=null, scriptDirty=false;
let scenarioId='';

// The original script stays in its existing field. Each mini-story owns a separate script.
function scenarioDocument(play) {
 if (!scenarioId) return play;
 const scenario=play.scenarios?.find(item=>item.id===scenarioId);
 if (!scenario) throw new Error('Сценарій не знайдено.');
 return scenario;
}

function switchScenario(id) {
 if (saving || (scriptDirty && !window.confirm('Відкинути незбережені зміни цього сценарію?'))) return false;
 scenarioId=id;
 scriptDraft=null;
 scriptDirty=false;
 render();
 return true;
}

function scenarioTitle(play,id) {
 if (!id) return play.mainScenarioTitle || 'Основний сценарій';
 return play.scenarios.find(item=>item.id===id).title;
}

async function renameScenario(id,title) {
 title=title.trim();
 if (!title) throw new Error('Вкажіть назву сценарію.');
 if (title===scenarioTitle(state,id)) return;
 await mutate(play=>{
  if (id) play.scenarios.find(item=>item.id===id).title=title;
  else play.mainScenarioTitle=title;
 });
}

async function createScenario(title) {
 title=title.trim();
 if (!title) throw new Error('Вкажіть назву сценарію.');
 const id=uid();
 await mutate(play=>{
  (play.scenarios??=[]).push({id,title,script:[]});
 });
 // Keep the current draft open when creating a scenario from an unsaved script.
 if (!scriptDirty) switchScenario(id);
}
let session = null, editor = false, state, revision = 0, saving = false, submitting = false, timer;
const initial = {
  points: [
    {id:'p1',title:'Тиша перед початком',text:'Усі 36 персонажів уже на сцені. Простір завмирає. Перший погляд, невеликий рух — і увага глядача знаходить свою початкову точку.',focus:'Спільний простір та перший рух'},
    {id:'p2',title:'Перший імпульс',text:'Один персонаж порушує тишу. Його дія відгукується в інших: хтось наближається, хтось відступає, хтось продовжує чекати.',focus:'Персонаж, який починає дію'},
    {id:'p3',title:'Перетин історій',text:'Окремі лінії зустрічаються. Між персонажами виникають зв’язки, а увага глядача переходить від однієї групи до іншої.',focus:'Зустрічі та взаємодія груп'},
    {id:'p4',title:'Точка напруги',text:'Спільний ритм змінюється. Кожен персонаж робить вибір, залишаючись частиною загальної картини.',focus:'Ключовий вибір'},
    {id:'p5',title:'Відлуння',text:'Події залишають слід у кожному. Рух сповільнюється, відкриваючи нові деталі та реакції.',focus:'Реакції та зміни'},
    {id:'p6',title:'Спільний фінал',text:'Усі історії знову збираються в одному просторі. Остання дія, спільний подих, тиша.',focus:'Завершальна картина'}
  ],
  characters:Array.from({length:36},(_,i)=>({id:`c${i+1}`,name:`Персонаж ${String(i+1).padStart(2,'0')}`,actor:'',bio:'',photo:'',notes:{}})),
  script:[],
  props:[]
};
function notify(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',4200);}
async function api(path, options={}){
 const res=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{...options,headers:{apikey:config.supabaseAnonKey,Authorization:`Bearer ${session?.access_token || config.supabaseAnonKey}`,'Content-Type':'application/json',...options.headers}});
 if(!res.ok){if(res.status===401){editor=false;session=null;render();}throw new Error(res.status===401?'Сеанс завершено. Увійдіть знову.':res.status===403?'Немає дозволу на редагування.':res.status===409?'Дані вже змінилися в іншому вікні. Оновіть сторінку перед редагуванням.':'Не вдалося виконати запит. Перевірте з’єднання та налаштування.');}
 return res.status===204?null:res.json();
}

const photoTypes = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
function validatePhoto(file){
 if(!photoTypes[file.type])throw new Error('Оберіть фото у форматі JPG, PNG, WebP або GIF.');
 if(!file.size || file.size>5*1024*1024)throw new Error('Фото має бути непорожнім і не перевищувати 5 МБ.');
}
async function uploadPhoto(file,characterId){
 if(!editor||!session)throw new Error('Увійдіть як редактор, щоб завантажити фото.');
 validatePhoto(file);
 const path=`${characterId}/${uid()}.${photoTypes[file.type]}`;
 await api(`/storage/v1/object/character-photos/${path}`,{method:'POST',body:file,headers:{'Content-Type':file.type,'Cache-Control':'max-age=31536000','x-upsert':'false'}});
 return `${config.supabaseUrl.replace(/\/$/,'')}/storage/v1/object/public/character-photos/${path}`;
}
async function saveCharacter(id,data){
 if(!editor)throw new Error('Увійдіть як редактор, щоб зберегти зміни.');
 const {name,actor,bio,photoFile,removePhoto}=data;
 if(!name.trim())throw new Error('Вкажіть ім’я.');
 const current=state.characters.find(c=>c.id===id);
 const color=data.color||characterColor(current);
 if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error("Оберіть коректний колір.");
 let photo=removePhoto?'':current.photo;
 if(photoFile?.size){
  $('#submit-modal').textContent='Завантаження фото…';
  photo=await uploadPhoto(photoFile,id);
 }
 $('#submit-modal').textContent='Збереження…';
 await mutate(s=>Object.assign(s.characters.find(c=>c.id===id),{name,actor,bio,photo,color}));
}

async function load(){
 if(!connected){state=structuredClone(initial);render();return;}
 $('#content').innerHTML='<p class="loading">Завантаження вистави…</p>';
 try{const rows=await api('/rest/v1/play?id=eq.1&select=data,revision');if(!rows.length)throw new Error('Виставу ще не створено. Виконайте SQL-налаштування.');state=rows[0].data;revision=rows[0].revision;render();}
 catch(e){$('#content').innerHTML=`<div class="empty">${esc(e.message)}<p><button class="quiet" id="retry">Спробувати знову</button></p></div>`;$('#retry').onclick=load;}
}
async function mutate(change){
 if(!editor||saving)throw new Error('Увійдіть як редактор, щоб зберегти зміни.');
 const next=structuredClone(state);change(next);saving=true;
 try{const result=await api('/rest/v1/rpc/save_play',{method:'POST',body:JSON.stringify({expected_revision:revision,new_data:next})});state=next;revision=result;render();notify('Зміни збережено для всіх учасників');}finally{saving=false;}
}
const avatar=c=>`<div class="avatar">${c.photo?`<img src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy">`:portrait}</div>`;
const number=i=>String(i+1).padStart(2,'0');
const action=(name,label,id,cls='quiet')=>`<button class="${cls}" data-action="${name}" data-id="${esc(id)}">${label}</button>`;
function pointActions(p,i){return editor?`<div class="actions">${action('edit-point','Редагувати',p.id)}${i>0?action('up','↑',p.id):''}${i<state.points.length-1?action('down','↓',p.id):''}${action('delete-point','Видалити',p.id,'quiet danger')}</div>`:'';}
function render(){
 if(!state)return;
 const [tab,id]=(location.hash.slice(1)||'script').split('/');
 document.querySelectorAll('nav a').forEach(a=>{a.classList.toggle('active',a.dataset.tab===tab);if(a.dataset.tab===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 $('#mode-label').textContent=editor?'Режим редактора':'Режим перегляду';$('#login').textContent=editor?'Вийти з акаунта':'↗ Вхід для редактора';
 $('#notice').textContent=connected?'':'Демонстраційний вміст · Підключіть Supabase, щоб зберігати зміни та відкрити вхід редактора.';
 $('#footer-status').textContent=connected?`Спільна версія · ${revision}`:'Демонстраційний простір';
 const views={script:renderScript,story:renderStory,characters:()=>renderCharacters(id),props:renderProps};$('#content').innerHTML=(views[tab]||renderScript)();
 $('#search')?.addEventListener('input',e=>{const q=e.target.value.toLocaleLowerCase('uk');document.querySelectorAll('.character-card').forEach(c=>c.hidden=!c.dataset.search.includes(q));$('#no-results').hidden=[...document.querySelectorAll('.character-card')].some(c=>!c.hidden);});
 if(editor&&tab==='script')bindScriptEditor();
 const scenarios=$('#scenario-select');
 if(scenarios)scenarios.onchange=()=>{if(!switchScenario(scenarios.value))scenarios.value=scenarioId;};
 const picker=$('#character-select');if(picker){tintCharacterSelect(picker);picker.addEventListener('change',e=>location.hash=`characters/${e.target.value}`);}
}

function previousCharacterColor(c){

 const i=Math.max(0,state.characters.findIndex(x=>x.id===c?.id));
 const hue=(i*137.508)%360, saturation=.62, lightness=.31;
 const a=saturation*Math.min(lightness,1-lightness);
 const component=n=>{const k=(n+hue/30)%12;return Math.round(255*(lightness-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
 return `#${component(0)}${component(8)}${component(4)}`;
}
const characterPalette=['#c62828','#1565c0','#2e7d32','#8e24aa','#e65100','#00838f','#ad1457','#6d4c41','#5e35b1','#00796b','#9e6c00','#37474f','#ef5350','#3949ab','#689f38','#d81b60','#039be5','#a44700','#7b1fa2','#008a70','#b58b00','#5c6b21','#b33c66','#00689d','#8b4513','#5661d2','#447b4b','#a538a0','#ce6a00','#008caa','#7c2332','#505050','#bd781a','#455a9b','#9b4e39','#527500'];
function characterColor(c){
 const i=Math.max(0,state.characters.findIndex(x=>x.id===c?.id));
 if(/^#[0-9a-f]{6}$/i.test(c?.color||'')&&c.color.toLowerCase()!==previousCharacterColor(c))return c.color;
 return characterPalette[i%characterPalette.length];
}
function tintCharacterSelect(select){
 const c=state.characters.find(c=>c.id===select.value);
 select.style.color=characterColor(c);
 select.style.borderLeft=`6px solid ${characterColor(c)}`;
}

function speakerLabel(c){return `${c.name} [${state.characters.findIndex(x=>x.id===c.id)+1}]`;}
function scriptToText(lines){
 return lines.map(l=>{
 const c=state.characters.find(c=>c.id===l.characterId);
 const text=l.text.replace(/\n/g,'\n  ');
 return l.type==='dialogue'?`- ${speakerLabel(c)}: ${text}`:l.type==='direction'?`(${text})`:text;
 }).join('\n\n');
}
function parseScript(text,strict=true){
 const result=[];
 for(const [i,raw] of text.split('\n').entries()){
 if(!raw.trim())continue;
 if(raw.startsWith('  ')&&result.length){result[result.length-1].text+='\n'+raw.slice(2);continue;}
 const line=raw.trim();
 if(line.startsWith('-')){
 const c=state.characters.find(c=>line.startsWith(`- ${speakerLabel(c)}:`));
 if(!c){if(strict)throw new Error(`Рядок ${i+1}: оберіть персонажа для репліки.`);result.push({id:uid(),type:'direction',text:line,characterId:null});continue;}
 const speech=line.slice(`- ${speakerLabel(c)}:`.length).trimStart();
 if(strict&&!speech.trim())throw new Error(`Рядок ${i+1}: введіть репліку.`);
 result.push({id:uid(),type:'dialogue',characterId:c.id,text:speech});
 }else result.push({id:uid(),type:line.startsWith('(')?'direction':'heading',characterId:null,text:line.startsWith('(')?line.slice(1):line});
 }
 result.forEach(l=>{if(l.type==='direction')l.text=l.text.replace(/\)$/,'');});
 return result;
}
function scriptPreview(lines){return lines.map(l=>{const c=state.characters.find(c=>c.id===l.characterId);return `<div class="script-entry ${l.type}" style="--speaker-color:${c?characterColor(c):'#66665f'}">${c?`<h3>${esc(c.name)}</h3>`:''}<div class="script-text">${esc(l.text)}</div></div>`;}).join('');}
function renderScriptEditor(){
 if(scriptDraft===null)scriptDraft=scriptToText(scenarioDocument(state).script||[]);
 return `<div class="section-head"><div><h2>Сценарій</h2><p class="subtext"><b>-</b> на початку рядка — репліка · <b>(</b> — дія · звичайний текст — заголовок</p></div><button class="primary" id="save-script-text">Зберегти сценарій</button></div><p id="script-save-status" role="status">${scriptDirty?'Є незбережені зміни':'Усі зміни збережено'}</p><div class="script-editor-wrap"><label class="tiny-heading" for="script-editor">ТЕКСТ СЦЕНАРІЮ</label><textarea id="script-editor" spellcheck="true" placeholder="Сцена перша\n\n(Світло повільно згасає)\n\n-" aria-describedby="script-help">${esc(scriptDraft)}</textarea><div id="script-character-menu" hidden><label for="script-character-choice">Хто говорить?</label><select id="script-character-choice" size="7" aria-label="Персонаж для репліки">${state.characters.map(c=>`<option value="${esc(c.id)}" style="color:${characterColor(c)}">${esc(speakerLabel(c))}${c.actor?' · '+esc(c.actor):''}</option>`).join('')}</select><button class="primary" id="choose-script-character">Обрати персонажа</button></div></div><p class="subtext" id="script-help">Enter — новий рядок. Два пробіли на початку — продовження попередньої репліки. Ctrl / ⌘ + Enter — зберегти.</p><p class="tiny-heading preview-label">ПОПЕРЕДНІЙ ПЕРЕГЛЯД</p><div id="script-live-preview" class="script-page">${scriptPreview(parseScript(scriptDraft,false))}</div>`;
}
function bindScriptEditor(){
 const input=$('#script-editor'),menu=$('#script-character-menu'),choice=$('#script-character-choice');
 const currentLine=()=>{const start=input.value.lastIndexOf('\n',input.selectionStart-1)+1;const end=input.value.indexOf('\n',input.selectionStart);return {start,end:end<0?input.value.length:end,text:input.value.slice(start,end<0?input.value.length:end)};};
 const updateMenu=()=>{const line=currentLine().text;menu.hidden=!/^\s*-/.test(line)||state.characters.some(c=>line.trimStart().startsWith(`- ${speakerLabel(c)}:`));};
 const update=()=>{scriptDraft=input.value;scriptDirty=true;$('#script-save-status').textContent='Є незбережені зміни';$('#script-live-preview').innerHTML=scriptPreview(parseScript(scriptDraft,false));updateMenu();};
 input.addEventListener('input',update);input.addEventListener('click',updateMenu);input.addEventListener('keyup',updateMenu);
 const choose=()=>{const c=state.characters.find(c=>c.id===choice.value);if(!c)return;const line=currentLine();const content=line.text.replace(/^\s*-\s*/,'');const value=`- ${speakerLabel(c)}: ${content}`;input.setRangeText(value,line.start,line.end,'end');input.focus();update();};
 $('#choose-script-character').onclick=choose;choice.addEventListener('click',choose);choice.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();choose();}if(e.key==='Escape'){menu.hidden=true;input.focus();}});
 input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!menu.hidden){e.preventDefault();choice.focus();}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('#save-script-text').click();}if(e.key==='Escape')menu.hidden=true;});
 $('#save-script-text').onclick=async()=>{
 const button=$('#save-script-text');button.disabled=true;input.readOnly=true;menu.hidden=true;
 try{const lines=parseScript(input.value);await mutate(s=>{scenarioDocument(s).script=lines;});scriptDirty=false;scriptDraft=null;render();}
 catch(e){const status=$('#script-save-status');if(status)status.textContent=e.message;else notify(e.message);}
 finally{button.disabled=false;input.readOnly=false;}
 };
}

function renderScript(){
 const options=(state.scenarios||[]).map(item=>`<option value="${esc(item.id)}" ${item.id===scenarioId?'selected':''}>${esc(item.title)}</option>`).join('');
 const controls=editor?action('rename-scenario','Перейменувати',scenarioId)+action('new-scenario','+ Новий сценарій',''):'';
 const toolbar=`<div class="scenario-toolbar"><label for="scenario-select">Обрати сценарій</label><select id="scenario-select"><option value="">${esc(scenarioTitle(state,''))}</option>${options}</select>${controls}</div>`;
 return toolbar+(editor?renderScriptEditor():renderScriptReader());
}
function renderScriptReader(){
 const lines=scenarioDocument(state).script||[];
 return `<div class="section-head"><div><h2>Сценарій</h2><p class="subtext">Повний текст вистави: репліки, ремарки та сцени.</p></div>${editor?action('add-script','+ Додати текст','','primary'):''}</div><div class="script-page">${lines.map((line,i)=>{
 const c=state.characters.find(c=>c.id===line.characterId);
 const color=line.type==='dialogue'&&c?characterColor(c):'#55564f';
 return `<article class="script-entry ${esc(line.type)}" style="--speaker-color:${color}">${line.type==='dialogue'?`<h3>${esc(c?.name||'Персонаж')}${c?.actor?` <small>· ${esc(c.actor)}</small>`:''}</h3>`:''}<div class="script-text">${esc(line.text)}</div>${editor?`<div class="actions">${action('edit-script','Редагувати',line.id)}${action('insert-script','+ Після',line.id)}${i?action('script-up','↑',line.id):''}${i<lines.length-1?action('script-down','↓',line.id):''}${action('delete-script','Видалити',line.id,'quiet danger')}</div>`:''}</article>`;
 }).join('')||'<div class="empty">Сценарій ще не додано.</div>'}</div>`;
}
function scriptForm(line){
 return `<label for="script-type">Тип тексту</label><select name="type" id="script-type">${[['dialogue','Репліка'],['direction','Ремарка'],['heading','Сцена / заголовок']].map(([value,label])=>`<option value="${value}" ${line?.type===value?'selected':''}>${label}</option>`).join('')}</select><div id="speaker-fields"><label for="script-speaker">Хто говорить</label><select name="characterId" id="script-speaker">${state.characters.map(c=>`<option style="color:${characterColor(c)};background:#fffefa;font-weight:600" value="${esc(c.id)}" ${line?.characterId===c.id?'selected':''}>${esc(c.name)}${c.actor?' · '+esc(c.actor):''}</option>`).join('')}</select><p class="subtext">Колір репліки береться з профілю персонажа.</p></div>${field('Текст','text',line?.text,true)}`;
}
async function saveScriptLine(id,afterId,data){
 if(!['dialogue','direction','heading'].includes(data.type)||!data.text.trim())throw new Error('Оберіть тип і введіть текст.');
 if(data.type==='dialogue'&&!state.characters.some(c=>c.id===data.characterId))throw new Error('Оберіть персонажа.');
 const entry={type:data.type,text:data.text,characterId:data.type==='dialogue'?data.characterId:null};
 await mutate(s=>{s.script??=[];if(id)Object.assign(s.script.find(l=>l.id===id),entry);else{const at=afterId?s.script.findIndex(l=>l.id===afterId)+1:s.script.length;s.script.splice(at,0,{id:uid(),...entry});}});
}

function renderStory(){return `<div class="section-head"><div><h2>Основна історія</h2><p class="subtext">Послідовність подій та фокус уваги глядача.</p></div><div class="toolbar"><span class="count">${state.points.length} точок уваги</span>${editor?action('add-point','+ Додати точку',''):''}</div></div><div class="story-layout"><aside class="outline"><p class="tiny-heading">ЛІНІЯ ВИСТАВИ</p>${state.points.map((p,i)=>`<a href="#point-${esc(p.id)}" data-scroll="point-${esc(p.id)}"><span>${number(i)}</span>${esc(p.title)}</a>`).join('')}<p class="outline-note">Кожна точка поєднує основну історію з діями всіх 36 персонажів.</p></aside><div>${state.points.map((p,i)=>`<article class="point" id="point-${esc(p.id)}"><div class="point-top"><span class="point-no">${number(i)}</span><span class="point-tag">ТОЧКА УВАГИ</span></div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>${pointActions(p,i)}</article>`).join('')||'<div class="empty">Додайте першу точку уваги для вашої вистави.</div>'}</div></div>`;}
function renderCharacters(id){
 const c=state.characters.find(c=>c.id===id);
 if(c)return `<a class="back" href="#characters">← Усі персонажі</a><div class="section-head"><div><h2>Лінія персонажа</h2><p class="subtext">Особиста історія у спільному ритмі вистави.</p></div><select id="character-select" class="character-select" aria-label="Обрати персонажа">${state.characters.map(x=>`<option style="color:${characterColor(x)};background:#fffefa;font-weight:600" value="${esc(x.id)}" ${x.id===id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="character-layout"><aside class="profile">${avatar(c)}<h2><span class="color-dot" style="background:${characterColor(c)}"></span>${esc(c.name)}</h2><p>${esc(c.actor||'Ім’я актора ще не додано')}</p><p>${esc(c.bio||'Тут з’явиться інформація про персонажа: його характер, мотивація та зв’язки.')}</p>${editor?`<div class="actions">${action('edit-character','Редагувати профіль',c.id)}</div>`:''}</aside><div>${state.points.map((p,i)=>`<article class="point"><div class="point-top"><span class="point-no">${number(i)}</span><span class="point-tag">${esc(p.title)}</span></div><p>${esc(c.notes[p.id]||'Дії персонажа в цій точці ще не описані.')}</p>${editor?`<div class="actions">${action('edit-note','Редагувати дії',`${c.id}/${p.id}`)}</div>`:''}</article>`).join('')||'<div class="empty">Спочатку додайте точки в основній історії.</div>'}</div></div>`;
 return `<div class="section-head"><div><h2>36 персонажів</h2><p class="subtext">Оберіть персонажа, щоб побачити його історію.</p></div><input class="search" id="search" type="search" placeholder="Пошук персонажа чи актора…" aria-label="Пошук персонажа чи актора"></div><div class="character-grid">${state.characters.map((c,i)=>`<a class="character-card" href="#characters/${esc(c.id)}" data-search="${esc((c.name+' '+c.actor).toLocaleLowerCase('uk'))}">${avatar(c)}<h3><span class="color-dot" style="background:${characterColor(c)}"></span>${esc(c.name)}</h3><small>${esc(c.actor||`Учасник ${number(i)}`)}</small></a>`).join('')}</div><p class="empty" id="no-results" hidden>Персонажів не знайдено.</p>`;
}
function renderProps(){const done=state.props.filter(p=>p.done).length;return `<div class="section-head"><div><h2>Список реквізиту</h2><p class="subtext">Усе, що має бути готове до виходу на сцену.</p></div>${editor?action('add-prop','+ Додати реквізит',''):'<span class="count">Лише перегляд</span>'}</div><div class="props-summary"><p class="tiny-heading">ГОТОВО ${done} ІЗ ${state.props.length}</p><div class="progress" aria-label="Готовність реквізиту"><i style="width:${state.props.length?done/state.props.length*100:0}%"></i></div></div>${state.props.length?`<div class="props-list">${state.props.map(p=>`<div class="prop-row ${p.done?'done':''}"><input type="checkbox" aria-label="${esc(p.name)} — готово" data-check="${esc(p.id)}" ${p.done?'checked':''} ${editor?'':'disabled'}><div class="prop-info"><strong>${esc(p.name)}</strong><p>${esc(p.note)}</p></div>${editor?`<div class="actions">${action('edit-prop','Змінити',p.id)}${action('delete-prop','×',p.id,'quiet danger')}</div>`:''}</div>`).join('')}</div>`:'<div class="empty"><h3>Місце для важливих деталей</h3><p>Реквізит ще не додано. Тут буде список речей та їхня готовність.</p></div>'}`;}
function field(label,name,value='',multi=false,type='text'){return `<label for="field-${name}">${label}</label>${multi?`<textarea id="field-${name}" name="${name}" maxlength="20000">${esc(value)}</textarea>`:`<input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${['title','name','email','password'].includes(name)?'required':''} maxlength="${name==='photo'?2000:300}" ${type==='password'?'autocomplete="current-password"':''}>`}`;}
function modal(title,body,submit,label='Зберегти'){
 $('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#form-error').textContent='';$('#submit-modal').textContent=label;$('#submit-modal').disabled=false;
 $('#modal-form').onsubmit=async e=>{e.preventDefault();if(submitting)return;submitting=true;$('#form-error').textContent='';$('#submit-modal').disabled=true;$('#close-modal').disabled=$('#cancel-modal').disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));$('#modal').close();}catch(err){$('#form-error').textContent=err.message;}finally{submitting=false;$('#submit-modal').disabled=false;$('#submit-modal').textContent=label;$('#close-modal').disabled=$('#cancel-modal').disabled=false;}};$('#modal').showModal();
}
$('#close-modal').onclick=$('#cancel-modal').onclick=()=>{if(!saving&&!submitting)$('#modal').close();};
$('#modal').addEventListener('cancel',e=>{if(submitting||saving)e.preventDefault();});
$('#login').onclick=async()=>{
 if(editor){try{await api('/auth/v1/logout',{method:'POST'});}catch{}session=null;editor=false;render();return;}
 if(!connected){modal('Вхід ще не підключено','<p>Для входу редактора потрібно підключити Supabase та призначити один акаунт редактором. Інструкція є у файлі README репозиторію.</p>',async()=>{},'Зрозуміло');return;}
 modal('Вхід для редактора','<p class="subtext">Гості можуть переглядати виставу без входу.</p>'+field('Електронна пошта','email','','','email')+field('Пароль','password','','','password'),async data=>{
 session=await api('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify(data)});
 try{const admins=await api('/rest/v1/editors?select=user_id');if(!admins.some(a=>a.user_id===session.user.id))throw new Error('Цей акаунт не має права редагувати виставу.');editor=true;await load();notify('Ви увійшли як редактор');}catch(e){session=null;editor=false;throw e;}
 },'Увійти');
};
$('#content').addEventListener('click',e=>{
 const link=e.target.closest('[data-scroll]');if(link){e.preventDefault();document.getElementById(link.dataset.scroll)?.scrollIntoView({behavior:'smooth'});return;}
 const b=e.target.closest('[data-action]');if(!b||!editor)return;const {action:a,id}=b.dataset,p=state.points.find(p=>p.id===id),c=state.characters.find(c=>c.id===id),prop=state.props.find(p=>p.id===id);
 if(a==='new-scenario')modal('Новий сценарій',field('Назва сценарію','title'),data=>createScenario(data.title),'Створити');
 if(a==='rename-scenario')modal('Перейменувати сценарій',field('Назва сценарію','title',scenarioTitle(state,id)),data=>renameScenario(id,data.title));
 if(['add-script','edit-script','insert-script'].includes(a)){
 const line=a==='edit-script'?(state.script||[]).find(l=>l.id===id):null;
 modal(line?'Редагувати текст':'Додати до сценарію',scriptForm(line),d=>saveScriptLine(line?.id,a==='insert-script'?id:null,d));
 const speaker=$('#script-speaker');tintCharacterSelect(speaker);speaker.addEventListener('change',()=>tintCharacterSelect(speaker));
 const toggle=()=>{$('#speaker-fields').hidden=$('#script-type').value!=='dialogue';};$('#script-type').addEventListener('change',toggle);toggle();
 }
 if(a==='script-up'||a==='script-down')mutate(s=>{const i=s.script.findIndex(l=>l.id===id),j=i+(a==='script-up'?-1:1);if(j>=0&&j<s.script.length)[s.script[i],s.script[j]]=[s.script[j],s.script[i]];}).catch(e=>notify(e.message));
 if(a==='delete-script')modal('Видалити текст?','<p>Цей фрагмент буде видалено зі сценарію.</p>',()=>mutate(s=>{s.script=s.script.filter(l=>l.id!==id);}),'Видалити');
 if(a==='add-point'||a==='edit-point')modal(p?'Редагувати точку':'Нова точка уваги',field('Назва','title',p?.title)+field('Основна історія','text',p?.text,true),d=>{if(!d.title.trim())throw new Error('Вкажіть назву.');return mutate(s=>{if(p)Object.assign(s.points.find(x=>x.id===id),d);else s.points.push({id:uid(),...d});});});
 if(a==='up'||a==='down')mutate(s=>{const i=s.points.findIndex(x=>x.id===id),j=i+(a==='up'?-1:1);[s.points[i],s.points[j]]=[s.points[j],s.points[i]];}).catch(e=>notify(e.message));
 if(a==='delete-point')modal('Видалити точку?',`<p>«${esc(p.title)}» та відповідні дії всіх персонажів буде видалено.</p>`,()=>mutate(s=>{s.points=s.points.filter(x=>x.id!==id);s.characters.forEach(x=>delete x.notes[id]);}),'Видалити');
 if(a==='edit-character')modal('Профіль персонажа',field('Ім’я персонажа','name',c.name)+field('Ім’я актора','actor',c.actor)+field('Про персонажа','bio',c.bio,true)+field('Колір персонажа','color',characterColor(c),false,'color')+'<label for="field-photo-file">Фото з пристрою</label><input id="field-photo-file" name="photoFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-describedby="photo-help"><p id="photo-help" class="subtext">JPG, PNG, WebP або GIF · до 5 МБ. Нове фото буде завантажено після збереження. Без нового файлу поточне фото залишиться.</p>'+(c.photo?'<label class="photo-remove"><input type="checkbox" name="removePhoto"> Прибрати поточне фото</label>':''),d=>saveCharacter(id,d));
 if(a==='edit-note'){const [cid,pid]=id.split('/'),char=state.characters.find(x=>x.id===cid);modal('Дії персонажа',field('Що робить персонаж у цій точці?','note',char.notes[pid],true),d=>mutate(s=>{s.characters.find(x=>x.id===cid).notes[pid]=d.note;}));}
 if(a==='add-prop'||a==='edit-prop')modal(prop?'Редагувати реквізит':'Новий реквізит',field('Назва речі','name',prop?.name)+field('Кількість, відповідальний або примітка','note',prop?.note,true),d=>{if(!d.name.trim())throw new Error('Вкажіть назву.');return mutate(s=>{if(prop)Object.assign(s.props.find(x=>x.id===id),d);else s.props.push({id:uid(),done:false,...d});});});
 if(a==='delete-prop')modal('Видалити реквізит?',`<p>Видалити «${esc(prop.name)}» зі списку?</p>`,()=>mutate(s=>{s.props=s.props.filter(x=>x.id!==id);}),'Видалити');
});
$('#content').addEventListener('change',async e=>{if(!e.target.matches('[data-check]'))return;const target=e.target;target.disabled=true;try{await mutate(s=>{s.props.find(x=>x.id===target.dataset.check).done=target.checked;});}catch(err){render();notify(err.message);}});
$('#content').addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.parentNode.innerHTML=portrait;},true);
window.addEventListener('hashchange',render);
window.addEventListener('beforeunload',e=>{if(saving||submitting||scriptDirty){e.preventDefault();e.returnValue='';}});
$('#stage-dots').innerHTML='<i></i>'.repeat(36);
// Refresh authenticated sessions in memory; no credentials are written to localStorage.
setInterval(async()=>{if(!session)return;if(session.expires_at*1000-Date.now()<120000){try{session=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});}catch{session=null;editor=false;render();notify('Увійдіть повторно, щоб редагувати.');}}},30000);
load();
