import { env } from 'cloudflare:workers';
import { administrator, assertOrigin, authHeaders, readState, session } from '../../../lib/local-auth';
import { State, uid, uploadedImageId } from '../../../lib/model';
import { imageKey, readEventImage } from '../../../lib/event-images';
export const dynamic='force-dynamic';
const failure=(error:unknown)=>Response.json({error:(error as Error).message},{status:['Нужны права администратора','Недопустимый источник запроса'].includes((error as Error).message)?403:400,headers:authHeaders});
export async function POST(request:Request){try{
 assertOrigin(request);await administrator(request);if(!env.BUCKET)throw Error('Хранилище картинок недоступно');const {bytes,type}=await readEventImage(request),id=uid();
 await env.BUCKET.put(imageKey(id),bytes,{httpMetadata:{contentType:type}});return Response.json({image:'/api/event-image?id='+id},{headers:authHeaders});
}catch(error){return failure(error);}}
export async function GET(request:Request){try{
 const id=uploadedImageId('/api/event-image?id='+new URL(request.url).searchParams.get('id'));if(!id||!env.BUCKET)return new Response('Картинка не найдена',{status:404});
 const state:State=JSON.parse((await readState()).data),publicImage=state.events.some(e=>!e.deletedAt&&uploadedImageId(e.image)===id);
 if(!publicImage){const current=await session(request);if(!current||!state.admins.includes(current.id))return new Response('Картинка не найдена',{status:404});}
 const object=await env.BUCKET.get(imageKey(id));if(!object)return new Response('Картинка не найдена',{status:404});
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':publicImage?'public, max-age=300':'private, no-store',ETag:object.httpEtag}});
}catch(error){return failure(error);}}
export async function DELETE(request:Request){try{
 assertOrigin(request);const {state}=await administrator(request),id=uploadedImageId('/api/event-image?id='+new URL(request.url).searchParams.get('id'));if(!id||!env.BUCKET)throw Error('Картинка не найдена');
 if(state.events.some(e=>uploadedImageId(e.image)===id))return Response.json({error:'Картинка используется во встрече'},{status:409,headers:authHeaders});
 await env.BUCKET.delete(imageKey(id));return Response.json({ok:true},{headers:authHeaders});
}catch(error){return failure(error);}}
