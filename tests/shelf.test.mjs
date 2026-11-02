import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,ensureShelfHistory,shelfSongs,shelfDestinations,visibleState} from '../lib/model.ts';

const event=(id,extra={})=>({id,title:id,date:'2026-11-20',time:'17:00',venue:'Berlin',budget:120,breakMins:0,status:'draft',demo:false,songs:[],applications:[],program:[],rulesVersion:5,...extra});
function fixture(){
 const song={id:'song',title:'A song',artist:'Artist',duration:7,slots:[{id:'g',label:'Гитара',required:true}],assigned:{g:'u'},pins:{},inclusion:'auto',proposedBy:'owner',proposedAt:'2026-10-20T10:15:00.000Z'};
 return {people:['owner','u','v','n'].map(id=>({id,auth:id,name:id,nickname:id==='n'?'other_user':id+'_user',nicknameSource:'custom',roles:[],max:5})),admins:['owner'],log:[],events:[event('source',{songs:[song],program:['song'],applications:[{id:'app',song:'song',by:'owner',priority:2,together:'soft',members:[{person:'u',slot:'g',consent:'yes'},{person:'v',slot:'g',consent:'pending'},{person:'n',slot:'g',consent:'no'}]}]}),event('target',{date:'2026-12-12',time:'19:30'})]};
}
const act=(state,action)=>applyAction(state,{event:'source',song:'song',...action},'owner');

test('a demo song can return to a real draft with original provenance and no old lineup or applications',()=>{
 let state=fixture();state.events[0].demo=true;
 state=act(state,{type:'shelveSong'});const origin=structuredClone(state.events[0].songs[0].origin),oldApps=structuredClone(state.events[0].applications);
 state.events[0].title='Renamed';state.events[0].date='2030-01-01';
 state=act(state,{type:'restoreShelved',targetEvent:'target'});const copy=state.events[1].songs[0];
 assert.deepEqual(copy.origin,origin);assert.equal(copy.proposedAt,'2026-10-20T10:15:00.000Z');assert.deepEqual(copy.assigned,{});assert.deepEqual(copy.pins,{});assert.deepEqual(state.events[1].applications,[]);assert.deepEqual(state.events[0].applications,oldApps);
 assert.equal(shelfSongs(state,'',true)[0].entry.returned.event,'target');
 state=applyAction(state,{type:'shelveSong',event:'target',song:copy.id},'owner');assert.deepEqual(state.events[1].songs[0].origin,origin);
});

test('returning to the same meeting retains history and records a second shelving separately',()=>{
 let state=act(fixture(),{type:'shelveSong'});state=act(state,{type:'restoreShelved',targetEvent:'source'});
 assert.equal(state.events[0].songs[0].shelvedAt,undefined);assert.equal(shelfSongs(state,'',true).length,1);assert.equal(shelfSongs(state,'',true)[0].entry.returned.event,'source');
 state=act(state,{type:'shelveSong'});assert.equal(state.events[0].songs[0].shelfHistory.length,2);assert.equal(shelfSongs(state,'',true)[0].entry.returned,undefined);
});

test('participants see their recorded songs, including pending invites, while unrelated authors and declined users do not',()=>{
 let state=act(fixture(),{type:'shelveSong'});
 assert.equal(shelfSongs(state,'u').length,1);assert.equal(shelfSongs(state,'v').length,1);assert.equal(shelfSongs(state,'n').length,0);assert.equal(shelfSongs(state,'owner').length,0);assert.equal(shelfSongs(state).length,0);assert.equal(shelfSongs(state,'owner',true).length,1);
 const before=structuredClone(state),mine=visibleState(state,false,'u'),other=visibleState(state,false,'n');
 assert.deepEqual(mine.events[0].songs[0].shelfHistory[0].members,['u']);assert.deepEqual(other.events[0].songs[0].shelfHistory,[]);assert.equal(other.events[0].songs[0].origin,undefined);assert.deepEqual(state,before);
 state=act(state,{type:'restoreShelved',targetEvent:'source'});state.events[0].applications=[];state.events[0].songs[0].assigned={};assert.equal(shelfSongs(state,'u').length,1);
});

test('source-meeting filtering uses the first meeting across later transfers',()=>{
 let state=act(fixture(),{type:'shelveSong'});state=act(state,{type:'restoreShelved',targetEvent:'target'});const copy=state.events[1].songs[0];state=applyAction(state,{type:'shelveSong',event:'target',song:copy.id},'owner');
 assert.equal(shelfSongs(state,'owner',true,'source').length,2);assert.equal(shelfSongs(state,'owner',true,'target').length,0);assert.equal(shelfSongs(state,'u',false,'source').length,1);
});

test('legacy shelf entries and old returned copies acquire provenance without invented proposal timestamps',()=>{
 const state=fixture(),song=state.events[0].songs[0];delete song.proposedAt;song.shelvedAt='2026-10-25T10:00:00.000Z';song.shelfReason='unselected';song.shelfReturn={event:'target',song:'copy'};state.events[1].songs=[{...structuredClone(song),id:'copy',shelvedAt:undefined,shelfReturn:undefined}];
 assert.equal(ensureShelfHistory(state),true);assert.equal(song.origin.proposedAt,undefined);assert.equal(song.shelfHistory[0].returned.title,'target');assert.equal(state.events[1].songs[0].origin.event,'source');assert.equal(ensureShelfHistory(state),false);
});

test('destination choices include real and demo drafts, reject deleted or published meetings and enforce capacity',()=>{
 const state=fixture();state.events[0].demo=true;state.events.push(event('closed',{status:'published'}),event('deleted',{deletedAt:'2026-10-20'}),event('full',{songs:Array.from({length:60},(_,i)=>({...structuredClone(state.events[0].songs[0]),id:String(i),assigned:{}}))}));
 assert.deepEqual(shelfDestinations(state,'source').map(e=>e.id),['source','target']);
 let shelved=act(state,{type:'shelveSong'});for(const targetEvent of ['closed','deleted','full'])assert.throws(()=>act(shelved,{type:'restoreShelved',targetEvent}),/черновик|60 песен/);
 shelved=act(shelved,{type:'deleteEvent'});assert.equal(shelfSongs(shelved,'',true).length,1);assert.equal(act(shelved,{type:'restoreShelved',targetEvent:'target'}).events[1].songs.length,1);
});

test('new proposals record proposal time and the original meeting before later edits',()=>{
 let state=act(fixture(),{type:'song',song:undefined,title:'New',artist:'Artist',duration:5,slots:[{label:'Гитара',required:true}]});const song=state.events[0].songs.at(-1);assert.ok(Number.isFinite(Date.parse(song.proposedAt)));assert.equal(song.origin.title,'source');state.events[0].title='Changed';state=act(state,{type:'shelveSong',song:song.id});assert.equal(state.events[0].songs.at(-1).origin.title,'source');
});

test('permanent musician deletion anonymizes shelf history along with other historical records',()=>{
 let state=act(fixture(),{type:'shelveSong'});state=applyAction(state,{type:'deletePerson',person:'u'},'owner');state=applyAction(state,{type:'purgePerson',person:'u'},'owner');assert.ok(!state.events[0].songs[0].shelfHistory[0].members.includes('u'));assert.ok(state.events[0].songs[0].shelfHistory[0].members.some(id=>id.startsWith('__deleted_person__')));
});
