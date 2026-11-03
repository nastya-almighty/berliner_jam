import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, optimize, complete, counts, duration, warnings, applyAction, participation, DEFAULT_SLOTS, retainDraftSongs, isPrimary, seekingPerformers, allocationWeight, vocalCounts, starredSongs, applicants, flexibleApplicants, readiness, readinessPeople, memberPart, firstCreatorComment, reviewIssues, ensureNicknames, isRegistered, normalizeNickname, suggestNickname, validateNickname, applicationsFor, assignmentNote, syncReservations, vacancyFamily, hasVacancy, sortSongs, slotAvailability, eventImageUrl, uploadedImageId, ADMIN_LIMIT, DELETED_PERSON_PREFIX, directoryPeople, musicianAppearances, filterMusicians, hasJamApplication, canManageAdmins, isAlgorithmAssignment, assignmentCandidates, signupAssignments, signupSong, personalApplicationGroups, isSelectedForProgram, musicianStats, PROGRAM_APPROVERS, canApproveProgram, resetAllocation, visibleState, eventHasStarted } from '../lib/model.ts';
// Fixtures select all songs explicitly when testing manual moderation.
const allSongsDemo=(...args)=>{const s=seed(...args);s.events[0].program=s.events[0].songs.map(x=>x.id);return s;};
const slot=(id,label)=>({id,label,required:true});
const person=(id,roles,max=5)=>({id,name:id,roles,max});
const song=(id,slots)=>({id,title:id,artist:'Artist',duration:7,slots,assigned:{},pins:{},inclusion:'auto'});
const request=(id,song,members,together='soft',priority=2)=>({id,song,by:members[0][0],members:members.map(([person,slot])=>({person,slot,consent:'yes'})),together,priority});
function base(people,songs,applications){return {people,admins:['a'],log:[],events:[{id:'e',title:'Test',date:'2026-11-20',time:'17:00',venue:'Berlin',budget:60,breakMins:0,status:'draft',demo:false,program:songs.map(s=>s.id),songs,applications}]};}
test('demo retains every proposal and reports incomplete songs for moderation',()=>{const state=allSongsDemo();const e=state.events[0];assert.ok(e.program.length>0);assert.equal(e.program.length,e.songs.length);assert.ok(duration(e)<=e.budget);assert.ok(warnings(state,e).some(w=>w.kind==='incomplete'));assert.ok(!warnings(state,e).some(w=>['load','group','roles','consent'].includes(w.kind)))});
test('flexible guitarist moves to bass so both musicians can play',()=>{const state=base([person('a',['Гитара','Бас']),person('b',['Гитара'])],[song('s',[slot('g','Гитара'),slot('b','Бас')])],[request('a','s',[['a','g']]),request('b','s',[['a','b']]),request('c','s',[['b','g']])]);optimize(state,state.events[0]);assert.deepEqual(state.events[0].songs[0].assigned,{g:'b',b:'a'});});
test('hard duo is accepted together even against a competing application',()=>{const state=base([person('a',['Вокал']),person('b',['Гитара']),person('c',['Гитара'])],[song('s',[slot('v','Вокал'),slot('g','Гитара')])],[request('duo','s',[['a','v'],['b','g']],'hard'),request('other','s',[['c','g']], 'soft',1)]);optimize(state,state.events[0]);assert.equal(state.events[0].songs[0].assigned.g,'b');});
test('pending hard duo occupies its parts provisionally without forging consent',()=>{const state=base([person('a',['Вокал']),person('b',['Гитара'])],[song('s',[slot('v','Вокал'),slot('g','Гитара')])],[request('duo','s',[['a','v'],['b','g']],'hard')]);state.events[0].applications[0].members[1].consent='pending';optimize(state,state.events[0]);const e=state.events[0];assert.deepEqual(e.songs[0].assigned,{v:'a',g:'b'});assert.equal(e.applications[0].members[1].consent,'pending');assert.ok(!applicants(e,'s','g').length);assert.ok(warnings(state,e).some(w=>w.kind==='consent'));});
test('pinned assignments and excluded songs survive recomputation',()=>{const state=allSongsDemo();const e=state.events[0];const s=e.songs.find(s=>e.program.includes(s.id));const [r,p]=Object.entries(s.assigned)[0];s.pins[r]=true;e.songs.at(-1).inclusion='exclude';optimize(state,e);assert.equal(s.assigned[r],p);assert.ok(e.program.includes(s.id));assert.ok(!e.program.includes(e.songs.at(-1).id));});
test('overrunning time keeps every song and reports the overrun',()=>{const state=base([person('a',['Вокал']),person('b',['Вокал'])],[song('s1',[slot('v','Вокал')]),song('s2',[slot('v','Вокал')]),song('s3',[slot('v','Вокал')])],[request('a1','s1',[['a','v']]),request('a2','s2',[['a','v']]),request('b1','s3',[['b','v']])]);const e=state.events[0];e.budget=14;optimize(state,e);assert.equal(e.program.length,3);assert.deepEqual(counts(e),{a:2,b:1});assert.ok(warnings(state,e).some(w=>w.kind==='time'));});
test('one person may play multiple instruments in one song',()=>{const state=base([person('a',['Гитара','Барабаны'])],[song('s',[slot('g','Гитара'),slot('d','Барабаны')])],[request('a1','s',[['a','g']]),request('a2','s',[['a','d']])]);optimize(state,state.events[0]);assert.equal(state.events[0].program.length,1);assert.ok(complete(state.events[0].songs[0]));assert.deepEqual(participation(state.events[0]),{all:{a:1},core:{a:1},extra:{}});assert.deepEqual(warnings(state,state.events[0]),[]);});
test('vocals and guitar can be combined and count as one appearance',()=>{const state=base([person('a',['Вокал','Гитара'])],[song('s',[slot('v','Вокал'),slot('g','Гитара')])],[request('a1','s',[['a','v'],['a','g']],'hard')]);optimize(state,state.events[0]);assert.deepEqual(counts(state.events[0]),{a:1});});
test('non-admin cannot allocate or invite a musician who has not joined',()=>{const state=allSongsDemo('owner');state.people.push({id:'u',auth:'u',name:'User',roles:['Гитара'],max:5});assert.throws(()=>applyAction(state,{type:'optimize',event:'demo-event'},'u'),/администратора/);assert.throws(()=>applyAction(state,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'p1',slot:'r0'}]},'u'),/присоединился/);});
test('co-applicants must consent; non-admin cannot forge agreed flag',()=>{const state=allSongsDemo('owner');state.people.push({id:'u',auth:'u',name:'User',roles:['Гитара'],max:5});const next=applyAction(state,{type:'apply',event:'demo-event',song:'s1',priority:2,together:'hard',agreed:true,members:[{person:'u',slot:'r1'},{person:'owner',slot:'r0'}]},'u');assert.deepEqual(next.events[0].applications.at(-1).members.map(m=>m.consent),['yes','yes']);});
test('unconfirmed manual replacement blocks publication and detects broken duo',()=>{const state=allSongsDemo('owner');let next=applyAction(state,{type:'assign',replace:true,event:'demo-event',song:'s1',slot:'r1',person:'p10'},'owner');assert.ok(warnings(next,next.events[0]).some(w=>w.kind==='group'));assert.throws(()=>applyAction(next,{type:'publish',event:'demo-event'},'owner'),/организаторы/);});
test('withdraw deletes only requested application',()=>{const state=allSongsDemo('owner');const n=state.events[0].applications.length;const next=applyAction(state,{type:'withdraw',event:'demo-event',application:'duo'},'owner');assert.equal(next.events[0].applications.length,n-1);assert.ok(!next.events[0].applications.some(a=>a.id==='duo'));});
test('alternative hard groups sharing a singer do not make the song impossible',()=>{const state=base([person('a',['Вокал']),person('b',['Гитара']),person('c',['Гитара'])],[song('s',[slot('v','Вокал'),slot('g','Гитара')])],[request('duo1','s',[['a','v'],['b','g']],'hard'),request('duo2','s',[['a','v'],['c','g']],'hard')]);optimize(state,state.events[0]);assert.equal(state.events[0].program.length,1);assert.deepEqual(warnings(state,state.events[0]),[]);});
test('admin can correct a managed musician profile; participant can only edit their own',()=>{const state=allSongsDemo('owner');const next=applyAction(state,{type:'profile',person:'p4',name:'Drummer',max:10,roles:['Барабаны']},'owner');assert.equal(next.people.find(p=>p.id==='p4').max,10);state.people.push({id:'u',auth:'u',name:'User',roles:[],max:5});const n=applyAction(state,{type:'profile',person:'p4',name:'Self',max:7,roles:[]},'u');assert.equal(n.people.find(p=>p.id==='p4').max,5);assert.equal(n.people.find(p=>p.id==='u').max,7);});
test('demo musicians cannot be assigned to a real event',()=>{const state=allSongsDemo('owner');const next=applyAction(state,{type:'newEvent',title:'Real',date:'2026-11-20',time:'17:00',venue:'Berlin',budget:60},'owner');const e=next.events.at(-1);e.songs.push(song('s',[slot('g','Гитара')]));assert.throws(()=>applyAction(next,{type:'apply',event:e.id,song:'s',members:[{person:'p1',slot:'g'}],priority:2,agreed:true},'owner'),/участников/);});
function participantState(){const s=allSongsDemo('owner');s.people.push({id:'u',auth:'u',name:'Скрипач',roles:[],max:5});return s;}
test('participant creates an optional violin part and their application atomically',()=>{const s=participantState();const n=applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:'Скрипка'}]},'u');const e=n.events[0],song=e.songs[0],r=song.slots.find(r=>r.label==='Скрипка');assert.equal(r.required,false);assert.equal(e.applications.at(-1).members[0].slot,r.id);assert.equal(e.applications.at(-1).members[0].consent,'yes');assert.equal(s.events[0].songs[0].slots.length,6);assert.equal(complete(song),true);optimize(n,e);assert.equal(e.songs[0].assigned[r.id],'u');assert.ok(!warnings(n,e).some(w=>w.song===song.id));});
test('custom instruments work for accordion, balalaika and flute',()=>{for(const label of ['Аккордеон','Балалайка','Флейта']){const n=applyAction(participantState(),{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:label}]},'u');assert.ok(n.events[0].songs[0].slots.some(r=>r.label===label&&!r.required));}});
test('instrument labels differing only in case and whitespace reuse one part',()=>{let s=participantState();s=applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:'  Губная   гармошка '}]},'u');const n=applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:'губная гармошка'}]},'u');assert.equal(n.events[0].songs[0].slots.length,7);const apps=n.events[0].applications.slice(-2);assert.equal(apps[0].members[0].slot,apps[1].members[0].slot);});
test('existing mandatory part cannot be downgraded via custom instrument entry',()=>{const n=applyAction(participantState(),{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:'бас'}]},'u');assert.equal(n.events[0].songs[0].slots.length,6);assert.ok(n.events[0].songs[0].slots.find(r=>r.id==='r2').required);});
test('joint application can add new instruments while preserving consent requirements',()=>{const s=participantState();s.people.push({id:'friend',auth:'friend',name:'Флейтист',roles:[],max:5});const n=applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,together:'hard',members:[{person:'u',slot:'__custom',instrument:'Скрипка'},{person:'friend',slot:'__custom',instrument:'Флейта'}]},'u');assert.equal(n.events[0].songs[0].slots.length,8);assert.deepEqual(n.events[0].applications.at(-1).members.map(m=>m.consent),['yes','yes']);});
test('invalid custom request leaves original song unchanged',()=>{const s=participantState();for(const instrument of ['', 'x'.repeat(61)])assert.throws(()=>applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument}]},'u'));assert.equal(s.events[0].songs[0].slots.length,6);});
test('cannot add instruments to published program or exceed ten parts',()=>{const s=participantState();s.events[0].status='published';assert.throws(()=>applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:'Скрипка'}]},'u'),/опубликована/);s.events[0].status='draft';while(s.events[0].songs[0].slots.length<10)s.events[0].songs[0].slots.push({id:crypto.randomUUID(),label:'Extra '+s.events[0].songs[0].slots.length,required:false});assert.throws(()=>applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'__custom',instrument:'Скрипка'}]},'u'),/10 партий/);});
test('songs without any requests remain in draft; recalculation never excludes them',()=>{const state=base([], [song('empty',[slot('v','Вокал')])],[]);optimize(state,state.events[0]);assert.deepEqual(state.events[0].program,['empty']);assert.equal(state.events[0].songs[0].inclusion,'auto');assert.ok(warnings(state,state.events[0]).some(w=>w.kind==='incomplete'));});
test('manual inclusion restores an excluded song without changing source applications',()=>{const state=allSongsDemo('owner');const removed=applyAction(state,{type:'inclusion',event:'demo-event',song:'s1',value:'exclude'},'owner');const recalculated=applyAction(removed,{type:'optimize',event:'demo-event'},'owner');assert.ok(!recalculated.events[0].program.includes('s1'));assert.ok(recalculated.events[0].songs.some(s=>s.id==='s1'));const restored=applyAction(recalculated,{type:'inclusion',event:'demo-event',song:'s1',value:'include'},'owner');assert.ok(restored.events[0].program.includes('s1'));});
test('new proposals stay available without silently entering the program',()=>{const s=allSongsDemo('owner');const n=applyAction(s,{type:'song',event:'demo-event',title:'New song',artist:'Artist',duration:7,slots:DEFAULT_SLOTS},'owner');const song=n.events[0].songs.at(-1);assert.ok(!n.events[0].program.includes(song.id));assert.deepEqual(song.slots.filter(r=>r.required).map(r=>r.label),['Вокал','Ритм-гитара','Соло-гитара','Бас-гитара','Барабаны']);assert.ok(song.slots.some(r=>r.label==='Вокал (дуэт)'&&!r.required&&!('primary' in r)));});
test('extra instruments remain available after core participation, without the old global cap',()=>{const state=base([person('a',['Гитара','Скрипка'],1),person('b',['Вокал'],1),person('c',['Флейта'],1)],[song('s',[slot('g','Гитара'),slot('v','Вокал')]),song('extras',[{id:'x',label:'Скрипка',required:false},{id:'f',label:'Флейта',required:false}])],[request('a-main','s',[['a','g']]),request('b-main','s',[['b','v']]),request('duo','extras',[['a','x'],['c','f']],'hard',1)]);optimize(state,state.events[0]);assert.equal(state.events[0].songs[0].assigned.g,'a');assert.equal(state.events[0].songs[0].assigned.v,'b');assert.equal(state.events[0].songs[1].assigned.x,'a');assert.equal(state.events[0].songs[1].assigned.f,'c');assert.ok(!warnings(state,state.events[0]).some(w=>w.kind==='load'));assert.deepEqual(participation(state.events[0]).core,{a:1,b:1});});
test('extra appearances do not count as core appearances but count toward workload',()=>{const state=base([person('a',['Скрипка'])],[song('s',[{id:'x',label:'Скрипка',required:false},slot('v','Вокал')])],[request('a','s',[['a','x']])]);optimize(state,state.events[0]);assert.deepEqual(participation(state.events[0]),{all:{a:1},core:{},extra:{a:1}});});
test('draft upgrade preserves existing requests and moderator exclusions; published programs stay intact',()=>{const state=base([], [song('s',[slot('v','Вокал'),slot('g','Гитара'),slot('b','Бас'),slot('d','Барабаны')]),song('hidden',[slot('v','Вокал')])], [request('a','s',[['a','g']])]);state.events[0].songs[1].inclusion='exclude';const published=structuredClone(state.events[0]);published.id='past';published.status='published';state.events.push(published);const saved=JSON.stringify(published);assert.ok(retainDraftSongs(state));assert.deepEqual(state.events[0].program,['s']);assert.equal(state.events[0].applications[0].members[0].slot,'g');assert.equal(state.events[0].songs[0].slots.find(r=>r.id==='g').label,'Ритм-гитара');assert.equal(JSON.stringify(state.events[1]),saved);assert.equal(retainDraftSongs(state),false);});

