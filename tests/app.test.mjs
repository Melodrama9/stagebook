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
