import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,pbkdf2Sync} from 'node:crypto';

const require=createRequire(import.meta.url);
const {Miniflare}=createRequire(require.resolve('wrangler'))('miniflare');
const root=fileURLToPath(new URL('../dist/server/',import.meta.url));
const files=await readdir(root,{recursive:true});
const modules=[{type:'ESModule',path:path.join(root,'index.js')},...files.filter(f=>f!=='index.js'&&/\.m?js$/.test(f)).map(f=>({type:'ESModule',path:path.join(root,f)}))];
const sha=value=>createHash('sha256').update(value).digest('hex');
const oldPassword='Old-Owner-Reset-Test-Password!',newPassword='New-Owner-Reset-Test-Password!';
const salt='fixture-salt',passwordHash=pbkdf2Sync(oldPassword,salt,100000,32,'sha256').toString('hex');
const resetToken='a'.repeat(64),oldSession='d'.repeat(64),accountId='owner-recovery-test';
const base={modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET']};

async function fixture(overrides={}){
 const request={accountId,login:'nastya',tokenHash:sha(resetToken),passwordHash,expiresAt:Date.now()+3600000,...overrides};
 const mf=new Miniflare({...base,bindings:{OWNER_PASSWORD_RESET:JSON.stringify(request)}});
 const db=await mf.getD1Database('DB');
 for(const f of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
  for(const sql of (await readFile(new URL('../drizzle/'+f,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 }
 await mf.dispatchFetch('https://jam.test/api/state');
 const row=await db.prepare("SELECT data FROM jam_state WHERE id = 'main'").first(),state=JSON.parse(row.data);
 state.people.push({id:accountId,auth:accountId,name:'Nastya QA',nickname:'nastya',nicknameSource:'custom',roles:['Вокал'],max:5});
 state.admins.push(accountId);
 await db.prepare('INSERT INTO jam_accounts (id,login,password_hash,salt,created_at) VALUES (?,?,?,?,?)').bind(accountId,'nastya',passwordHash,salt,Date.now()).run();
 await db.prepare("UPDATE jam_state SET data = ? WHERE id = 'main'").bind(JSON.stringify(state)).run();
 await db.prepare('INSERT INTO jam_sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').bind(sha(oldSession),accountId,Date.now()+3600000).run();
 const send=(body,extra={})=>mf.dispatchFetch('https://jam.test/api/access',{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
 return {mf,db,send};
}

const {mf,db,send}=await fixture();
try{
 const before=await db.prepare("SELECT data,revision FROM jam_state WHERE id = 'main'").first();
 let response=await send({mode:'reset-password',token:'b'.repeat(64),password:newPassword});assert.equal(response.status,400);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM jam_account_tokens').first()).n,0);
 response=await send({mode:'verify-email',token:resetToken});assert.equal(response.status,400);
 response=await send({mode:'reset-password',token:resetToken,password:newPassword},{origin:'https://other.test'});assert.equal(response.status,400);
 const attempts=await Promise.all([send({mode:'reset-password',token:resetToken,password:newPassword}),send({mode:'reset-password',token:resetToken,password:newPassword})]);
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]);
 const success=attempts.find(r=>r.status===200),cookie=success.headers.get('set-cookie').split(';')[0];
 const current=await (await mf.dispatchFetch('https://jam.test/api/state',{headers:{cookie}})).json();
 assert.equal(current.identity.id,accountId);assert.ok(current.state.admins.includes(accountId));assert.equal(current.account.email,null);
 assert.deepEqual(await db.prepare("SELECT data,revision FROM jam_state WHERE id = 'main'").first(),before);
 const stale=await (await mf.dispatchFetch('https://jam.test/api/state',{headers:{cookie:'berliner_jam_session='+oldSession}})).json();assert.equal(stale.identity,null);
 response=await send({mode:'login',login:'nastya',password:oldPassword});assert.equal(response.status,400);
 response=await send({mode:'login',login:'nastya',password:newPassword});assert.equal(response.status,200);
 response=await send({mode:'reset-password',token:resetToken,password:oldPassword});assert.equal(response.status,400);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM jam_account_tokens').first()).n,0);
 console.log('Owner recovery passed: exact account, no email needed, one-use concurrent reset, old sessions revoked, identity/roles/applications preserved, and runtime configuration cannot revive a consumed link.');
}finally{await mf.dispose();}

for(const overrides of [{expiresAt:Date.now()-1},{passwordHash:sha('outdated-password')},{login:'different-account'}]){
 const {mf,send}=await fixture(overrides);
 try{const response=await send({mode:'reset-password',token:resetToken,password:newPassword});assert.equal(response.status,400);}finally{await mf.dispose();}
}
console.log('Owner recovery rejected expired requests and changed account credentials.');