test('vocals and several instruments share one required appearance and workload limit',()=>{const state=base([person('a',[],1)],[song('s',[slot('v','Вокал'),slot('g','Гитара'),{id:'f',label:'Флейта',required:false}])],[request('multi','s',[['a','v'],['a','g'],['a','f']],'hard')]);optimize(state,state.events[0]);assert.ok(complete(state.events[0].songs[0]));assert.equal(Object.keys(state.events[0].songs[0].assigned).length,3);assert.deepEqual(participation(state.events[0]),{all:{a:1},core:{a:1},extra:{}});assert.deepEqual(warnings(state,state.events[0]),[]);});
test('several optional roles count once as an extra appearance',()=>{const state=base([person('a',[],1)],[song('s',[{id:'x',label:'Флейта',required:false},{id:'y',label:'Скрипка',required:false}])],[request('a','s',[['a','x'],['a','y']],'hard')]);optimize(state,state.events[0]);assert.equal(Object.keys(state.events[0].songs[0].assigned).length,2);assert.deepEqual(participation(state.events[0]),{all:{a:1},core:{},extra:{a:1}});});
test('required flag alone controls classification, ignoring old independent primary flag',()=>{assert.equal(isPrimary({required:false,primary:true}),false);assert.equal(isPrimary({required:true,primary:false}),true);const n=applyAction(allSongsDemo('owner'),{type:'song',event:'demo-event',title:'Flags',artist:'Artist',duration:7,slots:[{label:'Вокал',required:true,primary:false},{label:'Флейта',required:false,primary:true}]},'owner');assert.deepEqual(n.events[0].songs.at(-1).slots.map(r=>[r.required,'primary' in r]),[[true,false],[false,false]]);});
test('one consent response confirms every role of that person',()=>{let s=participantState();s.people.push({id:'friend',auth:'friend',name:'Друг',roles:[],max:5});s=applyAction(s,{type:'apply',event:'demo-event',song:'s1',priority:2,together:'hard',members:[{person:'u',slot:'r1'},{person:'friend',slot:'r0'},{person:'friend',slot:'r2'}]},'u');const a=s.events[0].applications.at(-1);assert.deepEqual(a.members.map(m=>m.consent),['yes','yes','yes']);s=applyAction(s,{type:'consent',event:'demo-event',application:a.id,accept:true},'friend');assert.deepEqual(s.events[0].applications.at(-1).members.map(m=>m.consent),['yes','yes','yes']);});
test('duplicate role is rejected even when one musician plays several parts',()=>{assert.throws(()=>applyAction(participantState(),{type:'apply',event:'demo-event',song:'s1',priority:2,members:[{person:'u',slot:'r0'},{person:'u',slot:'r0'}]},'u'),/каждую партию/);});
test('existing participant promotions also respect the twelve-admin cap',()=>{const s=allSongsDemo('local_owner');for(let i=0;i<ADMIN_LIMIT;i++)s.people.push({id:'u'+i,auth:'local_u'+i,name:'User '+i,roles:[],max:5});let n=s;for(let i=0;i<ADMIN_LIMIT-1;i++)n=applyAction(n,{type:'admin',person:'u'+i},'local_owner');assert.equal(n.admins.length,ADMIN_LIMIT);assert.throws(()=>applyAction(n,{type:'admin',person:'u'+(ADMIN_LIMIT-1)},'local_owner'),/12 администраторов/);});

test('musicians can propose songs but cannot edit an existing song or published program',()=>{
 const state=participantState();const before=structuredClone(state.events[0].songs[0]);
 const action={type:'song',event:'demo-event',title:'Предложение участника',artist:'Artist',duration:7,slots:DEFAULT_SLOTS};
 const next=applyAction(state,action,'u');const added=next.events[0].songs.at(-1);
 assert.equal(added.title,action.title);assert.ok(!next.events[0].program.includes(added.id));assert.deepEqual(next.events[0].songs[0],before);
 for(const id of ['s1','nonexistent'])assert.throws(()=>applyAction(next,{...action,song:id},'u'),/администратора/);
 next.events[0].status='published';assert.throws(()=>applyAction(next,action,'u'),/опубликована/);
});

test('deleting and restoring the final event retains all songs, applications, assignments and publication status',()=>{
 for(const status of ['draft','published']){
  const state=participantState();state.events[0].status=status;const before=structuredClone(state.events[0]);
  assert.throws(()=>applyAction(state,{type:'deleteEvent',event:before.id},'u'),/администратора/);
  const deleted=applyAction(state,{type:'deleteEvent',event:before.id},'owner');assert.ok(deleted.events[0].deletedAt);
  assert.equal(deleted.events.filter(e=>!e.deletedAt).length,0);assert.equal(state.events[0].deletedAt,undefined);
  for(const actor of ['owner','u'])assert.throws(()=>applyAction(deleted,{type:'song',event:before.id,title:'No',artist:'No',duration:7,slots:DEFAULT_SLOTS},actor),/удалена/);
  assert.throws(()=>applyAction(deleted,{type:'restoreEvent',event:before.id},'u'),/администратора/);
  const restored=applyAction(deleted,{type:'restoreEvent',event:before.id},'owner');assert.deepEqual(restored.events[0],before);
 }
});

test('performer search includes free optional parts and excludes moderator-excluded songs',()=>{
 const s=song('s',[slot('v','Вокал'),{id:'f',label:'Флейта',required:false}]);
 assert.equal(seekingPerformers(s),true);s.assigned.v='a';assert.equal(complete(s),true);assert.equal(seekingPerformers(s),true);
 s.assigned.f='b';assert.equal(seekingPerformers(s),false);delete s.assigned.v;s.inclusion='exclude';assert.equal(seekingPerformers(s),false);
});

test('role weights match the requested hierarchy, with backing vocals always lightest',()=>{
 const weight=(label,required=true)=>allocationWeight({id:'r',label,required})/20;
 assert.equal(weight('Вокал'),2);assert.equal(weight('Вокал (дуэт)',false),2);
 assert.equal(weight('Соло-гитара'),1);assert.equal(weight('Ритм-гитара'),1);
 assert.equal(weight('Бас-гитара'),.5);assert.equal(weight('Барабаны'),.5);
 assert.equal(weight('Скрипка',false),.2);assert.equal(weight('Перкуссия',false),.2);
 assert.equal(weight('Бэк-вокал',false),.05);assert.equal(weight('Бэк-вокал'),.05);
});
function fresh(people,songs,apps=[]){const s=base(people.map(p=>({...p,auth:p.id})),songs,apps);s.events[0].rulesVersion=4;return s;}
const apply=(s,song,slot,priority=1,starred=false,person='a')=>applyAction(s,{type:'apply',event:'e',song,priority,members:[{person,slot,starred}]},person);
test('all three preference levels are unlimited on instruments, independent of vocal stars',()=>{
 let s=fresh([person('a',[],1)],Array.from({length:12},(_,i)=>song('s'+i,[slot('g','Соло-гитара')])));
 for(let i=0;i<12;i++)s=apply(s,'s'+i,'g',i%3+1);
 assert.equal(s.events[0].applications.length,12);assert.equal(starredSongs(s.events[0],'a').size,0);
 optimize(s,s.events[0]);assert.equal(counts(s.events[0]).a,12);assert.ok(!warnings(s,s.events[0]).some(w=>w.kind==='load'));
});
test('very-want vocal requests do not consume stars and more than three remain allowed',()=>{
 let s=fresh([person('a',[])],Array.from({length:7},(_,i)=>song('s'+i,[slot('v','Вокал')])));
 for(let i=0;i<7;i++)s=apply(s,'s'+i,'v');
 assert.equal(starredSongs(s.events[0],'a').size,0);
 assert.ok(s.events[0].applications.every(a=>Number.isFinite(Date.parse(a.createdAt))));
});
test('vocal star budget is three distinct songs, transferable and independent per meeting',()=>{
 let s=fresh([person('a',[])],Array.from({length:4},(_,i)=>song('s'+i,[slot('v','Вокал'),slot('duet','Вокал (дуэт)')])));
 for(let i=0;i<3;i++)s=apply(s,'s'+i,'v',2,true);
 s=apply(s,'s0','duet',3,true);assert.equal(starredSongs(s.events[0],'a').size,3);
 assert.throws(()=>apply(s,'s3','v',1,true),/до 3/);s=apply(s,'s3','v');
 s=applyAction(s,{type:'vocalStar',event:'e',song:'s0',starred:false},'a');
 s=applyAction(s,{type:'vocalStar',event:'e',song:'s3',starred:true},'a');assert.equal(starredSongs(s.events[0],'a').size,3);
 assert.ok(!s.events[0].applications.filter(a=>a.song==='s0').some(a=>a.members.some(m=>m.starred)));
 const next=structuredClone(s.events[0]);next.id='other';next.applications=[];s.events.push(next);
 s=applyAction(s,{type:'apply',event:'other',song:'s0',priority:1,members:[{person:'a',slot:'v',starred:true}]},'a');assert.equal(starredSongs(s.events[1],'a').size,1);
});
test('stars cannot be forged for someone else or non-vocal parts',()=>{
 const s=fresh([person('a',[]),person('b',[])],[song('s',[slot('v','Вокал'),slot('g','Соло-гитара')])]);
 assert.throws(()=>apply(s,'s','g',1,true),/только для вокала/);
 const both={...s,admins:['owner']};assert.throws(()=>applyAction(both,{type:'apply',event:'e',song:'s',priority:2,members:[{person:'a',slot:'g'},{person:'b',slot:'v',starred:true}]},'a'),/он сам/);
 assert.throws(()=>applyAction(both,{type:'vocalStar',event:'e',song:'s',person:'b',starred:true},'a'),/свои звёзды/);
});
test('application star checkbox updates the own song preference across vocal applications',()=>{
 let s=fresh([person('a',[])],[song('s',[slot('v','Вокал'),slot('duet','Вокал (дуэт)')])]);
 s=apply(s,'s','v',2,true);s=apply(s,'s','duet',2,false);
 assert.equal(starredSongs(s.events[0],'a').size,0);
 assert.ok(s.events[0].applications.every(a=>a.members.every(m=>!m.starred)));
 s=apply(s,'s','duet',2,true);
 assert.equal(starredSongs(s.events[0],'a').size,1);
 assert.ok(s.events[0].applications.every(a=>a.members.every(m=>m.starred)));
});
test('omitting a star preference leaves an existing favorite untouched',()=>{
 let s=fresh([person('a',[])],[song('s',[slot('v','Вокал'),slot('duet','Вокал (дуэт)')])]);
 s=apply(s,'s','v',2,true);
 s=applyAction(s,{type:'apply',event:'e',song:'s',priority:2,members:[{person:'a',slot:'duet'}]},'a');
 assert.ok(starredSongs(s.events[0],'a').has('s'));
});
test('inviting another singer cannot clear their existing vocal star',()=>{
 let s=fresh([person('a',[]),person('b',[])],[song('s',[slot('v','Вокал'),slot('duet','Вокал (дуэт)')])]);s.admins=['owner'];
 s=apply(s,'s','v',2,true,'b');
 s=applyAction(s,{type:'apply',event:'e',song:'s',priority:2,members:[{person:'b',slot:'duet',starred:false}]},'a');
 assert.ok(starredSongs(s.events[0],'b').has('s'));
 assert.equal(s.events[0].applications.at(-1).members[0].consent,'yes');
});
test('singers can select their own star before accepting an invitation',()=>{
 let s=fresh([person('a',[]),person('b',[])],[song('s',[slot('v','Вокал')])]);s.admins=['owner'];
 s=applyAction(s,{type:'apply',event:'e',song:'s',priority:2,members:[{person:'b',slot:'v'}]},'a');
 s=applyAction(s,{type:'vocalStar',event:'e',song:'s',starred:true},'b');
 assert.ok(starredSongs(s.events[0],'b').has('s'));
 assert.equal(s.events[0].applications.at(-1).members[0].consent,'yes');
});
test('only vocal songs use the hard profile maximum; instruments and backing vocals stay available',()=>{
 const songs=Array.from({length:4},(_,i)=>song('s'+i,[slot('v','Вокал'),slot('g','Соло-гитара'),{id:'bv',label:'Бэк-вокал',required:false}]));
 const apps=songs.flatMap(s=>[request(s.id+'v',s.id,[['a','v']]),request(s.id+'g',s.id,[['a','g']]),request(s.id+'bv',s.id,[['a','bv']])]);
 const s=fresh([person('a',[],1)],songs,apps);optimize(s,s.events[0]);
 assert.equal(vocalCounts(s.events[0]).a,1);assert.equal(counts(s.events[0]).a,4);
 assert.ok(s.events[0].songs.every(s=>s.assigned.g==='a'&&s.assigned.bv==='a'));
 assert.ok(!warnings(s,s.events[0]).some(w=>w.kind==='load'));
});
test('manual vocal pins survive even over the cap, but excess still needs moderator review',()=>{
 const s=fresh([person('a',[],1)],[song('x',[slot('v','Вокал')]),song('y',[slot('v','Вокал')])],[request('x','x',[['a','v']]),request('y','y',[['a','v']])]);
 s.events[0].songs.forEach(s=>{s.assigned.v='a';s.pins.v=true;});optimize(s,s.events[0]);
 assert.equal(vocalCounts(s.events[0]).a,2);assert.ok(warnings(s,s.events[0]).some(w=>w.kind==='load'));
});
test('coverage beats wishes and early arrival: newcomer gets their only song',()=>{
 const s=fresh([person('a',[]),person('b',[])],[song('x',[slot('g','Соло-гитара')]),song('y',[slot('g','Соло-гитара')])],[request('a-x','x',[['a','g']],'soft',1),request('a-y','y',[['a','g']],'soft',1),request('b-x','x',[['b','g']],'soft',3)]);
 optimize(s,s.events[0]);assert.equal(s.events[0].songs[0].assigned.g,'b');assert.equal(s.events[0].songs[1].assigned.g,'a');
});
test('weighted vocal load leaves the guitar slot to the less loaded participant',()=>{
 const s=fresh([person('a',[]),person('b',[])],[song('v',[slot('v','Вокал')]),song('g1',[slot('g','Соло-гитара')]),song('g2',[slot('g','Соло-гитара')])],[request('v','v',[['a','v']]),request('g1','g1',[['b','g']]),request('early','g2',[['a','g']]),request('late','g2',[['b','g']])]);
 optimize(s,s.events[0]);assert.equal(s.events[0].songs[2].assigned.g,'b');
});
test('backing vocals hardly penalize a musician seeking a lead guitar place',()=>{
 const s=fresh([person('a',[]),person('b',[])],[song('b',[{id:'bv',label:'Бэк-вокал',required:false}]),song('d',[slot('d','Барабаны')]),song('g',[slot('g','Соло-гитара')])],[request('b','b',[['a','bv']]),request('d','d',[['b','d']]),request('g-b','g',[['b','g']]),request('g-a','g',[['a','g']])]);
 optimize(s,s.events[0]);assert.equal(s.events[0].songs[2].assigned.g,'a');
});
test('first-role coverage uses the strongest role and the specified weights',()=>{
 const s=fresh([person('a',[]),person('b',[])],[song('g',[slot('g','Соло-гитара')]),song('d',[slot('d','Барабаны')]),song('v',[slot('v','Вокал')])],[request('g','g',[['a','g']]),request('d','d',[['b','d']]),request('early','v',[['a','v']]),request('late','v',[['b','v']])]);
 optimize(s,s.events[0]);assert.equal(s.events[0].songs[2].assigned.v,'b');
});
test('equal vocal workloads favor starred songs, without overriding coverage',()=>{
 const x=request('a-x','x',[['a','v']]),y=request('b-x','x',[['b','v']]),z=request('a-y','y',[['a','v']]),w=request('b-y','y',[['b','v']]);z.members[0].starred=true;y.members[0].starred=true;
 const s=fresh([person('a',[]),person('b',[])],[song('x',[slot('v','Вокал')]),song('y',[slot('v','Вокал')])],[x,y,z,w]);optimize(s,s.events[0]);
 assert.equal(s.events[0].songs[0].assigned.v,'b');assert.equal(s.events[0].songs[1].assigned.v,'a');
});
test('arrival order only breaks a true fairness tie and cannot monopolize later songs',()=>{
 const songs=Array.from({length:6},(_,i)=>song('s'+i,[slot('g','Соло-гитара')]));
 const apps=songs.flatMap(s=>[request('a'+s.id,s.id,[['a','g']]),request('b'+s.id,s.id,[['b','g']])]);
 for(const a of apps)a.createdAt=`${a.by==='a'?'2026-10-20':'2026-10-21'}T10:0${a.song.slice(1)}:00Z`;
 const s=fresh([person('a',[]),person('b',[])],songs,apps.reverse());optimize(s,s.events[0]);
 assert.deepEqual(counts(s.events[0]),{a:3,b:3});assert.equal(s.events[0].songs[0].assigned.g,'a');
 const saved=JSON.stringify(s.events[0].songs.map(s=>s.assigned));optimize(s,s.events[0]);assert.equal(JSON.stringify(s.events[0].songs.map(s=>s.assigned)),saved);
});
test('draft migration preserves wish levels, initializes only three vocal stars and leaves published events untouched',()=>{
 const songs=Array.from({length:5},(_,i)=>song('s'+i,[slot('v','Вокал'),slot('g','Соло-гитара')]));
 const s=fresh([person('a',[])],songs,songs.flatMap(s=>[request(s.id+'v',s.id,[['a','v']],'soft',1),request(s.id+'g',s.id,[['a','g']],'soft',1)]));s.events[0].rulesVersion=3;
 const published=structuredClone(s.events[0]);published.id='published';published.status='published';s.events.push(published);const before=JSON.stringify(published);
 assert.ok(retainDraftSongs(s));assert.equal(starredSongs(s.events[0],'a').size,3);assert.ok(s.events[0].applications.every(a=>a.priority===1));assert.ok(!s.events[0].applications.some(a=>a.members.some(m=>m.slot==='g'&&m.starred)));assert.equal(JSON.stringify(s.events[1]),before);assert.equal(retainDraftSongs(s),false);
});

