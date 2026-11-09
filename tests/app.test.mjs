import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
function app(){
 const nodes=new Map();
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',style:{},addEventListener(){},showModal(){},close(){}});return nodes.get(selector);};
 const context=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[]},window:{STAGE_CONFIG:{},addEventListener(){}},location:{hash:'#story'},crypto:globalThis.crypto,structuredClone,setInterval(){},setTimeout(){},clearTimeout(){},URL,FormData,console,fetch(){throw Error('Unexpected network request');}});
 vm.runInContext(source,context);
 return {run:code=>vm.runInContext(code,context),nodes};
}
test('guest demo has exactly 36 profiles and no editing controls',()=>{
 const a=app();assert.equal(a.run('state.characters.length'),36);
 assert.equal((a.run('renderCharacters()').match(/class="character-card"/g)||[]).length,36);
 assert.doesNotMatch(a.run('renderStory()'),/data-action=/);
 assert.doesNotMatch(a.run("renderCharacters('c1')"),/data-action=/);
});
test('character timelines share every focal point in the main story',()=>{
 const a=app();a.run("state.characters[0].notes.p1='Моя дія'; state.points.reverse()");
 const html=a.run("renderCharacters('c1')");assert.equal((html.match(/class="point"/g)||[]).length,6);
 assert.ok(html.indexOf('Спільний фінал')<html.indexOf('Тиша перед початком'));assert.match(html,/Моя дія/);
});
test('guest props are read-only and user text is escaped',()=>{
 const a=app();a.run('state.props=[{id:"x",name:"<script>alert(1)</script>",note:"",done:true}]');
 const html=a.run('renderProps()');assert.match(html,/checked disabled/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
test('saving failure preserves previous content; successful save updates revision',async()=>{
 const a=app();a.run("editor=true; api=async()=>{throw new Error('conflict')}");
 await assert.rejects(a.run("mutate(s=>s.points[0].title='Changed')"),/conflict/);
 assert.equal(a.run('state.points[0].title'),'Тиша перед початком');assert.equal(a.run('saving'),false);
 a.run('api=async()=>8');await a.run("mutate(s=>s.points[0].title='Changed')");
 assert.equal(a.run('state.points[0].title'),'Changed');assert.equal(a.run('revision'),8);
});
test('guests cannot invoke save operations',async()=>{
 const a=app();await assert.rejects(a.run("mutate(s=>s.props.push({name:'x'}))"),/Увійдіть/);assert.equal(a.run('state.props.length'),0);
});
test('photo upload validates type and size before any network request',async()=>{
 const a=app();a.run('editor=true;session={access_token:"test"}');
 await assert.rejects(a.run('uploadPhoto({type:"image/svg+xml",size:20},"c1")'),/форматі/);
 await assert.rejects(a.run('uploadPhoto({type:"image/png",size:5242881},"c1")'),/5 МБ/);
 await assert.rejects(a.run('uploadPhoto({type:"image/png",size:0},"c1")'),/непорожнім/);
 a.run('editor=false');await assert.rejects(a.run('uploadPhoto({type:"image/png",size:20},"c1")'),/Увійдіть/);
});
test('photo upload sends binary file and saves a public unique URL',async()=>{
 const a=app();a.run('editor=true;session={access_token:"test"};config.supabaseUrl="https://example.supabase.co";let calls=[];api=async(path,options)=>{calls.push({path,options});return path.includes("save_play")?1:{Key:"ok"}}');
 await a.run('saveCharacter("c1",{name:"Новий персонаж",actor:"Актор",bio:"Опис",photoFile:{type:"image/png",size:20}})');
 assert.match(a.run('state.characters[0].photo'),/^https:\/\/example.supabase.co\/storage\/v1\/object\/public\/character-photos\/c1\/[a-f0-9-]+\.png$/);
 assert.equal(a.run('calls[0].options.headers["Content-Type"]'),'image/png');
 assert.equal(a.run('calls[0].options.body.size'),20);
 assert.equal(a.run('state.characters[0].name'),'Новий персонаж');
});
test('failed photo upload preserves the entire character; text-only edits retain existing photo',async()=>{
 const a=app();a.run('editor=true;session={access_token:"test"};state.characters[0].photo="https://example.com/old.png";api=async()=>{throw Error("upload failed")}');
 await assert.rejects(a.run('saveCharacter("c1",{name:"Changed",actor:"",bio:"",photoFile:{type:"image/png",size:20}})'),/upload failed/);
 assert.equal(a.run('state.characters[0].name'),'Персонаж 01');
 assert.equal(a.run('state.characters[0].photo'),'https://example.com/old.png');
 a.run('api=async()=>1');await a.run('saveCharacter("c1",{name:"Changed",actor:"",bio:"",photoFile:{size:0}})');
 assert.equal(a.run('state.characters[0].photo'),'https://example.com/old.png');
 await a.run('saveCharacter("c1",{name:"Changed",actor:"",bio:"",removePhoto:"on"})');
 assert.equal(a.run('state.characters[0].photo'),'');
});
test('script saves independently of focal points and retains speaker assignments',async()=>{
 const a=app();a.run('editor=true;api=async()=>1;delete state.script');
 await a.run('saveScriptLine(null,null,{type:"dialogue",characterId:"c2",text:"Вітаю!"})');
 assert.equal(a.run('state.script[0].characterId'),'c2');assert.equal(a.run('state.points.length'),6);
 assert.match(a.run('characterColor(state.characters[1])'),/^#[a-f0-9]{6}$/);
 await a.run('saveScriptLine(null,state.script[0].id,{type:"direction",text:"Пауза."})');
 assert.equal(a.run('state.script[1].characterId'),null);
 await a.run('saveScriptLine(state.script[0].id,null,{type:"dialogue",characterId:"c3",text:"Інша репліка"})');
 assert.equal(a.run('state.script[0].characterId'),'c3');
 await assert.rejects(a.run('saveScriptLine(null,null,{type:"dialogue",characterId:"missing",text:"Hello"})'),/Оберіть персонажа/);
});
test('script rendering uses current character color and safely renders guest text',()=>{
 const a=app();a.run('state.script=[{id:"s1",type:"dialogue",characterId:"c1",text:"<script>bad</script>"}];state.characters[0].color="#123456"');
 const html=a.run('renderScript()');assert.match(html,/--speaker-color:#123456/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/data-action=/);
 a.run('state.characters[0].color="#654321"');assert.match(a.run('renderScript()'),/--speaker-color:#654321/);
});
test('text commands parse dialogue, actions and headings and reject unassigned speech',()=>{
 const a=app();
 const lines=a.run('parseScript("Сцена 1\\n\\n- Персонаж 01 [1]: Вітаю!\\n(Пауза)")');
 assert.equal(lines[0].type,'heading');assert.equal(lines[1].characterId,'c1');assert.equal(lines[1].text,'Вітаю!');assert.equal(lines[2].type,'direction');assert.equal(lines[2].text,'Пауза');
 assert.throws(()=>a.run('parseScript("- Вітаю")'),/оберіть персонажа/);
});
test('existing multiline script round-trips through whole-text editing',()=>{
 const a=app();a.run('state.script=[{id:"s1",type:"dialogue",characterId:"c2",text:"Перша\\nДруга"},{id:"s2",type:"direction",characterId:null,text:"Рух\\nПауза"}]');
 const lines=a.run('parseScript(scriptToText(state.script))');
 assert.equal(lines[0].text,'Перша\nДруга');assert.equal(lines[0].characterId,'c2');assert.equal(lines[1].text,'Рух\nПауза');
});

test('mini-story creation and editing preserve the original script and actor profiles',async()=>{
 const a=app();
 a.run('editor=true;api=async()=>revision+1;state.script=[{id:"old",type:"heading",text:"Original"}];const original=JSON.stringify(state.script), profiles=JSON.stringify(state.characters)');
 await a.run('createScenario("Дует")');
 a.run('const duet=scenarioId');
 assert.equal(a.run('scenarioDocument(state).script.length'),0);
 await a.run('mutate(s=>{scenarioDocument(s).script=parseScript("- Персонаж 02 [2]: Hello")})');
 await a.run('createScenario("Фінал")');
 assert.equal(a.run('scenarioDocument(state).script.length'),0);
 a.run('switchScenario(duet);editor=false');
 assert.match(a.run('renderScript()'),/Hello/);
 assert.doesNotMatch(a.run('renderScript()'),/data-action=/);
 assert.equal(a.run('JSON.stringify(state.script)===original && JSON.stringify(state.characters)===profiles'),true);
});

test('renaming either scenario changes only its title and preserves the active draft',async()=>{
 const a=app();
 a.run('editor=true;api=async()=>revision+1;state.scenarios=[{id:"duet",title:"Duet",script:[]}];const original=structuredClone(state);scriptDirty=true;scriptDraft="Unsaved text"');
 await a.run('renameScenario("", "  Прем’єра  ")');
 await a.run('renameScenario("duet", "Дует <2>")');
 await assert.rejects(a.run('renameScenario("duet","   ")'),/Вкажіть назву/);
 assert.equal(a.run('state.mainScenarioTitle'),'Прем’єра');
 assert.equal(a.run('state.scenarios[0].title'),'Дует <2>');
 assert.equal(a.run('scriptDirty && scriptDraft==="Unsaved text"'),true);
 assert.equal(a.run('original.mainScenarioTitle=state.mainScenarioTitle;original.scenarios[0].title=state.scenarios[0].title;JSON.stringify(original)===JSON.stringify(state)'),true);
 a.run('editor=false');
 assert.match(a.run('renderScript()'),/Дует &lt;2&gt;/);
 assert.doesNotMatch(a.run('renderScript()'),/rename-scenario/);
});

test('PDF button exports the selected scenario when clicked',async()=>{
 const a=app();
 a.run('state.scenarios=[{id:"duet",title:"Дует",script:[{type:"heading",text:"Сцена"}]}];location.hash="#script";switchScenario("duet");pdfAssets=Promise.resolve();let exported;window.pdfMake={createPdf:doc=>({download:name=>{exported={doc,name}}})}');
 await a.nodes.get('#download-scenario').onclick();
 assert.equal(a.run('exported.name'),'Дует.pdf');
 assert.equal(a.run('exported.doc.content[1].text'),'Сцена');
});
