import { mailAvailable, privateAccount } from '../../../lib/account-security';
import { cleanupEventImages, requireUploadedImage } from '../../../lib/event-images';
import { applyAction, retainDraftSongs, visibleState, State } from '../../../lib/model';
import { authHeaders, assertOrigin, db, readState, session, setupAvailable, migrateOrganizerLogin, saveState } from '../../../lib/local-auth';
export const dynamic = 'force-dynamic';
export async function GET(request:Request){try{
 await migrateOrganizerLogin();let row=await readState();let state:State=JSON.parse(row.data);const current=await session(request);
 if(retainDraftSongs(state)){
  const result=await db().prepare('UPDATE jam_state SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state),'main',row.revision).run();
  if(result.meta.changes)row={data:JSON.stringify(state),revision:row.revision+1};else{row=await readState();state=JSON.parse(row.data);}
 }
 const person=current?state.people.find(p=>p.auth===current.id):null;
 return Response.json({state:visibleState(state,!!current&&state.admins.includes(current.id),person?.id),revision:row.revision,identity:person&&current?{id:current.id,name:person.name}:null,setupAvailable:await setupAvailable(),mailAvailable:mailAvailable(),account:await privateAccount(current)},{headers:authHeaders});
 }catch(error){return Response.json({error:(error as Error).message},{status:500,headers:authHeaders});}}
export async function POST(request:Request){try{
 assertOrigin(request);const current=await session(request);if(!current)return Response.json({error:'Войдите в свой аккаунт'},{status:401,headers:authHeaders});
 const raw=await request.text();if(raw.length>80000)return Response.json({error:'Слишком большой запрос'},{status:413});const body=JSON.parse(raw);const row=await readState();
 if(body.revision!==row.revision)return Response.json({error:'Данные изменились у другого участника. Обновили страницу, повторите действие.'},{status:409,headers:authHeaders});
 const before:State=JSON.parse(row.data),state=applyAction(before,body.action,current.id);
 if(['newEvent','settings'].includes(body.action.type)&&body.action.image)await requireUploadedImage(body.action.image);
 const r=await saveState(row,state,body.action,current.id,before);if(!r.meta.changes)return Response.json({error:'Данные обновились. Повторите действие.'},{status:409,headers:authHeaders});
 try{await cleanupEventImages(before,state);}catch{console.error('Unable to remove an unused event image');}
 const person=state.people.find(p=>p.auth===current.id&&!p.deletedAt);return Response.json({state:visibleState(state,state.admins.includes(current.id),person?.id),revision:row.revision+1,identity:person?{id:current.id,name:person.name}:null},{headers:authHeaders});
 }catch(error){return Response.json({error:(error as Error).message.includes('UNIQUE')?'Этот ник или логин уже занят':(error as Error).message},{status:(error as Error).message==='Недопустимый источник запроса'?403:400,headers:authHeaders});}}
