import { type State, type JamEvent, type Song, type ApplicationMember, allocationWeight, isVocal, isFlexible, offeredSlots, groupOK, signupAssignments, eventHasStarted, complete } from './model.ts';

export const RECORDING_RULES = 6;
export const songKey = (title:string,artist:string) => [title,artist].map(s=>s.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'')).join('|');
export function previousMeetings(state:State,event:JamEvent){
 return state.events.filter(e=>e.id!==event.id&&!e.deletedAt&&e.demo===event.demo&&e.status==='published'&&eventHasStarted(e)&&`${e.date}T${e.time}`<`${event.date}T${event.time}`).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time)||b.id.localeCompare(a.id)).slice(0,2);
}
export function stopList(state:State,event:JamEvent){
 const rows=new Map<string,{song:Song;event:JamEvent;remaining:number}>();
 previousMeetings(state,event).forEach((e,i)=>{for(const s of e.songs)if(e.program.includes(s.id)&&s.played===true){const key=songKey(s.title,s.artist);if(!rows.has(key))rows.set(key,{song:s,event:e,remaining:2-i});}});
 return [...rows.values()];
}
export function assertSongAllowed(state:State,event:JamEvent,title:string,artist:string){
 const blocked=stopList(state,event).find(x=>songKey(x.song.title,x.song.artist)===songKey(title,artist));
 if(blocked)throw Error(`Песня в стоп-листе: сыграна на встрече «${blocked.event.title}». До повтора осталось пропустить встреч: ${blocked.remaining}.`);
}
export function historicalLoad(state:State,event:JamEvent){
 const result:Record<string,number>={};previousMeetings(state,event).forEach((e,i)=>{for(const s of e.songs)if(e.program.includes(s.id)&&s.played===true)for(const [p,w] of songLoads(s))result[p]=(result[p]||0)+w*(i===0?.5:.25);});return result;
}
export function songLoads(song:Song){const weights=new Map<string,number>();for(const r of song.slots){const p=song.assigned[r.id];if(p)weights.set(p,Math.max(weights.get(p)||0,allocationWeight(r)));}return weights;}
export function mainAssignments(e:JamEvent,s:Song){
 const result:Record<string,string>={};for(const [slot,booking] of Object.entries(s.main||{})){
  const app=booking.application?e.applications.find(a=>a.id===booking.application&&a.song===s.id):undefined;
  if(!s.slots.some(r=>r.id===slot)||booking.application&&!app?.members.some(m=>m.person===booking.person&&m.slot===slot&&m.consent!=='no'))continue;
  result[slot]=booking.person;
 }return result;
}
export function migrateRecordings(e:JamEvent){
 if(e.status!=='draft'||(e.rulesVersion||0)>=RECORDING_RULES)return false;
 for(const s of e.songs){s.main={};const ordered=e.applications.filter(a=>a.song===s.id).map((a,i)=>({a,i})).sort((x,y)=>{const a=Date.parse(x.a.createdAt||''),b=Date.parse(y.a.createdAt||'');return (Number.isFinite(a)?a:0)-(Number.isFinite(b)?b:0)||x.i-y.i;});
  for(const [slot,p] of Object.entries(s.assigned))if(p&&s.pins[slot])s.main[slot]={person:p,by:'',manual:true};
  for(const {a} of ordered)for(const m of a.members){if(m.consent==='no'||isFlexible(m)||!s.slots.some(r=>r.id===m.slot))continue;
   if(!s.main[m.slot])s.main[m.slot]={person:m.person,by:a.by,application:a.id};if(s.main[m.slot].person!==m.person)m.standby=true;
  }
  s.assigned=Object.fromEntries(Object.entries(s.main).map(([slot,b])=>[slot,b.person]));s.pins=Object.fromEntries(Object.keys(s.main).map(slot=>[slot,true]));delete s.reservations;delete s.algorithmAssigned;
 }
 e.rulesVersion=RECORDING_RULES;delete e.allocatedAt;return true;
}
export function syncMain(e:JamEvent){
 let changed=false;for(const s of e.songs){for(const [slot,b] of Object.entries(s.main||{}))if(b.application&&!e.applications.some(a=>a.id===b.application&&a.members.some(m=>m.slot===slot&&m.person===b.person&&m.consent!=='no'))){const support=e.applications.find(a=>a.song===s.id&&a.members.some(m=>m.slot===slot&&m.person===b.person&&m.consent!=='no'));if(support){b.application=support.id;b.by=support.by;}}const valid=mainAssignments(e,s);for(const slot of Object.keys(s.main||{}))if(valid[slot]!==s.main![slot].person){const p=s.main![slot].person;delete s.main![slot];delete s.pins[slot];if(s.assigned[slot]===p)delete s.assigned[slot];changed=true;}
  for(const [slot,p] of Object.entries(valid)){if(s.assigned[slot]!==p||!s.pins[slot])changed=true;s.assigned[slot]=p;s.pins[slot]=true;}
 }return changed;
}
export function registerMains(e:JamEvent,s:Song,application:string){
 const a=e.applications.find(a=>a.id===application)!;for(const m of a.members){if(isFlexible(m)||m.consent==='no')continue;
  const old=s.main?.[m.slot];if(!old&&!m.standby){(s.main||={})[m.slot]={person:m.person,by:a.by,application:a.id};s.assigned[m.slot]=m.person;s.pins[m.slot]=true;}
  m.standby=!!s.main?.[m.slot]&&s.main[m.slot].person!==m.person||!!m.standby;
 }syncMain(e);
}
export function recordingLabel(e:JamEvent,s:Song,m:ApplicationMember){return m.consent==='no'?'Отказ':!isFlexible(m)&&mainAssignments(e,s)[m.slot]===m.person?'Основной':'Резерв';}

