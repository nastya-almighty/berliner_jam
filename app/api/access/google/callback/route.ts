import { authHeaders, cookie } from '../../../../../lib/local-auth';
import { clearGoogleFlow, clearGoogleSignup, finishGoogle } from '../../../../../lib/google-auth';

export const dynamic='force-dynamic';

export async function GET(request:Request){
 const headers=new Headers(authHeaders);
 headers.append('Set-Cookie',clearGoogleFlow(request));
 try{
  const result=await finishGoogle(request);
  if(result.token)headers.append('Set-Cookie',cookie(request,result.token));
  headers.append('Set-Cookie',result.signup||clearGoogleSignup(request));
  headers.set('Location',result.next);
 }catch{
  headers.append('Set-Cookie',clearGoogleSignup(request));
  headers.set('Location','/#google=error');
 }
 return new Response(null,{status:302,headers});
}
