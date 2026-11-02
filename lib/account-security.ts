import { env } from 'cloudflare:workers';
import { db, digest, randomToken, passwordHash, validatePassword, readState, nicknameDirectory } from './local-auth';
import { State, validateNickname } from './model';
type Current={id:string;tokenHash:string;recoveryUntil:number};
type Account={id:string;login:string|null;password_hash:string|null;salt:string|null;email:string|null;email_verified_at:number|null;pending_email:string|null};
const SESSION_MS=30*86400000;
export const mailAvailable=()=>!!env.RESEND_API_KEY&&!!env.MAIL_FROM;
export function validateEmail(value:unknown){if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw Error('Укажите корректный адрес почты');return value.trim().toLowerCase();}
async function account(id:string){const row=await db().prepare('SELECT id,login,password_hash,salt,email,email_verified_at,pending_email FROM jam_accounts WHERE id = ?').bind(id).first<Account>();if(!row)throw Error('Аккаунт не найден');return row;}
export async function privateAccount(current:Current|null){if(!current)return null;const row=await account(current.id);return {login:row.login,hasPassword:!!row.password_hash,email:row.email,emailVerified:!!row.email_verified_at,pendingEmail:row.pending_email,recoveryActive:current.recoveryUntil>Date.now()};}
async function active(id:string){const state:State=JSON.parse((await readState()).data);if(!state.people.some(p=>p.auth===id&&!p.deletedAt))throw Error('Профиль недоступен');}
async function provePassword(current:Current,password:unknown){const row=await account(current.id);if(row.password_hash&&current.recoveryUntil<=Date.now()){const supplied=typeof password==='string'&&password.length<=200?password:'';if(await passwordHash(supplied,row.salt!)!==row.password_hash)throw Error('Укажите текущий пароль');}return row;}
async function sendMail(request:Request,email:string,purpose:'verify'|'reset',token:string){
 if(!mailAvailable())throw Error('Отправка писем пока не подключена. Используйте резервную ссылку.');
 const url=new URL(request.url).origin+'/#'+purpose+'='+token,verify=purpose==='verify';
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:verify?'Berliner Jam: подтверждение почты':'Berliner Jam: восстановление пароля',text:(verify?'Подтвердите почту для восстановления доступа. Ссылка действует 24 часа.':'Задайте новый пароль. Ссылка действует 15 минут.')+'\n\n'+url+'\n\nЕсли вы не запрашивали это письмо, проигнорируйте его.'}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Не удалось отправить письмо. Попробуйте позже.');
}
export async function requestEmailVerification(request:Request,current:Current,emailInput:unknown,password:unknown){
 if(!mailAvailable())throw Error('Отправка писем пока не подключена. Используйте резервную ссылку.');
 const email=validateEmail(emailInput),row=await provePassword(current,password);if(row.email===email&&row.email_verified_at)return;
 const token=randomToken(),hash=await digest(token),expires=Date.now()+86400000;
 const result=await db().batch([
  db().prepare("UPDATE jam_accounts SET pending_email = ? WHERE id = ? AND COALESCE(password_hash,'') = ?").bind(email,current.id,row.password_hash||''),
  db().prepare("INSERT INTO jam_account_tokens (token_hash,account_id,purpose,email,expires_at) SELECT ?,?,'verify',?,? WHERE EXISTS (SELECT 1 FROM jam_accounts WHERE id = ? AND pending_email = ? AND COALESCE(password_hash,'') = ?)").bind(hash,current.id,email,expires,current.id,email,row.password_hash||''),
  db().prepare('DELETE FROM jam_account_tokens WHERE expires_at < ?').bind(Date.now())
 ]);if(!result[1].meta.changes)throw Error('Аккаунт изменился. Повторите действие.');
 try{await sendMail(request,email,'verify',token);}catch(error){await db().prepare('DELETE FROM jam_account_tokens WHERE token_hash = ?').bind(hash).run();throw error;}
}
async function installOwnerReset(tokenHash:string){
 // A Site owner may authorize one recovery for one existing password version.
 // No raw token or new password is stored in source or runtime configuration.
 if(!env.OWNER_PASSWORD_RESET)return;
 let reset:{accountId:string;login:string;tokenHash:string;passwordHash:string;expiresAt:number};
 try{reset=JSON.parse(env.OWNER_PASSWORD_RESET);}catch{return;}
 if(!reset||reset.tokenHash!==tokenHash||typeof reset.accountId!=='string'||typeof reset.login!=='string'||!/^[a-f0-9]{64}$/.test(reset.passwordHash)||!Number.isFinite(reset.expiresAt)||reset.expiresAt<=Date.now())return;
 await db().prepare("INSERT OR IGNORE INTO jam_account_tokens (token_hash,account_id,purpose,email,expires_at) SELECT ?,a.id,'owner-reset',a.password_hash,? FROM jam_accounts a WHERE a.id = ? AND a.login = ? AND a.password_hash = ? AND EXISTS (SELECT 1 FROM jam_state, json_each(jam_state.data, '$.people') p WHERE jam_state.id = 'main' AND json_extract(p.value, '$.auth') = a.id AND json_extract(p.value, '$.deletedAt') IS NULL)").bind(tokenHash,reset.expiresAt,reset.accountId,reset.login,reset.passwordHash).run();
}
async function tokenRecord(value:unknown,purpose:'verify'|'reset'){
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('Ссылка недействительна или срок её действия истёк');const hash=await digest(value);
 if(purpose==='reset')await installOwnerReset(hash);
 const row=await db().prepare("SELECT account_id,email,purpose FROM jam_account_tokens WHERE token_hash = ? AND (purpose = ? OR (purpose = 'owner-reset' AND ? = 'reset')) AND expires_at > ? AND consumed_by IS NULL").bind(hash,purpose,purpose,Date.now()).first<{account_id:string;email:string;purpose:'verify'|'reset'|'owner-reset'}>();if(!row)throw Error('Ссылка недействительна или уже использована');await active(row.account_id);return {...row,hash};
}
export async function verifyEmail(value:unknown){
 const link=await tokenRecord(value,'verify'),nonce=randomToken();
 const r=await db().batch([
  db().prepare("UPDATE jam_account_tokens SET consumed_by = ? WHERE token_hash = ? AND purpose = 'verify' AND consumed_by IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM jam_accounts WHERE id = ? AND pending_email = ?)").bind(nonce,link.hash,Date.now(),link.account_id,link.email),
  db().prepare('UPDATE jam_accounts SET email = ?, email_verified_at = ?, pending_email = NULL WHERE id = ? AND EXISTS (SELECT 1 FROM jam_account_tokens WHERE token_hash = ? AND consumed_by = ?)').bind(link.email,Date.now(),link.account_id,link.hash,nonce),
  db().prepare("DELETE FROM jam_account_tokens WHERE account_id = ? AND purpose = 'reset' AND EXISTS (SELECT 1 FROM jam_account_tokens WHERE token_hash = ? AND consumed_by = ?)").bind(link.account_id,link.hash,nonce)
 ]);if(!r[1].meta.changes)throw Error('Ссылка недействительна или уже использована');
}
export async function forgotPassword(request:Request,value:unknown){
 if(!mailAvailable())throw Error('Отправка писем пока не подключена. Используйте резервную ссылку.');
 const query=typeof value==='string'?value.trim().replace(/^@/,'').toLowerCase().slice(0,254):'';
 const row=await db().prepare('SELECT id,email FROM jam_accounts WHERE (login = ? OR email = ?) AND email_verified_at IS NOT NULL').bind(query,query).first<{id:string;email:string}>();if(!row)return;
 try{await active(row.id);}catch{return;}
 const pending=await db().prepare("SELECT COUNT(*) AS n FROM jam_account_tokens WHERE account_id = ? AND purpose = 'reset' AND expires_at > ?").bind(row.id,Date.now()).first<{n:number}>();if((pending?.n||0)>=3)return;
 const token=randomToken(),hash=await digest(token);await db().prepare("INSERT INTO jam_account_tokens (token_hash,account_id,purpose,email,expires_at) VALUES (?,?,'reset',?,?)").bind(hash,row.id,row.email,Date.now()+900000).run();
 try{await sendMail(request,row.email,'reset',token);}catch{await db().prepare('DELETE FROM jam_account_tokens WHERE token_hash = ?').bind(hash).run();console.error('Password recovery email delivery failed');}
}
export async function changePassword(password:unknown,current:Current|null,currentPassword:unknown,resetToken?:unknown){
 validatePassword(password);const link=resetToken!==undefined?await tokenRecord(resetToken,'reset'):null;if(!link&&!current)throw Error('Сначала войдите');
 const id=link?.account_id||current!.id,previous=link?await account(id):await provePassword(current!,currentPassword),saved=await readState(),state:State=JSON.parse(saved.data),person=state.people.find(p=>p.auth===id&&!p.deletedAt);if(!person)throw Error('Профиль недоступен');
 const login=validateNickname(person.nickname,await nicknameDirectory(state),person.id),salt=randomToken(),hash=await passwordHash(password,salt),recovery=randomToken(),token=randomToken(),nonce=randomToken(),statements=[];
 if(link){
  const proof=link.purpose==='owner-reset'?"password_hash = ?":"email = ? AND email_verified_at IS NOT NULL";
  statements.push(db().prepare("UPDATE jam_account_tokens SET consumed_by = ? WHERE token_hash = ? AND purpose = ? AND consumed_by IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM jam_accounts WHERE id = ? AND "+proof+" AND COALESCE(password_hash,'') = ?) AND EXISTS (SELECT 1 FROM jam_state WHERE id = 'main' AND revision = ?)").bind(nonce,link.hash,link.purpose,Date.now(),id,link.email,previous.password_hash||'',saved.revision));
 }
 const passwordIndex=statements.length;
 statements.push(db().prepare("UPDATE jam_accounts SET login = ?, password_hash = ?, salt = ?, access_hash = ? WHERE id = ? AND COALESCE(password_hash,'') = ? AND EXISTS (SELECT 1 FROM jam_state WHERE id = 'main' AND revision = ?)"+(link?' AND EXISTS (SELECT 1 FROM jam_account_tokens WHERE token_hash = ? AND consumed_by = ?)':'')).bind(login,hash,salt,await digest(recovery),id,previous.password_hash||'',saved.revision,...(link?[link.hash,nonce]:[])));
 statements.push(db().prepare('DELETE FROM jam_sessions WHERE account_id = ? AND EXISTS (SELECT 1 FROM jam_accounts WHERE id = ? AND salt = ?)').bind(id,id,salt));
 statements.push(db().prepare('DELETE FROM jam_account_tokens WHERE account_id = ? AND EXISTS (SELECT 1 FROM jam_accounts WHERE id = ? AND salt = ?)').bind(id,id,salt));
 statements.push(db().prepare('INSERT INTO jam_sessions (token_hash,account_id,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM jam_accounts WHERE id = ? AND salt = ?)').bind(await digest(token),id,Date.now()+SESSION_MS,id,salt));
 const r=await db().batch(statements);if(!r[passwordIndex].meta.changes)throw Error('Доступ уже изменился. Откройте восстановление заново.');return {token,recoveryToken:recovery};
}
export async function rotateRecovery(current:Current,password:unknown){const previous=await provePassword(current,password),token=randomToken();const r=await db().prepare("UPDATE jam_accounts SET access_hash = ? WHERE id = ? AND COALESCE(password_hash,'') = ?").bind(await digest(token),current.id,previous.password_hash||'').run();if(!r.meta.changes)throw Error('Доступ уже изменился. Войдите заново.');return token;}
