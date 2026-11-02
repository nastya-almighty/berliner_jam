'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {jamLocationUrl,readJamLocation,type JamLocation,type JamTab} from '../lib/navigation';
export function useJamNavigation(){
 const [location,setLocation]=useState<JamLocation>({eventId:'demo-event',tab:'songs'}),[ready,setReady]=useState(false),current=useRef(location);
 useEffect(()=>{const initial=readJamLocation(window.location.href);current.current=initial;setLocation(initial);setReady(true);window.history.replaceState({...window.history.state,berlinerJam:initial},'',jamLocationUrl(window.location.href,initial));
  const restore=()=>{const next=readJamLocation(window.location.href);current.current=next;setLocation(next);};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);
 },[]);
 const navigate=useCallback((change:Partial<JamLocation>,replace=false)=>{const next={...current.current,...change};if(next.eventId===current.current.eventId&&next.tab===current.current.tab)return;current.current=next;setLocation(next);const state={...window.history.state,berlinerJam:next},url=jamLocationUrl(window.location.href,next);if(replace)window.history.replaceState(state,'',url);else window.history.pushState(state,'',url);},[]);
 const setTab=useCallback((tab:JamTab)=>navigate({tab}),[navigate]),setEventId=useCallback((eventId:string)=>navigate({eventId,tab:'songs'}),[navigate]),replaceTab=useCallback((tab:JamTab)=>navigate({tab},true),[navigate]),replaceEventId=useCallback((eventId:string)=>navigate({eventId},true),[navigate]);
 return {...location,setTab,setEventId,replaceTab,replaceEventId,navigationReady:ready};
}
