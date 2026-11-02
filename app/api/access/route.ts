import { changePassword, forgotPassword, mailAvailable, requestEmailVerification, rotateRecovery, validateEmail, verifyEmail } from '../../../lib/account-security';
import { normalizeNickname } from '../../../lib/model';
import { authHeaders, assertOrigin, cookie, createAccount, db, digest, makeSession, passwordHash, randomToken, rateLimit, readState, session, migrateOrganizerLogin } from '../../../lib/local-auth';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 assertOrigin(request);const raw=await request.text();if(raw.length>6000)throw Error('Слишком большой запрос');const body=JSON.parse(raw);let token:string|null=null,recoveryToken:string|null=null,message:string|undefined;
 if(body.mode==='join'||body.mode==='setup'||body.mode==='invite'){await rateLimit(request,body.mode,body.mode==='join'?200:20);if(body.email){validateEmail(body.email);if(!mailAvailable())throw Error('Отправка писем пока не подключена');}const r=await createAccount(request,body);token=r.token;recoveryToken=r.recoveryToken;if(body.email){try{await requestEmailVerification(request,{id:r.accountId,tokenHash:await digest(token),recoveryUntil:0},body.email,body.password);}catch{message='Аккаунт создан. Письмо не отправлено — повторите подтверждение почты в настройках входа.';}}}
 else if(body.mode==='login'){
  await rateLimit(request,'login',20);await migrateOrganizerLogin();const login=typeof body.login==='string'?normalizeNickname(body.login):'';const row=await db().prepare('SELECT id,password_hash,salt FROM jam_accounts WHERE login = ?').bind(login).first<{id:string;password_hash:string;salt:string}>();const password=typeof body.password==='string'&&body.password.length<=200?body.password:'';
  const hash=await passwordHash(password,row?.salt||'invalid-login-fixed-salt');if(!row||hash!==row.password_hash)throw Error('Неверный логин или пароль');token=await makeSession(row.id);
 }else if(body.mode==='link'){
  await rateLimit(request,'link',100);if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw Error('Личная ссылка недействительна');const row=await db().prepare('SELECT id FROM jam_accounts WHERE access_hash = ?').bind(await digest(body.token)).first<{id:string}>();if(!row)throw Error('Личная ссылка недействительна');token=await makeSession(row.id,true);
 }else if(body.mode==='new-link'){
  await rateLimit(request,'new-link',10);const current=await session(request);if(!current)throw Error('Сначала войдите');recoveryToken=await rotateRecovery(current,body.currentPassword);
 }else if(body.mode==='set-password'||body.mode==='reset-password'){
  await rateLimit(request,'password-change',20);const changed=await changePassword(body.password,await session(request),body.currentPassword,body.mode==='reset-password'?body.token:undefined);token=changed.token;recoveryToken=changed.recoveryToken;
 }else if(body.mode==='set-email'){
  await rateLimit(request,'verify-email',5);const current=await session(request);if(!current)throw Error('Сначала войдите');await requestEmailVerification(request,current,body.email,body.currentPassword);message='Письмо отправлено. Подтвердите почту по ссылке.';
 }else if(body.mode==='verify-email'){
  await rateLimit(request,'verify-link',30);await verifyEmail(body.token);message='Почта подтверждена.';
 }else if(body.mode==='forgot-password'){
  await rateLimit(request,'forgot-password',10);await forgotPassword(request,body.identifier);message='Если к аккаунту привязана подтверждённая почта, на неё отправлено письмо.';
 }else if(body.mode==='logout'){
  const current=await session(request);if(current)await db().prepare('DELETE FROM jam_sessions WHERE token_hash = ?').bind(current.tokenHash).run();return Response.json({ok:true},{headers:{...authHeaders,'Set-Cookie':cookie(request,'',true)}});
 }else throw Error('Неизвестный способ входа');
 return Response.json({ok:true,recoveryToken,message},{headers:{...authHeaders,...(token?{'Set-Cookie':cookie(request,token)}:{})}});
 }catch(err){const message=(err as Error).message;const safe=message.includes('UNIQUE')?'Этот ник, логин или адрес уже используется':message;return Response.json({error:safe},{status:400,headers:authHeaders});}}