test('a late singer is considered even when earlier singers exhaust the combination bound',()=>{
 const people=Array.from({length:8},(_,i)=>person('p'+i,[],30));
 const slots=[slot('v','Вокал'),slot('g','Соло-гитара'),slot('b','Бас-гитара'),slot('d','Барабаны'),slot('k','Клавиши')];
 const songs=[song('crowded',slots),...people.slice(0,7).map(p=>song(p.id,[slot('v','Вокал')]))];
 const apps=slots.flatMap(r=>people.map(p=>request(p.id+r.id,'crowded',[[p.id,r.id]])));
 for(const p of people.slice(0,7)){const s=songs.find(s=>s.id===p.id);s.assigned.v=p.id;s.pins.v=true;apps.push(request(p.id,p.id,[[p.id,'v']],'soft'));}
 const s=fresh(people,songs,apps);optimize(s,s.events[0]);assert.ok(Object.values(songs[0].assigned).includes('p7'));assert.equal(Object.keys(counts(s.events[0])).length,8);
});

function jointFixture(withC=true){
 const main=song('duet',[slot('v','Вокал'),slot('g','Соло-гитара')]);
 const stages=[['b','b1'],['b','b2'],...(withC?[['c','c1']]:[])];
 const songs=[main,...stages.map(([p,id])=>{const s=song(id,[slot('g','Соло-гитара')]);s.assigned.g=p;s.pins.g=true;return s;})];
 const apps=[request('together','duet',[['a','v'],['b','g']],'soft',3),request('competing','duet',[['c','g']],'soft',1),...stages.map(([p,id])=>request(id,id,[[p,'g']]))];
 return fresh([person('a',[]),person('b',[]),person('c',[])],songs,apps);
}
test('confirmed soft duo precedes balanced workload and personal preference',()=>{
 const s=jointFixture();optimize(s,s.events[0]);
 assert.deepEqual(s.events[0].songs[0].assigned,{v:'a',g:'b'});
 assert.equal(counts(s.events[0]).b,3);assert.equal(counts(s.events[0]).c,1);
 assert.ok(!warnings(s,s.events[0]).some(w=>w.kind==='group'));
});
test('a soft duo yields when it would leave another musician without an appearance',()=>{
 const s=jointFixture(false);optimize(s,s.events[0]);
 assert.equal(s.events[0].songs[0].assigned.v,'a');assert.equal(s.events[0].songs[0].assigned.g,'c');
 assert.deepEqual(new Set(Object.keys(counts(s.events[0]))),new Set(['a','b','c']));
});
test('confirmed soft duo precedes vocal stars, wish levels and early signup',()=>{
 const main=song('duet',[slot('v','Вокал'),slot('g','Соло-гитара')]);
 const x=song('a-solo',[slot('v','Вокал')]),y=song('b-solo',[slot('v','Вокал')]);x.assigned.v='a';x.pins.v=true;y.assigned.v='b';y.pins.v=true;
 const group=request('group','duet',[['a','v'],['c','g']],'soft',3);group.createdAt='2026-10-23T12:00:00Z';
 const early=request('early','duet',[['b','v']],'soft',1);early.createdAt='2026-10-20T12:00:00Z';early.members[0].starred=true;
 const s=fresh([person('a',[]),person('b',[]),person('c',[])],[main,x,y],[early,group,request('ax','a-solo',[['a','v']]),request('by','b-solo',[['b','v']])]);
 optimize(s,s.events[0]);assert.equal(main.assigned.v,'a');assert.equal(main.assigned.g,'c');assert.equal(counts(s.events[0]).b,1);
});
test('pending or declined soft partners earn no group priority through an independent application',()=>{
 for(const consent of ['pending','no']){
  const s=jointFixture();s.events[0].applications[0].members[1].consent=consent;
  s.events[0].applications.push(request('b-independent','duet',[['b','g']],'soft',3));
  optimize(s,s.events[0]);assert.equal(s.events[0].songs[0].assigned.g,'c',consent);
 }
});
test('repeating the same soft duo cannot overpower a different equally valid duo',()=>{
 const s=jointFixture();
 s.events[0].applications.push(request('other-duo','duet',[['a','v'],['c','g']],'soft',3));
 for(let i=0;i<20;i++)s.events[0].applications.push(request('duplicate-'+i,'duet',i%2?[['b','g'],['a','v']]:[['a','v'],['b','g']],'soft',3));
 optimize(s,s.events[0]);assert.equal(s.events[0].songs[0].assigned.g,'c');
});
test('soft relationships apply to one song and do not bind a singer to the same guitarist elsewhere',()=>{
 const s=jointFixture();const main=s.events[0].songs[0];
 const other=song('other',[slot('v','Вокал'),slot('g','Соло-гитара')]);s.events[0].songs.push(other);
 s.events[0].applications.push(request('a-other','other',[['a','v']]),request('b-other','other',[['b','g']],'soft',1),request('c-other','other',[['c','g']],'soft',3));
 optimize(s,s.events[0]);assert.equal(main.assigned.g,'b');assert.equal(other.assigned.g,'c');
});
test('a soft relationship never overrides a moderator pin',()=>{
 const s=jointFixture(),main=s.events[0].songs[0];main.assigned.g='c';main.pins.g=true;
 optimize(s,s.events[0]);assert.equal(main.assigned.g,'c');
});
test('full soft groups remain candidates beyond the song combination bound',()=>{
 const people=Array.from({length:8},(_,i)=>person('p'+i,[],30));
 const slots=[slot('v','Вокал'),slot('g','Соло-гитара'),slot('b','Бас-гитара'),slot('d','Барабаны'),slot('k','Клавиши')];
 const main=song('crowded',slots),songs=[main,...people.map(p=>{const s=song(p.id,[slot('v','Вокал')]);s.assigned.v=p.id;s.pins.v=true;return s;})];
 const apps=slots.flatMap(r=>people.map(p=>request(p.id+r.id,'crowded',[[p.id,r.id]])));
 apps.push(...people.map(p=>request(p.id,p.id,[[p.id,'v']])));
 apps.push(request('late-joint','crowded',[['p7','v'],['p6','g']],'soft',3));
 const s=fresh(people,songs,apps);optimize(s,s.events[0]);assert.equal(main.assigned.v,'p7');assert.equal(main.assigned.g,'p6');
});


// Flexible offers express alternatives; they never reserve every possible role.
const flexibleAction=(members,extra={})=>({type:'apply',event:'demo-event',song:'s1',priority:2,members,...extra});
test('any part offers survive recalculation without taking the drummer place',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'u',slot:'__any'}],{priority:1}),'u');const e=s.events[0],song=e.songs[0],saved=structuredClone(e.applications.at(-1));
 assert.equal(flexibleApplicants(e,song,'r3').some(m=>m.person==='u'),true);assert.equal(applicants(e,song.id,'r3').some(m=>m.person==='u'),false);
 optimize(s,e);assert.equal(song.assigned.r3,'p4');assert.equal(Object.values(song.assigned).filter(p=>p==='u').length,1);assert.deepEqual(e.applications.at(-1),saved);assert.equal(counts(e).u,1);
});
test('several alternative parts show readiness only on the selected parts',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'u',slot:'__choice',alternatives:['r1','r2']}]),'u');const e=s.events[0],song=e.songs[0];
 assert.ok(flexibleApplicants(e,song,'r1').some(m=>m.person==='u'));assert.ok(flexibleApplicants(e,song,'r2').some(m=>m.person==='u'));assert.ok(!flexibleApplicants(e,song,'r3').some(m=>m.person==='u'));assert.match(memberPart(song,e.applications.at(-1).members[0]),/Ритм-гитара.*Бас-гитара/);
 optimize(s,e);assert.ok(!Object.values(song.assigned).includes('u'));
});
test('one selected alternative remains a reserve offer until assigned',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'u',slot:'__choice',alternatives:['r3','r3']}]),'u');const m=s.events[0].applications.at(-1).members[0];assert.equal(m.slot,'__choice');assert.deepEqual(m.alternatives,['r3']);assert.equal(m.consent,'yes');
});
test('empty or unknown alternatives are rejected atomically',()=>{
 const s=participantState(),before=JSON.stringify(s);for(const alternatives of [[],['r1','missing'],['__any'],null])assert.throws(()=>applyAction(s,flexibleAction([{person:'u',slot:'__choice',alternatives}]),'u'),/Выберите/);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>applyAction(s,flexibleAction([{person:'u',slot:'__any'},{person:'u',slot:'r3'}]),'u'),/один раз/);
});
test('readiness does not make a song complete or count one person twice',()=>{
 const s=base([person('a',[])],[song('s',[slot('g','Гитара'),slot('d','Барабаны')])],[request('any','s',[['a','__any']]),request('duplicate','s',[['a','__any']])]);const e=s.events[0];assert.equal(readiness(e,e.songs[0],'g'),1);optimize(s,e);assert.equal(complete(e.songs[0]),false);assert.deepEqual(e.songs[0].assigned,{});assert.deepEqual(counts(e),{});assert.ok(warnings(s,e).some(w=>w.kind==='incomplete'));
});
test('recorded flexible offers show readiness until the musician declines',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'owner',slot:'__any'},{person:'u',slot:'r0'}],{together:'soft'}),'u');const e=s.events[0],a=e.applications.at(-1);assert.equal(flexibleApplicants(e,e.songs[0]).length,1);
 s=applyAction(s,{type:'consent',event:e.id,application:a.id,person:'owner',accept:true},'owner');assert.equal(flexibleApplicants(s.events[0],s.events[0].songs[0]).length,1);
 s=applyAction(s,{type:'consent',event:e.id,application:a.id,person:'owner',accept:false},'owner');assert.equal(flexibleApplicants(s.events[0],s.events[0].songs[0]).length,0);
});
test('hard group with an unresolved member cannot be assigned by the algorithm',()=>{
 const s=base([person('a',[]),person('b',[])],[song('s',[slot('v','Вокал'),slot('g','Гитара')])],[request('hard','s',[['a','v'],['b','__any']],'hard')]);optimize(s,s.events[0]);assert.deepEqual(s.events[0].songs[0].assigned,{});
});
test('soft group never creates a fake slot while considering whole-group seeds',()=>{
 const s=base([person('a',[]),person('b',[])],[song('s',[slot('v','Вокал'),slot('g','Гитара')])],[request('soft','s',[['a','v'],['b','__any']])]);optimize(s,s.events[0]);assert.deepEqual(s.events[0].songs[0].assigned,{v:'a'});
});
test('moderator resolves exactly one offered part and pins the consented assignment',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'u',slot:'__choice',alternatives:['r1','r2']}]),'u');const a=s.events[0].applications.at(-1);const resolve={type:'resolve',event:'demo-event',song:'s1',application:a.id,member:0,slot:'r1'};
 assert.throws(()=>applyAction(s,resolve,'u'),/администратора/);assert.throws(()=>applyAction(s,{...resolve,slot:'r3'},'owner'),/не указана/);assert.throws(()=>applyAction(s,resolve,'owner'),/занята/);
 s=applyAction(s,{type:'assign',replace:true,event:'demo-event',song:'s1',slot:'r1',person:''},'owner');s=applyAction(s,resolve,'owner');const song=s.events[0].songs[0],m=s.events[0].applications.at(-1).members[0];assert.equal(m.slot,'r1');assert.equal(m.alternatives,undefined);assert.equal(m.consent,'yes');assert.equal(song.assigned.r1,'u');assert.equal(song.pins.r1,true);assert.equal(song.assigned.r2,'p5');optimize(s,s.events[0]);assert.equal(song.assigned.r1,'u');
});
// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.
test('flexible vocal stars count towards the same three songs and clear on nonvocal resolution',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'u',slot:'__choice',alternatives:['r0','lead'],starred:true}]),'u');assert.ok(starredSongs(s.events[0],'u').has('s1'));const a=s.events[0].applications.at(-1);s=applyAction(s,{type:'assign',replace:true,event:'demo-event',song:'s1',slot:'lead',person:''},'owner');s=applyAction(s,{type:'resolve',event:'demo-event',song:'s1',application:a.id,member:0,slot:'lead'},'owner');assert.equal(starredSongs(s.events[0],'u').size,0);
});
test('a part referenced by an alternative cannot silently be removed',()=>{
 let s=participantState();s=applyAction(s,flexibleAction([{person:'u',slot:'__choice',alternatives:['duet','lead']}]),'u');const song=s.events[0].songs[0];assert.throws(()=>applyAction(s,{type:'song',event:'demo-event',song:song.id,title:song.title,artist:song.artist,duration:song.duration,slots:song.slots.filter(r=>r.id!=='duet')},'owner'),/Сначала снимите/);
});
test('comments have server authorship and can be deleted only by their author or an admin',()=>{
 let s=participantState();s=applyAction(s,{type:'comment',event:'demo-event',song:'s1',comment:'  На тон выше.\nМогу уступить бас.  ',by:'owner'},'u');const c=s.events[0].songs[0].comments[0];assert.equal(c.by,'u');assert.equal(c.body,'На тон выше.\nМогу уступить бас.');assert.ok(c.id&&c.createdAt);
 s.people.push({id:'other',auth:'other',name:'Other',roles:[],max:5});assert.throws(()=>applyAction(s,{type:'deleteComment',event:'demo-event',song:'s1',commentId:c.id},'other'),/чужой/);
 const removed=applyAction(s,{type:'deleteComment',event:'demo-event',song:'s1',commentId:c.id},'u');assert.deepEqual(removed.events[0].songs[0].comments,[]);assert.deepEqual(applyAction(s,{type:'deleteComment',event:'demo-event',song:'s1',commentId:c.id},'owner').events[0].songs[0].comments,[]);
});
test('application comment is saved atomically and comments do not alter published lineups',()=>{
 const original=participantState(),before=JSON.stringify(original);assert.throws(()=>applyAction(original,flexibleAction([{person:'u',slot:'__any'}],{comment:'x'.repeat(1001)}),'u'),/Проверьте/);assert.equal(JSON.stringify(original),before);
 let s=applyAction(original,flexibleAction([{person:'u',slot:'__any'}],{comment:'Могу взять любую партию'}),'u');assert.equal(s.events[0].songs[0].comments.find(c=>!c.readiness).body,'Могу взять любую партию');s.events[0].status='published';const saved=JSON.stringify(s.events[0].songs.map(x=>x.assigned));s=applyAction(s,{type:'comment',event:'demo-event',song:'s1',comment:'Готовлю партию'},'u');assert.equal(JSON.stringify(s.events[0].songs.map(x=>x.assigned)),saved);assert.throws(()=>applyAction(s,{type:'comment',event:'demo-event',song:'s1',comment:'   '},'u'),/Проверьте/);
});


