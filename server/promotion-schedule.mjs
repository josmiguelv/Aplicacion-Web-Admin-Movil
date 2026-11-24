// Local-time promotion visibility for the Administrator's published mobile catalog.
// Weekdays: ISO 1=Monday ... 7=Sunday; dates and clock times are local to the tenant.
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KEYS=['mon','tue','wed','thu','fri','sat','sun'];
export function validPromotionDate(value){
 if(typeof value!=='string'||!DATE.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function validatePromotionSchedule(input){
 const {startDate,endDate,startTime,endTime,weekdays}=input||{};
 if(!validPromotionDate(startDate)||!validPromotionDate(endDate)||startDate>endDate||
   typeof startTime!=='string'||!TIME.test(startTime)||
   typeof endTime!=='string'||!TIME.test(endTime)||startTime>=endTime||
   !Array.isArray(weekdays)||weekdays.length===0||weekdays.length>7||
   new Set(weekdays).size!==weekdays.length||
   !weekdays.every(n=>Number.isInteger(n)&&n>=1&&n<=7))
  return false;
 return true;
}
export function promotionVisible(promo,timeZone='America/Lima',now=new Date()){
 if(promo.active===false)return false;
 // Published legacy promotions may contain only UTC timestamp bounds.
 if(!promo.startDate||!promo.endDate||!promo.startTime||!promo.endTime||
  !Array.isArray(promo.weekdays)){
  if(promo.starts_at&&new Date(promo.starts_at)>now)return false;
  if(promo.ends_at&&new Date(promo.ends_at)<now)return false;
  return true;
 }
 try{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
   timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const day=parts.year+'-'+parts.month+'-'+parts.day;
  const weekday=KEYS.indexOf(String(parts.weekday).toLowerCase())+1;
  const clock=parts.hour+':'+parts.minute;
  return day>=promo.startDate&&day<=promo.endDate&&
   clock>=promo.startTime&&clock<promo.endTime&&
   promo.weekdays.includes(weekday);
 }catch{return false}
}
