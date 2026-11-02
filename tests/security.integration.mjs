import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{Miniflare}=createRequire(require.resolve('wrangler'))('miniflare');
const root=fileURLToPath(new URL('../dist/server/',import.meta.url)),files=await readdir(root,{recursive:true}),modules=[{type:'ESModule',path:path.join(root,'index.js')},...files.filter(f=>f!=='index.js'&&/\.m?js$/.test(f)).map(f=>({type:'ESModule',path:path.join(root,f)}))];
const mail=[];let failMail=false;
const base={modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET']};
const mf=new Miniflare({...base,bindings:{RESEND_API_KEY:'integration-dummy-key',MAIL_FROM:'Berliner Jam <noreply@example.test>'},outboundService:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com');assert.equal(request.headers.get('authorization'),'Bearer integration-dummy-key');mail.push(await request.json());return new Response(JSON.stringify(failMail?{message:'failed'}:{id:'test-message'}),{status:failMail?500:200,headers:{'content-type':'application/json'}});}});
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0],sha=s=>createHash('sha256').update(s).digest('hex');
const send=(body,cookie='',extra={})=>mf.dispatchFetch('https://jam.test/api/access',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...extra},body:JSON.stringify(body)});
const get=async(cookie='')=>{const r=await mf.dispatchFetch('https://jam.test/api/state',{headers:cookie?{cookie}:{}}),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;};
const migrate=async mf=>{const db=await mf.getD1Database('DB');for(const f of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile(new URL('../drizzle/'+f,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();return db;};
const tokenOf=(message,purpose)=>new URLSearchParams(new URL(message.text.match(/https:\/\/jam.test\/#[^\s]+/)[0]).hash.slice(1)).get(purpose);
const PW='Participant-Test-Password!',PW2='Changed-Password-For-Testing!',PW3='Recovered-Password-For-Testing!';
try{
 const db=await migrate(mf);assert.equal((await get()).mailAvailable,true);assert.equal((await get()).account,null);
 for(const password of [undefined,'short']){const r=await send({mode:'join',name:'Invalid',password});assert.equal(r.status,400);}
 let r=await send({mode:'join',name:'Email invalid',password:PW,email:'not-an-email'});assert.equal(r.status,400);
 r=await send({mode:'join',name:'User',nicknameMode:'custom',nickname:'test_user',password:PW,email:'User@Example.test'});let a=await r.json();assert.equal(r.status,200,JSON.stringify(a));let userCookie=cookieOf(r),recovery=a.recoveryToken,user=await get(userCookie),id=user.identity.id;
 assert.equal(user.account.login,'test_user');assert.equal(user.account.hasPassword,true);assert.equal(user.account.emailVerified,false);assert.equal(user.account.pendingEmail,'user@example.test');assert.ok(!JSON.stringify(user.state).includes('user@example.test'));assert.equal((await get()).account,null);
 const stored=await db.prepare('SELECT login,password_hash,salt FROM jam_accounts WHERE id = ?').bind(id).first();assert.equal(stored.login,'test_user');assert.ok(stored.salt);assert.notEqual(stored.password_hash,PW);assert.equal(mail.length,1);const verifyToken=tokenOf(mail[0],'verify');assert.match(verifyToken,/^[a-f0-9]{64}$/);assert.ok(await db.prepare('SELECT token_hash FROM jam_account_tokens WHERE token_hash = ?').bind(sha(verifyToken)).first());
 r=await send({mode:'join',name:'Duplicate',nicknameMode:'custom',nickname:'test_user',password:PW});assert.equal(r.status,400);
 for(const login of ['test_user','@TEST_USER',' TEST_USER ','＠ｔｅｓｔ＿ｕｓｅｒ']){r=await send({mode:'login',login,password:PW});assert.equal(r.status,200);assert.equal((await get(cookieOf(r))).identity.id,id);}
 let secondCookie=cookieOf(r);
 r=await send({mode:'set-password',password:PW2},userCookie);assert.equal(r.status,400);assert.equal((await get(secondCookie)).identity.id,id);
 r=await send({mode:'new-link'},userCookie);assert.equal(r.status,400);
 r=await send({mode:'set-password',currentPassword:PW,password:PW2},userCookie);a=await r.json();assert.equal(r.status,200,JSON.stringify(a));userCookie=cookieOf(r);recovery=a.recoveryToken;assert.equal((await get(secondCookie)).identity,null);assert.equal((await get(userCookie)).identity.id,id);assert.equal((await get(userCookie)).account.login,'test_user');
 r=await send({mode:'login',login:'test_user',password:PW});assert.equal(r.status,400);
 // Password changes invalidate outstanding verification and reset tokens as well as sessions.
 r=await send({mode:'verify-email',token:verifyToken});assert.equal(r.status,400);
 r=await send({mode:'link',token:recovery});assert.equal(r.status,200);let linkCookie=cookieOf(r);assert.equal((await get(linkCookie)).account.recoveryActive,true);
 r=await send({mode:'set-password',password:PW3},linkCookie);a=await r.json();assert.equal(r.status,200,JSON.stringify(a));userCookie=cookieOf(r);const newestRecovery=a.recoveryToken;r=await send({mode:'link',token:recovery});assert.equal(r.status,400);assert.equal((await get(linkCookie)).identity,null);
 r=await send({mode:'set-email',email:'user@example.test',currentPassword:PW3},userCookie);assert.equal(r.status,200);const freshVerify=tokenOf(mail.at(-1),'verify');r=await send({mode:'verify-email',token:freshVerify},'',{origin:'https://other.test'});assert.equal(r.status,400);
 r=await send({mode:'verify-email',token:freshVerify});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));r=await send({mode:'verify-email',token:freshVerify});assert.equal(r.status,400);assert.equal((await get(userCookie)).account.emailVerified,true);
 const priorMail=mail.length;r=await send({mode:'forgot-password',identifier:'unknown'});const generic=await r.json();assert.equal(r.status,200);assert.equal(mail.length,priorMail);
 r=await send({mode:'forgot-password',identifier:'test_user'});a=await r.json();assert.equal(r.status,200);assert.deepEqual(a,generic);assert.equal(mail.length,priorMail+1);assert.deepEqual(mail.at(-1).to,['user@example.test']);const reset=tokenOf(mail.at(-1),'reset');assert.ok(!JSON.stringify(a).includes(reset));
 // Concurrent uses of one reset link may succeed only once.
 const savedState=await db.prepare('SELECT data FROM jam_state WHERE id = ?').bind('main').first();
 const both=await Promise.all([send({mode:'reset-password',token:reset,password:PW2}),send({mode:'reset-password',token:reset,password:PW2})]);assert.deepEqual(both.map(r=>r.status).sort(),[200,400]);const success=both.find(r=>r.status===200);userCookie=cookieOf(success);assert.equal((await get(userCookie)).identity.id,id);assert.deepEqual(await db.prepare('SELECT data FROM jam_state WHERE id = ?').bind('main').first(),savedState);r=await send({mode:'link',token:newestRecovery});assert.equal(r.status,400);
 r=await send({mode:'forgot-password',identifier:'user@example.test'});assert.equal(r.status,200);const expired=tokenOf(mail.at(-1),'reset');await db.prepare('UPDATE jam_account_tokens SET expires_at = 0 WHERE token_hash = ?').bind(sha(expired)).run();r=await send({mode:'reset-password',token:expired,password:PW});assert.equal(r.status,400);
 // Updating email requires proof and preserves the old verified address until confirmation.
 r=await send({mode:'set-email',email:'new@example.test'},userCookie);assert.equal(r.status,400);r=await send({mode:'set-email',email:'new@example.test',currentPassword:PW2},userCookie);assert.equal(r.status,200);const newVerify=tokenOf(mail.at(-1),'verify');assert.equal((await get(userCookie)).account.email,'user@example.test');
 r=await send({mode:'forgot-password',identifier:'test_user'});assert.equal(r.status,200);const oldEmailReset=tokenOf(mail.at(-1),'reset');r=await send({mode:'verify-email',token:newVerify});assert.equal(r.status,200);r=await send({mode:'reset-password',token:oldEmailReset,password:PW});assert.equal(r.status,400);assert.equal((await get(userCookie)).account.email,'new@example.test');
 r=await send({mode:'join',name:'Other',nicknameMode:'custom',nickname:'other_user',password:PW,email:'new@example.test'});assert.equal(r.status,200);const otherCookie=cookieOf(r),duplicateVerify=tokenOf(mail.at(-1),'verify');r=await send({mode:'verify-email',token:duplicateVerify});assert.equal(r.status,400);assert.equal((await get(otherCookie)).account.email,null);
 // A pre-password account can adopt its existing nickname without replacing its identity.
 r=await send({mode:'join',name:'Legacy',nicknameMode:'custom',nickname:'legacy_user',password:PW});assert.equal(r.status,200);let legacyCookie=cookieOf(r),legacy=await get(legacyCookie),legacyId=legacy.identity.id;
 await db.prepare('UPDATE jam_accounts SET password_hash = NULL, salt = NULL, login = NULL WHERE id = ?').bind(legacyId).run();assert.equal((await get(legacyCookie)).account.hasPassword,false);
 r=await send({mode:'set-password',password:PW2},legacyCookie);assert.equal(r.status,200);legacyCookie=cookieOf(r);assert.equal((await get(legacyCookie)).identity.id,legacyId);r=await send({mode:'login',login:'legacy_user',password:PW2});assert.equal(r.status,200);assert.equal((await get(cookieOf(r))).identity.id,legacyId);
 // Mail delivery failure exposes neither account existence nor usable undelivered tokens.
 failMail=true;r=await send({mode:'forgot-password',identifier:'test_user'});assert.equal(r.status,200);assert.deepEqual(await r.json(),generic);const unsent=tokenOf(mail.at(-1),'reset');assert.equal(await db.prepare('SELECT token_hash FROM jam_account_tokens WHERE token_hash = ?').bind(sha(unsent)).first(),null);failMail=false;
 console.log('Security integration passed: required passwords; universal nickname login; private email; legacy adoption; password proof and session rotation; backup recovery; verified unique email; non-enumerating recovery; expiry and one-use concurrent tokens; undelivered-token cleanup.');
}finally{await mf.dispose();}
const offline=new Miniflare(base);try{await migrate(offline);const state=await (await offline.dispatchFetch('https://jam.test/api/state')).json();assert.equal(state.mailAvailable,false);const sendOffline=body=>offline.dispatchFetch('https://jam.test/api/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});let r=await sendOffline({mode:'join',name:'No mail',password:PW});assert.equal(r.status,200);r=await sendOffline({mode:'forgot-password',identifier:'no_mail'});assert.equal(r.status,400);console.log('Mail-off integration passed: password signup works; unavailable mail recovery is explicitly disabled.');}finally{await offline.dispose();}