test('the main song preview preserves the first comment by the proposal author',()=>{
 const s=participantState(),e=s.events[0],song=e.songs[0];song.proposedBy='u';song.comments=[{id:'other',by:'owner',body:'Other person commented first',createdAt:'2026-10-27T10:00:00Z'},{id:'intro',by:'u',body:'Original version in Am',createdAt:'2026-10-27T10:01:00Z'},{id:'followup',by:'u',body:'Another comment',createdAt:'2026-10-27T10:02:00Z'}];assert.equal(firstCreatorComment(song,e).id,'intro');assert.equal(song.comments.length,3);
 song.comments= song.comments.filter(c=>c.by!=='u');assert.equal(firstCreatorComment(song,e),undefined);
});
test('song proposal stores its author and introductory comment in one operation',()=>{
 const original=participantState(),action={type:'song',event:'demo-event',title:'New proposal',artist:'Artist',duration:7,comment:'Original key, any lineup welcome',slots:[{label:'Вокал',required:true},{label:'Гитара',required:true}],proposedBy:'owner'};
 const s=applyAction(original,action,'u'),e=s.events[0],song=e.songs.at(-1);assert.equal(song.proposedBy,'u');assert.equal(firstCreatorComment(song,e).by,'u');assert.equal(song.comments[0].body,action.comment);
 assert.throws(()=>applyAction(original,{...action,comment:'x'.repeat(1001)},'u'),/Проверьте/);assert.equal(original.events[0].songs.length,12);
});
test('legacy song preview uses the author of its first saved application',()=>{
 const s=participantState(),e=s.events[0],song=e.songs[0],author=e.applications.find(a=>a.song===song.id).by;song.comments=[{id:'first',by:author,body:'First',createdAt:''},{id:'last',by:author,body:'Last',createdAt:''}];assert.equal(firstCreatorComment(song,e).id,'first');
});
// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.
test('no-appearance review starts after allocation, is scoped to active applicants and clears on reset',()=>{
 let s=base(['a','b','pending','declined','absent','other-jam'].map(id=>({...person(id,[]),auth:id})),[song('s',[slot('g','Гитара')])],[request('a-request','s',[['a','g']],'soft',1),request('b-request','s',[['b','g']]),request('pending-request','s',[['pending','__any']]),request('declined-request','s',[['declined','g']])]);
 s.events[0].applications[2].members[0].consent='pending';s.events[0].applications[3].members[0].consent='no';s.events.push({...structuredClone(s.events[0]),id:'other',applications:[request('elsewhere','s',[['other-jam','g']])]});
 const noShows=()=>reviewIssues(s,s.events[0]).filter(x=>x.kind==='no-show');assert.deepEqual(noShows(),[]);
 s=applyAction(s,{type:'optimize',event:'e'},'a');assert.deepEqual(noShows().map(x=>x.id),['no-show-b']);assert.match(noShows()[0].text,/пока нет выступлений/);
 s=applyAction(s,{type:'assign',replace:true,event:'e',song:'s',slot:'g',person:'b'},'a');assert.deepEqual(noShows().map(x=>x.id),['no-show-a']);
 s=applyAction(s,{type:'resetAllocation',event:'e'},'a');assert.deepEqual(noShows(),[]);s=applyAction(s,{type:'optimize',event:'e'},'a');assert.deepEqual(noShows().map(x=>x.id),['no-show-a']); // The moderator's pin remains in place.
});
test('an accepted invitation and a flexible application count as requests, and any assigned role avoids a no-appearance warning',()=>{
 const s=base([person('invited',[]),person('flexible',[]),person('backing',[])],[song('s',[{id:'b',label:'Бэк-вокал',required:false}])],[request('accepted','s',[['invited','__any']]),request('flexible','s',[['flexible','__choice']]),request('backing','s',[['backing','b']])]);const e=s.events[0];e.applications[1].members[0].alternatives=['b'];e.program=['s'];e.allocatedAt=new Date().toISOString();e.songs[0].assigned.b='backing';assert.deepEqual(reviewIssues(s,e).filter(x=>x.kind==='no-show').map(x=>x.id),['no-show-invited','no-show-flexible']);
});


test('site nicknames are stable, unique and assigned only to joined profiles',()=>{
 const s=participantState();s.people.push({id:'collision',auth:'new_owner',name:'Second',roles:[],max:5},{id:'manual',name:'Managed',roles:[],max:5});assert.ok(ensureNicknames(s));const handles=s.people.filter(isRegistered).map(p=>p.nickname);assert.equal(new Set(handles).size,handles.length);assert.ok(handles.every(n=>/^[a-z0-9_]{3,32}$/.test(n)));assert.equal(s.people.find(p=>p.id==='manual').nickname,undefined);assert.equal(ensureNicknames(s),false);assert.equal(normalizeNickname(' @MiXeD_Name '),'mixed_name');
});
test('name-based nickname suggestions transliterate names, handle duplicates and fit the nickname limit',()=>{
 assert.equal(suggestNickname('Иван Петров',[]),'ivan_petrov');assert.equal(suggestNickname('Артём Гусаков',[]),'artyom_gusakov');assert.equal(suggestNickname('Jörg Müller',[]),'jorg_muller');assert.equal(suggestNickname('  Саша--Ким  ',[]),'sasha_kim');assert.equal(suggestNickname('p',[]),'p_jam');assert.equal(suggestNickname('🎸',[]),'musician');
 const people=[{id:'1',nickname:'Ivan_Petrov'},{id:'2',nickname:'ivan_petrov_2'}];assert.equal(suggestNickname('Иван Петров',people),'ivan_petrov_3');assert.equal(suggestNickname('Иван Петров',people,'1'),'ivan_petrov');
 const long='a'.repeat(80),first=suggestNickname(long,[]),second=suggestNickname(long,[{id:'1',nickname:first}]);assert.equal(first.length,32);assert.equal(second.length,32);assert.match(second,/_2$/);assert.match(second,/^[a-z0-9_]{3,32}$/);
});
test('legacy technical nicknames become readable without changing custom nicknames or applications',()=>{
 const s=participantState();s.people.find(p=>p.id==='owner').nickname='jam_owner';delete s.people.find(p=>p.id==='owner').nicknameSource;const p=s.people.find(p=>p.id==='u');p.name='Иван Петров';p.nickname='my_stage_name';
 s.people.push({id:'legacy',auth:'local_1234567890',name:'Иван Петров',roles:[],max:5,nickname:'jam_1234567890'},{id:'custom',auth:'local_9876543210',name:'Custom',roles:[],max:5,nickname:'jam_9876543210',nicknameSource:'custom'});
 const events=structuredClone(s.events);assert.ok(ensureNicknames(s));assert.equal(s.people.find(p=>p.id==='owner').nickname,'vy_jam');assert.equal(p.nickname,'my_stage_name');assert.equal(s.people.find(p=>p.id==='legacy').nickname,'ivan_petrov');assert.equal(s.people.find(p=>p.id==='custom').nickname,'jam_9876543210');assert.deepEqual(s.events,events);assert.equal(ensureNicknames(s),false);
});
test('nickname validation is shared by signup and profiles and ignores only the same profile',()=>{
 const people=[{id:'1',nickname:'ivan_petrov'}];assert.equal(validateNickname(' @New_Name ',people),'new_name');assert.equal(validateNickname('IVAN_PETROV',people,'1'),'ivan_petrov');assert.throws(()=>validateNickname('@IVAN_PETROV',people),/уже занят/);for(const invalid of ['xy','bad nick','юзер','x'.repeat(33)])assert.throws(()=>validateNickname(invalid,people),/Ник:/);
});
test('nickname changes are normalized, unique and cannot rename another participant',()=>{
 let s=participantState();s=applyAction(s,{type:'profile',name:'User',max:5,roles:[],nickname:'@Guitar_Player'},'u');assert.equal(s.people.find(p=>p.id==='u').nickname,'guitar_player');
 assert.throws(()=>applyAction(s,{type:'profile',name:'Owner',max:5,roles:[],nickname:'GUITAR_PLAYER'},'owner'),/уже занят/);assert.throws(()=>applyAction(s,{type:'profile',name:'User',max:5,roles:[],nickname:'bad nickname'},'u'),/Ник:/);
 const next=applyAction(s,{type:'profile',person:'owner',name:'User',max:5,roles:[],nickname:'own_new_nick'},'u');assert.equal(next.people.find(p=>p.id==='owner').nickname,s.people.find(p=>p.id==='owner').nickname);assert.equal(next.people.find(p=>p.id==='u').nickname,'own_new_nick');
});
test('a participant can invite another registered player without also joining the song',()=>{
 let s=participantState();s.people.push({id:'friend',auth:'friend',name:'Friend',roles:[],max:5});s=applyAction(s,flexibleAction([{person:'friend',slot:'lead'}],{agreed:true}),'u');const a=s.events[0].applications.at(-1);assert.equal(a.by,'u');assert.equal(a.members[0].consent,'yes');assert.ok(applicants(s.events[0],'s1','lead').some(m=>m.person==='friend'));s=applyAction(s,{type:'consent',event:'demo-event',application:a.id,accept:true},'friend');assert.ok(applicants(s.events[0],'s1','lead').some(m=>m.person==='friend'));
});
test('inviting a managed profile is reserved for administrators',()=>{
 const s=participantState();s.people.push({id:'managed',name:'Managed',roles:[],max:5});assert.throws(()=>applyAction(s,flexibleAction([{person:'managed',slot:'lead'}]),'u'),/присоединился/);const n=applyAction(s,flexibleAction([{person:'managed',slot:'lead'}],{agreed:true}),'owner');assert.equal(n.events[0].applications.at(-1).members[0].consent,'yes');
});


