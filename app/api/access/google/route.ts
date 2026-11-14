import { authHeaders, rateLimit } from '../../../../lib/local-auth';
import { startGoogle } from '../../../../lib/google-auth';

export const dynamic='force-dynamic';

export async function GET(request:Request){
 const params=new URL(request.url).searchParams;
 try{
  if(request.headers.get('sec-fetch-site')==='cross-site')throw Error('Недопустимый источник запроса');
  await rateLimit(request,'google-start',40);
  const result=await startGoogle(request,params.get('next'),params.get('link')==='1');
  return new Response(null,{status:302,headers:{...authHeaders,Location:result.url,'Set-Cookie':result.cookie}});
 }catch{
  return new Response(null,{status:302,headers:{...authHeaders,Location:'/#google=error'}});
 }
}