type Lineup=Record<string,string>;
const compare=(a:number[],b:number[])=>{for(let i=0;i<Math.max(a.length,b.length);i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)?1:-1;return 0;};
function missing(s:Song,a=s.assigned){return s.slots.filter(r=>r.required&&!a[r.id]);}
// A flexible member is a single offer, never simultaneous coverage of several parts.
export function lineupOptions(state:State,e:JamEvent,s:Song){
 const fixed=mainAssignments(e,s),history=historicalLoad(state,e),all=e.applications.filter(a=>a.song===s.id),seen=new Set<string>(),options:Lineup[]=[];
 const slots=[...s.slots].sort((a,b)=>Number(b.required)-Number(a.required));let visits=0;
 function walk(i:number,chosen:Lineup,used:Set<string>){
  if(++visits>12000)return;if(i===slots.length){if(!groupOK(e,s,chosen))return;const key=JSON.stringify(Object.entries(chosen).sort());if(!seen.has(key)){seen.add(key);options.push({...chosen});}return;}
  const part=slots[i];if(fixed[part.id]){chosen[part.id]=fixed[part.id];walk(i+1,chosen,used);delete chosen[part.id];return;}
  const candidates=all.flatMap(a=>a.members.flatMap((m,j)=>m.consent!=='no'&&offeredSlots(s,m).some(r=>r.id===part.id)?[{a,m,key:a.id+'|'+j}]:[])).sort((a,b)=>(history[a.m.person]||0)-(history[b.m.person]||0)||a.a.priority-b.a.priority);
  const people=new Set<string>();for(const c of candidates){if(people.has(c.m.person)||isFlexible(c.m)&&used.has(c.key))continue;people.add(c.m.person);chosen[part.id]=c.m.person;const next=new Set(used);if(isFlexible(c.m))next.add(c.key);walk(i+1,chosen,next);}
  delete chosen[part.id];walk(i+1,chosen,used);
 }walk(0,{},new Set());
 const score=(a:Lineup)=>{const weights=songLoads({...s,assigned:a});return [-missing(s,a).length,weights.size,-[...weights].reduce((n,[p,w])=>n+w*(history[p]||0),0),Object.keys(a).length,...preferenceScore(e,s,a)];};
 return options.map(a=>({a,rank:score(a)})).sort((a,b)=>-compare(a.rank,b.rank)).slice(0,48).map(x=>x.a);
}
function preferenceScore(e:JamEvent,s:Song,a:Lineup){let stars=0,pref=0;for(const [slot,p] of Object.entries(a)){const candidates=e.applications.filter(app=>app.song===s.id&&app.members.some(m=>m.person===p&&m.consent!=='no'&&offeredSlots(s,m).some(r=>r.id===slot)));stars+=Number(candidates.some(app=>app.members.some(m=>m.person===p&&m.starred)));pref+=Math.max(0,...candidates.map(app=>4-app.priority));}return [stars,pref];}
type Plan={songs:Song[];minutes:number;rank?:number[]};
function planScore(plan:Plan,history:Record<string,number>){if(plan.rank)return plan.rank;const load:Record<string,number>={},core=new Set<string>();let filled=0;for(const s of plan.songs){for(const r of s.slots)if(s.assigned[r.id]&&r.required){core.add(s.assigned[r.id]);filled++;}for(const [p,w] of songLoads(s))load[p]=(load[p]||0)+w;}
 return plan.rank=[core.size,Object.keys(load).length,filled,-Object.values(load).reduce((n,w)=>n+w*w,0),-Object.entries(load).reduce((n,[p,w])=>n+2*w*(history[p]||0),0),plan.songs.length];}
