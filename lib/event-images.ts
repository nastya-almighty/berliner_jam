import { env } from 'cloudflare:workers';
import { State, uploadedImageId } from './model';

export const MAX_EVENT_IMAGE_BYTES=5*1024*1024;
export const imageKey=(id:string)=>'event-images/'+id;
export async function requireUploadedImage(value:unknown){const id=uploadedImageId(value);if(id&&(!env.BUCKET||!await env.BUCKET.head(imageKey(id))))throw Error('Картинка не найдена. Загрузите её ещё раз');}
export async function cleanupEventImages(before:State,after:State){
 if(!env.BUCKET)return;const used=new Set(after.events.map(e=>uploadedImageId(e.image)).filter(Boolean));
 const removed=[...new Set(before.events.map(e=>uploadedImageId(e.image)).filter((id):id is string=>!!id&&!used.has(id)))];
 if(removed.length)await env.BUCKET.delete(removed.map(imageKey));
}
export async function readEventImage(request:Request){
 if(Number(request.headers.get('content-length'))>MAX_EVENT_IMAGE_BYTES)throw Error('Картинка должна быть не больше 5 МБ');
 const reader=request.body?.getReader();if(!reader)throw Error('Выберите картинку');const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_EVENT_IMAGE_BYTES){await reader.cancel();throw Error('Картинка должна быть не больше 5 МБ');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const png=bytes.length>=24&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b),jpeg=bytes.length>=16&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.length>=16&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 const type=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':null;if(!type)throw Error('Выберите картинку JPG, PNG или WebP');return {bytes,type};
}
