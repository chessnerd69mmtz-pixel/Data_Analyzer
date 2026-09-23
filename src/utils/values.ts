import type { DataValue, InferredType } from "../models/Dataset.ts";

export function displayValue(value:DataValue):string{
  if(value===null||value===undefined)return "";
  if(value instanceof Date)return value.toISOString();
  return String(value);
}
export function isBlank(value:DataValue):boolean{
  return value===null||value===undefined||(typeof value==="string"&&value.trim()==="");
}
export function comparableString(value:DataValue):string{return displayValue(value).trim();}
export function parseNumberStrict(value:DataValue):number|null{
  if(typeof value==="number")return Number.isFinite(value)?value:null;
  if(typeof value!=="string")return null;
  const raw=value.trim();if(!raw)return null;
  if(/^[+-]?\d{1,3}(?:\.\d{3})*,\d+$/.test(raw))return null;
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw))return null;
  const n=Number(raw);return Number.isFinite(n)?n:null;
}
export function parseTypedValue(rawValue:string,type:InferredType):DataValue{
  const raw=rawValue.trim();if(raw==="")return null;
  if(type==="number")return parseNumberStrict(raw);
  if(type==="boolean"){if(/^true$/i.test(raw))return true;if(/^false$/i.test(raw))return false;return null;}
  if(type==="date"){if(!/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(raw))return null;const d=new Date(raw);return Number.isNaN(d.getTime())?null:d;}
  return rawValue;
}
export function formatNumber(value:number,digits=3):string{
  if(!Number.isFinite(value))return "not available";
  return value.toFixed(digits).replace(/\.?(0+)$/,"");
}
