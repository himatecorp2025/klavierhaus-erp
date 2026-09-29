"use strict";

function isoDate(year,month,day){return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;}
function addDays(key,amount){const d=new Date(`${key}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+amount);return isoDate(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());}
function weekdayDate(year,month,weekday,occurrence){const first=new Date(Date.UTC(year,month-1,1));const offset=(weekday-first.getUTCDay()+7)%7;return isoDate(year,month,1+offset+(occurrence-1)*7);}
function lastWeekdayDate(year,month,weekday){const last=new Date(Date.UTC(year,month,0));const offset=(last.getUTCDay()-weekday+7)%7;return isoDate(year,month,last.getUTCDate()-offset);}
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return isoDate(year,month,day);
}
function builtInHolidays(year,{christian=true}={}){
  const fixed=[[1,1],[6,19],[7,4],[11,11],[12,25]],keys=new Set();
  for(const [month,day] of fixed){
    const key=isoDate(year,month,day),weekday=new Date(`${key}T00:00:00Z`).getUTCDay();
    keys.add(key);keys.add(weekday===6?addDays(key,-1):weekday===0?addDays(key,1):key);
  }
  keys.add(weekdayDate(year,1,1,3));
  keys.add(weekdayDate(year,2,1,3));
  keys.add(lastWeekdayDate(year,5,1));
  keys.add(weekdayDate(year,9,1,1));
  keys.add(weekdayDate(year,10,1,2));
  keys.add(weekdayDate(year,11,4,4));
  if(christian){
    const easter=easterSunday(year);
    [-2,0,1,39,49,50].forEach(offset=>keys.add(addDays(easter,offset)));
  }
  return keys;
}
function nyParts(date=new Date()){
  return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(date).reduce((out,part)=>(out[part.type]=part.value,out),{});
}
function manualHolidays(db,year){
  try{return new Map(db.prepare("SELECT holiday_date,enabled,label FROM support_holidays WHERE holiday_date LIKE ?").all(`${year}-%`).map(row=>[row.holiday_date,row]));}
  catch(_error){return new Map();}
}
function supportState({db,date=new Date(),env=process.env}={}){
  const parts=nyParts(date),dateKey=`${parts.year}-${parts.month}-${parts.day}`,hour=Number(parts.hour),minute=Number(parts.minute);
  const holidays=builtInHolidays(Number(parts.year),{christian:String(env.SUPPORT_CHRISTIAN_HOLIDAYS||"true").toLowerCase()!=="false"});
  String(env.SUPPORT_HOLIDAYS||"").split(",").map(value=>value.trim()).filter(Boolean).forEach(key=>holidays.add(key));
  const manual=manualHolidays(db,Number(parts.year)),override=manual.get(dateKey);
  if(override){if(Number(override.enabled)===1)holidays.add(dateKey);else holidays.delete(dateKey);}
  const weekend=["Sat","Sun"].includes(parts.weekday),holiday=holidays.has(dateKey),withinClock=hour>=9&&hour<17;
  return {
    open:!weekend&&!holiday&&withinClock,
    timezone:"America/New_York",opens_at:"09:00",closes_at:"17:00",
    date:dateKey,weekday:parts.weekday,local_time:`${parts.hour}:${parts.minute}`,
    reason:weekend?"WEEKEND":holiday?"HOLIDAY":withinClock?"OPEN":"OUTSIDE_HOURS",
    holiday_label:override?.label||null
  };
}
module.exports={supportState,builtInHolidays,easterSunday};
