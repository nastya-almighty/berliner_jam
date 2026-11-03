import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PROGRAM_APPROVERS} from '../lib/model.ts';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler')),{Miniflare}=wr('miniflare');
const root=fileURLToPath(new URL('../dist/server/',import.meta.url)),files=await readdir(root,{recursive:true});
const modules=[{type:'ESModule',path:path.join(root,'index.js')},...files.filter(f=>f!=='index.js'&&/\.m?js$/.test(f)).map(f=>({type:'ESModule',path:path.join(root,f)}))];
const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET']});
const owner=PROGRAM_APPROVERS[0],people=[owner,'author','friend','reserve'].map(id=>({id,auth:id,name:id,roles:[],max:5}));
const song={id:'song',title:'New song',artist:'Artist',duration:7,slots:[{id:'g',label:'Гитара',required:true},{id:'d',label:'Барабаны',required:true}],assigned:{},pins:{},main:{},inclusion:'auto',proposedBy:'author'};
const event={id:'e',title:'Next jam',date:'2027-01-01',time:'17:00',venue:'Berlin',budget:30,breakMins:0,status:'draft',demo:false,rulesVersion:6,songs:[song],applications:[],program:[]};
const digest=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
const cookies={};
const get=async id=>{const r=await mf.dispatchFetch('https://jam.test/api/state',{headers:id?{cookie:cookies[id]}:{}});assert.equal(r.status,200);return r.json();};
const post=async(id,action,expected=200)=>{const before=await get(id),r=await mf.dispatchFetch('https://jam.test/api/state',{method:'POST',headers:{cookie:cookies[id],'Content-Type':'application/json'},body:JSON.stringify({revision:before.revision,action:{event:'e',...action}})}),d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d;};
try{
 const db=await mf.getD1Database('DB');for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 await db.prepare('INSERT INTO jam_state (id,data,revision) VALUES (?,?,0)').bind('main',JSON.stringify({people,admins:[owner],log:[],events:[event]})).run();
 for(const p of people){const token=crypto.randomUUID().replaceAll('-','').repeat(2);await db.prepare('INSERT INTO jam_accounts (id,login,created_at) VALUES (?,?,?)').bind(p.id,p.id,Date.now()).run();await db.prepare('INSERT INTO jam_sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').bind(await digest(token),p.id,Date.now()+3600000).run();cookies[p.id]='berliner_jam_session='+token;}
 await post('author',{type:'apply',song:'song',priority:2,members:[{person:'friend',slot:'g'}]});
 let user=await get('friend');assert.equal(user.state.events[0].songs[0].main.g.person,'friend');assert.equal(user.state.events[0].songs[0].main.g.by,'author');assert.deepEqual(user.state.events[0].program,[]);
 await post('reserve',{type:'apply',song:'song',priority:1,members:[{person:'reserve',slot:'g'}]});
 let admin=await get(owner);assert.equal(admin.state.events[0].songs[0].assigned.g,'friend');assert.equal(admin.state.events[0].applications.at(-1).members[0].standby,true);
 await post('reserve',{type:'apply',song:'song',priority:2,members:[{person:'reserve',slot:'__choice',alternatives:['g','d']}]});
 await post('author',{type:'buildProgram'},400);admin=await post(owner,{type:'buildProgram'});assert.deepEqual(admin.state.events[0].program,['song']);assert.equal(admin.state.events[0].songs[0].assigned.d,'reserve');assert.ok(admin.state.events[0].programNotes.song);
 user=await get('friend');assert.equal(user.state.events[0].programNotes,undefined);assert.equal(user.state.events[0].songs[0].assigned.d,undefined);
 await post(owner,{type:'assign',song:'song',slot:'g',person:'reserve'},400);
 await post(owner,{type:'publish'});user=await get('friend');assert.deepEqual(user.state.events[0].program,['song']);assert.equal(user.state.events[0].songs[0].assigned.d,'reserve');
 // Exercise the server's repeat prohibition, including bypassing the UI.
 const stored=await db.prepare('SELECT data FROM jam_state WHERE id = ?').bind('main').first(),s=JSON.parse(stored.data);s.events[0].status='draft';s.events.push({...structuredClone(event),id:'past',title:'Past jam',date:'2026-10-01',status:'published',program:['played'],songs:[{...structuredClone(song),id:'played',played:true}]});await db.prepare('UPDATE jam_state SET data = ?, revision=revision+1 WHERE id = ?').bind(JSON.stringify(s),'main').run();
 const blocked=await post('author',{type:'song',title:'NEW SONG!',artist:'Artist',duration:7,slots:[{label:'Гитара',required:true}]},400);assert.match(blocked.error,/стоп-листе/);
 await post('reserve',{type:'apply',song:'song',priority:2,members:[{person:'reserve',slot:'g'}]},400);
 const excluded=await post(owner,{type:'buildProgram'});assert.deepEqual(excluded.state.events[0].program,[]);
 console.log('Recording API integration passed: booking sources, reserve, flexible matching, admin access, draft privacy, approval, and server-side repeat prohibition.');
}finally{await mf.dispose();}
