import { ADMIN_LIMIT, uid } from '../../../lib/model';
import { env } from 'cloudflare:workers';
import { administrator, assertOrigin, authHeaders, db, digest, randomToken, rateLimit } from '../../../lib/local-auth';
export const dynamic='force-dynamic';
const denied=(error:unknown)=>Response.json({error:(error as Error).message},{status:(error as Error).message==='Нужны права администратора'?403:400,headers:authHeaders});
export async function GET(request:Request){try{
 const {state}=await administrator(request);
 const accounts=await db().prepare(`SELECT id,login FROM jam_accounts WHERE id IN (${state.admins.map(()=>'?').join(',')})`).bind(...state.admins).all<{id:string;login:string|null}>();
 const admins=state.admins.map(id=>({id,login:accounts.results.find(a=>a.id===id)?.login||null,name:state.people.find(p=>p.auth===id)?.name||'Организатор'}));
 const invitations=await db().prepare('SELECT id,created_at,expires_at FROM jam_admin_invites WHERE used_by IS NULL AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC').bind(Date.now()).all<{id:string;created_at:number;expires_at:number}>();
 const sharedExpiry=Number(env.ADMIN_GROUP_INVITE_EXPIRES_AT);
 const sharedInviteExpiresAt=env.ADMIN_GROUP_INVITE_TOKEN&&Number.isFinite(sharedExpiry)&&sharedExpiry>Date.now()&&!await db().prepare('SELECT key FROM jam_auth_claims WHERE key = ?').bind('admin-group-closed:'+await digest(env.ADMIN_GROUP_INVITE_TOKEN)).first()?sharedExpiry:null;
 return Response.json({admins,invitations:invitations.results,limit:ADMIN_LIMIT,sharedInviteExpiresAt},{headers:authHeaders});
 }catch(error){return denied(error);}}
export async function POST(request:Request){try{
 assertOrigin(request);const {current}=await administrator(request);await rateLimit(request,'admin-invites',100);
 const raw=await request.text();if(raw.length>1000)throw Error('Слишком большой запрос');const body=JSON.parse(raw);
 if(body.mode==='close-shared-invite'){
  if(!env.ADMIN_GROUP_INVITE_TOKEN)throw Error('Общая ссылка не настроена');
  await db().prepare('INSERT OR IGNORE INTO jam_auth_claims (key,account_id) VALUES (?,?)').bind('admin-group-closed:'+await digest(env.ADMIN_GROUP_INVITE_TOKEN),current.id).run();
  return Response.json({ok:true},{headers:authHeaders});
 }
 if(body.mode==='new-invite'){
  const token=randomToken(),id=uid(),expiresAt=Date.now()+7*86400000;
  for(let attempt=0;attempt<3;attempt++){
   const {state,row}=await administrator(request);if(state.admins.length>=ADMIN_LIMIT)throw Error(`Достигнут лимит: ${ADMIN_LIMIT} администраторов`);
   const r=await db().prepare('INSERT INTO jam_admin_invites (id,token_hash,created_by,created_at,expires_at,revoked) SELECT ?,?,?,?,?,0 WHERE EXISTS (SELECT 1 FROM jam_state WHERE id = ? AND revision = ?) AND (SELECT COUNT(*) FROM jam_admin_invites WHERE used_by IS NULL AND revoked = 0 AND expires_at > ?) < ?').bind(id,await digest(token),current.id,Date.now(),expiresAt,'main',row.revision,Date.now(),ADMIN_LIMIT-state.admins.length).run();
   if(r.meta.changes)return Response.json({id,token,expiresAt},{headers:authHeaders});
  }
  throw Error('Все свободные места уже зарезервированы приглашениями. Отзовите ненужную ссылку.');
 }
 if(body.mode==='revoke-invite'){
  if(typeof body.id!=='string'||body.id.length>80)throw Error('Приглашение не найдено');
  const r=await db().prepare('UPDATE jam_admin_invites SET revoked = 1 WHERE id = ? AND used_by IS NULL AND revoked = 0').bind(body.id).run();
  if(!r.meta.changes)throw Error('Приглашение уже использовано или отозвано');return Response.json({ok:true},{headers:authHeaders});
 }
 throw Error('Неизвестное действие');
 }catch(error){return denied(error);}}