function bookingFixture(){const s=base(['writer','target','admin'].map(id=>({id,auth:id,name:id,roles:[],max:5})),[song('s',[slot('g','Соло-гитара')])],[]);s.admins=['admin'];return s;}
const booking=(members,extra={})=>({type:'apply',event:'e',song:'s',priority:2,members,...extra});
// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.
test('accepting an invitation keeps the booking but releases its provisional hold',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'target',slot:'g'}]),'writer');const id=s.events[0].applications[0].id;s=applyAction(s,{type:'consent',event:'e',application:id,accept:true},'target');const e=s.events[0];assert.equal(e.songs[0].assigned.g,'target');assert.equal(e.songs[0].reservations?.g,undefined);assert.equal(assignmentNote(s,e,e.songs[0],'g'),'');assert.equal(applicants(e,'s','g')[0].person,'target');assert.deepEqual(warnings(s,e),[]);
});
test('rejecting or withdrawing a provisional invitation frees the part',()=>{
 for(const type of ['consent','withdraw']){let s=bookingFixture();s=applyAction(s,booking([{person:'target',slot:'g'}]),'writer');const id=s.events[0].applications[0].id;s=applyAction(s,{type,event:'e',application:id,accept:false},type==='consent'?'target':'writer');assert.equal(s.events[0].songs[0].assigned.g,undefined,type);assert.equal(s.events[0].songs[0].reservations?.g,undefined,type);}
});
test('decline frees the same musician but preserves a different manual replacement',()=>{
 for(const replacement of ['writer','target']){let s=bookingFixture();s=applyAction(s,booking([{person:'target',slot:'g'}]),'writer');const id=s.events[0].applications[0].id;s=applyAction(s,{type:'assign',replace:true,event:'e',song:'s',slot:'g',person:replacement},'admin');s=applyAction(s,{type:'consent',event:'e',application:id,accept:false},'target');assert.equal(s.events[0].songs[0].assigned.g,replacement==='target'?undefined:replacement);assert.equal(s.events[0].songs[0].pins.g,replacement==='target'?undefined:true);}
});
// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.
test('plain-name entry creates an unlinked booking even when an account has the same name',()=>{
 let s=bookingFixture();s.people.find(p=>p.id==='target').name='Коля';s=applyAction(s,booking([{person:'__name',name:'Коля',slot:'g'}]),'writer');const e=s.events[0],m=e.applications[0].members[0],p=s.people.find(p=>p.id===m.person);assert.notEqual(p.id,'target');assert.equal(p.auth,undefined);assert.equal(p.nickname,undefined);assert.equal(p.unlinkedBy,'writer');assert.equal(m.consent,'yes');assert.equal(e.songs[0].assigned.g,p.id);assert.equal(assignmentNote(s,s.events[0],s.events[0].songs[0],'r0'),'');assert.deepEqual(applicationsFor(e,'target'),[]);assert.equal(applicationsFor(e,'writer').length,1);optimize(s,e);assert.equal(e.songs[0].assigned.g,p.id);
});
test('plain names reuse only the same author unlinked profile and never match by account name',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'__name',name:'  Коля  ',slot:'g'}]),'writer');const personId=s.events[0].applications[0].members[0].person;s.events[0].songs.push(song('s2',[slot('g','Гитара')]));s=applyAction(s,booking([{person:'__name',name:'КОЛЯ',slot:'g'}],{song:'s2'}),'writer');assert.equal(s.events[0].applications[1].members[0].person,personId);
 const other=applyAction(s,booking([{person:'__name',name:'Коля',slot:'g'}],{song:'s2'}),'target');assert.notEqual(other.events[0].applications.at(-1).members[0].person,personId);
});
test('invalid plain names leave the original state unchanged and cannot forge approval',()=>{
 const original=bookingFixture(),before=JSON.stringify(original);for(const name of ['', '   ', 'x'.repeat(81)])assert.throws(()=>applyAction(original,booking([{person:'__name',name,slot:'g'}]),'writer'),/Проверьте/);assert.equal(JSON.stringify(original),before);
 const s=applyAction(original,booking([{person:'__name',name:'Guest',slot:'g'}],{agreed:true}),'writer');assert.equal(s.events[0].applications[0].members[0].consent,'yes');
});
test('an administrator can confirm an unlinked booking without attaching an account',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'__name',name:'Guest',slot:'g'}]),'writer');const a=s.events[0].applications[0],personId=a.members[0].person;s=applyAction(s,{type:'consent',event:'e',application:a.id,person:personId,accept:true},'admin');assert.equal(s.events[0].songs[0].assigned.g,personId);assert.equal(s.events[0].songs[0].reservations?.g,undefined);assert.equal(s.people.find(p=>p.id===personId).auth,undefined);assert.deepEqual(warnings(s,s.events[0]),[]);
});
test('only incoming pending invitations sort ahead of the recipient other applications',()=>{
 const s=bookingFixture(),e=s.events[0];e.applications=[request('old','s',[['target','g']]),{...request('outgoing','s',[['writer','g']]),by:'target',members:[{person:'writer',slot:'g',consent:'pending'}]},{...request('incoming','s',[['target','g']]),by:'writer',members:[{person:'target',slot:'g',consent:'pending'}]}];assert.deepEqual(applicationsFor(e,'target').map(a=>a.id),['incoming','old','outgoing']);assert.equal(e.applications[0].id,'old');
});
test('flexible invitations never occupy all of the possible parts',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('v','Вокал'));for(const m of [{person:'target',slot:'__any'},{person:'__name',name:'Guest',slot:'__choice',alternatives:['g','v']}]){const n=applyAction(s,booking([m]),'writer');assert.deepEqual(n.events[0].songs[0].assigned,{});assert.equal(Object.keys(n.events[0].songs[0].reservations||{}).length,0);}
});
test('pending bookings migrate once, while published lineups remain intact',()=>{
 const s=bookingFixture(),e=s.events[0];e.applications=[{...request('invite','s',[['target','g']]),members:[{person:'target',slot:'g',consent:'pending'}]}];assert.equal(syncReservations(e),true);assert.equal(syncReservations(e),false);assert.equal(e.songs[0].assigned.g,'target');e.status='published';const saved=JSON.stringify(e.songs[0].assigned);const n=applyAction(s,{type:'consent',event:'e',application:'invite',accept:false},'target');assert.equal(JSON.stringify(n.events[0].songs[0].assigned),saved);
});


test('vacancy filters separate core role families and combine backing vocals with extra instruments',()=>{
 for(const [part,expected] of [[slot('v','Вокал'),'vocal'],[{id:'duet',label:'Вокал (дуэт)',required:false},'vocal'],[slot('g','Соло-гитара'),'lead_guitar'],[slot('r','Ритм-гитара'),'rhythm_guitar'],[slot('legacy','Гитара'),'rhythm_guitar'],[slot('b','Бас-гитара'),'bass'],[slot('d','Барабаны'),'drums'],[slot('back','Бэк-вокал'),'extras'],[{id:'flute',label:'Флейта',required:false},'extras'],[slot('keys','Клавиши'),'extras']])assert.equal(vacancyFamily(part),expected,part.label);
});
test('role filters match only unoccupied parts in included songs',()=>{
 const s=song('s',[slot('v','Вокал'),slot('b','Бас'),slot('d','Барабаны'),slot('g','Соло-гитара'),slot('r','Ритм-гитара'),{id:'k',label:'Клавиши',required:false}]);s.assigned.v='singer';s.assigned.d='drummer';s.assigned.g='soloist';assert.equal(hasVacancy(s,'rhythm_guitar'),true);delete s.assigned.g;s.assigned.r='rhythm';assert.equal(hasVacancy(s,'lead_guitar'),true);assert.equal(hasVacancy(s,'rhythm_guitar'),false);s.assigned.g='soloist';assert.equal(hasVacancy(s,'vocal'),false);assert.equal(hasVacancy(s,'drums'),false);assert.equal(hasVacancy(s,'lead_guitar'),false);assert.equal(hasVacancy(s,'bass'),true);assert.equal(hasVacancy(s,'extras'),true);assert.equal(hasVacancy(s,'all'),true);s.inclusion='exclude';assert.equal(hasVacancy(s,'all'),false);
});
test('provisional occupied parts are excluded from vacancy filters',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'target',slot:'g'}]),'writer');assert.equal(hasVacancy(s.events[0].songs[0],'lead_guitar'),false);assert.equal(slotAvailability(s.events[0],s.events[0].songs[0],'g'),'occupied');
});
test('flexible readiness stays grey and free until a concrete booking occupies the part',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('v','Вокал'));s=applyAction(s,booking([{person:'writer',slot:'__any'}]),'writer');let e=s.events[0];assert.equal(slotAvailability(e,e.songs[0],'g'),'tentative');assert.equal(hasVacancy(e.songs[0],'lead_guitar'),true);s=applyAction(s,booking([{person:'target',slot:'g'}]),'writer');e=s.events[0];assert.equal(slotAvailability(e,e.songs[0],'g'),'occupied');assert.equal(slotAvailability(e,e.songs[0],'v'),'tentative');assert.equal(e.applications[0].members[0].slot,'__any');
});
test('song sorting supports title and vacancy count without changing saved song or program order',()=>{
 const first=song('first',[slot('g','Гитара'),slot('v','Вокал')]),second=song('second',[slot('g','Гитара')]),third=song('third',[slot('g','Гитара')]);first.title='Я';second.title='А';third.title='Б';second.assigned.g='p';const songs=[first,second,third];assert.deepEqual(sortSongs(songs,'added').map(s=>s.id),['first','second','third']);assert.deepEqual(sortSongs(songs,'title').map(s=>s.id),['second','third','first']);assert.deepEqual(sortSongs(songs,'vacancies').map(s=>s.id),['first','third','second']);assert.deepEqual(songs.map(s=>s.id),['first','second','third']);
});


function editRequest(state,id,members,actor='writer',extra={}){const previous=state.events[0].applications.find(a=>a.id===id);return applyAction(state,{type:'updateApplication',event:'e',application:id,song:previous?.song,priority:previous?.priority||2,together:previous?.together||'soft',members,...extra},actor);}
test('editing alternative parts preserves application identity, signup order and desired level',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('v','Вокал'),slot('d','Барабаны'));
 s=applyAction(s,booking([{person:'writer',slot:'__choice',alternatives:['v','g'],starred:true}]),'writer');
 const previous=structuredClone(s.events[0].applications[0]);const n=editRequest(s,previous.id,[{person:'writer',slot:'__choice',alternatives:['g','d']}]);
 const next=n.events[0].applications[0];assert.equal(n.events[0].applications.length,1);assert.equal(next.id,previous.id);assert.equal(next.createdAt,previous.createdAt);assert.equal(next.by,previous.by);assert.equal(next.priority,previous.priority);assert.deepEqual(next.members[0].alternatives,['g','d']);assert.deepEqual(n.events[0].songs[0].assigned,{});assert.equal(starredSongs(n.events[0],'writer').size,0);assert.deepEqual(s.events[0].applications[0],previous);
});
test('editing concrete parts releases removed bookings and immediately fills added free parts',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('d','Барабаны'),slot('b','Бас'));
 s=applyAction(s,booking([{person:'writer',slot:'g'},{person:'writer',slot:'d'}]),'writer');const id=s.events[0].applications[0].id;
 s=editRequest(s,id,[{person:'writer',slot:'d'},{person:'writer',slot:'b'}]);assert.deepEqual(s.events[0].songs[0].assigned,{d:'writer',b:'writer'});
 s=editRequest(s,id,[{person:'writer',slot:'__any'}]);assert.deepEqual(s.events[0].songs[0].assigned,{});
 s=editRequest(s,id,[{person:'writer',slot:'g'}]);assert.deepEqual(s.events[0].songs[0].assigned,{g:'writer'});
});
test('editing an invitation retains unchanged consent and re-requests a changed party',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('d','Барабаны'),slot('b','Бас'));
 s=applyAction(s,booking([{person:'writer',slot:'b'},{person:'target',slot:'g'}]),'writer');const id=s.events[0].applications[0].id;
 s=applyAction(s,{type:'consent',event:'e',application:id,accept:true},'target');
 s=editRequest(s,id,[{person:'writer',slot:'b'},{person:'target',slot:'g'}]);assert.equal(s.events[0].applications[0].members[1].consent,'yes');
 s=editRequest(s,id,[{person:'writer',slot:'b'},{person:'target',slot:'d',consent:'yes'}],'writer',{agreed:true});const e=s.events[0];assert.equal(e.applications[0].members[1].consent,'yes');assert.equal(e.songs[0].assigned.g,undefined);assert.equal(e.songs[0].assigned.d,'target');assert.equal(e.songs[0].main.d.application,id);
 s=editRequest(s,id,[{person:'writer',slot:'b'}]);assert.equal(s.events[0].songs[0].assigned.d,undefined);assert.equal(s.events[0].songs[0].reservations?.d,undefined);
});
test('editing keeps pins and bookings supported by another application',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('d','Барабаны'),slot('b','Бас'));
 s=applyAction(s,booking([{person:'writer',slot:'g'},{person:'writer',slot:'d'}]),'writer');const id=s.events[0].applications[0].id;
 s=applyAction(s,booking([{person:'writer',slot:'d'}]),'writer');s=applyAction(s,{type:'assign',replace:true,event:'e',song:'s',slot:'g',person:'writer'},'admin');
 s=editRequest(s,id,[{person:'writer',slot:'b'}]);assert.deepEqual(s.events[0].songs[0].assigned,{g:'writer',d:'writer',b:'writer'});assert.equal(s.events[0].songs[0].pins.g,true);
});
test('editing cannot alter another author application, transfer songs or overwrite stale edits',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'writer',slot:'g'}]),'writer');const a=s.events[0].applications[0],snapshot=structuredClone(s);
 assert.throws(()=>editRequest(s,a.id,[{person:'target',slot:'g'}],'target'),/чужую заявку/);
 assert.throws(()=>editRequest(s,a.id,[{person:'writer',slot:'g'}],'writer',{song:'another'}),/другую песню/);
 assert.throws(()=>editRequest(s,'missing',[{person:'writer',slot:'g'}]),/чужую заявку/);
 assert.throws(()=>editRequest(s,a.id,[{person:'writer',slot:'g'}],'writer',{expectedApplication:{...a,priority:3}}),/уже изменилась/);
 assert.deepEqual(s,snapshot);s.events[0].status='published';assert.throws(()=>editRequest(s,a.id,[{person:'writer',slot:'g'}]),/опубликована/);
});
test('editing preserves another singer star and their existing account link',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('v','Вокал'),slot('d','Барабаны'));
 s=applyAction(s,booking([{person:'target',slot:'v'}]),'writer');const id=s.events[0].applications[0].id;s=applyAction(s,{type:'vocalStar',event:'e',song:'s',starred:true},'target');
 s=editRequest(s,id,[{person:'target',slot:'v',starred:false},{person:'writer',slot:'d'}]);assert.ok(starredSongs(s.events[0],'target').has('s'));assert.equal(s.events[0].applications[0].members[0].person,'target');
 s=editRequest(s,id,[{person:'target',slot:'v'},{person:'writer',slot:'g'}]);assert.ok(starredSongs(s.events[0],'target').has('s'));
});
test('invalid edits are atomic and valid edits still work at the application count limit',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'writer',slot:'g'}]),'writer');const id=s.events[0].applications[0].id,old=structuredClone(s);
 assert.throws(()=>editRequest(s,id,[{person:'writer',slot:'__custom',instrument:'Флейта'},{person:'writer',slot:'missing'}]));assert.deepEqual(s,old);
 while(s.events[0].applications.length<600)s.events[0].applications.push({...structuredClone(s.events[0].applications[0]),id:'copy-'+s.events[0].applications.length});
 s=editRequest(s,id,[{person:'writer',slot:'__custom',instrument:'Флейта'}]);assert.equal(s.events[0].applications.length,600);assert.ok(s.events[0].songs[0].slots.some(r=>r.label==='Флейта'));
});


