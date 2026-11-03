'use client';
import {useState,type FormEvent} from 'react';
import {Inbox,RotateCcw,X} from 'lucide-react';
import type {JamEvent,Song,State} from '../lib/model';
import {shelfDestinations,shelfSongs} from '../lib/model';

const meetingDate=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
const timestamp=(value:string)=>new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Berlin',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});

export function ShelfPanel({state,me,busy,admin=false,onRestore}:{state:State;me:string;busy:boolean;admin?:boolean;onRestore:(event:JamEvent,song:Song)=>void}){
 const [source,setSource]=useState(''),[onlyMine,setOnlyMine]=useState(false);
 const available=shelfSongs(state,me,admin&&!onlyMine),sources=[...new Map(available.map(item=>[item.origin.event,item.origin])).values()];
 const filter=sources.some(origin=>origin.event===source)?source:'';
 const items=available.filter(item=>!filter||item.origin.event===filter);
 return <section className="panel shelf-panel">
  <div className="panel-title"><div><h2>Долгий ящик</h2><p>{admin&&!onlyMine?'Все песни, когда-либо отправленные сюда':'Песни, на которые вы были записаны'}</p></div><span className="count-badge">{items.length}</span></div>
  <div className="shelf-filters"><label>Исходная встреча<select aria-label="Фильтр по исходной встрече" value={filter} onChange={event=>setSource(event.target.value)}><option value="">Все встречи</option>{sources.map(origin=><option key={origin.event} value={origin.event}>{origin.title} · {meetingDate(origin.date)} · {origin.time}</option>)}</select></label>{admin&&<label className="checkbox-label"><input type="checkbox" checked={onlyMine} onChange={event=>{setOnlyMine(event.target.checked);setSource('');}}/>Только мои</label>}</div>
  {items.length?items.map(({event,song,entry,origin})=>{
   const waiting=!!song.shelvedAt&&!song.shelfReturn&&entry.at===song.shelvedAt;
   return <article className="shelf-song" key={event.id+song.id}><div className="shelf-song-info"><h3>{song.title}</h3><p>{song.artist}</p><small>Впервые предложена для: {origin.title} · {meetingDate(origin.date)} · {origin.time}</small>{origin.proposedAt&&<small>Добавлена {timestamp(origin.proposedAt)}</small>}<small>{entry.returned?`Возвращена в «${entry.returned.title}»${entry.returned.date?' · '+meetingDate(entry.returned.date)+' · '+entry.returned.time:''}`:waiting?'В долгом ящике · '+(entry.reason==='unplayed'?'Не сыграна':'Вне программы'):song.played===true?'Сыграна':'В истории долгого ящика'}</small></div>{admin&&waiting&&<button className="secondary" disabled={busy} onClick={()=>onRestore(event,song)}><RotateCcw size={15}/>Вернуть во встречу</button>}</article>;
  }):<div className="shelf-empty"><Inbox size={26}/><h3>{filter||onlyMine?'По этому фильтру песен нет':'Здесь пока нет песен'}</h3><p>{admin?'Здесь сохраняется история песен, отправленных в долгий ящик.':me?'Здесь появятся песни из долгого ящика, на которые вы были записаны.':'Войдите, чтобы увидеть свои песни из долгого ящика.'}</p></div>}
 </section>;
}

export function RestoreShelvedDialog({state,source,song,busy,onClose,onSubmit}:{state:State;source:JamEvent;song:Song;busy:boolean;onClose:()=>void;onSubmit:(target:string)=>Promise<unknown>}){
 const choices=shelfDestinations(state,source.id),[target,setTarget]=useState('');
 async function submit(event:FormEvent){event.preventDefault();if(target)await onSubmit(target);}
 return <div className="overlay modal-overlay" onMouseDown={event=>event.target===event.currentTarget&&!busy&&onClose()}><section className="modal shelf-restore-modal" role="dialog" aria-modal="true" aria-labelledby="restore-shelf-title"><button className="close-btn icon-btn" aria-label="Закрыть выбор встречи" disabled={busy} onClick={onClose}><X size={20}/></button><span className="eyebrow">Долгий ящик</span><h2 id="restore-shelf-title">Вернуть во встречу</h2><p className="hint">{song.title} · {song.artist}</p>{choices.length?<form onSubmit={submit}><label>Выберите встречу<select aria-label="Куда вернуть песню" value={target} disabled={busy} onChange={event=>setTarget(event.target.value)} required autoFocus><option value="" disabled>Выберите встречу</option>{choices.map(event=><option key={event.id} value={event.id}>{event.title} · {meetingDate(event.date)} · {event.time}{event.demo?' · демо':''}</option>)}</select></label><p className="hint">В другую встречу переносятся песня и партии. Заявки и прежний состав сохраняются в истории исходной встречи.</p><div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="primary" disabled={busy||!choices.some(event=>event.id===target)} type="submit"><RotateCcw size={16}/>{busy?'Переносим…':'Вернуть во встречу'}</button></div></form>:<><p className="hint">Нет доступных черновиков. Создайте встречу или освободите место в одной из них.</p><button className="secondary full" onClick={onClose}>Закрыть</button></>}</section></div>;
}