function prune(plans:Plan[],history:Record<string,number>){
 plans.sort((a,b)=>-compare(planScore(a,history),planScore(b,history))||a.minutes-b.minutes);const selected=plans.slice(0,100),times=new Set(selected.map(p=>p.minutes));for(const p of plans)if(!times.has(p.minutes)){selected.push(p);times.add(p.minutes);if(selected.length>=160)break;}return selected;
}
export function allocateRecordings(state:State,e:JamEvent){
 syncMain(e);const history=historicalLoad(state,e),chosen:Song[]=[];for(const s of e.songs){if(s.shelvedAt||s.inclusion==='exclude')continue;const options=lineupOptions(state,e,s);const fixed=mainAssignments(e,s);const score=(a:Lineup)=>[-missing(s,a).length,...planScore({songs:[...chosen,{...s,assigned:a}],minutes:0},history),...preferenceScore(e,s,a)];options.sort((a,b)=>-compare(score(a),score(b)));s.assigned=options[0]||fixed;chosen.push(s);const auto=Object.fromEntries(Object.entries(s.assigned).filter(([slot])=>!fixed[slot]));if(Object.keys(auto).length)s.algorithmAssigned=auto;else delete s.algorithmAssigned;}
 e.program=e.program.filter(id=>e.songs.some(s=>s.id===id&&!s.shelvedAt&&s.inclusion!=='exclude'));e.allocatedAt=new Date().toISOString();delete e.programNotes;
}
export function buildProgram(state:State,e:JamEvent){
 syncMain(e);const history=historicalLoad(state,e),blocked=new Set(stopList(state,e).map(x=>songKey(x.song.title,x.song.artist))),songs=e.songs.filter(s=>!s.shelvedAt&&s.inclusion!=='exclude'&&!blocked.has(songKey(s.title,s.artist)));
 const options=new Map(songs.map(s=>[s.id,lineupOptions(state,e,s)]));
 const forced=songs.filter(s=>s.inclusion==='include').map(s=>({...s,assigned:options.get(s.id)?.[0]||mainAssignments(e,s)}));
 let beam:Plan[]=[{songs:forced,minutes:forced.reduce((n,s)=>n+s.duration,0)}];const limit=e.budget-e.breakMins;
 for(const tier of [0,1]){
  for(const s of songs.filter(s=>s.inclusion!=='include')){
   const variants=(options.get(s.id)||[]).filter(a=>missing(s,a).length===tier).slice(0,20);if(!variants.length)continue;
   const next=[...beam];for(const plan of beam){if(plan.songs.some(x=>x.id===s.id)||plan.minutes+s.duration>limit)continue;
    for(const a of variants){const candidate={...s,assigned:a},trial={songs:[...plan.songs,candidate],minutes:plan.minutes+s.duration};const vocals:Record<string,number>={};for(const song of trial.songs)for(const p of new Set(song.slots.filter(isVocal).map(r=>song.assigned[r.id]).filter(Boolean)))vocals[p]=(vocals[p]||0)+1;
     if(state.people.some(p=>(vocals[p.id]||0)>p.max))continue;next.push(trial);}
   }beam=prune(next,history);
  }
  // Ready songs are chosen first; the second tier fills the remaining time.
  beam=[beam.sort((a,b)=>-compare(planScore(a,history),planScore(b,history))||a.minutes-b.minutes)[0]];
 }
 const chosen=beam[0].songs;e.program=chosen.map(s=>s.id);e.programNotes={};const covered=new Set<string>();
 for(const original of e.songs){const pick=chosen.find(s=>s.id===original.id),a=pick?.assigned||options.get(original.id)?.[0]||mainAssignments(e,original);original.assigned=a;const fixed=mainAssignments(e,original),auto=Object.fromEntries(Object.entries(a).filter(([slot])=>!fixed[slot]));if(Object.keys(auto).length)original.algorithmAssigned=auto;else delete original.algorithmAssigned;
  if(pick){const people=[...songLoads(pick).keys()],added=people.filter(p=>!covered.has(p)).length;people.forEach(p=>covered.add(p));e.programNotes[original.id]=`${complete(pick)?'Состав собран':'Почти собрана: нужна '+missing(pick).map(r=>r.label).join(', ')} · Добавляет участников: ${added}. Учтены нагрузка сейчас и две прошлые встречи.`;}
 }
 e.allocatedAt=new Date().toISOString();
}
export function programAdvice(state:State,e:JamEvent){
 const selected=e.songs.filter(s=>e.program.includes(s.id)),covered=new Set(selected.flatMap(s=>[...songLoads(s).keys()])),history=historicalLoad(state,e),blocked=new Set(stopList(state,e).map(x=>songKey(x.song.title,x.song.artist))),time=selected.reduce((n,s)=>n+s.duration,0)+(selected.length?e.breakMins:0);
 return e.songs.filter(s=>!s.shelvedAt&&!e.program.includes(s.id)).map(s=>{
  const need=missing(s),people=[...songLoads(s).keys()],added=people.filter(p=>!covered.has(p)).length,over=Math.max(0,time+s.duration+(selected.length?0:e.breakMins)-e.budget),stop=blocked.has(songKey(s.title,s.artist));
  const replacements=selected.filter(x=>x.inclusion!=='include'&&time-x.duration+s.duration<=e.budget).map(x=>{const others=new Set(selected.filter(y=>y.id!==x.id).flatMap(y=>[...songLoads(y).keys()]));people.forEach(p=>others.add(p));return {song:x,gain:others.size-covered.size,lost:[...songLoads(x).keys()].filter(p=>!others.has(p)).length,load:[...songLoads(x).keys()].reduce((n,p)=>n+selected.filter(y=>Object.values(y.assigned).includes(p)).length+(history[p]||0)/20,0)};}).filter(x=>x.gain>0&&x.lost===0).sort((a,b)=>b.gain-a.gain||b.load-a.load);
  return {song:s,missing:need.map(r=>r.label),added,over,blocked:stop,replace:over?replacements[0]?.song:undefined,reason:stop?'Песня в стоп-листе последних двух встреч':need.length>1?'Не хватает обязательных партий: '+need.map(r=>r.label).join(', '):`${need.length?'Почти собрана: нужна '+need[0].label:'Состав собран'} · Участников без выступлений: ${added}${over?' · Не хватает '+over+' мин':' · Помещается по времени'}`};
 }).sort((a,b)=>b.added-a.added||a.missing.length-b.missing.length);
}