test('flexible applications add automatic comments and update them without duplicates',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('d','Барабаны'));s.people.find(p=>p.id==='writer').name='Коля';
 s=applyAction(s,booking([{person:'writer',slot:'__any'}],{comment:'Мой комментарий'}),'writer');const a=s.events[0].applications[0],comments=s.events[0].songs[0].comments;
 assert.equal(comments[0].body,'Мой комментарий');assert.equal(comments[1].body,'Коля готов сыграть любую партию');const noticeId=comments[1].id;assert.equal(comments[1].by,'writer');
 s=editRequest(s,a.id,[{person:'writer',slot:'__choice',alternatives:['g','d']}]);const next=s.events[0].songs[0].comments;assert.equal(next.length,2);assert.equal(next[1].id,noticeId);assert.equal(next[1].body,'Коля готов сыграть несколько партий');
 assert.deepEqual(readinessPeople(s.events[0],s.events[0].songs[0],'g'),['writer']);assert.deepEqual(s.events[0].songs[0].assigned,{});
 s=applyAction(s,{type:'withdraw',event:'e',application:a.id},'writer');assert.deepEqual(s.events[0].songs[0].comments.map(c=>c.body),['Мой комментарий']);
});
test('old draft flexible applications get notices once; published songs and deleted notices stay unchanged',()=>{
 const s=bookingFixture();s.events[0].rulesVersion=4;s.events[0].applications=[request('old','s',[['writer','__any']])];const published=structuredClone(s.events[0]);published.id='published';published.status='published';s.events.push(published);
 assert.ok(retainDraftSongs(s));assert.equal(s.events[0].songs[0].comments[0].body,'writer готов сыграть любую партию');assert.equal(s.events[1].songs[0].comments,undefined);assert.equal(retainDraftSongs(s),false);
 s.events[0].songs[0].comments=[];assert.equal(retainDraftSongs(s),false);assert.equal(s.events[0].songs[0].comments.length,0);
});
test('rejected and resolved flexible offers remove only their own automatic comments',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'target',slot:'__any'}]),'writer');const id=s.events[0].applications[0].id;assert.equal(s.events[0].songs[0].comments.length,1);
 s=applyAction(s,{type:'consent',event:'e',application:id,accept:false},'target');assert.equal(s.events[0].songs[0].comments.length,0);
 s=applyAction(s,booking([{person:'writer',slot:'__any'}]),'writer');const own=s.events[0].applications.at(-1).id;
 s=applyAction(s,{type:'resolve',event:'e',song:'s',application:own,member:0,slot:'g'},'admin');assert.equal(s.events[0].songs[0].comments.length,0);assert.equal(s.events[0].songs[0].assigned.g,'writer');
});
test('ready people are unique across multiple recorded offers',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'writer',slot:'__any'}]),'writer');s=applyAction(s,booking([{person:'writer',slot:'__any'}]),'writer');s=applyAction(s,booking([{person:'target',slot:'__any'}]),'writer');
 assert.deepEqual(readinessPeople(s.events[0],s.events[0].songs[0],'g'),['writer','target']);s=applyAction(s,{type:'consent',event:'e',application:s.events[0].applications.at(-1).id,accept:true},'target');assert.deepEqual(readinessPeople(s.events[0],s.events[0].songs[0],'g'),['writer','target']);assert.equal(readiness(s.events[0],s.events[0].songs[0],'g'),2);
});


test('administrator personal applications contain only their own parts and invitations',()=>{
 const s=bookingFixture(),e=s.events[0];e.applications=[request('own','s',[['admin','g']]),{...request('written-for-other','s',[['target','g']]),by:'admin'},request('unrelated','s',[['writer','g']]),{...request('incoming','s',[['admin','g']]),by:'writer',members:[{person:'admin',slot:'g',consent:'pending'}]}];
 assert.deepEqual(applicationsFor(e,'admin',true).map(a=>a.id),['incoming','own']);assert.deepEqual(applicationsFor(e,'admin').map(a=>a.id),['incoming','own','written-for-other']);
});
test('deleting a musician clears their draft participation and pins but preserves published history',()=>{
 let s=bookingFixture();s.events[0].songs[0].slots.push(slot('d','Барабаны'));s=applyAction(s,booking([{person:'writer',slot:'__any'},{person:'target',slot:'g'}]),'writer');
 s=applyAction(s,{type:'assign',replace:true,event:'e',song:'s',slot:'g',person:'target'},'admin');const history=structuredClone(s.events[0]);history.id='history';history.status='published';s.events.push(history);const beforeHistory=structuredClone(history);
 s=applyAction(s,{type:'deletePerson',person:'target'},'admin');assert.ok(s.people.find(p=>p.id==='target').deletedAt);assert.equal(isRegistered(s.people.find(p=>p.id==='target')),false);assert.equal(s.events[0].songs[0].assigned.g,undefined);assert.equal(s.events[0].songs[0].pins.g,undefined);assert.ok(s.events[0].applications.every(a=>a.members.every(m=>m.person!=='target')));assert.deepEqual(s.events[1],beforeHistory);
 s=applyAction(s,{type:'restorePerson',person:'target'},'admin');assert.equal(s.people.find(p=>p.id==='target').deletedAt,undefined);assert.equal(s.events[0].songs[0].assigned.g,undefined);
});
test('only administrators can delete musicians, and self and administrator profiles are protected',()=>{
 const s=bookingFixture();for(const actor of ['writer','target'])assert.throws(()=>applyAction(s,{type:'deletePerson',person:'writer'},actor),/администратора/);assert.throws(()=>applyAction(s,{type:'deletePerson',person:'admin'},'admin'),/свой профиль/);s.people.push({id:'second',auth:'second',name:'Second admin',roles:[],max:5});s.admins.push('second');assert.throws(()=>applyAction(s,{type:'deletePerson',person:'second'},'admin'),/администратора/);
 let deleted=applyAction(s,{type:'deletePerson',person:'target'},'admin');assert.throws(()=>applyAction(deleted,booking([{person:'target',slot:'g'}]),'writer'),/участников/);assert.throws(()=>applyAction(deleted,{type:'assign',replace:true,event:'e',song:'s',slot:'g',person:'target'},'admin'),/Участник не найден/);assert.throws(()=>applyAction(deleted,{type:'profile',name:'Back',max:5,roles:[]},'target'),/Профиль не найден/);
});
test('reopening a published event does not restore participation of a deleted musician',()=>{
 let s=bookingFixture();s=applyAction(s,booking([{person:'writer',slot:'g'}]),'writer');s.events[0].status='published';s=applyAction(s,{type:'deletePerson',person:'writer'},'admin');assert.equal(s.events[0].songs[0].assigned.g,'writer');s=applyAction(s,{type:'reopen',event:'e'},'admin');assert.equal(s.events[0].songs[0].assigned.g,undefined);assert.equal(s.events[0].applications.length,0);
});
test('custom profile instruments can be removed without altering song parts or requests',()=>{
 let s=bookingFixture();s=applyAction(s,{type:'profile',name:'Writer',max:5,roles:['Гитара','Скрипка с ошибкой']},'writer');const before=structuredClone(s.events);s=applyAction(s,{type:'profile',name:'Writer',max:5,roles:['Гитара']},'writer');assert.deepEqual(s.people.find(p=>p.id==='writer').roles,['Гитара']);assert.deepEqual(s.events,before);
});
test('meeting images support creation, replacement and removal while legacy posters keep displaying',()=>{
 const url='/api/event-image?id=12345678-1234-4234-8234-123456789abc';let s=bookingFixture();assert.equal(eventImageUrl(s.events[0]),'/berliner-jam-poster.jpg');
 const fields={title:'Edited event',date:'2026-11-22',time:'19:30',venue:'Aviator',budget:90,breakMins:10};s=applyAction(s,{type:'settings',event:'e',...fields,image:url},'admin');assert.equal(eventImageUrl(s.events[0]),url);assert.equal(uploadedImageId(url),'12345678-1234-4234-8234-123456789abc');
 const songs=structuredClone(s.events[0].songs);s.events[0].status='published';s=applyAction(s,{type:'settings',event:'e',...fields,image:null},'admin');assert.equal(eventImageUrl(s.events[0]),null);assert.deepEqual(s.events[0].songs,songs);assert.equal(s.events[0].status,'published');assert.throws(()=>applyAction(s,{type:'settings',event:'e',...fields,image:'https://another.site/a.svg'},'admin'),/загруженную картинку/);
 s=applyAction(s,{type:'newEvent',...fields},'admin');assert.equal(s.events.at(-1).image,null);s=applyAction(s,{type:'newEvent',...fields,image:url},'admin');assert.equal(s.events.at(-1).image,url);
});
test('permanent deletion is administrator-only and applies only to trashed meetings',()=>{
 const s=bookingFixture();assert.throws(()=>applyAction(s,{type:'purgeEvent',event:'e'},'admin'),/в корзину/);assert.throws(()=>applyAction(s,{type:'purgeEvent',event:'e'},'writer'),/администратора/);let n=applyAction(s,{type:'deleteEvent',event:'e'},'admin');const people=structuredClone(n.people);n=applyAction(n,{type:'purgeEvent',event:'e'},'admin');assert.equal(n.events.length,0);assert.deepEqual(n.people,people);assert.throws(()=>applyAction(n,{type:'restoreEvent',event:'e'},'admin'),/Встреча не найдена/);assert.equal(s.events.length,1);
});

test('allocation reset preserves competing applications, wishes, vocal stars and manual pins, repeatedly',()=>{
 let s=allSongsDemo('owner');const e=s.events[0];e.songs[0].pins.r0=true;const pinned=e.songs[0].assigned.r0,apps=structuredClone(e.applications),comments=e.songs.map(x=>structuredClone(x.comments));
 s=applyAction(s,{type:'optimize',event:e.id},'owner');assert.ok(s.events[0].allocatedAt);
 s=applyAction(s,{type:'resetAllocation',event:e.id},'owner');assert.equal(s.events[0].allocatedAt,undefined);assert.deepEqual(s.events[0].applications,apps);assert.deepEqual(s.events[0].songs.map(x=>x.comments),comments);assert.equal(s.events[0].songs[0].assigned.r0,pinned);
 const snapshot=JSON.stringify(s.events[0]);s=applyAction(s,{type:'resetAllocation',event:e.id},'owner');assert.equal(JSON.stringify(s.events[0]),snapshot);
 s=applyAction(s,{type:'optimize',event:e.id},'owner');assert.deepEqual(s.events[0].applications,apps);
});
test('reset uses current applications: later edits survive and withdrawn candidates do not return',()=>{
 const s=base([person('a',[]),person('b',[])],[song('s',[slot('v','Вокал')])],[request('a','s',[['a','v']]),request('b','s',[['b','v']])]);const e=s.events[0];e.applications[0].members[0].starred=true;optimize(s,e);e.applications.shift();resetAllocation(e);assert.equal(e.songs[0].assigned.v,'b');assert.equal(e.applications.length,1);
});
test('draft program is hidden from visitors; approved program is public',()=>{
 const s=allSongsDemo('owner'),program=[...s.events[0].program];assert.deepEqual(visibleState(s,false).events[0].program,[]);assert.deepEqual(visibleState(s,true).events[0].program,program);assert.deepEqual(s.events[0].program,program);s.events[0].status='published';assert.deepEqual(visibleState(s,false).events[0].program,program);
});
function approvalFixture(actor=PROGRAM_APPROVERS[0]){const s=base([{...person(actor,[]),auth:actor,nickname:'changed_handle'}],[song('s',[slot('g','Гитара')])],[request('a','s',[[actor,'g']])]);s.admins=[actor];optimize(s,s.events[0]);retainDraftSongs(s);return s;}
test('only the two verified organizer accounts approve even after handle changes',()=>{
 for(const actor of PROGRAM_APPROVERS){const s=approvalFixture(actor);assert.equal(canApproveProgram(s,actor),true);assert.equal(applyAction(s,{type:'publish',event:'e'},actor).events[0].status,'published');}
 const spoof=approvalFixture('intruder');spoof.people[0].nickname='nikita';assert.equal(canApproveProgram(spoof,'intruder'),false);assert.throws(()=>applyAction(spoof,{type:'publish',event:'e'},'intruder'),/организаторы/);
});
test('organizers must explicitly review warnings before approving incomplete or overlong programs',()=>{
 const actor=PROGRAM_APPROVERS[0],s=approvalFixture();s.events[0].songs[0].assigned={};s.events[0].songs[0].main={};assert.throws(()=>applyAction(s,{type:'publish',event:'e'},actor),/замечания/);s.events[0].songs[0].assigned.g=actor;s.events[0].budget=1;assert.throws(()=>applyAction(s,{type:'publish',event:'e'},actor),/замечания/);
});
test('shelving a song directly from the draft retains original applications and survives allocation/reset',()=>{
 const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();const apps=structuredClone(s.events[0].applications);
 s=applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor);assert.equal(s.events[0].songs[0].shelfReason,'unselected');s=applyAction(s,{type:'optimize',event:'e'},actor);s=applyAction(s,{type:'resetAllocation',event:'e'},actor);assert.deepEqual(s.events[0].program,[]);assert.deepEqual(s.events[0].applications,apps);
 s=applyAction(s,{type:'restoreShelved',event:'e',song:'s',targetEvent:'e'},actor);assert.deepEqual(s.events[0].program,[]);assert.equal(s.events[0].songs[0].shelvedAt,undefined);assert.deepEqual(s.events[0].applications,apps);
});
test('past unplayed songs retain approved history and return to a new meeting without assigning old musicians',()=>{
 const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();s=applyAction(s,{type:'publish',event:'e'},actor);s.events[0].date='2020-01-01';s=applyAction(s,{type:'newEvent',title:'Next',date:'2030-01-01',time:'18:00',venue:'Berlin',budget:120},actor);const target=s.events[1].id,lineup=structuredClone(s.events[0].songs[0].assigned),apps=structuredClone(s.events[0].applications);
 s=applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor);assert.equal(s.events[0].songs[0].played,false);assert.deepEqual(s.events[0].program,['s']);assert.deepEqual(s.events[0].songs[0].assigned,lineup);
 s=applyAction(s,{type:'restoreShelved',event:'e',song:'s',targetEvent:target},actor);assert.equal(s.events[1].songs.length,1);assert.notEqual(s.events[1].songs[0].id,'s');assert.deepEqual(s.events[1].songs[0].assigned,{});assert.deepEqual(s.events[1].applications,[]);assert.deepEqual(s.events[0].applications,apps);assert.deepEqual(s.events[0].songs[0].assigned,lineup);
});
test('marking a song played removes the unplayed shelf entry; future programs cannot be marked',()=>{
 const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();s=applyAction(s,{type:'publish',event:'e'},actor);s.events[0].date='2099-01-01';assert.throws(()=>applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor),/прошедшей/);s.events[0].date='2020-01-01';s=applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor);s=applyAction(s,{type:'setPlayed',event:'e',song:'s',played:true},actor);assert.equal(s.events[0].songs[0].played,true);assert.equal(s.events[0].songs[0].shelvedAt,undefined);
});
test('participants cannot shelve songs, reset allocations or return songs',()=>{const s=approvalFixture();s.people.push({id:'u',auth:'u',name:'User',max:5,roles:[]});for(const type of ['resetAllocation','shelveSong','restoreShelved','setPlayed'])assert.throws(()=>applyAction(s,{type,event:'e',song:'s'},'u'),/администратора/);});
test('event timing uses Berlin daylight saving time for past-program controls',()=>{const e={date:'2026-10-28',time:'18:00'};assert.equal(eventHasStarted(e,new Date('2026-10-28T16:59:00Z')),false);assert.equal(eventHasStarted(e,new Date('2026-10-28T17:00:00Z')),true);assert.equal(eventHasStarted({date:'2026-07-01',time:'18:00'},new Date('2026-07-01T16:00:00Z')),true);});
test('unselected songs may be shelved after approval without changing the published program',()=>{const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();const spare=song('spare',[slot('g','Гитара')]);spare.inclusion='exclude';s.events[0].songs.push(spare);s=applyAction(s,{type:'publish',event:'e'},actor);s=applyAction(s,{type:'shelveSong',event:'e',song:'spare'},actor);assert.equal(s.events[0].songs[1].shelfReason,'unselected');assert.deepEqual(s.events[0].program,['s']);});
test('returning a shelved song to another draft does not resurrect the old proposal or duplicate it',()=>{const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();s=applyAction(s,{type:'inclusion',event:'e',song:'s',value:'exclude'},actor);s=applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor);s=applyAction(s,{type:'newEvent',title:'Next',date:'2030-01-01',time:'18:00',venue:'Berlin',budget:120},actor);const target=s.events[1].id;s=applyAction(s,{type:'restoreShelved',event:'e',song:'s',targetEvent:target},actor);assert.ok(s.events[0].songs[0].shelvedAt);assert.equal(s.events[0].songs[0].shelfReturn.event,target);assert.throws(()=>applyAction(s,{type:'restoreShelved',event:'e',song:'s',targetEvent:target},actor),/не найдена/);assert.throws(()=>applyAction(s,{type:'assign',replace:true,event:'e',song:'s',slot:'g',person:actor},actor),/верните/);});

