import { RECORDING_RULES, migrateRecordings, syncMain, mainAssignments, registerMains, assertSongAllowed, buildProgram, allocateRecordings, stopList, songKey } from './program.ts';
export const ROLES = ['Вокал','Ритм-гитара','Соло-гитара','Бас-гитара','Барабаны','Клавиши','Бэк-вокал'];
export const ADMIN_LIMIT = 12;
export const VOCAL_STARS = 3;
// Verified existing organizer accounts; nicknames may change without granting rights.
export const PROGRAM_APPROVERS = ['local_f74b4705-a761-4e22-88d4-58b84f2b0166','local_dc9bedcb-9b62-4b14-b85d-adc47b7af762'] as const;
export function canManageAdmins(state:State,actor:string){return state.admins.includes(actor)&&PROGRAM_APPROVERS.some(id=>id===actor);}
export function canApproveProgram(state:State,actor:string){return state.admins.includes(actor)&&PROGRAM_APPROVERS.some(id=>id===actor);}
export const DEFAULT_SLOTS = ['Вокал','Ритм-гитара','Соло-гитара','Бас-гитара','Барабаны'].map(label=>({label,required:true})).concat([{label:'Вокал (дуэт)',required:false}]);
export type Person = {id:string;name:string;roles:string[];max:number;auth?:string;demo?:boolean;nickname?:string;nicknameSource?:'suggested'|'custom';unlinkedBy?:string;deletedAt?:string};
export type Slot = {id:string;label:string;required:boolean;primary?:boolean};
export type SongComment = {id:string;by:string;body:string;createdAt:string;readiness?:{application:string;person:string}};
export type Song = {id:string;title:string;artist:string;duration:number;slots:Slot[];assigned:Record<string,string>;main?:Record<string,{person:string;by:string;application?:string;manual?:boolean}>;pins:Record<string,boolean>;algorithmAssigned?:Record<string,string>;inclusion:'auto'|'include'|'exclude';comments?:SongComment[];proposedBy?:string;proposedAt?:string;origin?:SongOrigin;shelfHistory?:ShelfHistory[];reservations?:Record<string,{application:string;person:string}>;shelvedAt?:string;shelvedBy?:string;shelfReason?:'unselected'|'unplayed';played?:boolean;shelfReturn?:{event:string;song:string}};
export type ApplicationMember = {person:string;slot:string;alternatives?:string[];consent:'yes'|'pending'|'no';starred?:boolean;standby?:boolean};
export type Application = {id:string;song:string;by:string;priority:number;together:'hard'|'soft';createdAt?:string;members:ApplicationMember[]};
export type JamEvent = {id:string;title:string;date:string;time:string;venue:string;image?:string|null;budget:number;breakMins:number;status:'draft'|'published';demo:boolean;songs:Song[];applications:Application[];program:string[];publishedAt?:string;rulesVersion?:number;deletedAt?:string;allocatedAt?:string;programNotes?:Record<string,string>};
export type State = {people:Person[];events:JamEvent[];admins:string[];log:{at:string;text:string}[]};
export type Action = {type:string;event?:string;[key:string]:any};

export type SongOrigin={event:string;song:string;title:string;date:string;time:string;proposedAt?:string};
export type ShelfHistory={at:string;by?:string;reason:'unselected'|'unplayed';members:string[];returned?:{at?:string;event:string;song:string;title:string;date:string;time:string}};

export function songOrigin(event:JamEvent,song:Song):SongOrigin{
 return song.origin||{event:event.id,song:song.id,title:event.title,date:event.date,time:event.time,...(song.proposedAt?{proposedAt:song.proposedAt}:{})};
}
export function shelfMembers(event:JamEvent,song:Song){
 return [...new Set([...Object.values(song.assigned),...event.applications.filter(a=>a.song===song.id).flatMap(a=>a.members.filter(m=>m.consent!=='no').map(m=>m.person))].filter(Boolean))];
}
export function ensureShelfHistory(state:State){
 let changed=false;
 for(const event of state.events)for(const song of event.songs){
  if(!song.shelvedAt)continue;
  if(!song.origin){song.origin=songOrigin(event,song);changed=true;}
  const returnedEvent=song.shelfReturn&&state.events.find(e=>e.id===song.shelfReturn!.event),returnedSong=returnedEvent?.songs.find(s=>s.id===song.shelfReturn!.song);
  if(returnedSong&&!returnedSong.origin){returnedSong.origin=structuredClone(song.origin);changed=true;}
  if(!song.shelfHistory?.some(entry=>entry.at===song.shelvedAt)){
   const target=song.shelfReturn&&state.events.find(e=>e.id===song.shelfReturn!.event);
   const entry:ShelfHistory={at:song.shelvedAt,by:song.shelvedBy,reason:song.shelfReason||'unselected',members:shelfMembers(event,song)};
   if(song.shelfReturn)entry.returned={event:song.shelfReturn.event,song:song.shelfReturn.song,title:target?.title||'Встреча удалена',date:target?.date||'',time:target?.time||''};
   (song.shelfHistory||=[]).push(entry);changed=true;
  }
 }
 return changed;
}
export function shelfSongs(state:State,person='',all=false,source=''){
 return state.events.flatMap(event=>event.songs.flatMap(song=>{
  const entries=(song.shelfHistory||[]).filter(entry=>all||!!person&&entry.members.includes(person));
  const entry=entries.at(-1),origin=songOrigin(event,song);
  return entry&&(!source||origin.event===source)?[{event,song,entry,origin}]:[];
 })).sort((a,b)=>b.entry.at.localeCompare(a.entry.at));
}
export function shelfDestinations(state:State,source:string){
 return state.events.filter(event=>!event.deletedAt&&event.status==='draft'&&(event.id===source||event.songs.length<60)).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.title.localeCompare(b.title,'ru'));
}

export const uid = () => { if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128; const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20); };
export const DELETED_PERSON_PREFIX='__deleted_person__';
export function directoryPeople(state:Pick<State,'people'>,demo=false){return state.people.filter(p=>!p.deletedAt&&(demo||!p.demo));}
export function isBackingVocal(slot:Pick<Slot,'label'>){return /бэк|бек|back/i.test(slot.label)&&/вокал|vocal/i.test(slot.label);}
export function musicianAppearances(e:JamEvent){const result:Record<string,number>={};for(const song of e.songs.filter(s=>!s.shelvedAt&&s.inclusion!=='exclude'&&(e.status!=='published'||e.program.includes(s.id))))for(const person of new Set(song.slots.filter(r=>!isBackingVocal(r)&&song.assigned[r.id]).map(r=>song.assigned[r.id])))result[person]=(result[person]||0)+1;return result;}
export function hasJamApplication(e:JamEvent,person:string){return e.applications.some(a=>a.members.some(m=>m.person===person&&m.consent!=='no'));}
export function filterMusicians(people:Person[],appearances:Record<string,number>,query=''){const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е'),words=normalize(query).trim().split(/\s+/).map(w=>w.replace(/^@/,'')).filter(Boolean);return people.filter(p=>words.every(w=>normalize(p.name+' '+(p.nickname||'')).includes(w))).sort((a,b)=>(appearances[b.id]||0)-(appearances[a.id]||0)||a.name.localeCompare(b.name,'ru-RU',{sensitivity:'base',numeric:true}));}
export function isRegistered(p:Person){return !!p.auth&&!p.demo&&!p.deletedAt&&!['demo','__unclaimed_admin__'].includes(p.auth);}
export function normalizeNickname(value:string){return value.normalize('NFKC').trim().replace(/^@/,'').toLowerCase();}
const NICKNAME_LETTERS:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',і:'i',ї:'yi',є:'ye',ґ:'g',ß:'ss',æ:'ae',œ:'oe',ø:'o',ł:'l'};
export function suggestNickname(name:string,people:Pick<Person,'id'|'nickname'>[],excludeId?:string){
 const roman=Array.from(name.normalize('NFKC').toLowerCase()).map(c=>NICKNAME_LETTERS[c]??c).join('').normalize('NFKD').replace(/\p{M}/gu,'');
 let base=roman.replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,32).replace(/_+$/,'')||'musician';if(base.length<3)base+='_jam';
 const used=new Set(people.filter(p=>p.id!==excludeId&&p.nickname).map(p=>normalizeNickname(p.nickname!)));let nickname=base,n=2;while(used.has(nickname)){const suffix='_'+n++;nickname=base.slice(0,32-suffix.length).replace(/_+$/,'')+suffix;}return nickname;
}
export function validateNickname(value:unknown,people:Pick<Person,'id'|'nickname'>[],excludeId?:string){
 if(typeof value!=='string')throw Error('Укажите ник');const nickname=normalizeNickname(value);if(!/^[a-z0-9_]{3,32}$/.test(nickname))throw Error('Ник: 3–32 латинские буквы, цифры или знак подчёркивания');
 if(people.some(p=>p.id!==excludeId&&p.nickname&&normalizeNickname(p.nickname)===nickname))throw Error('Этот ник уже занят');return nickname;
}
export function ensureNicknames(state:State){let changed=false;for(const p of state.people){if(!isRegistered(p))continue;const legacy='jam_'+p.auth!.replace(/[^a-z0-9]/gi,'').slice(-10).toLowerCase(),nickname=p.nickname?normalizeNickname(p.nickname):'',legacyAuto=!p.nicknameSource&&(nickname===legacy||nickname.startsWith(legacy+'_')&&/^\d+$/.test(nickname.slice(legacy.length+1)));if(p.nickname&&!legacyAuto)continue;p.nickname=suggestNickname(p.name,state.people,p.id);p.nicknameSource='suggested';changed=true;}return changed;}

