const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const portrait = '<svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="27" r="13" stroke="currentColor" stroke-width="1.5"/><path d="M14 69c0-18 11-27 26-27s26 9 26 27" stroke="currentColor" stroke-width="1.5"/></svg>';
const config = window.STAGE_CONFIG || {};
const connected = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let session = null, editor = false, state, revision = 0, saving = false, timer;
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
  props:[]
};
function notify(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',4200);}
async function api(path, options={}){
 const res=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{...options,headers:{apikey:config.supabaseAnonKey,Authorization:`Bearer ${session?.access_token || config.supabaseAnonKey}`,'Content-Type':'application/json',...options.headers}});
 if(!res.ok){if(res.status===401){editor=false;session=null;render();}throw new Error(res.status===401?'Сеанс завершено. Увійдіть знову.':res.status===403?'Немає дозволу на редагування.':res.status===409?'Дані вже змінилися в іншому вікні. Оновіть сторінку перед редагуванням.':'Не вдалося виконати запит. Перевірте з’єднання та налаштування.');}
 return res.status===204?null:res.json();
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
 const [tab='story',id]=location.hash.slice(1).split('/');
 document.querySelectorAll('nav a').forEach(a=>{a.classList.toggle('active',a.dataset.tab===tab);if(a.dataset.tab===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 $('#mode-label').textContent=editor?'Режим редактора':'Режим перегляду';$('#login').textContent=editor?'Вийти з акаунта':'↗ Вхід для редактора';
 $('#notice').textContent=connected?'':'Демонстраційний вміст · Підключіть Supabase, щоб зберігати зміни та відкрити вхід редактора.';
 $('#footer-status').textContent=connected?`Спільна версія · ${revision}`:'Демонстраційний простір';
 const views={story:renderStory,characters:()=>renderCharacters(id),props:renderProps};$('#content').innerHTML=(views[tab]||renderStory)();
 $('#search')?.addEventListener('input',e=>{const q=e.target.value.toLocaleLowerCase('uk');document.querySelectorAll('.character-card').forEach(c=>c.hidden=!c.dataset.search.includes(q));$('#no-results').hidden=[...document.querySelectorAll('.character-card')].some(c=>!c.hidden);});
 $('#character-select')?.addEventListener('change',e=>location.hash=`characters/${e.target.value}`);
}
function renderStory(){return `<div class="section-head"><div><h2>Основна історія</h2><p class="subtext">Послідовність подій та фокус уваги глядача.</p></div><div class="toolbar"><span class="count">${state.points.length} точок уваги</span>${editor?action('add-point','+ Додати точку',''):''}</div></div><div class="story-layout"><aside class="outline"><p class="tiny-heading">ЛІНІЯ ВИСТАВИ</p>${state.points.map((p,i)=>`<a href="#point-${esc(p.id)}" data-scroll="point-${esc(p.id)}"><span>${number(i)}</span>${esc(p.title)}</a>`).join('')}<p class="outline-note">Кожна точка поєднує основну історію з діями всіх 36 персонажів.</p></aside><div>${state.points.map((p,i)=>`<article class="point" id="point-${esc(p.id)}"><div class="point-top"><span class="point-no">${number(i)}</span><span class="point-tag">ТОЧКА УВАГИ</span></div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>${p.focus?`<div class="focus"><b>◎ Фокус</b>${esc(p.focus)}</div>`:''}${pointActions(p,i)}</article>`).join('')||'<div class="empty">Додайте першу точку уваги для вашої вистави.</div>'}</div></div>`;}
function renderCharacters(id){
 const c=state.characters.find(c=>c.id===id);
 if(c)return `<a class="back" href="#characters">← Усі персонажі</a><div class="section-head"><div><h2>Лінія персонажа</h2><p class="subtext">Особиста історія у спільному ритмі вистави.</p></div><select id="character-select" class="character-select" aria-label="Обрати персонажа">${state.characters.map(x=>`<option value="${esc(x.id)}" ${x.id===id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="character-layout"><aside class="profile">${avatar(c)}<h2>${esc(c.name)}</h2><p>${esc(c.actor||'Ім’я актора ще не додано')}</p><p>${esc(c.bio||'Тут з’явиться інформація про персонажа: його характер, мотивація та зв’язки.')}</p>${editor?`<div class="actions">${action('edit-character','Редагувати профіль',c.id)}</div>`:''}</aside><div>${state.points.map((p,i)=>`<article class="point"><div class="point-top"><span class="point-no">${number(i)}</span><span class="point-tag">${esc(p.title)}</span></div><p>${esc(c.notes[p.id]||'Дії персонажа в цій точці ще не описані.')}</p>${editor?`<div class="actions">${action('edit-note','Редагувати дії',`${c.id}/${p.id}`)}</div>`:''}</article>`).join('')||'<div class="empty">Спочатку додайте точки в основній історії.</div>'}</div></div>`;
 return `<div class="section-head"><div><h2>36 персонажів</h2><p class="subtext">Оберіть персонажа, щоб побачити його історію.</p></div><input class="search" id="search" type="search" placeholder="Пошук персонажа чи актора…" aria-label="Пошук персонажа чи актора"></div><div class="character-grid">${state.characters.map((c,i)=>`<a class="character-card" href="#characters/${esc(c.id)}" data-search="${esc((c.name+' '+c.actor).toLocaleLowerCase('uk'))}">${avatar(c)}<h3>${esc(c.name)}</h3><small>${esc(c.actor||`Учасник ${number(i)}`)}</small></a>`).join('')}</div><p class="empty" id="no-results" hidden>Персонажів не знайдено.</p>`;
}
function renderProps(){const done=state.props.filter(p=>p.done).length;return `<div class="section-head"><div><h2>Список реквізиту</h2><p class="subtext">Усе, що має бути готове до виходу на сцену.</p></div>${editor?action('add-prop','+ Додати реквізит',''):'<span class="count">Лише перегляд</span>'}</div><div class="props-summary"><p class="tiny-heading">ГОТОВО ${done} ІЗ ${state.props.length}</p><div class="progress" aria-label="Готовність реквізиту"><i style="width:${state.props.length?done/state.props.length*100:0}%"></i></div></div>${state.props.length?`<div class="props-list">${state.props.map(p=>`<div class="prop-row ${p.done?'done':''}"><input type="checkbox" aria-label="${esc(p.name)} — готово" data-check="${esc(p.id)}" ${p.done?'checked':''} ${editor?'':'disabled'}><div class="prop-info"><strong>${esc(p.name)}</strong><p>${esc(p.note)}</p></div>${editor?`<div class="actions">${action('edit-prop','Змінити',p.id)}${action('delete-prop','×',p.id,'quiet danger')}</div>`:''}</div>`).join('')}</div>`:'<div class="empty"><h3>Місце для важливих деталей</h3><p>Реквізит ще не додано. Тут буде список речей та їхня готовність.</p></div>'}`;}
function field(label,name,value='',multi=false,type='text'){return `<label for="field-${name}">${label}</label>${multi?`<textarea id="field-${name}" name="${name}" maxlength="20000">${esc(value)}</textarea>`:`<input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${['title','name','email','password'].includes(name)?'required':''} maxlength="${name==='photo'?2000:300}" ${type==='password'?'autocomplete="current-password"':''}>`}`;}
function modal(title,body,submit,label='Зберегти'){
 $('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#form-error').textContent='';$('#submit-modal').textContent=label;$('#submit-modal').disabled=false;
 $('#modal-form').onsubmit=async e=>{e.preventDefault();$('#form-error').textContent='';$('#submit-modal').disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));$('#modal').close();}catch(err){$('#form-error').textContent=err.message;}finally{$('#submit-modal').disabled=false;}};$('#modal').showModal();
}
$('#close-modal').onclick=$('#cancel-modal').onclick=()=>{if(!saving)$('#modal').close();};
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
 if(a==='add-point'||a==='edit-point')modal(p?'Редагувати точку':'Нова точка уваги',field('Назва','title',p?.title)+field('Основна історія','text',p?.text,true)+field('Фокус уваги','focus',p?.focus),d=>{if(!d.title.trim())throw new Error('Вкажіть назву.');return mutate(s=>{if(p)Object.assign(s.points.find(x=>x.id===id),d);else s.points.push({id:uid(),...d});});});
 if(a==='up'||a==='down')mutate(s=>{const i=s.points.findIndex(x=>x.id===id),j=i+(a==='up'?-1:1);[s.points[i],s.points[j]]=[s.points[j],s.points[i]];}).catch(e=>notify(e.message));
 if(a==='delete-point')modal('Видалити точку?',`<p>«${esc(p.title)}» та відповідні дії всіх персонажів буде видалено.</p>`,()=>mutate(s=>{s.points=s.points.filter(x=>x.id!==id);s.characters.forEach(x=>delete x.notes[id]);}),'Видалити');
 if(a==='edit-character')modal('Профіль персонажа',field('Ім’я персонажа','name',c.name)+field('Ім’я актора','actor',c.actor)+field('Про персонажа','bio',c.bio,true)+field('Посилання на фото (HTTPS)','photo',c.photo,false,'url')+'<p class="subtext">Залиште порожнім, щоб показати стандартний портрет.</p>',d=>{if(!d.name.trim())throw new Error('Вкажіть ім’я.');if(d.photo&&!/^https:\/\//i.test(d.photo))throw new Error('Використовуйте HTTPS-посилання на фото.');return mutate(s=>Object.assign(s.characters.find(x=>x.id===id),d));});
 if(a==='edit-note'){const [cid,pid]=id.split('/'),char=state.characters.find(x=>x.id===cid);modal('Дії персонажа',field('Що робить персонаж у цій точці?','note',char.notes[pid],true),d=>mutate(s=>{s.characters.find(x=>x.id===cid).notes[pid]=d.note;}));}
 if(a==='add-prop'||a==='edit-prop')modal(prop?'Редагувати реквізит':'Новий реквізит',field('Назва речі','name',prop?.name)+field('Кількість, відповідальний або примітка','note',prop?.note,true),d=>{if(!d.name.trim())throw new Error('Вкажіть назву.');return mutate(s=>{if(prop)Object.assign(s.props.find(x=>x.id===id),d);else s.props.push({id:uid(),done:false,...d});});});
 if(a==='delete-prop')modal('Видалити реквізит?',`<p>Видалити «${esc(prop.name)}» зі списку?</p>`,()=>mutate(s=>{s.props=s.props.filter(x=>x.id!==id);}),'Видалити');
});
$('#content').addEventListener('change',async e=>{if(!e.target.matches('[data-check]'))return;const target=e.target;target.disabled=true;try{await mutate(s=>{s.props.find(x=>x.id===target.dataset.check).done=target.checked;});}catch(err){render();notify(err.message);}});
$('#content').addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.parentNode.innerHTML=portrait;},true);
window.addEventListener('hashchange',render);
window.addEventListener('beforeunload',e=>{if(saving){e.preventDefault();e.returnValue='';}});
$('#stage-dots').innerHTML='<i></i>'.repeat(36);
// Refresh authenticated sessions in memory; no credentials are written to localStorage.
setInterval(async()=>{if(!session)return;if(session.expires_at*1000-Date.now()<120000){try{session=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});}catch{session=null;editor=false;render();notify('Увійдіть повторно, щоб редагувати.');}}},30000);
load();