test('verified organizers can approve reviewed warnings, but acknowledgement grants no extra rights',()=>{
 for(const actor of PROGRAM_APPROVERS){let s=approvalFixture(actor);s.events[0].songs[0].assigned={};s.events[0].songs[0].main={};assert.throws(()=>applyAction(s,{type:'publish',event:'e'},actor),/замечания/);const saved=structuredClone(s.events[0]);s=applyAction(s,{type:'publish',event:'e',acknowledgeWarnings:true},actor);assert.equal(s.events[0].status,'published');assert.deepEqual(s.events[0].songs,saved.songs);assert.deepEqual(s.events[0].applications,saved.applications);assert.equal(warnings(s,s.events[0])[0].kind,'incomplete');}
 const spoof=approvalFixture('another_admin');spoof.people[0].nickname='nikita';assert.throws(()=>applyAction(spoof,{type:'publish',event:'e',acknowledgeWarnings:true},'another_admin'),/организаторы/);
});
test('cancelling approval preserves assignments, pins, applications and order, and hides the program again',()=>{
 const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();s.events[0].songs.push({...song('second',[slot('g','Гитара')]),inclusion:'exclude'});s.events[0].songs[0].pins.g=true;s=applyAction(s,{type:'publish',event:'e'},actor);const before=structuredClone(s.events[0]);assert.ok(before.publishedAt);
 s=applyAction(s,{type:'reopen',event:'e'},actor);assert.equal(s.events[0].status,'draft');assert.equal(s.events[0].publishedAt,undefined);assert.deepEqual(s.events[0].songs,before.songs);assert.deepEqual(s.events[0].applications,before.applications);assert.deepEqual(s.events[0].program,before.program);assert.deepEqual(visibleState(s,false).events[0].program,[]);assert.throws(()=>applyAction(s,{type:'reopen',event:'e'},actor),/уже отменено/);
 s=applyAction(s,{type:'publish',event:'e'},actor);assert.equal(s.events[0].status,'published');assert.deepEqual(visibleState(s,false).events[0].program,before.program);
});
test('participants cannot cancel approval, move shelf songs or modify meeting settings',()=>{
 let s=approvalFixture();s=applyAction(s,{type:'publish',event:'e'},PROGRAM_APPROVERS[0]);s.people.push({id:'reader',auth:'reader',name:'Reader',roles:[],max:5});for(const type of ['reopen','restoreShelved','settings'])assert.throws(()=>applyAction(s,{type,event:'e',song:'s'},'reader'),/администратора/);
});
test('cancelling a past approval does not bring unplayed shelved songs into the draft program',()=>{
 const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();s=applyAction(s,{type:'publish',event:'e'},actor);s.events[0].date='2020-01-01';s=applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor);s=applyAction(s,{type:'reopen',event:'e'},actor);assert.ok(s.events[0].songs[0].shelvedAt);assert.equal(s.events[0].songs[0].inclusion,'exclude');assert.deepEqual(s.events[0].program,[]);
});

test('musician directory includes site-wide accounts without any application in the selected event',()=>{
 const state=allSongsDemo('owner');state.people.push({id:'global',auth:'local_global',nickname:'global_user',name:'Global musician',roles:[],max:5},{id:'deleted',auth:'local_deleted',name:'Deleted',roles:[],max:5,deletedAt:'2026-10-20'});
 const before=directoryPeople(state).map(p=>p.id);state.events.push({...structuredClone(state.events[0]),id:'empty',demo:false,songs:[],applications:[],program:[]});assert.ok(before.includes('global'));assert.deepEqual(directoryPeople(state).map(p=>p.id),before);assert.ok(!before.includes('deleted'));assert.ok(!directoryPeople(state).some(p=>p.demo));
});
test('a first group can be proposed in an empty real meeting using the author and a plain-name musician',()=>{
 let state=allSongsDemo('local_owner');state=applyAction(state,{type:'newEvent',title:'Empty',date:'2030-01-01',time:'18:00',venue:'Berlin',budget:120},'local_owner');const event=state.events.at(-1).id;
 state=applyAction(state,{type:'song',event,title:'First group song',artist:'Band',duration:5,slots:[{label:'Вокал',required:true},{label:'Гитара',required:true}]},'local_owner');const song=state.events.at(-1).songs[0],owner=state.people.find(p=>p.auth==='local_owner').id;
 state=applyAction(state,{type:'apply',event,song:song.id,priority:2,together:'hard',members:[{person:owner,slot:song.slots[0].id},{person:'__name',name:'Invited by name',slot:song.slots[1].id}]},'local_owner');assert.equal(state.events.at(-1).applications.length,1);assert.equal(state.events.at(-1).applications[0].members.length,2);assert.equal(Object.keys(state.events.at(-1).songs[0].assigned).length,2);
});
test('permanent musician deletion requires a removed profile and organizer permissions',()=>{
 let state=bookingFixture();assert.throws(()=>applyAction(state,{type:'purgePerson',person:'target'},'admin'),/Сначала/);state=applyAction(state,{type:'deletePerson',person:'target'},'admin');assert.throws(()=>applyAction(state,{type:'purgePerson',person:'target'},'writer'),/администратора/);state=applyAction(state,{type:'purgePerson',person:'target'},'admin');assert.ok(!state.people.some(p=>p.id==='target'));assert.throws(()=>applyAction(state,{type:'restorePerson',person:'target'},'admin'),/не найден/);
 const protectedState=bookingFixture();protectedState.people.find(p=>p.id==='admin').deletedAt='2026-01-01';assert.throws(()=>applyAction(protectedState,{type:'purgePerson',person:'admin'},'admin'),/Профиль не найден/);
});
test('permanent removal anonymizes published participation while preserving others and clearing author comments',()=>{
 let state=bookingFixture();state.events[0].songs[0].slots.push(slot('v','Вокал'));state=applyAction(state,booking([{person:'writer',slot:'g'},{person:'target',slot:'v'}]),'writer');state=applyAction(state,{type:'consent',event:'e',application:state.events[0].applications[0].id,person:'target',accept:true},'target');const history=structuredClone(state.events[0]);history.id='history';history.status='published';history.songs[0].assigned={g:'writer',v:'target'};history.songs[0].proposedBy='target';history.songs[0].comments=[{id:'mine',by:'target',body:'Remove me',createdAt:'2026-01-01'},{id:'other',by:'writer',body:'Keep me',createdAt:'2026-01-01'}];state.events.push(history);
 state=applyAction(state,{type:'deletePerson',person:'target'},'admin');state=applyAction(state,{type:'purgePerson',person:'target'},'admin');const past=state.events[1],anonymous=past.songs[0].assigned.v;assert.ok(anonymous.startsWith(DELETED_PERSON_PREFIX));assert.equal(past.status,'published');assert.equal(past.songs[0].assigned.g,'writer');assert.equal(past.songs[0].proposedBy,anonymous);assert.equal(past.songs[0].comments.length,1);assert.equal(past.songs[0].comments[0].id,'other');assert.ok(!JSON.stringify(past).includes('"target"'));
 state=applyAction(state,{type:'reopen',event:'history'},'admin');assert.equal(state.events[1].songs[0].assigned.v,undefined);assert.ok(state.events[1].applications.every(a=>a.members.every(m=>!m.person.startsWith(DELETED_PERSON_PREFIX))));
});

test('directory appearances count distinct songs and exclude backing-only performances',()=>{
 const state=base([],['one','two','back','excluded','shelved','out'].map(id=>song(id,[slot('v','Вокал'),slot('g','Гитара'),{...slot('b','Бэк-вокал'),required:false},{...slot('x','Флейта'),required:false}])),[]),e=state.events[0];
 e.songs[0].assigned={v:'a',g:'a',b:'b'};e.songs[1].assigned={g:'b',b:'a',x:'c'};e.songs[2].assigned={b:'a'};e.songs[3].assigned={g:'a'};e.songs[3].inclusion='exclude';e.songs[4].assigned={g:'a'};e.songs[4].shelvedAt='2026-01-01';e.songs[5].assigned={g:'c'};
 assert.deepEqual(musicianAppearances(e),{a:1,b:1,c:2});e.status='published';e.program=['one','two','back'];assert.deepEqual(musicianAppearances(e),{a:1,b:1,c:1});
});
test('directory participation includes pending invitations but excludes declined or absent applications',()=>{
 const state=bookingFixture(),e=state.events[0];e.applications=[request('yes','s',[['writer','g']]),{...request('pending','s',[['target','g']]),members:[{person:'target',slot:'g',consent:'pending'}]},{...request('declined','s',[['no','g']]),members:[{person:'no',slot:'g',consent:'no'}]}];assert.equal(hasJamApplication(e,'writer'),true);assert.equal(hasJamApplication(e,'target'),true);assert.equal(hasJamApplication(e,'no'),false);assert.equal(hasJamApplication(e,'admin'),false);
});
test('musician search matches names and nicknames in one field and orders by appearances',()=>{
 const people=[{...person('a',[]),name:'Никита Котляров',nickname:'nikita'},{...person('b',[]),name:'Никита Другой',nickname:'another'},{...person('c',[]),name:'Анастасия',nickname:'nastya'}];assert.deepEqual(filterMusicians(people,{a:2,b:5,c:1}).map(p=>p.id),['b','a','c']);assert.deepEqual(filterMusicians(people,{a:2,b:5},'НИКИТА').map(p=>p.id),['b','a']);assert.deepEqual(filterMusicians(people,{},'@NiKiTa').map(p=>p.id),['a']);assert.deepEqual(filterMusicians(people,{},'Котляров @nikita').map(p=>p.id),['a']);assert.deepEqual(filterMusicians(people,{},'missing'),[]);
});
function atomicGroup(event='e'){return {type:'songWithApplication',event,title:'First group',artist:'Band',duration:5,priority:1,together:'hard',comment:'Initial note',slots:[{id:'client-v',label:'Вокал',required:true},{id:'client-g',label:'Гитара',required:true}],members:[{person:'writer',slot:'client-v',starred:true},{person:'target',slot:'client-g'}]};}
test('a group creates one ordinary song and application atomically as the first entry in any meeting',()=>{
 const state=bookingFixture();state.events[0].songs=[];state.events[0].program=[];const next=applyAction(state,atomicGroup(),'writer'),e=next.events[0],s=e.songs[0],a=e.applications[0];assert.equal(e.songs.length,1);assert.equal(e.applications.length,1);assert.equal(a.song,s.id);assert.equal(a.by,'writer');assert.deepEqual(a.members.map(m=>m.slot),s.slots.map(r=>r.id));assert.deepEqual(a.members.map(m=>m.consent),['yes','yes']);assert.equal(a.members[0].starred,true);assert.equal(s.comments.length,1);assert.equal(s.comments[0].body,'Initial note');assert.equal(s.assigned[s.slots[1].id],'target');assert.equal(state.events[0].songs.length,0);
});
test('group creation remains atomic on invalid members, parts, preferences and exhausted application capacity',()=>{
 const state=bookingFixture(),before=structuredClone(state),cases=[{...atomicGroup(),priority:99,members:[{person:'__name',name:'Do not persist',slot:'client-v'}]},{...atomicGroup(),members:[{person:'writer',slot:'missing'}]},{...atomicGroup(),slots:[{id:'x',label:'Вокал',required:true},{id:'x',label:'Гитара',required:true}]},{...atomicGroup(),song:'s'},{...atomicGroup(),members:[{person:'writer',slot:'__choice',alternatives:['missing']}]}];for(const action of cases){assert.throws(()=>applyAction(state,action,'writer'));assert.deepEqual(state,before);}const full=structuredClone(state);full.events[0].applications=Array.from({length:600},(_,i)=>request('a'+i,'s',[['writer','g']]));const snapshot=structuredClone(full);assert.throws(()=>applyAction(full,atomicGroup(),'writer'),/лимит заявок/);assert.deepEqual(full,snapshot);
});
test('groups work after individual applications and flexible choices are mapped into the new song',()=>{
 let state=bookingFixture();state=applyAction(state,booking([{person:'writer',slot:'g'}]),'writer');const initial=structuredClone(state.events[0].applications[0]);state=applyAction(state,{...atomicGroup(),members:[{person:'writer',slot:'__choice',alternatives:['client-v','client-g'],starred:true},{person:'target',slot:'__any'}]},'writer');assert.equal(state.events[0].songs.length,2);assert.equal(state.events[0].applications.length,2);assert.deepEqual(state.events[0].applications[0],initial);const e=state.events[0],a=e.applications[1];assert.deepEqual(a.members[0].alternatives,e.songs[1].slots.map(r=>r.id));assert.equal(a.members[1].slot,'__any');assert.deepEqual(e.songs[1].assigned,{});e.status='published';assert.throws(()=>applyAction(state,atomicGroup(),'writer'),/опубликована/);
});
test('only verified lead organizers can revoke another administrator without changing their profile',()=>{
 for(const actor of PROGRAM_APPROVERS){let state=approvalFixture(actor);state.people.push({id:'other',auth:'local_other',name:'Other',nickname:'other',roles:['Гитара'],max:5},{id:'ordinary',auth:'local_ordinary',name:'Ordinary',roles:[],max:5});state.admins.push('local_other');const original=structuredClone(state.people.find(p=>p.id==='other'));assert.equal(canManageAdmins(state,actor),true);assert.equal(canManageAdmins(state,'local_other'),false);assert.throws(()=>applyAction(state,{type:'revokeAdmin',person:actor},actor),/свои/);assert.throws(()=>applyAction(state,{type:'revokeAdmin',person:'other'},'local_other'),/только/);assert.throws(()=>applyAction(state,{type:'revokeAdmin',person:'other'},'local_ordinary'),/администратора/);state=applyAction(state,{type:'revokeAdmin',person:'other'},actor);assert.ok(!state.admins.includes('local_other'));assert.deepEqual(state.people.find(p=>p.id==='other'),original);assert.throws(()=>applyAction(state,{type:'newEvent',title:'Denied'},'local_other'),/администратора/);state=applyAction(state,{type:'admin',person:'other'},actor);assert.ok(state.admins.includes('local_other'));}
});


// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.
test('unchanged agreed bookings and manual pins remain white while new algorithm choices are marked',()=>{
 const state=base(['a','b','c'].map(id=>person(id,[])),[song('s',[slot('a','Гитара'),slot('b','Бас'),slot('c','Барабаны')])],[request('a','s',[['a','a']]),request('b','s',[['b','b']]),request('c','s',[['c','c']])]);const e=state.events[0],s=e.songs[0];s.assigned={a:'a',b:'b'};s.pins.b=true;optimize(state,e);assert.deepEqual(s.assigned,{a:'a',b:'b',c:'c'});assert.equal(isAlgorithmAssignment(e,s,'a'),false);assert.equal(isAlgorithmAssignment(e,s,'b'),false);assert.equal(isAlgorithmAssignment(e,s,'c'),true);e.status='published';assert.equal(isAlgorithmAssignment(e,s,'c'),false);
});
test('draft alternatives include confirmed flexible offers once and permit explicit moderator replacement',()=>{
 let state=bookingFixture();state.people.push({id:'flex',auth:'flex',name:'Flexible',roles:[],max:5},{id:'waiting',auth:'waiting',name:'Waiting',roles:[],max:5});let e=state.events[0];e.applications=[request('writer','s',[['writer','g']]),request('target','s',[['target','g']]),request('any','s',[['flex','__any']]),request('duplicate','s',[['flex','__choice']]),request('pending','s',[['waiting','g']])];e.applications[3].members[0].alternatives=['g'];e.applications[4].members[0].consent='pending';e.songs[0].assigned.g='writer';e.songs[0].algorithmAssigned={g:'writer'};
 assert.deepEqual(assignmentCandidates(e,e.songs[0],'g').map(c=>c.person),['writer','target','flex']);const candidate=assignmentCandidates(e,e.songs[0],'g').find(c=>c.person==='flex');const choose={type:'resolve',event:'e',song:'s',slot:'g',application:candidate.application.id,member:candidate.member,replace:true};assert.throws(()=>applyAction(state,choose,'writer'),/администратора/);
 state=applyAction(state,choose,'admin');e=state.events[0];assert.equal(e.songs[0].assigned.g,'flex');assert.equal(e.songs[0].pins.g,true);assert.equal(isAlgorithmAssignment(e,e.songs[0],'g'),false);assert.ok(assignmentCandidates(e,e.songs[0],'g').some(c=>c.person==='target'));e.status='published';assert.throws(()=>applyAction(state,choose,'admin'),/опубликована/);
});
test('accepting a proposed assignment removes its blue marker and deletion removes provenance data',()=>{
 let state=bookingFixture();state.events[0].applications=[request('t','s',[['target','__any']])];state=applyAction(state,{type:'optimize',event:'e'},'admin');assert.equal(isAlgorithmAssignment(state.events[0],state.events[0].songs[0],'g'),true);state=applyAction(state,{type:'pin',event:'e',song:'s',slot:'g'},'admin');assert.equal(isAlgorithmAssignment(state.events[0],state.events[0].songs[0],'g'),false);
 state.events[0].songs[0].pins.g=false;state.events[0].songs[0].algorithmAssigned={g:'target'};state=applyAction(state,{type:'deletePerson',person:'target'},'admin');assert.ok(!JSON.stringify(state.events[0].songs[0].algorithmAssigned).includes('target'));assert.equal(state.events[0].songs[0].assigned.g,undefined);
});


test('the sole contested guitar goes to a singer with load two rather than a guitarist with load five',()=>{
 const dima={...person('dima',[]),auth:'dima'},nikita={...person('nikita',[]),auth:'nikita'};const songs=Array.from({length:4},(_,i)=>{const s=song('d'+i,[slot('g','Ритм-гитара')]);s.assigned.g='dima';s.pins.g=true;return s;});const vocal=song('v',[slot('v','Вокал')]);vocal.assigned.v='nikita';vocal.pins.v=true;const choice=song('choice',[slot('g','Ритм-гитара')]);choice.assigned.g='dima';songs.push(vocal,choice);
 const apps=[...songs.slice(0,4).map(s=>request(s.id,s.id,[['dima','g']])),request('v','v',[['nikita','v']]),request('first','choice',[['dima','g']]),request('second','choice',[['nikita','g']])];const state=base([dima,nikita],songs,apps),e=state.events[0];e.program=songs.map(s=>s.id);const original=structuredClone(e.applications),before=signupSong(e,choice);
 optimize(state,e);assert.equal(choice.assigned.g,'nikita');assert.equal(isAlgorithmAssignment(e,choice,'g'),true);assert.deepEqual(musicianStats(e,'dima'),{performances:4,vocals:0});assert.deepEqual(musicianStats(e,'nikita'),{performances:2,vocals:1});assert.deepEqual(signupSong(e,choice).assigned,before.assigned);assert.deepEqual(signupSong(e,choice).assigned,{});
 resetAllocation(e);assert.equal(choice.assigned.g,undefined);assert.equal(choice.algorithmAssigned,undefined);assert.deepEqual(readinessPeople(e,choice,'g'),['dima','nikita']);assert.deepEqual(e.applications,original);optimize(state,e);assert.equal(choice.assigned.g,'nikita');assert.equal(isAlgorithmAssignment(e,choice,'g'),true);
});
// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.
test('signup availability distinguishes competing people, duplicate requests and a pending concrete booking',()=>{
 const state=bookingFixture(),e=state.events[0],s=e.songs[0];e.applications=[request('one','s',[['writer','g']]),request('duplicate','s',[['writer','g']])];assert.deepEqual(signupAssignments(e,s),{g:'writer'});e.applications.push(request('two','s',[['target','g']]));assert.deepEqual(signupAssignments(e,s),{});e.applications=e.applications.slice(2);e.applications[0].members[0].consent='pending';assert.deepEqual(signupAssignments(e,s),{g:'target'});e.applications[0].members[0].consent='no';assert.deepEqual(signupAssignments(e,s),{});
});
test('after publication only personally selected applications stay above the unselected section',()=>{
 const state=base([person('me',[]),person('other',[])],[song('yes',[slot('g','Гитара')]),song('no',[slot('g','Гитара')]),song('excluded',[slot('g','Гитара')])],[request('chosen','yes',[['me','g']]),request('lost','no',[['me','g']]),request('outside','excluded',[['me','g']])]),e=state.events[0];e.songs[0].assigned.g='me';e.songs[1].assigned.g='other';e.songs[2].assigned.g='me';e.program=['yes','no'];assert.deepEqual(personalApplicationGroups(e,'me').selected.map(a=>a.id),['chosen','lost','outside']);assert.deepEqual(personalApplicationGroups(e,'me').unselected,[]);e.status='published';assert.deepEqual(personalApplicationGroups(e,'me').selected.map(a=>a.id),['chosen']);assert.deepEqual(personalApplicationGroups(e,'me').unselected.map(a=>a.id),['lost','outside']);assert.equal(isSelectedForProgram(e,e.applications[1],'me'),false);
 e.applications[1].members.push({person:'other',slot:'g',consent:'yes'});assert.equal(isSelectedForProgram(e,e.applications[1],'me'),false);assert.equal(isSelectedForProgram(e,e.applications[1],'other'),true);
});
test('personal musician statistics count songs once, exclude backing-only songs and count vocal appearances separately',()=>{
 const state=base([person('p',[])],[song('both',[slot('v','Вокал'),slot('g','Соло-гитара'),{id:'b',label:'Бэк-вокал',required:false}]),song('back',[{id:'b',label:'Бэк-вокал',required:false}]),song('extra',[{id:'x',label:'Скрипка',required:false}]),song('out',[slot('v','Вокал')])],[]),e=state.events[0];e.songs[0].assigned={v:'p',g:'p',b:'p'};e.songs[1].assigned={b:'p'};e.songs[2].assigned={x:'p'};e.songs[3].assigned={v:'p'};e.songs[3].inclusion='exclude';assert.deepEqual(musicianStats(e,'p'),{performances:2,vocals:1});e.status='published';e.program=['both','back'];assert.deepEqual(musicianStats(e,'p'),{performances:1,vocals:1});assert.deepEqual(musicianStats(e,'absent'),{performances:0,vocals:0});
});


test('song editing updates metadata and can explicitly remove an occupied required part without affecting other roles',()=>{
 const state=bookingFixture(),e=state.events[0],s=e.songs[0];s.slots.push(slot('d','Барабаны'));s.assigned={g:'writer',d:'target'};s.pins={g:true,d:true};s.algorithmAssigned={g:'writer'};e.applications=[request('guitar','s',[['writer','g']]),request('drums','s',[['target','d']]),request('choice','s',[['writer','__choice']])];e.applications[2].members[0].alternatives=['g','d'];s.comments=[{id:'author',by:'writer',body:'Original comment',createdAt:''}];const original=structuredClone(state),action={type:'song',event:'e',song:'s',title:'New title',artist:'New artist',duration:8,slots:[slot('d','Барабаны'),{id:'new',label:'Клавиши',required:true}]};
 assert.throws(()=>applyAction(state,action,'admin'),/Сначала снимите/);assert.deepEqual(state,original);const next=applyAction(state,{...action,dropPartApplications:true},'admin'),edited=next.events[0].songs[0];assert.equal(edited.title,'New title');assert.equal(edited.artist,'New artist');assert.equal(edited.slots.length,2);assert.equal(edited.slots[1].required,true);assert.equal(edited.assigned.g,undefined);assert.equal(edited.assigned.d,'target');assert.equal(edited.pins.d,true);assert.ok(!next.events[0].applications.some(a=>a.id==='guitar'));assert.deepEqual(next.events[0].applications.find(a=>a.id==='drums'),original.events[0].applications[1]);assert.equal(next.events[0].applications.find(a=>a.id==='choice').members[0].slot,'__choice');assert.ok(edited.comments.some(c=>c.id==='author'));assert.throws(()=>applyAction(state,{...action,dropPartApplications:true},'writer'),/администратора/);
});


// Superseded by recordings.test.mjs: primary bookings, reserve allocation and migration.

test('drag ordering moves songs to either end or between songs without changing applications or assignments',()=>{
 let state=bookingFixture(),e=state.events[0];e.songs=[song('one',[slot('g','Гитара')]),song('two',[slot('g','Гитара')]),song('three',[slot('g','Гитара')]),song('four',[slot('g','Гитара')])];e.program=e.songs.map(s=>s.id);e.songs[0].assigned.g='writer';e.songs[0].pins.g=true;e.applications=[request('kept','one',[['writer','g']])];
 retainDraftSongs(state);const original=structuredClone(state),performances=structuredClone(e.songs),applications=structuredClone(e.applications);
 state=applyAction(state,{type:'order',event:'e',song:'one',before:null},'admin');assert.deepEqual(state.events[0].program,['two','three','four','one']);
 state=applyAction(state,{type:'order',event:'e',song:'one',before:'two'},'admin');assert.deepEqual(state.events[0].program,['one','two','three','four']);
 state=applyAction(state,{type:'order',event:'e',song:'one',before:'four'},'admin');assert.deepEqual(state.events[0].program,['two','three','one','four']);
 state=applyAction(state,{type:'order',event:'e',song:'four',before:'three'},'admin');assert.deepEqual(state.events[0].program,['two','four','three','one']);
 assert.deepEqual(state.events[0].songs,performances);assert.deepEqual(state.events[0].applications,applications);assert.deepEqual(original.events[0].program,['one','two','three','four']);
 state=applyAction(state,{type:'order',event:'e',song:'four',direction:-1},'admin');assert.deepEqual(state.events[0].program,['four','two','three','one']);
});

test('drag ordering rejects unavailable songs, published programs and participants',()=>{
 const state=bookingFixture(),e=state.events[0];e.songs.push(song('next',[slot('g','Гитара')]));e.program=e.songs.map(s=>s.id);const original=structuredClone(state);
 for(const action of [{song:'missing',before:null},{song:'s',before:'missing'},{song:'s',before:3},{song:'s',before:undefined}])assert.throws(()=>applyAction(state,{type:'order',event:'e',...action},'admin'),/Песня не найдена/);
 assert.throws(()=>applyAction(state,{type:'order',event:'e',song:'s',before:null},'writer'),/администратора/);assert.deepEqual(state,original);
 e.status='published';assert.throws(()=>applyAction(state,{type:'order',event:'e',song:'s',before:null},'admin'),/опубликована/);
});


test('shelving a pinned draft song removes only that song and preserves its lineup and remaining order',()=>{
 const actor=PROGRAM_APPROVERS[0];let s=approvalFixture();const e=s.events[0];e.songs[0].inclusion='include';e.songs[0].pins.g=true;const lineup=structuredClone(e.songs[0].assigned),pins=structuredClone(e.songs[0].pins),apps=structuredClone(e.applications);e.songs.push(song('before',[slot('g','Гитара')]),song('after',[slot('g','Гитара')]));e.program=['before','s','after'];
 s=applyAction(s,{type:'shelveSong',event:'e',song:'s'},actor);assert.deepEqual(s.events[0].program,['before','after']);assert.deepEqual(s.events[0].songs[0].assigned,lineup);assert.deepEqual(s.events[0].songs[0].pins,pins);assert.deepEqual(s.events[0].applications,apps);assert.equal(s.events[0].songs[0].inclusion,'exclude');assert.ok(s.events[0].songs[0].shelvedAt);
 s=applyAction(s,{type:'restoreShelved',event:'e',song:'s',targetEvent:'e'},actor);assert.deepEqual(s.events[0].program,['before','after']);assert.deepEqual(s.events[0].songs[0].assigned,lineup);
});
