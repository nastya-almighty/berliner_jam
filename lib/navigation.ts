export const JAM_TABS=['songs','seeking','people','applications','review','program','shelf','stoplist'] as const;
export type JamTab=typeof JAM_TABS[number];
export type JamLocation={eventId:string;tab:JamTab};
export function readJamLocation(href:string):JamLocation{const url=new URL(href),event=url.searchParams.get('meeting')||'demo-event',tab=url.searchParams.get('tab');return {eventId:/^[a-zA-Z0-9_-]{1,100}$/.test(event)?event:'demo-event',tab:JAM_TABS.some(t=>t===tab)?tab as JamTab:'songs'};}
export function jamLocationUrl(href:string,location:JamLocation){const url=new URL(href);url.searchParams.set('meeting',location.eventId);url.searchParams.set('tab',location.tab);return url.pathname+url.search+url.hash;}