export const DEFAULT_EVENT_IMAGE='/berliner-jam-poster.jpg';
export function uploadedImageId(value:unknown){return typeof value==='string'?/^\/api\/event-image\?id=([a-f0-9-]{36})$/.exec(value)?.[1]||null:null;}
export function eventImageUrl(e:Pick<JamEvent,'image'>){return e.image===undefined?DEFAULT_EVENT_IMAGE:e.image;}
export function validateEventImage(value:unknown){if(value===null)return null;if(value===DEFAULT_EVENT_IMAGE||uploadedImageId(value))return value as string;throw Error('Выберите загруженную картинку встречи');}
export function eventHasStarted(e:Pick<JamEvent,'date'|'time'>,now=new Date()){
 const parts=new Intl.DateTimeFormat('en',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),part=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${e.date}T${e.time}`<=`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function visibleState(state:State,admin:boolean,person=''){
 if(admin)return state;const result=structuredClone(state);ensureShelfHistory(result);
 for(const e of result.events){
  for(const s of e.songs)if(s.shelfHistory){
   s.shelfHistory=s.shelfHistory.filter(entry=>!!person&&entry.members.includes(person)).map(entry=>({...entry,members:[person],by:undefined}));
   if(!s.shelfHistory.length){delete s.origin;delete s.shelfReturn;}
  }
  if(e.status==='draft'){for(const s of e.songs){s.assigned=signupAssignments(e,s);delete s.algorithmAssigned;s.pins={};delete s.reservations;}e.program=[];delete e.allocatedAt;delete e.programNotes;}
 }return result;
}
// Rebuild bookings from the surviving applications, never from optimizer output.
// Moderator pins stay in place; preferences, stars, comments and consent are untouched.
export function resetAllocation(e:JamEvent){
 if((e.rulesVersion||0)>=RECORDING_RULES){for(const s of e.songs){s.assigned=mainAssignments(e,s);delete s.algorithmAssigned;}delete e.allocatedAt;delete e.programNotes;return;}
 for(const s of e.songs){const bookings=signupAssignments(e,s);s.assigned=Object.fromEntries(Object.entries(s.assigned).filter(([slot])=>s.pins[slot]));delete s.reservations;delete s.algorithmAssigned;
  for(const [slot,person] of Object.entries(bookings))if(!s.pins[slot])s.assigned[slot]=person;
 }
 syncReservations(e);delete e.allocatedAt;
}
export function seed(owner='demo', name='Вы'): State {
 const people:Person[] = [['p1','Аня Волкова',['Вокал']],['p2','Борис Левин',['Гитара','Бас']],['p3','Маша Белова',['Вокал','Бэк-вокал']],['p4','Артём Соколов',['Барабаны']],['p5','Лена Морозова',['Бас']],['p6','Дима Орлов',['Гитара']],['p7','Саша Ким',['Клавиши']],['p8','Ира Смирнова',['Вокал']],['p9','Юра Петров',['Барабаны']],['p10','Оля Новикова',['Гитара']],['p11','Костя Лебедев',['Бас']],['p12','Таня Миронова',['Вокал','Клавиши']]].map(([id,name,roles])=>({id:id as string,name:name as string,roles:roles as string[],max:5,demo:true}));
 people.push({id:'p13',name:'Максим Громов',roles:['Соло-гитара'],max:12,demo:true});
 people.push({id:owner,name,roles:['Ритм-гитара'],max:5,auth:owner});
 const data=[['Creep','Radiohead'],['Я то, что надо','Браво'],['Zombie','The Cranberries'],['Highway to Hell','AC/DC'],['Мой рок-н-ролл','Би-2'],['Wake Me Up When September Ends','Green Day'],['Почему','Земфира'],['Салют, Вера','Валерий Меладзе'],['Come as You Are','Nirvana'],['Paparazzi','Lady Gaga'],['Земля','Маша и Медведи'],['Enter Sandman','Metallica']];
 const songs:Song[]=data.map(([title,artist],i)=>({id:`s${i+1}`,title,artist,duration:i===11?9:7,slots:[...['Вокал','Ритм-гитара','Бас-гитара','Барабаны'].map((label,j)=>({id:`r${j}`,label,required:true})),{id:'lead',label:'Соло-гитара',required:true},{id:'duet',label:'Вокал (дуэт)',required:false}],assigned:{},pins:{},inclusion:'auto'}));
 const applications:Application[]=[];
 const lineups=[['p1','p2','p5','p4'],['p3','p6','p11','p9'],['p8','p10','p5','p4'],['p1','p6','p2','p9'],['p3','p2','p11','p4'],['p8','p10','p5','p9'],['p12','p6','p11','p4'],['p1','p2','p5','p9'],['p3','p6','p11','p4'],['p12','p10','p5',''],['p8','p2','','p9'],['p1','p6','','']];
 lineups.forEach((ps,i)=>ps.forEach((p,j)=>{if(p)applications.push({id:`a${i}-${j}`,song:songs[i].id,by:p,priority:i<3?1:2,together:'soft',members:[{person:p,slot:`r${j}`,consent:'yes'}]})}));
 songs.slice(0,9).forEach(s=>applications.push({id:'lead-'+s.id,song:s.id,by:'p13',priority:2,together:'soft',members:[{person:'p13',slot:'lead',consent:'yes'}]}));
 // A confirmed duo and competing applications make the demo useful for moderation.
 applications.splice(applications.findIndex(a=>a.id==='a0-0'),2,{id:'duo',song:'s1',by:'p1',priority:1,together:'hard',members:[{person:'p1',slot:'r0',consent:'yes'},{person:'p2',slot:'r1',consent:'yes'}]});
 applications.push({id:'alt1',song:'s1',by:'p10',priority:1,together:'soft',members:[{person:'p10',slot:'r1',consent:'yes'}]},{id:'alt2',song:'s9',by:owner,priority:2,together:'soft',members:[{person:owner,slot:'r1',consent:'yes'}]});
 const event:JamEvent={id:'demo-event',title:'Осенний джем',date:'2026-11-20',time:'17:00',venue:'Берлин · площадка уточняется',budget:120,breakMins:15,status:'draft',demo:true,songs,applications,program:[],rulesVersion:3};
 const state={people,events:[event],admins:[owner],log:[]}; retainDraftSongs(state);optimize(state,event);return state;
}
export function applicants(e:JamEvent,song:string,slot:string) {
 return e.applications.flatMap(a=>a.song===song&&(!a.members.some(m=>(e.rulesVersion||0)>=RECORDING_RULES?m.consent==='no':m.consent!=='yes')||a.together!=='hard')?a.members.filter(m=>m.slot===slot&&((e.rulesVersion||0)>=RECORDING_RULES?m.consent!=='no':m.consent==='yes')).map(m=>({...m,application:a})):[]);
}
export function isFlexible(m:Pick<ApplicationMember,'slot'>){return m.slot==='__any'||m.slot==='__choice';}
export function offeredSlots(s:Song,m:Pick<ApplicationMember,'slot'|'alternatives'>){return s.slots.filter(r=>m.slot==='__any'||(m.slot==='__choice'?(m.alternatives||[]).includes(r.id):r.id===m.slot));}
export function memberPart(s:Song,m:Pick<ApplicationMember,'slot'|'alternatives'>){return m.slot==='__any'?'Любая партия':m.slot==='__choice'?'Одна из: '+offeredSlots(s,m).map(r=>r.label).join(' / '):s.slots.find(r=>r.id===m.slot)?.label||'Партия удалена';}
export function flexibleApplicants(e:JamEvent,s:Song,slot?:string){return e.applications.flatMap(a=>a.song===s.id&&(a.together!=='hard'||a.members.every(m=>(e.rulesVersion||0)>=RECORDING_RULES?m.consent!=='no':m.consent==='yes'))?a.members.filter(m=>isFlexible(m)&&((e.rulesVersion||0)>=RECORDING_RULES?m.consent!=='no':m.consent==='yes')&&(!slot||offeredSlots(s,m).some(r=>r.id===slot))).map(m=>({...m,application:a})):[]);}
export function readinessPeople(e:JamEvent,s:Song,slot:string){return [...new Set([...applicants(e,s.id,slot),...flexibleApplicants(e,s,slot)].map(m=>m.person))];}
export function readiness(e:JamEvent,s:Song,slot:string){return readinessPeople(e,s,slot).length;}
export function isAlgorithmAssignment(e:JamEvent,s:Song,slot:string){return e.status==='draft'&&!!s.assigned[slot]&&!s.pins[slot]&&!s.reservations?.[slot]&&s.algorithmAssigned?.[slot]===s.assigned[slot];}
export function assignmentCandidates(e:JamEvent,s:Song,slot:string){const candidates=[...applicants(e,s.id,slot),...flexibleApplicants(e,s,slot)].sort((a,b)=>Number(isFlexible(a))-Number(isFlexible(b))||a.application.priority-b.application.priority);const unique=new Map<string,typeof candidates[number]&{member:number}>();for(const m of candidates)if(!unique.has(m.person))unique.set(m.person,{...m,member:m.application.members.findIndex(x=>x.person===m.person&&x.slot===m.slot)});return [...unique.values()];}
export const VACANCY_CATEGORIES=[['all','Все свободные партии'],['vocal','Вокал'],['lead_guitar','Соло-гитара'],['rhythm_guitar','Ритм-гитара'],['bass','Бас'],['drums','Барабаны'],['extras','Бэк-вокал и доп. инструменты']] as const;
export type VacancyCategory=typeof VACANCY_CATEGORIES[number][0];
export type SongSort='added'|'title'|'vacancies';
export function vacancyFamily(slot:Slot):Exclude<VacancyCategory,'all'>{if(isVocal(slot))return 'vocal';if(!slot.required)return 'extras';if(/бас|bass/i.test(slot.label))return 'bass';if(/гитар|guitar/i.test(slot.label))return /соло|solo|lead/i.test(slot.label)?'lead_guitar':'rhythm_guitar';if(/барабан|ударн|drum/i.test(slot.label))return 'drums';return 'extras';}
export function hasVacancy(s:Song,category:VacancyCategory='all'){return s.inclusion!=='exclude'&&s.slots.some(r=>!s.assigned[r.id]&&(category==='all'||vacancyFamily(r)===category));}
export function sortSongs(songs:Song[],order:SongSort){const result=[...songs];if(order==='added')return result;const title=(a:Song,b:Song)=>a.title.localeCompare(b.title,'ru-RU',{sensitivity:'base',numeric:true});return result.sort((a,b)=>order==='title'?title(a,b):b.slots.filter(r=>!b.assigned[r.id]).length-a.slots.filter(r=>!a.assigned[r.id]).length||title(a,b));}
export function slotAvailability(e:JamEvent,s:Song,slot:string){return s.assigned[slot]?'occupied':readiness(e,s,slot)?'tentative':'free';}
export function applicationsFor(e:JamEvent,person:string,membersOnly=false){return e.applications.filter(a=>(!membersOnly&&a.by===person)||a.members.some(m=>m.person===person)).sort((a,b)=>Number(b.members.some(m=>m.person===person&&m.consent==='pending'))-Number(a.members.some(m=>m.person===person&&m.consent==='pending')));}
// Signup availability is independent of the moderator's unpublished draft.
// Several confirmed people offering the same part remain grey candidates.
export function signupAssignments(e:JamEvent,s:Song){if((e.rulesVersion||0)>=RECORDING_RULES)return mainAssignments(e,s);const assigned:Record<string,string>={};for(const slot of s.slots){const confirmed=[...new Set(applicants(e,s.id,slot.id).map(m=>m.person))];if(confirmed.length===1)assigned[slot.id]=confirmed[0];else if(!confirmed.length){const pending=e.applications.filter(a=>a.song===s.id).flatMap(a=>a.members.filter(m=>m.slot===slot.id&&shouldHold(a,m)));if(pending.length)assigned[slot.id]=pending[0].person;}}return assigned;}
export function signupSong(e:JamEvent,s:Song):Song{return e.status==='published'?s:{...s,assigned:signupAssignments(e,s),pins:{},algorithmAssigned:undefined,reservations:undefined};}
export function memberSelected(s:Song,m:ApplicationMember){return m.consent!=='no'&&offeredSlots(s,m).some(r=>s.assigned[r.id]===m.person);}
export function isSelectedForProgram(e:JamEvent,a:Application,person:string){const s=e.songs.find(s=>s.id===a.song);return e.status==='published'&&!!s&&e.program.includes(s.id)&&a.members.some(m=>m.person===person&&memberSelected(s,m));}
export function personalApplicationGroups(e:JamEvent,person:string,membersOnly=false){const all=applicationsFor(e,person,membersOnly);return e.status==='published'?{selected:all.filter(a=>isSelectedForProgram(e,a,person)),unselected:all.filter(a=>!isSelectedForProgram(e,a,person))}:{selected:all,unselected:[]};}
export function musicianStats(e:JamEvent,person:string){const counted=e.status==='draft'?{...e,program:e.songs.filter(s=>!s.shelvedAt&&s.inclusion!=='exclude').map(s=>s.id)}:e;return {performances:musicianAppearances(counted)[person]||0,vocals:vocalCounts(counted)[person]||0};}
export function assignmentNote(state:State,e:JamEvent,s:Song,slot:string){if((e.rulesVersion||0)>=RECORDING_RULES)return '';const person=s.assigned[slot];if(!person)return '';if(state.people.find(p=>p.id===person)?.unlinkedBy)return 'Записан по имени, без связи с аккаунтом';return !applicants(e,s.id,slot).some(m=>m.person===person)&&e.applications.some(a=>a.song===s.id&&a.members.some(m=>m.person===person&&m.slot===slot&&m.consent==='pending'))?'Ждём подтверждения':'';}
function heldPart(s:Song,slot:string){return !!s.assigned[slot]&&(!!s.main?.[slot]||!!s.pins[slot]||!!s.reservations?.[slot]);}
function shouldHold(a:Application,m:ApplicationMember){return !isFlexible(m)&&m.consent!=='no'&&!(a.together==='hard'&&a.members.some(x=>x.consent==='no'))&&(m.consent==='pending'||a.together==='hard'&&a.members.some(x=>x.consent==='pending'));}
// A provisional booking occupies a part without pretending that consent exists.
export function syncReservations(e:JamEvent){if(e.status!=='draft')return false;if((e.rulesVersion||0)>=RECORDING_RULES)return syncMain(e);let changed=false;
 for(const s of e.songs){
  for(const [slot,r] of Object.entries(s.reservations||{})){const a=e.applications.find(a=>a.id===r.application&&a.song===s.id),m=a?.members.find(m=>m.slot===slot&&m.person===r.person);
   if(a&&m&&shouldHold(a,m)&&s.assigned[slot]===r.person&&!s.pins[slot]&&!applicants(e,s.id,slot).some(x=>x.person===r.person))continue;
   delete s.reservations![slot];changed=true;
   const declined=!a||!m||m.consent==='no'||a.together==='hard'&&a.members.some(x=>x.consent==='no');
   if(declined&&s.assigned[slot]===r.person&&!s.pins[slot]&&!applicants(e,s.id,slot).some(m=>m.person===r.person))delete s.assigned[slot];
  }
  for(const a of e.applications.filter(a=>a.song===s.id))for(const m of a.members){if(!shouldHold(a,m)||!s.slots.some(r=>r.id===m.slot)||s.pins[m.slot]||s.assigned[m.slot]&&s.assigned[m.slot]!==m.person||s.reservations?.[m.slot]||applicants(e,s.id,m.slot).some(x=>x.person===m.person))continue;
   s.assigned[m.slot]=m.person;(s.reservations||={})[m.slot]={application:a.id,person:m.person};changed=true;
  }
 }return changed;
}
function releaseApplicationParts(e:JamEvent,a:Application){if((e.rulesVersion||0)>=RECORDING_RULES){syncMain(e);return;}if(e.status!=='draft')return;const s=e.songs.find(s=>s.id===a.song);if(!s)return;for(const m of a.members)if(!isFlexible(m)&&s.assigned[m.slot]===m.person&&!s.pins[m.slot]&&!applicants(e,s.id,m.slot).some(x=>x.person===m.person)){delete s.assigned[m.slot];if(s.algorithmAssigned)delete s.algorithmAssigned[m.slot];}}
function syncReadinessComments(state:State,e:JamEvent,a:Application){
 const song=e.songs.find(s=>s.id===a.song);if(!song)return false;let changed=false;const offers=a.members.filter(m=>isFlexible(m)&&m.consent!=='no');
 const kept=(song.comments||[]).filter(c=>!c.readiness||c.readiness.application!==a.id||offers.some(m=>m.person===c.readiness!.person));if(kept.length!==(song.comments?.length||0)){song.comments=kept;changed=true;}
 for(const m of offers){const body=`${state.people.find(p=>p.id===m.person)?.name||'Музыкант'} готов сыграть ${m.slot==='__any'?'любую партию':'несколько партий'}`,previous=song.comments?.find(c=>c.readiness?.application===a.id&&c.readiness.person===m.person);
  if(previous){if(previous.body!==body){previous.body=body;changed=true;}}
  else{(song.comments||=[]).push({id:uid(),by:a.by,body,createdAt:a.createdAt||new Date().toISOString(),readiness:{application:a.id,person:m.person}});changed=true;}
 }return changed;
}
function removePersonFromDraft(state:State,event:JamEvent,person:string){let changed=false;
 for(const a of [...event.applications])if(a.members.some(m=>m.person===person)){a.members=a.members.filter(m=>m.person!==person);if(!a.members.length)event.applications=event.applications.filter(x=>x.id!==a.id);syncReadinessComments(state,event,a);changed=true;}
 for(const song of event.songs)for(const [slot,id] of Object.entries(song.assigned))if(id===person){delete song.assigned[slot];delete song.pins[slot];if(song.main)delete song.main[slot];if(song.algorithmAssigned)delete song.algorithmAssigned[slot];if(song.reservations)delete song.reservations[slot];changed=true;}
 return changed;
}
export function firstCreatorComment(s:Song,e:JamEvent){const by=s.proposedBy||e.applications.find(a=>a.song===s.id)?.by;return s.comments?.find(c=>c.by===by);}
export function reviewIssues(state:State,e:JamEvent){
 const issues=warnings(state,e).map((w,i)=>({...w,id:'warning-'+i}));const names=(id:string)=>state.people.find(p=>p.id===id)?.name||id,assigned=counts(e);
 const interested=new Set(e.applications.flatMap(a=>a.members.filter(m=>m.consent==='yes').map(m=>m.person)));
 if(e.allocatedAt)for(const person of interested)if(!assigned[person])issues.push({id:'no-show-'+person,text:`${names(person)}: пока нет выступлений`,kind:'no-show'});
 for(const a of e.applications){const s=e.songs.find(s=>s.id===a.song);if(!s||s.inclusion==='exclude')continue;
  for(const person of new Set(a.members.filter(m=>(e.rulesVersion||0)<RECORDING_RULES&&m.consent==='pending').map(m=>m.person)))issues.push({id:`pending-${a.id}-${person}`,song:s.id,kind:'pending',text:state.people.find(p=>p.id===person)?.unlinkedBy?`«${s.title}»: согласовать запись по имени ${names(person)}`:`«${s.title}»: ждём подтверждения ${names(person)}`});
  if(a.together==='hard'&&a.members.some(m=>m.consent==='no'))issues.push({id:'declined-'+a.id,song:s.id,kind:'declined',text:`«${s.title}»: участник отказался от совместной заявки`});
  a.members.forEach((m,i)=>{if(isFlexible(m)&&m.consent!=='no'&&!memberSelected(s,m))issues.push({id:`flexible-${a.id}-${i}`,song:s.id,kind:'flexible',text:`«${s.title}»: выбрать партию для ${names(m.person)} (${memberPart(s,m)})`});});
 }return issues;
}
export function isPrimary(slot:Slot){return slot.required;}
export function isVocal(slot:Pick<Slot,'label'>){const label=slot.label.toLocaleLowerCase('ru-RU').replace(/ё/g,'е');return /вокал|vocal/.test(label)&&!/(бэк|бек|back|бэки)/.test(label);}
export function isElectric(slot:Slot){return slot.required&&/гитар|guitar/i.test(slot.label)&&!/бас|bass|акуст|acoustic/i.test(slot.label);}
// Integer units avoid floating-point tie errors; divide by 20 for display.
export function allocationWeight(slot:Slot){const label=slot.label.toLocaleLowerCase('ru-RU');if(/бэк|бек|back/i.test(label)&&/вокал|vocal/i.test(label))return 1;if(isVocal(slot))return 40;if(!slot.required)return 4;if(/бас|bass|барабан|ударн|drum/i.test(label))return 10;return 20;}
export function vocalCounts(e:JamEvent){const result:Record<string,number>={};for(const s of e.songs.filter(s=>e.program.includes(s.id)))for(const p of new Set(s.slots.filter(isVocal).map(r=>s.assigned[r.id]).filter(Boolean)))result[p]=(result[p]||0)+1;return result;}
export function starredSongs(e:JamEvent,person:string){return new Set(e.applications.filter(a=>a.members.some(m=>m.person===person&&m.starred&&m.consent!=='no'&&e.songs.some(s=>s.id===a.song&&offeredSlots(s,m).some(isVocal)))).map(a=>a.song));}

export function participation(e:JamEvent){const all=counts(e),core:Record<string,number>={},extra:Record<string,number>={};for(const s of e.songs.filter(s=>e.program.includes(s.id))){const main=new Set(s.slots.filter(r=>isPrimary(r)&&s.assigned[r.id]).map(r=>s.assigned[r.id]));main.forEach(p=>core[p]=(core[p]||0)+1);new Set(s.slots.filter(r=>!isPrimary(r)&&s.assigned[r.id]).map(r=>s.assigned[r.id])).forEach(p=>{if(!main.has(p))extra[p]=(extra[p]||0)+1;});}return {all,core,extra};}
export function retainDraftSongs(state:State){let changed=ensureNicknames(state);if(ensureShelfHistory(state))changed=true;for(const e of state.events){if(e.status!=='draft'||e.deletedAt)continue;for(const person of new Set([...state.people.filter(p=>p.deletedAt).map(p=>p.id),...e.applications.flatMap(a=>a.members.filter(m=>m.person.startsWith(DELETED_PERSON_PREFIX)).map(m=>m.person)),...e.songs.flatMap(s=>Object.values(s.assigned).filter(id=>id.startsWith(DELETED_PERSON_PREFIX)))]))if(removePersonFromDraft(state,e,person))changed=true;if(syncReservations(e))changed=true;
 if((e.rulesVersion||0)<2){
  for(const s of e.songs){const legacy=s.slots.some(r=>r.label==='Гитара')&&s.slots.some(r=>r.label==='Бас')&&s.slots.some(r=>r.label==='Барабаны')&&s.slots.some(r=>r.label==='Вокал');
   for(const r of s.slots){if(legacy&&r.label==='Гитара')r.label='Ритм-гитара';if(legacy&&r.label==='Бас')r.label='Бас-гитара';}
   if(legacy){if(s.slots.length<10&&!s.slots.some(r=>r.label==='Соло-гитара'))s.slots.push({id:uid(),label:'Соло-гитара',required:true});if(s.slots.length<10&&!s.slots.some(r=>r.label==='Вокал (дуэт)'))s.slots.push({id:uid(),label:'Вокал (дуэт)',required:false});}
  }e.rulesVersion=2;changed=true;
 }if((e.rulesVersion||0)<3){for(const s of e.songs)for(const r of s.slots)delete r.primary;e.rulesVersion=3;changed=true;}if((e.rulesVersion||0)<4){const used=new Map<string,Set<string>>();for(const a of e.applications)for(const m of a.members){if(a.priority!==1||m.consent==='no'||!e.songs.find(s=>s.id===a.song)?.slots.some(r=>r.id===m.slot&&isVocal(r)))continue;const songs=used.get(m.person)||new Set<string>();if(songs.has(a.song)||songs.size<VOCAL_STARS){m.starred=true;songs.add(a.song);used.set(m.person,songs);}}e.rulesVersion=4;changed=true;}if((e.rulesVersion||0)<5){for(const a of e.applications)syncReadinessComments(state,e,a);e.rulesVersion=5;changed=true;}if(migrateRecordings(e))changed=true;const expected=e.songs.filter(s=>!s.shelvedAt&&s.inclusion!=='exclude').map(s=>s.id);const prev=e.program.filter(id=>expected.includes(id));if(prev.join()!==e.program.join()){e.program=prev;changed=true;}}return changed;}
export function complete(s:Song){return s.slots.filter(r=>r.required).every(r=>!!s.assigned[r.id]);}
export function seekingPerformers(s:Song){return hasVacancy(s);}
export function counts(e:JamEvent){const c:Record<string,number>={};e.songs.filter(s=>e.program.includes(s.id)).forEach(s=>new Set(Object.values(s.assigned).filter(Boolean)).forEach(p=>c[p]=(c[p]||0)+1));return c;}
export function duration(e:JamEvent){return e.songs.filter(s=>e.program.includes(s.id)).reduce((n,s)=>n+s.duration,0)+(e.program.length?e.breakMins:0);}
export function groupOK(e:JamEvent,s:Song,assign:Record<string,string>){
 if((e.rulesVersion||0)>=RECORDING_RULES){return Object.entries(assign).filter(([,p])=>p).every(([slot,p])=>{const support=e.applications.filter(a=>a.song===s.id&&a.members.some(m=>m.person===p&&m.consent!=='no'&&offeredSlots(s,m).some(r=>r.id===slot)));return !support.length||support.some(a=>a.together!=='hard'||a.members.every(m=>m.consent!=='no'&&offeredSlots(s,m).some(r=>assign[r.id]===m.person)));});}
 // A musician may offer alternative groups. Every assigned part needs one
 // compatible application, rather than simultaneously satisfying all alternatives.
 return Object.entries(assign).filter(([,p])=>p).every(([slot,p])=>{
  const support=e.applications.filter(a=>a.song===s.id&&a.members.some(m=>m.person===p&&m.slot===slot&&((e.rulesVersion||0)>=RECORDING_RULES?m.consent!=='no':m.consent==='yes')));
  return support.length===0||support.some(a=>a.together==='soft'||a.members.every(m=>m.consent==='yes'&&assign[m.slot]===m.person));
 });
}
export function warnings(state:State,e:JamEvent){const out:{text:string;song?:string;kind:string}[]=[];const c=vocalCounts(e);
 for(const s of e.songs.filter(s=>e.program.includes(s.id))){
  const missing=s.slots.filter(r=>r.required&&!s.assigned[r.id]);if(missing.length)out.push({text:`«${s.title}»: нужны ${missing.map(r=>r.label.toLowerCase()).join(', ')}`,song:s.id,kind:'incomplete'});
  if(!groupOK(e,s,s.assigned))out.push({text:`«${s.title}»: нарушено условие «только вместе»`,song:s.id,kind:'group'});
  for(const [slot,p] of Object.entries(s.assigned))if(p&&!s.main?.[slot]&&!applicants(e,s.id,slot).some(m=>m.person===p)&&!flexibleApplicants(e,s,slot).some(m=>m.person===p))out.push({text:`«${s.title}»: участие ${state.people.find(x=>x.id===p)?.name||p} требует согласования`,song:s.id,kind:'consent'});
 }
 for(const p of state.people)if((c[p.id]||0)>p.max)out.push({text:`${p.name}: ${c[p.id]} вокальных выступлений при максимуме ${p.max}`,kind:'load'});
 if(duration(e)>e.budget)out.push({text:`Программа превышает время на ${duration(e)-e.budget} мин`,kind:'time'});
 return out;
}
// Coverage precedes balancing, wishes and arrival order. Songs, pins and consent
// remain under moderator control. This bounded search is a recommendation,
// not a proof of a global optimum (hard groups make the problem combinatorial).
export function optimize(state:State,e:JamEvent){
 if((e.rulesVersion||0)>=RECORDING_RULES){allocateRecordings(state,e);return;}
 // Clearing a part must not turn its vacancy into a permanent moderator pin.
 for(const s of e.songs)for(const slot of Object.keys(s.pins))if(!s.assigned[slot])delete s.pins[slot];
 syncReservations(e);
 const agreed=e.songs.map(s=>{const bookings=signupAssignments(e,s);return Object.fromEntries(Object.entries(s.assigned).filter(([slot,person])=>!isAlgorithmAssignment(e,s,slot)&&(heldPart(s,slot)||bookings[slot]===person)));});
 type Assignment=Record<string,string>;
 type Meta={weights:Map<string,number>;vocals:Set<string>;electric:Set<string>;core:Set<string>;filled:number;ready:number;stars:number;pref:number;softGroups:number;extraFilled:number;extraPref:number;arrival:number[]};
 const eligible=new Map<string,ReturnType<typeof applicants>>();
 for(const s of e.songs)for(const r of s.slots)eligible.set(s.id+'|'+r.id,applicants(e,s.id,r.id));
 const appOrder=new Map([...e.applications].map((a,i)=>({a,i})).sort((x,y)=>{
  const tx=Date.parse(x.a.createdAt||''),ty=Date.parse(y.a.createdAt||'');
  // Legacy applications preserve their saved insertion order, ahead of new ones.
  if(!Number.isFinite(tx)||!Number.isFinite(ty))return !Number.isFinite(tx)&&!Number.isFinite(ty)?x.i-y.i:!Number.isFinite(tx)?-1:1;
  return tx-ty||x.i-y.i;
 }).map(({a},i)=>[a.id,i]));
 const metadata=new WeakMap<object,Meta>();
 function meta(s:Song,a:Assignment){let cached=metadata.get(a);if(cached)return cached;
  const m:Meta={weights:new Map(),vocals:new Set(),electric:new Set(),core:new Set(),filled:0,ready:complete({...s,assigned:a})?1:0,stars:0,pref:0,softGroups:0,extraFilled:0,extraPref:0,arrival:[]};
  const corePref=new Map<string,number>(),extraPref=new Map<string,number>(),starred=new Set<string>(),arrivals=new Map<string,number>();
  for(const r of s.slots){const p=a[r.id];if(!p)continue;const vocal=isVocal(r),main=r.required||vocal;
   m.weights.set(p,Math.max(m.weights.get(p)||0,allocationWeight(r)));
   if(vocal)m.vocals.add(p);if(isElectric(r))m.electric.add(p);if(main){m.core.add(p);m.filled++;}else m.extraFilled++;
   const apps=(eligible.get(s.id+'|'+r.id)||[]).filter(x=>x.person===p&&(x.application.together==='soft'||x.application.members.every(x=>x.consent==='yes'&&a[x.slot]===x.person)));
   const prefs=main?corePref:extraPref;const value=apps.length?4-Math.min(...apps.map(x=>x.application.priority)):0;prefs.set(p,Math.max(prefs.get(p)||0,value*(vocal?2:1)));
   if(vocal&&apps.some(x=>x.starred))starred.add(p);
   if(apps.length)arrivals.set(p,Math.min(arrivals.get(p)??Infinity,...apps.map(x=>appOrder.get(x.application.id)??e.applications.length)));
  }
  m.stars=starred.size;m.pref=[...corePref.values()].reduce((a,b)=>a+b,0);m.extraPref=[...extraPref.values()].reduce((a,b)=>a+b,0);m.arrival=[...arrivals.values()];
  m.softGroups=new Set(e.applications.filter(g=>g.song===s.id&&g.together==='soft'&&new Set(g.members.map(x=>x.person)).size>1&&g.members.every(x=>x.consent==='yes'&&a[x.slot]===x.person)).map(g=>g.members.map(x=>x.person+'|'+x.slot).sort().join(','))).size;
  metadata.set(a,m);return m;
 }
 // Keep the overall option pool bounded for the Worker's memory budget.
 const optionLimit=Math.min(600,Math.max(60,Math.floor(6000/Math.max(1,e.songs.length))));
 const choices=e.songs.map(s=>{
  if(s.inclusion==='exclude')return [];
  const opts:Assignment[]=[];let visited=0;
  // Scarce and vocal parts come first; retain vacancy options for every part.
  const slots=[...s.slots].sort((a,b)=>Number(isVocal(b))-Number(isVocal(a))||Number(b.required)-Number(a.required)||(eligible.get(s.id+'|'+a.id)?.length||0)-(eligible.get(s.id+'|'+b.id)?.length||0));
  function walk(i:number,a:Assignment){if(visited++>20000||opts.length>=optionLimit)return;
   if(i===slots.length){if(groupOK(e,s,a))opts.push({...a});return;}
   const r=slots[i],pool=heldPart(s,r.id)?[s.assigned[r.id]||'']:[...new Set((eligible.get(s.id+'|'+r.id)||[]).map(m=>m.person)),''];
   for(const p of pool){if(p)a[r.id]=p;else delete a[r.id];walk(i+1,a);delete a[r.id];}
  }walk(0,{});
  const pinned=Object.fromEntries(Object.entries(s.assigned).filter(([id])=>heldPart(s,id)));
  if(groupOK(e,s,pinned))opts.push(pinned);
  // Every eligible request gets a seed, even beyond the enumeration bound.
  // Otherwise the first singer's combinations could hide all later singers.
  function extend(base:Assignment,candidate:ReturnType<typeof applicants>[number],wholeGroup=false){
   const next={...base},app=candidate.application;
   const members=app.together==='hard'||wholeGroup?app.members:[candidate];
   for(const m of members){if(isFlexible(m)||m.consent!=='yes'||next[m.slot]&&next[m.slot]!==m.person||heldPart(s,m.slot)&&(s.assigned[m.slot]||'')!==m.person)return null;next[m.slot]=m.person;}
   return next;
  }
  function addSeed(seed:Assignment|null){
   if(!seed||!groupOK(e,s,seed))return;opts.push(seed);
   let filled=seed;
   for(const part of slots){if(filled[part.id]||heldPart(s,part.id))continue;
    const pool=[...(eligible.get(s.id+'|'+part.id)||[])].sort((a,b)=>Number(Object.values(filled).includes(a.person))-Number(Object.values(filled).includes(b.person))||a.application.priority-b.application.priority);
    for(const c of pool){const next=extend(filled,c);if(next&&groupOK(e,s,next)){filled=next;break;}}
   }opts.push(filled);
  }
  for(const r of slots)for(const candidate of eligible.get(s.id+'|'+r.id)||[])addSeed(extend(pinned,candidate));
  // A soft group must be considered as a whole even beyond the enumeration
  // bound, without making its members inseparable in the other options.
  for(const g of e.applications.filter(g=>g.song===s.id&&g.together==='soft'&&new Set(g.members.map(m=>m.person)).size>1&&g.members.every(m=>m.consent==='yes'))){
   const candidate=(eligible.get(s.id+'|'+g.members[0].slot)||[]).find(c=>c.application.id===g.id);
   if(candidate)addSeed(extend(pinned,candidate,true));
  }
  // Preserve existing valid choices, including late applicants beyond the bound.
  if(groupOK(e,s,s.assigned)&&Object.entries(s.assigned).every(([r,p])=>!p||heldPart(s,r)||(eligible.get(s.id+'|'+r)||[]).some(m=>m.person===p)))opts.push({...s.assigned});
  const unique=[...new Map(opts.map(a=>[JSON.stringify(Object.entries(a).sort(([a],[b])=>a.localeCompare(b))),a])).values()];for(const a of unique)meta(s,a);return unique;
 });
 type Plan=Assignment[];
 const compare=(a:number[],b:number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;};
 const pinnedVocal:Record<string,number>={};for(const s of e.songs.filter(s=>s.inclusion!=='exclude'))for(const p of new Set(s.slots.filter(r=>isVocal(r)&&heldPart(s,r.id)).map(r=>s.assigned[r.id]).filter(Boolean)))pinnedVocal[p]=(pinnedVocal[p]||0)+1;
 function score(plan:Plan){let filled=0,ready=0,stars=0,pref=0,softGroups=0,extraFilled=0,extraPref=0;const firstWeights=new Map<string,number>(),core=new Set<string>(),vocals=new Set<string>(),electric=new Set<string>(),load:Record<string,number>={},vocalLoad:Record<string,number>={},arrival:number[]=[];
  plan.forEach((a,i)=>{const s=e.songs[i];if(s.inclusion==='exclude')return;const m=meta(s,a);
   m.core.forEach(p=>{core.add(p);firstWeights.set(p,Math.max(firstWeights.get(p)||0,m.weights.get(p)||0));});m.vocals.forEach(p=>{vocals.add(p);vocalLoad[p]=(vocalLoad[p]||0)+1;});m.electric.forEach(p=>electric.add(p));m.weights.forEach((w,p)=>load[p]=(load[p]||0)+w);
   filled+=m.filled;ready+=m.ready;stars+=m.stars;pref+=m.pref;softGroups+=m.softGroups;extraFilled+=m.extraFilled;extraPref+=m.extraPref;arrival.push(...m.arrival);
  });
  const overflow=state.people.reduce((n,p)=>n+Math.max(0,(vocalLoad[p.id]||0)-Math.max(p.max,pinnedVocal[p.id]||0)),0);
  // Once the same number of people can play, compare their strongest role
  // with the configured role weights. Confirmed soft groups then precede
  // workload, stars and wishes; duplicate applications count only once.
  // Fill feasible core seats
  // before balancing; otherwise an empty seat could improve apparent equality.
  const fairness=Object.values(load).reduce((n,w)=>n+w*w,0);
  const early=Array.from({length:e.applications.length},()=>0);for(const rank of arrival)early[rank]++;
  return [-overflow,core.size,[...firstWeights.values()].reduce((n,w)=>n+w,0),softGroups,filled,extraFilled,-fairness,ready,stars,pref,Object.keys(load).length,extraPref,...early];
 }
 const initial=()=>e.songs.map(s=>s.inclusion==='exclude'?{}:Object.fromEntries(Object.entries(s.assigned).filter(([id])=>heldPart(s,id))));
 let best=initial(),bestScore=score(best),rng=45117;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const limit=60000;let evaluations=0;
 const consider=(plan:Plan,i:number,a:Assignment)=>{const trial=[...plan];trial[i]=a;return score(trial);};
 for(let restart=0;restart<5&&evaluations<limit;restart++){
  const plan:Plan=restart===1?e.songs.map((s,i)=>s.inclusion==='exclude'?{}:{...(choices[i].find(a=>Object.entries(s.assigned).every(([r,p])=>a[r]===p))||initial()[i])}):initial();
  const order=e.songs.map((_,i)=>i);if(restart)for(let j=order.length-1;j>0;j--){const k=Math.floor(random()*(j+1));[order[j],order[k]]=[order[k],order[j]];}
  for(let pass=0;pass<5&&evaluations<limit;pass++){let changed=false;for(const i of order){let local=score(plan),pick=plan[i];for(const a of choices[i]){if(evaluations++>=limit)break;const sc=consider(plan,i,a);if(compare(sc,local)>0){local=sc;pick=a;}}if(pick!==plan[i]){plan[i]=pick;changed=true;}}if(!changed)break;}
  // Deterministic pair exchanges escape conflicts such as one flexible musician
  // occupying the only place of a newcomer who has no other song available.
  for(let tries=0;tries<400&&evaluations<limit;tries++){const i=Math.floor(random()*plan.length),j=Math.floor(random()*plan.length);if(i===j||!choices[i]?.length||!choices[j]?.length)continue;const trial=[...plan];trial[i]=choices[i][Math.floor(random()*choices[i].length)];trial[j]=choices[j][Math.floor(random()*choices[j].length)];evaluations++;if(compare(score(trial),score(plan))>0){plan[i]=trial[i];plan[j]=trial[j];}}
  const sc=score(plan);if(compare(sc,bestScore)>0){bestScore=sc;best=plan.map(a=>({...a}));}
 }
 const oldOrder=e.program;e.program=e.songs.filter(s=>s.inclusion!=='exclude').map(s=>s.id).sort((a,b)=>{const ai=oldOrder.indexOf(a),bi=oldOrder.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi);});
 e.songs.forEach((s,i)=>{if(s.inclusion==='exclude')return;s.assigned=best[i];const proposed=Object.fromEntries(Object.entries(s.assigned).filter(([slot,person])=>!heldPart(s,slot)&&agreed[i][slot]!==person));if(Object.keys(proposed).length)s.algorithmAssigned=proposed;else delete s.algorithmAssigned;});
}
function text(v:any,min=1,max=120){if(typeof v!=='string'||v.trim().length<min||v.length>max)throw Error('Проверьте заполнение полей');return v.trim();}
function number(v:any,min:number,max:number){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Error(`Допустимое значение: ${min}–${max}`);return n;}
export function applyAction(original:State,action:Action,actor:string):State{
 if(action.type==='songWithApplication'){
  if(action.song)throw Error('Для существующей песни используйте обычную заявку');
  if(!Array.isArray(action.slots)||action.slots.some((r:any)=>!r||typeof r.id!=='string'||!r.id||r.id.length>80)||new Set(action.slots.map((r:any)=>r.id)).size!==action.slots.length)throw Error('Проверьте партии песни');
  if(!Array.isArray(action.members)||!action.members.length)throw Error('Укажите участников');
  const proposed=applyAction(original,{type:'song',event:action.event,title:action.title,artist:action.artist,duration:action.duration,slots:action.slots,comment:action.comment},actor),event=proposed.events.find(e=>e.id===action.event)!,song=event.songs.at(-1)!,ids=new Map<string,string>(action.slots.map((r:any,i:number)=>[r.id,song.slots[i].id]));
  const resolve=(id:unknown)=>{if(typeof id!=='string'||!ids.has(id))throw Error('Проверьте участников и партии');return ids.get(id)!;};
  const members=action.members.map((m:any)=>({...m,slot:['__any','__choice','__custom'].includes(m.slot)?m.slot:resolve(m.slot),...(m.slot==='__choice'?{alternatives:Array.isArray(m.alternatives)?m.alternatives.map(resolve):m.alternatives}:{})}));
  return applyAction(proposed,{...action,type:'apply',song:song.id,members,comment:undefined},actor);
 }
 const state=structuredClone(original);retainDraftSongs(state);const admin=state.admins.includes(actor);const me=state.people.find(p=>p.auth===actor&&!p.deletedAt);if(!me)throw Error('Профиль не найден');
 const publicActions=['apply','updateApplication','withdraw','consent','profile','song','vocalStar','comment','deleteComment'];if(!admin&&(!publicActions.includes(action.type)||(action.type==='song'&&action.song)))throw Error('Нужны права администратора');
 const e=state.events.find(e=>e.id===action.event);if(!['newEvent','person','admin','profile','deletePerson','restorePerson','purgePerson','revokeAdmin'].includes(action.type)&&!e)throw Error('Встреча не найдена');
 if(e?.deletedAt&&!['restoreEvent','purgeEvent','profile','deletePerson','restorePerson','purgePerson','revokeAdmin','restoreShelved'].includes(action.type))throw Error('Встреча удалена. Сначала восстановите её');
 if(e?.status==='published'&&!['reopen','profile','consent','deleteEvent','restoreEvent','purgeEvent','settings','deletePerson','restorePerson','purgePerson','revokeAdmin','comment','deleteComment','shelveSong','setPlayed','restoreShelved'].includes(action.type))throw Error('Программа опубликована. Администратор должен открыть редактирование');
 const previousApplication=action.type==='updateApplication'?e?.applications.find(a=>a.id===action.application):undefined;
 const song=e?.songs.find(s=>s.id===(previousApplication?.song||action.song));
 if(song?.shelvedAt&&['assign','resolve','pin','song','inclusion'].includes(action.type))throw Error('Сначала верните песню из долгого ящика');
 function addComment(target=song){if(!target)throw Error('Песня не найдена');const body=text(action.comment,1,1000);if((target.comments?.filter(c=>!c.readiness).length||0)>=100)throw Error('В песне уже 100 комментариев');(target.comments||=[]).push({id:uid(),by:me!.id,body,createdAt:new Date().toISOString()});}
 switch(action.type){
 case 'profile':{const target=admin&&action.person?state.people.find(p=>p.id===action.person):me;if(!target||target.deletedAt)throw Error('Профиль не найден');target.name=text(action.name);target.max=number(action.max,1,30);target.roles=Array.isArray(action.roles)?action.roles.slice(0,15).map((r:any)=>text(r)):target.roles;if(action.nickname!==undefined){if(!isRegistered(target))throw Error('Ник доступен после присоединения к сайту');target.nickname=validateNickname(action.nickname,state.people,target.id);target.nicknameSource='custom';}break;}
 case 'person':state.people.push({id:uid(),name:text(action.name),max:number(action.max||5,1,30),roles:action.roles?.length?action.roles.map((r:any)=>text(r)):['Гитара']});break;
 case 'deletePerson':{
  const target=state.people.find(p=>p.id===action.person);if(!target||target.deletedAt)throw Error('Музыкант не найден');if(target.id===me.id)throw Error('Нельзя удалить свой профиль');if(target.auth&&state.admins.includes(target.auth))throw Error('Нельзя удалить администратора');target.deletedAt=new Date().toISOString();
  for(const event of state.events.filter(ev=>ev.status==='draft')){removePersonFromDraft(state,event,target.id);syncReservations(event);}
  break;
 }
 case 'purgePerson':{
  const target=state.people.find(p=>p.id===action.person);if(!target?.deletedAt)throw Error('Сначала переместите музыканта в удалённые');if(target.id===me.id||target.auth&&state.admins.includes(target.auth))throw Error('Нельзя удалить свой профиль или администратора');const anonymous=DELETED_PERSON_PREFIX+uid();
  for(const event of state.events){
   if(event.status==='draft')removePersonFromDraft(state,event,target.id);
   for(const a of event.applications){if(a.by===target.id)a.by=anonymous;for(const m of a.members)if(m.person===target.id)m.person=anonymous;}
   for(const song of event.songs){for(const slot of Object.keys(song.assigned))if(song.assigned[slot]===target.id)song.assigned[slot]=anonymous;for(const b of Object.values(song.main||{})){if(b.person===target.id)b.person=anonymous;if(b.by===target.id)b.by=anonymous;}if(song.proposedBy===target.id)song.proposedBy=anonymous;if(song.shelvedBy===target.id)song.shelvedBy=anonymous;if(song.shelfHistory)for(const entry of song.shelfHistory){if(entry.by===target.id)entry.by=anonymous;entry.members=entry.members.map(id=>id===target.id?anonymous:id);}if(song.comments)song.comments=song.comments.filter(c=>c.by!==target.id&&c.readiness?.person!==target.id);for(const reservation of Object.values(song.reservations||{}))if(reservation.person===target.id)reservation.person=anonymous;for(const slot of Object.keys(song.algorithmAssigned||{}))if(song.algorithmAssigned![slot]===target.id)delete song.algorithmAssigned![slot];}
   if(event.status==='draft')syncReservations(event);
  }
  for(const p of state.people)if(p.unlinkedBy===target.id)p.unlinkedBy=anonymous;
  state.people=state.people.filter(p=>p.id!==target.id);state.log=state.log.filter(l=>!l.text.startsWith(target.name+':'));break;
 }
 case 'restorePerson':{const target=state.people.find(p=>p.id===action.person);if(!target?.deletedAt)throw Error('Удалённый музыкант не найден');delete target.deletedAt;break;}
 case 'revokeAdmin':{
  if(!canManageAdmins(state,actor))throw Error('Снимать права администратора могут только @nikita и @nastya');const target=state.people.find(p=>p.id===action.person&&!p.deletedAt);if(!target?.auth||!state.admins.includes(target.auth))throw Error('Администратор не найден');if(target.auth===actor)throw Error('Нельзя снять свои права администратора');state.admins=state.admins.filter(id=>id!==target.auth);break;
 }
 case 'admin':{const p=state.people.find(p=>p.id===action.person);if(p?.deletedAt||!p?.auth?.startsWith('local_'))throw Error('Права можно дать зарегистрированному участнику');if(!state.admins.includes(p.auth)){if(state.admins.length>=ADMIN_LIMIT)throw Error(`Достигнут лимит: ${ADMIN_LIMIT} администраторов`);state.admins.push(p.auth);}break;}
 case 'newEvent':state.events.push({id:uid(),title:text(action.title),date:text(action.date),time:text(action.time),venue:text(action.venue||'Площадка уточняется'),image:validateEventImage(action.image??null),budget:number(action.budget,15,720),breakMins:15,status:'draft',demo:false,songs:[],applications:[],program:[],rulesVersion:RECORDING_RULES});break;
 case 'deleteEvent':e!.deletedAt=new Date().toISOString();break;
 case 'restoreEvent':if(!e!.deletedAt)throw Error('Встреча уже восстановлена');delete e!.deletedAt;break;
 case 'purgeEvent':if(!e!.deletedAt)throw Error('Сначала переместите встречу в корзину');state.events=state.events.filter(ev=>ev.id!==e!.id);break;
 case 'settings':Object.assign(e!,{title:text(action.title),date:text(action.date),time:text(action.time),venue:text(action.venue),...(action.image!==undefined?{image:validateEventImage(action.image)}:{}),budget:number(action.budget,15,720),breakMins:number(action.breakMins,0,120)});break;
 case 'song':{
  if(!song&&e!.songs.length>=60)throw Error('В первой версии поддерживается до 60 песен на встречу');
  assertSongAllowed(state,e!,text(action.title),text(action.artist));
  const slots:Slot[]=action.slots?.map((r:any)=>({id:song?.slots.some(x=>x.id===r.id)?r.id:uid(),label:text(r.label,1,60),required:!!r.required}));if(!slots?.length||slots.length>10||!slots.some(s=>s.required))throw Error('Добавьте от 1 до 10 партий, хотя бы одну обязательную');
  if(song){
   const removed=song.slots.filter(r=>!slots.some(x=>x.id===r.id));
   if(removed.some(r=>song.assigned[r.id]||e!.applications.some(a=>a.song===song.id&&a.members.some(m=>m.slot===r.id||m.alternatives?.includes(r.id))))&&action.dropPartApplications!==true)throw Error('Сначала снимите заявки и назначения с удаляемой партии');
   if(removed.length){const ids=new Set(removed.map(r=>r.id));for(const r of removed){delete song.assigned[r.id];delete song.pins[r.id];if(song.main)delete song.main[r.id];if(song.algorithmAssigned)delete song.algorithmAssigned[r.id];if(song.reservations)delete song.reservations[r.id];}
    for(const a of e!.applications.filter(a=>a.song===song.id)){a.members=a.members.filter(m=>!ids.has(m.slot)).filter(m=>{if(m.slot!=='__choice')return true;m.alternatives=(m.alternatives||[]).filter(id=>!ids.has(id));return m.slot!=='__choice'||!!m.alternatives?.length;});syncReadinessComments(state,e!,a);}
    e!.applications=e!.applications.filter(a=>a.song!==song.id||a.members.length>0);
   }
   Object.assign(song,{title:text(action.title),artist:text(action.artist),duration:number(action.duration,1,30),slots});for(const a of e!.applications.filter(a=>a.song===song.id))for(const m of a.members)if(m.starred&&!offeredSlots(song,m).some(isVocal))delete m.starred;syncReservations(e!);
  }else {const id=uid();const proposal:Song={id,title:text(action.title),artist:text(action.artist),duration:number(action.duration,1,30),slots,assigned:{},pins:{},inclusion:'auto',proposedBy:me.id,proposedAt:new Date().toISOString()};proposal.origin=songOrigin(e!,proposal);if(action.comment?.trim())addComment(proposal);e!.songs.push(proposal);}break;
 }
 case 'updateApplication':
 case 'apply':{
  const editing=action.type==='updateApplication';
  if(editing){if(!previousApplication||(!admin&&previousApplication.by!==me.id))throw Error('Нельзя изменить чужую заявку');if(action.song&&action.song!==previousApplication.song)throw Error('Нельзя перенести заявку на другую песню');if(action.expectedApplication&&JSON.stringify(action.expectedApplication)!==JSON.stringify(previousApplication))throw Error('Заявка уже изменилась. Откройте её заново');}
  if(!song||song.shelvedAt)throw Error('Песня не найдена');assertSongAllowed(state,e!,song.title,song.artist);if(!editing&&e!.applications.length>=600)throw Error('Достигнут лимит заявок для этой встречи');
  if(!Array.isArray(action.members)||!action.members.length||action.members.length>10)throw Error('Укажите участников');
  const members:Application['members']=action.members.map((m:any)=>{
   let p:Person|undefined;
   if(m.person==='__name'){
    const name=text(m.name,1,80).replace(/\s+/g,' '),key=name.normalize('NFKC').toLocaleLowerCase('ru-RU');
    p=state.people.find(p=>!p.deletedAt&&p.unlinkedBy===me.id&&!p.auth&&p.name.normalize('NFKC').toLocaleLowerCase('ru-RU')===key);
    if(!p){p={id:uid(),name,roles:[],max:5,unlinkedBy:me.id};state.people.push(p);}
   }else p=state.people.find(p=>p.id===m.person);
   if(!p||p.deletedAt||(p.demo&&!e!.demo))throw Error('Проверьте участников и партии');
   if(!admin&&p.id!==me.id&&!isRegistered(p)&&p.unlinkedBy!==me.id)throw Error('Этот музыкант ещё не присоединился к сайту');
   let slotId=m.slot;
   if(slotId==='__custom'){
    const label=text(m.instrument,1,60).replace(/\s+/g,' ');
    const canonical=(name:string)=>{const n=name.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim().replace(/\s+/g,' ');return n==='бас'?'бас-гитара':n==='гитара'?'ритм-гитара':n;};
    let slot=song.slots.find(r=>canonical(r.label)===canonical(label));
    if(!slot){if(song.slots.length>=10)throw Error('В песне уже 10 партий. Обратитесь к администратору');slot={id:uid(),label,required:false};song.slots.push(slot);}
    slotId=slot.id;
   }
   let alternatives:string[]|undefined;
   if(slotId==='__choice'){
    if(!Array.isArray(m.alternatives)||!m.alternatives.length||m.alternatives.length>10||m.alternatives.some((id:any)=>typeof id!=='string'||!song.slots.some(r=>r.id===id)))throw Error('Выберите возможные партии');
    alternatives=[...new Set(m.alternatives as string[])];
   }
   if(!['__any','__choice'].includes(slotId)&&!song.slots.some(r=>r.id===slotId))throw Error('Проверьте участников и партии');
   if(m.starred&&(p.id!==me.id&&!admin))throw Error('Звёзды другого участника выбирает он сам');
   if(m.starred&&!offeredSlots(song,{slot:slotId,alternatives}).some(isVocal))throw Error('Звёзды доступны только для вокала');
   const vocal=offeredSlots(song,{slot:slotId,alternatives}).some(isVocal),prior=previousApplication?.members.find(x=>x.person===p!.id&&x.slot===slotId&&JSON.stringify([...(x.alternatives||[])].sort())===JSON.stringify([...(alternatives||[])].sort()));
   const starred=vocal&&(editing&&(m.starred===undefined||p.id!==me.id&&!admin)?starredSongs(e!,p.id).has(song.id):!!m.starred);
   const consent=(e!.rulesVersion||0)>=RECORDING_RULES?'yes':p.id===me.id||(admin&&action.agreed)?'yes':prior&&previousApplication?.together===(action.together==='hard'?'hard':'soft')?prior.consent:'pending';
   return {person:p.id,slot:slotId,...(alternatives?{alternatives}:{}),...(starred?{starred:true}:{}),consent,...((e!.rulesVersion||0)>=RECORDING_RULES?{standby:prior?.standby??(!!m.standby||isFlexible({slot:slotId})||!!song.main?.[slotId]&&song.main[slotId].person!==p.id)}:{})};
  });
  const fixed=members.filter(m=>!isFlexible(m));if(new Set(fixed.map(m=>m.slot)).size!==fixed.length)throw Error('На каждую партию укажите одного участника');
  if(members.some(m=>isFlexible(m)&&members.filter(x=>x.person===m.person).length>1))throw Error('Для выбора одной из партий укажите участника один раз');
  const priority=number(action.priority,1,3);if(![1,2,3].includes(priority))throw Error('Выберите приоритет');
  for(const m of members.filter(m=>m.starred)){const songs=starredSongs(e!,m.person);if(!songs.has(song.id)&&songs.size>=VOCAL_STARS)throw Error('Для вокала можно выбрать до 3 песен со звездой на встречу');}
  if(editing){const previous=structuredClone(previousApplication!);Object.assign(previousApplication!,{priority,together:action.together==='hard'?'hard':'soft',members});releaseApplicationParts(e!,previous);}
  else e!.applications.push({id:uid(),song:song.id,by:me.id,priority,createdAt:new Date().toISOString(),together:action.together==='hard'?'hard':'soft',members});
  const starPreferences=new Set(members.filter((m,i)=>(m.person===me.id||admin)&&typeof action.members[i].starred==='boolean'&&offeredSlots(song,m).some(isVocal)).map(m=>m.person));
  for(const person of starPreferences){const starred=members.some(m=>m.person===person&&m.starred&&offeredSlots(song,m).some(isVocal));for(const a of e!.applications.filter(a=>a.song===song.id))for(const m of a.members)if(m.person===person&&m.consent!=='no'&&offeredSlots(song,m).some(isVocal))m.starred=starred;}
  if((e!.rulesVersion||0)>=RECORDING_RULES){syncMain(e!);registerMains(e!,song,(previousApplication||e!.applications.at(-1)!).id);}else for(const m of fixed)if(!song.pins[m.slot]&&!song.assigned[m.slot])song.assigned[m.slot]=m.person;syncReservations(e!);if(action.comment?.trim())addComment();syncReadinessComments(state,e!,previousApplication||e!.applications.at(-1)!);break;
 }
 case 'comment':addComment();break;
 case 'deleteComment':{const c=song?.comments?.find(c=>c.id===action.commentId);if(!c||(!admin&&c.by!==me.id))throw Error('Нельзя удалить чужой комментарий');song!.comments=song!.comments!.filter(x=>x.id!==c.id);break;}
 case 'resolve':{
  if(!song)throw Error('Песня не найдена');const a=e!.applications.find(a=>a.id===action.application&&a.song===song.id);const m=a?.members[action.member];
  if(!a||!m||!isFlexible(m)||!offeredSlots(song,m).some(r=>r.id===action.slot))throw Error('Эта партия не указана в заявке');
  if(m.consent==='no'||(a.together==='hard'&&a.members.some(x=>x.consent==='no')))throw Error('Сначала подтвердите участие музыкантов');
  if(a.members.some(x=>x!==m&&x.slot===action.slot))throw Error('Эта партия уже указана у другого участника заявки');
  if(song.assigned[action.slot]&&song.assigned[action.slot]!==m.person&&action.replace!==true)throw Error('Партия уже занята. Сначала освободите её');
  m.slot=action.slot;delete m.alternatives;if(!isVocal(song.slots.find(r=>r.id===m.slot)!))delete m.starred;
  song.assigned[m.slot]=m.person;song.pins[m.slot]=true;(song.main||={})[m.slot]={person:m.person,by:me.id,application:a!.id};m.standby=false;if(song.algorithmAssigned)delete song.algorithmAssigned[m.slot];if(song.reservations)delete song.reservations[m.slot];syncReadinessComments(state,e!,a!);break;
 }
 case 'vocalStar':{
  if(!song)throw Error('Песня не найдена');const person=admin&&action.person?action.person:me.id;
  if(!admin&&action.person&&action.person!==me.id)throw Error('Можно менять только свои звёзды');
  const members=e!.applications.filter(a=>a.song===song.id).flatMap(a=>a.members).filter(m=>m.person===person&&m.consent!=='no'&&offeredSlots(song,m).some(isVocal));
  if(!members.length)throw Error('Сначала подайте заявку на вокал');
  const songs=starredSongs(e!,person);if(action.starred&&!songs.has(song.id)&&songs.size>=VOCAL_STARS)throw Error('Для вокала можно выбрать до 3 песен со звездой на встречу');
  for(const m of members)m.starred=!!action.starred;break;
 }
 case 'withdraw':{const a=e!.applications.find(a=>a.id===action.application);if(!a||(!admin&&a.by!==me.id))throw Error('Нельзя удалить чужую заявку');e!.applications=e!.applications.filter(x=>x.id!==a.id);releaseApplicationParts(e!,a);syncReservations(e!);const target=e!.songs.find(s=>s.id===a.song);if(target?.comments)target.comments=target.comments.filter(c=>c.readiness?.application!==a.id);break;}
 case 'consent':{const a=e!.applications.find(a=>a.id===action.application);const members=a?.members.filter(m=>m.person===(admin?action.person:me.id));if(!members?.length)throw Error('Приглашение не найдено');for(const m of members){m.consent=action.accept?'yes':'no';if(!action.accept)delete m.starred;}if(!action.accept){const song=e!.songs.find(s=>s.id===a!.song);if(e!.status==='draft'&&song)for(const m of members)for(const r of offeredSlots(song,m))if(song.main?.[r.id]?.person===m.person){delete song.main[r.id];delete song.assigned[r.id];delete song.pins[r.id];}releaseApplicationParts(e!,{...a!,members});}syncReservations(e!);syncReadinessComments(state,e!,a!);break;}
 case 'assign':{
  if(!song||!song.slots.some(r=>r.id===action.slot))throw Error('Партия не найдена');if(action.person&&!state.people.some(p=>p.id===action.person&&!p.deletedAt&&(!p.demo||e!.demo)))throw Error('Участник не найден');
  if(song.main?.[action.slot]&&song.main[action.slot].person!==action.person&&action.replace!==true)throw Error('Основной участник закреплён. Подтвердите замену по договорённости');
  if(action.person){(song.main||={})[action.slot]={person:action.person,by:me.id,manual:true};song.assigned[action.slot]=action.person;song.pins[action.slot]=true;}else{if(song.main)delete song.main[action.slot];delete song.assigned[action.slot];delete song.pins[action.slot];}if(song.reservations)delete song.reservations[action.slot];if(song.algorithmAssigned)delete song.algorithmAssigned[action.slot];break;
 }
 case 'pin':if(song?.main?.[action.slot])throw Error('Основное место сохраняется при пересчёте. Для замены согласуйте участие и измените состав');if(song){if(!song.assigned[action.slot])delete song.pins[action.slot];else{if((e!.rulesVersion||0)>=RECORDING_RULES)(song.main||={})[action.slot]={person:song.assigned[action.slot],by:me.id,manual:true};song.pins[action.slot]=!song.pins[action.slot];if(song.pins[action.slot]&&song.algorithmAssigned)delete song.algorithmAssigned[action.slot];}}break;
 case 'inclusion':if(song){if(song.shelvedAt)throw Error('Сначала верните песню из долгого ящика');if(!['auto','include','exclude'].includes(action.value))throw Error('Неверное решение');song.inclusion=action.value;if(action.value==='exclude')e!.program=e!.program.filter(id=>id!==song.id);if(action.value==='include'){assertSongAllowed(state,e!,song.title,song.artist);if(!e!.program.includes(song.id))e!.program.push(song.id);}}break;
 case 'order':{
  const i=e!.program.indexOf(action.song);
  if('before' in action){
   if(i<0||action.before!==null&&(typeof action.before!=='string'||!e!.program.includes(action.before)))throw Error('Песня не найдена в программе. Обновите страницу');
   if(action.before===action.song)break;
   const order=e!.program.filter(id=>id!==action.song),j=action.before===null?order.length:order.indexOf(action.before);order.splice(j,0,action.song);e!.program=order;
  }else{const j=i+Number(action.direction);if(i>=0&&j>=0&&j<e!.program.length)[e!.program[i],e!.program[j]]=[e!.program[j],e!.program[i]];}
  break;
 }
 case 'resetProgram':resetAllocation(e!);e!.program=[];for(const s of e!.songs)if(s.inclusion==='include')s.inclusion='auto';delete e!.programNotes;break;
 case 'buildProgram':buildProgram(state,e!);break;
 case 'optimize':optimize(state,e!);e!.allocatedAt=new Date().toISOString();break;
 case 'resetAllocation':resetAllocation(e!);break;
 case 'shelveSong':{
  if(!song||song.shelvedAt)throw Error('Песня не найдена или уже в долгом ящике');
  if(e!.status==='published'&&e!.program.includes(song.id)){
   if(!eventHasStarted(e!)||!e!.program.includes(song.id))throw Error('Отметить несыгранную песню можно только в программе прошедшей встречи');
   song.played=false;song.shelfReason='unplayed';
  }else{
   if(e!.status==='draft')e!.program=e!.program.filter(id=>id!==song.id);
   song.inclusion='exclude';song.shelfReason='unselected';
  }
  song.shelvedAt=new Date().toISOString();song.shelvedBy=me.id;song.origin=songOrigin(e!,song);(song.shelfHistory||=[]).push({at:song.shelvedAt,by:me.id,reason:song.shelfReason!,members:shelfMembers(e!,song)});break;
 }
 case 'setPlayed':{
  if(!song||e!.status!=='published'||!eventHasStarted(e!)||!e!.program.includes(song.id)||action.played!==true)throw Error('Отметить сыгранную песню можно в программе прошедшей встречи');
  song.played=true;if(song.shelfReason==='unplayed'){delete song.shelvedAt;delete song.shelvedBy;delete song.shelfReason;delete song.shelfReturn;}break;
 }
 case 'restoreShelved':{
  if(!song?.shelvedAt||song.shelfReturn)throw Error('Песня не найдена в долгом ящике');const target=state.events.find(ev=>ev.id===action.targetEvent&&!ev.deletedAt&&ev.status==='draft');
  if(!target)throw Error('Выберите черновик встречи');assertSongAllowed(state,target,song.title,song.artist);
  const entry=song.shelfHistory?.at(-1),origin=songOrigin(e!,song);let restoredSong=song.id;
  if(target.id===e!.id){delete song.shelvedAt;delete song.shelvedBy;delete song.shelfReason;song.inclusion='auto';}
  else{if(target.songs.length>=60)throw Error('Во встрече уже 60 песен');const copy:Song={id:uid(),title:song.title,artist:song.artist,duration:song.duration,slots:structuredClone(song.slots),assigned:{},pins:{},inclusion:'auto',proposedBy:me.id,proposedAt:song.proposedAt,origin:structuredClone(origin)};target.songs.push(copy);song.shelfReturn={event:target.id,song:copy.id};restoredSong=copy.id;}
  if(entry)entry.returned={at:new Date().toISOString(),event:target.id,song:restoredSong,title:target.title,date:target.date,time:target.time};
  break;
 }
 case 'publish':{if(!canApproveProgram(state,actor))throw Error('Утверждать программу могут только организаторы @nikita и @nastya');for(const s of e!.songs.filter(s=>e!.program.includes(s.id)))assertSongAllowed(state,e!,s.title,s.artist);if(!e!.program.length)throw Error('Сначала соберите программу');if(warnings(state,e!).length&&action.acknowledgeWarnings!==true)throw Error('Перед утверждением проверьте замечания и подтвердите решение организатора');e!.status='published';e!.publishedAt=new Date().toISOString();break;}
 case 'reopen':{if(e!.status!=='published')throw Error('Утверждение уже отменено');e!.status='draft';delete e!.publishedAt;for(const s of e!.songs)if(s.shelvedAt)s.inclusion='exclude';retainDraftSongs(state);break;}
 default:throw Error('Неизвестное действие');
 }
 state.log.unshift({at:new Date().toISOString(),text:`${me.name}: ${({'comment':'добавлен комментарий','deleteComment':'удалён комментарий','resolve':'уточнена партия по заявке','vocalStar':'обновлены вокальные звёзды','apply':'добавлена заявка','updateApplication':'изменена заявка','song':'добавлена песня','resetAllocation':'сброшено распределение','shelveSong':'песня отправлена в долгий ящик','restoreShelved':'песня возвращена из долгого ящика','setPlayed':'отмечена сыгранная песня','resetProgram':'сброшен черновик программы','buildProgram':'собран черновик программы','optimize':'пересчитана программа','publish':'опубликована программа','assign':'изменён состав','newEvent':'создана встреча','deleteEvent':'встреча перемещена в корзину','restoreEvent':'встреча восстановлена','reopen':'открыто редактирование','withdraw':'снята заявка','consent':'обновлено подтверждение','pin':'изменено закрепление','inclusion':'изменено решение по песне','profile':'обновлён профиль','person':'добавлен музыкант','purgePerson':'музыкант удалён навсегда','deletePerson':'удалён музыкант','restorePerson':'восстановлен музыкант','purgeEvent':'встреча удалена навсегда','order':'изменён порядок','settings':'изменены настройки','revokeAdmin':'сняты права администратора','admin':'добавлен администратор'} as Record<string,string>)[action.type]||action.type}${e?' · '+e.title:''}`});state.log=state.log.slice(0,80);return state;
}
