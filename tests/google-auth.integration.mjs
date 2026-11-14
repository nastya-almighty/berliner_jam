import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const {Miniflare}=createRequire(require.resolve('wrangler'))('miniflare');
const root=fileURLToPath(new URL('../dist/server/',import.meta.url));
const files=await readdir(root,{recursive:true});
const modules=['index.js',...files.filter(file=>file!=='index.js'&&/\.m?js$/.test(file))].map(file=>({type:'ESModule',path:path.join(root,file)}));
const origin='https://jam.test',audience='mock-google-client',secret='mock-client-secret';
const algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,publicExponent:Uint8Array.of(1,0,1)};
const keys=await crypto.subtle.generateKey(algorithm,true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
let attempt;
const mf=new Miniflare({
 modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{GOOGLE_CLIENT_ID:audience,GOOGLE_CLIENT_SECRET:secret,GOOGLE_AUTH_ORIGIN:origin},
 outboundService:async request=>{
  const url=new URL(request.url);
  if(url.href==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  assert.equal(url.href,'https://oauth2.googleapis.com/token');
  const body=new URLSearchParams(await request.text());
  assert.equal(body.get('client_id'),audience);
  assert.equal(body.get('client_secret'),secret);
  assert.equal(body.get('redirect_uri'),origin+'/api/access/google/callback');
  const challenge=await crypto.subtle.digest('SHA-256',Buffer.from(body.get('code_verifier')));
  assert.equal(Buffer.from(challenge).toString('base64url'),attempt.challenge);
  const token=[encode({alg:'RS256',kid:'test'}),encode({sub:attempt.subject,iss:'https://accounts.google.com',aud:audience,exp:Date.now()/1000+300,nonce:attempt.nonce,email:'private@gmail.com',email_verified:true})].join('.');
  const signature=await crypto.subtle.sign(algorithm,keys.privateKey,Buffer.from(token));
  return Response.json({id_token:token+'.'+Buffer.from(signature).toString('base64url')});
 },
});
const send=(path,options)=>mf.dispatchFetch(origin+path,options);
const pair=(response,name)=>response.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0];
const post=(body,cookie)=>send('/api/access',{method:'POST',headers:{cookie:cookie||'',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function flow(subject,{wrongState=false,wrongNonce=false,session,link=false}={}){
 const start=await send('/api/access/google?next=%2F%3Fmeeting%3Ddemo-event'+(link?'&link=1':''),{headers:{cookie:session||''},redirect:'manual'});
 const url=new URL(start.headers.get('location'));
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('scope'),'openid email');
 attempt={subject,challenge:url.searchParams.get('code_challenge'),nonce:wrongNonce?'wrong':url.searchParams.get('nonce')};
 const flowCookie=pair(start,'__Host-berliner_google_flow');
 assert.ok(flowCookie);
 return send('/api/access/google/callback?code=mock&state='+(wrongState?'wrong':url.searchParams.get('state')),{headers:{cookie:[flowCookie,session].filter(Boolean).join('; ')},redirect:'manual'});
}
async function state(session){return (await send('/api/state',{headers:{cookie:session}})).json();}
try{
 const database=await mf.getD1Database('DB');
 for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await database.prepare(statement).run();
 }
 assert.equal((await post({mode:'google-signup',name:'Stranger'})).status,400);
 assert.equal((await flow('100',{wrongState:true})).headers.get('location'),'/#google=error');
 assert.equal((await flow('100',{wrongNonce:true})).headers.get('location'),'/#google=error');
 const signup=await flow('100');
 assert.equal(signup.headers.get('location'),'/?meeting=demo-event#google=signup');
 const ticket=pair(signup,'__Host-berliner_google_signup');
 assert.ok(ticket);
 const created=await post({mode:'google-signup',name:'Псевдоним'},ticket);
 assert.equal(created.status,200,await created.clone().text());
 assert.equal((await post({mode:'google-signup',name:'Псевдоним'},ticket)).status,400);
 const profile=await state(pair(created,'berliner_jam_session'));
 assert.equal(profile.identity.name,'Псевдоним');
 assert.equal(profile.account.email,null);
 assert.equal(profile.account.googleLinked,true);
 assert.equal(profile.account.hasPassword,false);
 assert.ok(!JSON.stringify(profile).includes('private@gmail.com'));
 const login=await flow('100');
 assert.equal(login.headers.get('location'),'/?meeting=demo-event');
 assert.equal((await state(pair(login,'berliner_jam_session'))).identity.id,profile.identity.id);

 const regular=await post({mode:'join',name:'Другой псевдоним',password:'fixture-password'});
 const localSession=pair(regular,'berliner_jam_session');
 assert.ok(localSession);
 const existing=await state(localSession);
 assert.equal((await flow('100',{session:localSession,link:true})).headers.get('location'),'/#google=error');
 assert.equal((await flow('200',{session:localSession,link:true})).headers.get('location'),'/?meeting=demo-event#google=linked');
 const federated=await flow('200');
 const oldAccount=await state(pair(federated,'berliner_jam_session'));
 assert.equal(oldAccount.identity.id,existing.identity.id);
 assert.equal(oldAccount.account.hasPassword,true);
 console.log('Google sign-in integration passed: state, nonce, token verification, account creation, returning sign-in, account linking.');
}finally{await mf.dispose();}
