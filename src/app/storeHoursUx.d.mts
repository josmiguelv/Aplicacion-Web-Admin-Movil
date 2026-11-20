export type Weekday='mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'
export type DayHours={open:string;close:string}|{closed:true}
export type OpeningHours=Partial<Record<Weekday,DayHours>>
export type HoursPreset='all'|'weekdays'|'weekend'
export const WEEKDAYS:Weekday[]
export function applyStoreHoursPreset(current:OpeningHours,preset:HoursPreset,open:string,close:string):OpeningHours
export function storeHoursSummary(hours:OpeningHours):{openDays:number;closedDays:number;unconfigured:number}
