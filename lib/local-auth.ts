import { env } from 'cloudflare:workers';
import { ADMIN_LIMIT, seed, State, uid, ensureNicknames, suggestNickname, validateNickname } from './model';
export async function nicknameDirectory(state:State){const accounts=await db().prepare('SELECT id,login FROM jam_accounts WHERE login IS NOT NULL').all<{id:string;login:string}>();return [...state.people,...accounts.results.map(a=>({id:state.people.find(p=>p.auth===a.id)?.id||a.id,nickname:a.login}))];}
export async function migrateOrganizerLogin(){
 // Exact verified account, legacy login and current profile must all agree.
 await db().prepare("UPDATE jam_accounts SET login = 'nikita' WHERE id = ? AND login = 'nikita_orgie' AND NOT EXISTS (SELECT 1 FROM jam_accounts WHERE login = 'nikita') AND EXISTS (SELECT 1 FROM jam_state, json_each(jam_state.data, '$.people') p WHERE jam_state.id = 'main' AND json_extract(p.value, '$.auth') = jam_accounts.id AND json_extract(p.value, '$.nickname') = 'nikita')").bind('local_f74b4705-a761-4e22-88d4-58b84f2b0166').run();
}
export async function saveState(row:{revision:number},state:State,action:any,actor:string,before?:State){
 const statements=[];
 if(action.type==='purgePerson'){
  const id=before?.people.find(p=>p.id===action.person)?.auth;
  if(id){const guard=" AND EXISTS (SELECT 1 FROM jam_state WHERE id = 'main' AND revision = ?)";
   statements.push(db().prepare('DELETE FROM jam_sessions WHERE account_id = ?'+guard).bind(id,row.revision));
   statements.push(db().prepare('DELETE FROM jam_account_tokens WHERE account_id = ?'+guard).bind(id,row.revision));
   statements.push(db().prepare("UPDATE jam_auth_claims SET account_id = ? WHERE account_id = ? AND (key = 'admin-setup' OR key LIKE 'admin-group-closed:%')"+guard).bind(actor,id,row.revision));
   statements.push(db().prepare('DELETE FROM jam_auth_claims WHERE account_id = ?'+guard).bind(id,row.revision));
   statements.push(db().prepare('DELETE FROM jam_admin_invites WHERE created_by = ?'+guard).bind(id,row.revision));
   statements.push(db().prepare('UPDATE jam_admin_invites SET used_by = NULL, revoked = 1 WHERE used_by = ?'+guard).bind(id,row.revision));
   statements.push(db().prepare('DELETE FROM jam_accounts WHERE id = ?'+guard).bind(id,row.revision));
  }
 }

 if(action.type==='revokeAdmin'){const id=before?.people.find(p=>p.id===action.person)?.auth;if(id)statements.push(db().prepare("UPDATE jam_admin_invites SET revoked = 1 WHERE created_by = ? AND used_by IS NULL AND revoked = 0 AND EXISTS (SELECT 1 FROM jam_state WHERE id = 'main' AND revision = ?)").bind(id,row.revision));}
 if(action.type==='profile'&&action.nickname!==undefined){const target=state.people.find(p=>p.id===action.person&&state.admins.includes(actor))||state.people.find(p=>p.auth===actor)!;validateNickname(target.nickname,await nicknameDirectory(state),target.id);
  statements.push(db().prepare('UPDATE jam_accounts SET login = ? WHERE id = ? AND login IS NOT NULL AND EXISTS (SELECT 1 FROM jam_state WHERE id = ? AND revision = ?)').bind(target.nickname!,target.auth!,'main',row.revision));
 }
 statements.push(db().prepare('UPDATE jam_state SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state),'main',row.revision));
 const result=await db().batch(statements);return result.at(-1)!;
}
export const SESSION_COOKIE='berliner_jam_session';
const SESSION_SECONDS=60*60*24*30;
export const authHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
export function db(){if(!env.DB)throw Error('База данных недоступна');return env.DB;}
export function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function digest(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function passwordHash(password:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function cookie(request:Request,token:string,clear=false){return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear?0:SESSION_SECONDS}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function session(request:Request){const value=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);if(!value||!/^[a-f0-9]{64}$/.test(value))return null;const tokenHash=await digest(value);const row=await db().prepare('SELECT account_id,recovery_until FROM jam_sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash,Date.now()).first<{account_id:string;recovery_until:number|null}>();if(!row)return null;const state:State=JSON.parse((await readState()).data);return state.people.some(p=>p.auth===row.account_id&&!p.deletedAt)?{id:row.account_id,tokenHash,recoveryUntil:row.recovery_until||0}:null;}
export async function readState(){let row=await db().prepare('SELECT data,revision FROM jam_state WHERE id = ?').bind('main').first<{data:string;revision:number}>();if(!row){const state=seed('__unclaimed_admin__','Организатор');await db().prepare('INSERT OR IGNORE INTO jam_state (id,data,revision) VALUES (?,?,0)').bind('main',JSON.stringify(state)).run();row=await db().prepare('SELECT data,revision FROM jam_state WHERE id = ?').bind('main').first<{data:string;revision:number}>();}if(!row)throw Error('Не удалось загрузить встречу');return row;}
export async function setupAvailable(){return !!env.ADMIN_SETUP_TOKEN&&!await db().prepare('SELECT key FROM jam_auth_claims WHERE key = ?').bind('admin-setup').first();}
async function invitationClaim(value:unknown){
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('Приглашение недействительно или срок его действия истёк');
 const tokenHash=await digest(value);
 const sharedExpires=Number(env.ADMIN_GROUP_INVITE_EXPIRES_AT);
 if(env.ADMIN_GROUP_INVITE_TOKEN&&tokenHash===await digest(env.ADMIN_GROUP_INVITE_TOKEN)){
  if(!Number.isFinite(sharedExpires)||sharedExpires<=Date.now()||await db().prepare('SELECT key FROM jam_auth_claims WHERE key = ?').bind('admin-group-closed:'+tokenHash).first())throw Error('Общая ссылка приглашения отключена или срок её действия истёк');
  return {id:null,tokenHash,claimKey:null,shared:true};
 }
 const invitation=await db().prepare('SELECT id FROM jam_admin_invites WHERE token_hash = ? AND expires_at > ? AND used_by IS NULL AND revoked = 0').bind(tokenHash,Date.now()).first<{id:string}>();
 if(invitation)return {id:invitation.id,tokenHash,claimKey:null,shared:false};
 const expires=Number(env.ADMIN_INVITE_EXPIRES_AT);
 if(!env.ADMIN_INVITE_TOKEN||!Number.isFinite(expires)||expires<=Date.now()||tokenHash!==await digest(env.ADMIN_INVITE_TOKEN))throw Error('Приглашение недействительно, отозвано или уже использовано');
 const key='admin-invite:'+tokenHash;
 if(await db().prepare('SELECT key FROM jam_auth_claims WHERE key = ?').bind(key).first())throw Error('Это приглашение уже использовано. Войдите по логину и паролю');
 return {id:null,tokenHash,claimKey:key,shared:false};
}
export async function administrator(request:Request){const current=await session(request);if(!current)throw Error('Нужны права администратора');const row=await readState();const state:State=JSON.parse(row.data);if(!state.admins.includes(current.id))throw Error('Нужны права администратора');return {current,row,state};}
export async function makeSession(accountId:string,recovery=false){const state:State=JSON.parse((await readState()).data);if(!state.people.some(p=>p.auth===accountId&&!p.deletedAt))throw Error('Профиль удалён организатором');const token=randomToken();await db().prepare('INSERT INTO jam_sessions (token_hash,account_id,expires_at,recovery_until) VALUES (?,?,?,?)').bind(await digest(token),accountId,Date.now()+SESSION_SECONDS*1000,recovery?Date.now()+600000:null).run();return token;}
export function assertOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw Error('Недопустимый источник запроса');}
function nameField(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>80)throw Error('Укажите имя, не длиннее 80 символов');return value.trim();}
export async function rateLimit(request:Request,kind:string,limit:number){const ip=request.headers.get('cf-connecting-ip')||'local';const key=await digest(kind+'|'+ip);const window=Math.floor(Date.now()/600000);await db().prepare('INSERT INTO jam_auth_attempts (key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END, window = excluded.window').bind(key,window).run();const count=await db().prepare('SELECT count FROM jam_auth_attempts WHERE key = ?').bind(key).first<{count:number}>();if((count?.count||0)>limit)throw Error('Слишком много попыток. Повторите через 10 минут');}
export async function createAccount(request:Request,body:any){
 const setup=body.mode==='setup',invite=body.mode==='invite',admin=setup||invite;const name=nameField(body.name);
 let claimKey:string|null=null;
 if(setup){if(!await setupAvailable())throw Error('Администратор уже настроен');if(typeof body.setupToken!=='string'||await digest(body.setupToken)!==await digest(env.ADMIN_SETUP_TOKEN!))throw Error('Ссылка настройки недействительна');claimKey='admin-setup';}
 if(invite)claimKey=(await invitationClaim(body.inviteToken)).claimKey;
 validatePassword(body.password);
 const id='local_'+uid(),recovery=admin?null:randomToken(),salt=randomToken();
 const pass=await passwordHash(body.password,salt);const token=randomToken(),tokenHash=await digest(token);const accessHash=recovery?await digest(recovery):null;
 for(let attempt=0;attempt<3;attempt++){
  const row=await readState();const state:State=JSON.parse(row.data);ensureNicknames(state);
  if(body.nicknameMode!==undefined&&!['suggested','custom'].includes(body.nicknameMode))throw Error('Выберите предложенный ник или впишите свой');
  const previousOwner=setup?state.people.find(p=>p.auth===state.admins[0]):undefined,customNickname=body.nicknameMode==='custom'||body.nicknameMode===undefined&&body.nickname!==undefined;
  const directory=await nicknameDirectory(state),legacyLogin=admin&&body.nicknameMode===undefined&&body.nickname===undefined&&body.login!==undefined;
  const nickname=customNickname||legacyLogin?validateNickname(legacyLogin?body.login:body.nickname,directory,previousOwner?.id):suggestNickname(name,directory,previousOwner?.id);
  const invitation=invite?await invitationClaim(body.inviteToken):null;
  if(setup){const old=state.people.find(p=>p.auth===state.admins[0]);if(old){old.auth=id;old.name=name;}else state.people.push({id,auth:id,name,roles:[],max:5});state.admins=[...state.admins.filter(x=>x.startsWith('local_')),id];}
  else if(invite){if(!state.admins.some(x=>x.startsWith('local_')))throw Error('Сначала нужно настроить основного администратора');if(state.admins.length>=ADMIN_LIMIT)throw Error(`Достигнут лимит: ${ADMIN_LIMIT} администраторов`);state.people.push({id,auth:id,name,roles:[],max:5});state.admins.push(id);}
  else state.people.push({id,auth:id,name,roles:[],max:5});
  const profile=state.people.find(p=>p.auth===id)!;profile.nickname=nickname;profile.nicknameSource=customNickname?'custom':'suggested';
  state.log.unshift({at:new Date().toISOString(),text:setup?'Настроен независимый вход администратора':invite?`${name}: создан отдельный вход организатора`:`${name}: присоединился к сообществу`});state.log=state.log.slice(0,80);
  const accountQuery='INSERT INTO jam_accounts (id,access_hash,login,password_hash,salt,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM jam_state WHERE id = ? AND revision = ?)';
  const accountValues=[id,accessHash,nickname,pass,salt,Date.now(),'main',row.revision];
  const statements=[invitation?.id?db().prepare(accountQuery+' AND EXISTS (SELECT 1 FROM jam_admin_invites WHERE id = ? AND token_hash = ? AND expires_at > ? AND used_by IS NULL AND revoked = 0)').bind(...accountValues,invitation.id,invitation.tokenHash,Date.now()):invitation?.shared?db().prepare(accountQuery+' AND NOT EXISTS (SELECT 1 FROM jam_auth_claims WHERE key = ?) AND ? > ?').bind(...accountValues,'admin-group-closed:'+invitation.tokenHash,Number(env.ADMIN_GROUP_INVITE_EXPIRES_AT),Date.now()):db().prepare(accountQuery).bind(...accountValues)];
  if(claimKey)statements.push(db().prepare('INSERT INTO jam_auth_claims (key,account_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM jam_accounts WHERE id = ?)').bind(claimKey,id,id));
  if(invitation?.id)statements.push(db().prepare('UPDATE jam_admin_invites SET used_by = ? WHERE id = ? AND EXISTS (SELECT 1 FROM jam_accounts WHERE id = ?)').bind(id,invitation.id,id));
  statements.push(db().prepare('UPDATE jam_state SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM jam_accounts WHERE id = ?)').bind(JSON.stringify(state),'main',row.revision,id));
  statements.push(db().prepare('INSERT INTO jam_sessions (token_hash,account_id,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM jam_accounts WHERE id = ?)').bind(tokenHash,id,Date.now()+SESSION_SECONDS*1000,id));
  const result=await db().batch(statements);if(result[0].meta.changes)return {token,recoveryToken:recovery,accountId:id};
 }
 throw Error('Кто-то обновил встречу. Повторите вход');
}

export function validatePassword(value:unknown):asserts value is string{if(typeof value!=='string'||value.length<12||value.length>200)throw Error('Пароль должен содержать от 12 до 200 символов');}
