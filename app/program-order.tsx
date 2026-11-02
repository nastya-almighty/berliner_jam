'use client';
import {useEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {GripVertical} from 'lucide-react';

type Drag = {song:string;before:string|null;x:number;y:number};
type Press = {song:string;pointer:number;x:number;y:number;active:boolean};

export function ProgramOrder({order,editable,titleFor,onMove,children}:{order:string[];editable:boolean;titleFor:(song:string)=>string;onMove:(song:string,before:string|null)=>Promise<unknown>;children:(song:string,index:number,handle:ReactNode)=>ReactNode}){
 const root=useRef<HTMLDivElement>(null),press=useRef<Press|null>(null),current=useRef<Drag|null>(null),frame=useRef<number|null>(null);
 const [drag,setDrag]=useState<Drag|null>(null),[announcement,setAnnouncement]=useState('');
 function cancel(){press.current=null;current.current=null;setDrag(null);if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}}
 function locate(song:string,x:number,y:number){
  const rows=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-program-id]')||[]).filter(row=>row.dataset.programId!==song);
  const target=rows.find(row=>{const rect=(row.querySelector('.program-row')||row).getBoundingClientRect();return y<rect.top+rect.height/2;});
  const next={song,before:target?.dataset.programId||null,x,y};current.current=next;setDrag(next);
 }
 function autoScroll(){
  if(!current.current)return;
  const {song,x,y}=current.current,edge=75,step=y<edge?-Math.min(18,(edge-y)/4):y>window.innerHeight-edge?Math.min(18,(y-window.innerHeight+edge)/4):0;
  if(step){window.scrollBy({top:step,behavior:'instant'});locate(song,x,y);}
  frame.current=requestAnimationFrame(autoScroll);
 }
 useEffect(()=>{cancel();},[editable,order.join('|')]);
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 useEffect(()=>{if(!drag)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();cancel();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[!!drag]);
 function start(event:PointerEvent<HTMLButtonElement>,song:string){
  if(!editable||!event.isPrimary||event.button!==0)return;
  event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
  press.current={song,pointer:event.pointerId,x:event.clientX,y:event.clientY,active:false};
 }
 function move(event:PointerEvent<HTMLButtonElement>){
  const p=press.current;if(!p||p.pointer!==event.pointerId)return;
  if(!p.active&&Math.hypot(event.clientX-p.x,event.clientY-p.y)<6)return;
  event.preventDefault();p.active=true;locate(p.song,event.clientX,event.clientY);
  if(frame.current===null)frame.current=requestAnimationFrame(autoScroll);
 }
 function drop(event:PointerEvent<HTMLButtonElement>){
  const p=press.current,d=current.current;if(!p||p.pointer!==event.pointerId)return;
  const bounds=root.current?.getBoundingClientRect(),inside=!!bounds&&event.clientX>=bounds.left-40&&event.clientX<=bounds.right+40;
  cancel();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  if(!p.active||!d||!inside)return;
  const previous=order.indexOf(p.song),rest=order.filter(id=>id!==p.song),index=d.before===null?rest.length:rest.indexOf(d.before);
  if(index===previous)return;
  void onMove(p.song,d.before).then(result=>{if(result)setAnnouncement('Порядок песен сохранён');});
 }
 return <div ref={root} className={'program-order'+(drag?' dragging':'')}>
  {order.map((id,i)=><div key={id} data-program-id={id} className={'program-order-item'+(drag?.song===id?' is-dragging':'')+(drag&&drag.before===id?' drop-before':'')}>
   {children(id,i,editable?<button type="button" className="program-drag-handle" aria-label={'Перетащить песню: '+titleFor(id)} title="Зажмите и перетащите, чтобы изменить порядок" onPointerDown={event=>start(event,id)} onPointerMove={move} onPointerUp={drop} onPointerCancel={cancel} onLostPointerCapture={cancel} onClick={event=>event.preventDefault()}><GripVertical size={22}/></button>:null)}
  </div>)}
  {drag?.before===null&&<div className="program-drop-end"/>}
  {drag&&<div className="program-drag-preview" style={{left:Math.min(drag.x+14,window.innerWidth-220),top:Math.max(8,Math.min(drag.y+14,window.innerHeight-65))}} aria-hidden="true"><GripVertical size={18}/>{titleFor(drag.song)}</div>}
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </div>;
}
