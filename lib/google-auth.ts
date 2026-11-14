import { env } from 'cloudflare:workers';
import { createAccount, db, digest, makeSession, randomToken, session } from './local-auth';

const lifetime=600;
const flowCookie='berliner_google_flow';
const signupCookie='berliner_google_signup';
const callbackPath='/api/access/google/callback';
const encoder=new TextEncoder();

function settings(request:Request){
 const {GOOGLE_CLIENT_ID:id,GOOGLE_CLIENT_SECRET:secret,GOOGLE_AUTH_ORIGIN:origin='https://berlinerjam.de'}=env;
 if(!id||!secret||new URL(request.url).origin!==origin)return null;
 return {id,secret,redirect:origin+callbackPath};
}
export function googleAvailable(request:Request){return !!settings(request);}
function base64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function unbase64(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));}
function parse<T>(value:string):T{return JSON.parse(new TextDecoder().decode(unbase64(value))) as T;}
function cookieName(request:Request,name:string){return new URL(request.url).protocol==='https:'?'__Host-'+name:name;}
function cookieValue(request:Request,name:string){
 const prefix=cookieName(request,name)+'=';
 return request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(prefix))?.slice(prefix.length)||'';
}
function shortCookie(request:Request,name:string,value:string,maxAge=lifetime){
 return `${cookieName(request,name)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
export function clearGoogleFlow(request:Request){return shortCookie(request,flowCookie,'',0);}
export function clearGoogleSignup(request:Request){return shortCookie(request,signupCookie,'',0);}
function flowPath(value:string|null){
 if(!value||!value.startsWith('/?')||value.length>350)return '/';
 const supplied=new URL(value,'https://berlinerjam.de').searchParams;
 const query=new URLSearchParams();
 for(const key of ['meeting','tab']){
  const value=supplied.get(key);
  if(value&&/^[a-z0-9-]{1,80}$/i.test(value))query.set(key,value);
 }
 return query.size?'/?'+query:'/';
}
type Flow={state:string;nonce:string;verifier:string;next:string;account?:string};
export async function startGoogle(request:Request,next:string|null,link:boolean){
 const config=settings(request);if(!config)throw Error('Вход через Google ещё не подключён');
 const account=link?(await session(request))?.id:undefined;
 if(link&&!account)throw Error('Сначала войдите в свой аккаунт Berliner Jam');
 const flow:Flow={state:randomToken(),nonce:randomToken(),verifier:randomToken(),next:flowPath(next),account};
 const challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(flow.verifier))));
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:config.id,redirect_uri:config.redirect,response_type:'code',scope:'openid email',prompt:'select_account',state:flow.state,nonce:flow.nonce,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return {url:url.href,cookie:shortCookie(request,flowCookie,base64(encoder.encode(JSON.stringify(flow))))};
}
type GoogleClaims={iss:string;aud:string;sub:string;exp:number;nonce:string;email_verified:boolean;email?:string};
async function googleClaims(token:string,clientId:string,nonce:string){
 const [header,payload,signature,...extra]=token.split('.');
 if(!header||!payload||!signature||extra.length||token.length>12000)throw Error('Не удалось подтвердить вход через Google');
 const {kid,alg}=parse<{kid?:string;alg?:string}>(header);
 const claims=parse<GoogleClaims>(payload);
 if(alg!=='RS256'||!kid||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||claims.nonce!==nonce||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000||!/^[0-9]{1,40}$/.test(claims.sub)||claims.email_verified!==true)throw Error('Не удалось подтвердить вход через Google');
 const response=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Не удалось подтвердить вход через Google');
 const {keys}=await response.json() as {keys:(JsonWebKey&{kid:string})[]};
 const jwk=keys.find(key=>key.kid===kid&&key.kty==='RSA');
 if(!jwk)throw Error('Не удалось подтвердить вход через Google');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unbase64(signature),encoder.encode(header+'.'+payload)))throw Error('Не удалось подтвердить вход через Google');
 return claims;
}
async function claimKey(subject:string){return 'google:'+await digest(subject);}
async function linkedAccount(claim:string){
 return (await db().prepare('SELECT account_id FROM jam_auth_claims WHERE key = ?').bind(claim).first<{account_id:string}>())?.account_id;
}
async function signingKey(secret:string){return crypto.subtle.importKey('raw',encoder.encode('berliner-google-signup:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function finishGoogle(request:Request){
 const config=settings(request);if(!config)throw Error('Вход через Google ещё не подключён');
 const params=new URL(request.url).searchParams;
 const flow=parse<Flow>(cookieValue(request,flowCookie));
 const code=params.get('code');
 if(!flow?.state||params.get('state')!==flow.state||!code||code.length>2048)throw Error('Вход через Google не завершён');
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(8000),
  body:new URLSearchParams({code,client_id:config.id,client_secret:config.secret,redirect_uri:config.redirect,grant_type:'authorization_code',code_verifier:flow.verifier}),
 });
 if(!tokenResponse.ok)throw Error('Вход через Google не завершён');
 const {id_token}=await tokenResponse.json() as {id_token?:string};
 if(!id_token)throw Error('Вход через Google не завершён');
 const claims=await googleClaims(id_token,config.id,flow.nonce),claim=await claimKey(claims.sub),linked=await linkedAccount(claim);
 const next=flowPath(flow.next);
 if(flow.account){
  const current=await session(request);
  if(current?.id!==flow.account||linked&&linked!==current.id)throw Error('Аккаунт Google уже подключён или сеанс истёк');
  if(!linked){
   const result=await db().prepare("INSERT OR IGNORE INTO jam_auth_claims (key,account_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM jam_sessions WHERE token_hash = ? AND account_id = ? AND expires_at > ?) AND NOT EXISTS (SELECT 1 FROM jam_auth_claims WHERE account_id = ? AND key LIKE 'google:%')").bind(claim,current.id,current.tokenHash,current.id,Date.now(),current.id).run();
   if(!result.meta.changes&&await linkedAccount(claim)!==current.id)throw Error('К профилю уже подключён другой аккаунт Google');
  }
  return {next:next+'#google=linked'};
 }
 if(linked)return {next,token:await makeSession(linked)};
 // Existing users prove access through their current local session before linking Google.
 if(claims.email&&await db().prepare('SELECT id FROM jam_accounts WHERE email = ? AND email_verified_at IS NOT NULL').bind(claims.email.toLowerCase()).first())return {next:next+'#google=existing'};
 const ticket=base64(encoder.encode(JSON.stringify({claim,expires:Date.now()+lifetime*1000})));
 const signature=base64(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(config.secret),encoder.encode(ticket))));
 return {next:next+'#google=signup',signup:shortCookie(request,signupCookie,ticket+'.'+signature)};
}
export async function completeGoogleSignup(request:Request,name:unknown){
 const config=settings(request);
 const [ticket,signature]=cookieValue(request,signupCookie).split('.');
 if(!config||!ticket||!signature||!await crypto.subtle.verify('HMAC',await signingKey(config.secret),unbase64(signature),encoder.encode(ticket)))throw Error('Начните регистрацию через Google заново');
 const {claim,expires}=parse<{claim:string;expires:number}>(ticket);
 if(!/^google:[a-f0-9]{64}$/.test(claim)||!Number.isFinite(expires)||expires<Date.now()||await linkedAccount(claim))throw Error('Начните регистрацию через Google заново');
 return createAccount(request,{mode:'join',name},claim);
}
