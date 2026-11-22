import React,{useCallback,useEffect,useRef,useState} from 'react';
import { Kv } from '@/ui/widgets';
import { ubus } from '@/services/deviceUbus';
import { engineeringError } from './engineering';

interface Beams {ok:boolean; beams:Array<{cc:string;id:number|null;power:number|null;avg:number|null;snr:number|null}>;
  rx:Array<{cc:string;rsrp:(number|null)[];snr:(number|null)[];rssi:(number|null)[]}>}
const val=(n:number|null,unit:string)=>n==null?'—':n+' '+unit;
export function useBeams(sample:number){
  const [r,set]=useState<Beams|null>(null),[err,E]=useState('');
  const inFlight=useRef(false);
  const read=useCallback(async ()=>{
    if(inFlight.current)return;
    inFlight.current=true;
    try {
      const next=await ubus<Beams & {error?:string}>('dlink-cellular','beam_info');
      if(!next.ok)throw Error(next.error||'beam_read');
      set(next);E('');
    }catch(e){set(null);E(engineeringError(e));}finally{inFlight.current=false;}
  },[]);
  useEffect(()=>{if(sample>0)void read();},[sample,read]);
  return {data:r,error:err};
}
export const beamLabel=(id:number|null|undefined)=>id==null?'—':'SSB #'+id;
export const beamPower=(v:number|null|undefined)=>val(v??null,'dBm');

/** Bind only an exact modem-reported CC label, never an assumed SCC array order. */
export function BeamDetails({data,cc,error}:{data:Beams|null;cc:string;error?:string}){
  const b=data?.beams.find(v=>v.cc===cc),rx=data?.rx.find(v=>v.cc===cc);
  return <details className="carrier-beam-details">
    <summary>波束与接收链明细</summary>
    <div className="carrier-beam-body">
      {error && <p>{error}</p>}
      {b && <Kv dense items={[{label:'平均 SSB RSRP',value:val(b.avg,'dBm')},{label:'平均 SSB SNR',value:val(b.snr,'dB')}]} />}
      {rx ? <table className="rx-table"><thead><tr><th>接收链</th><th>RSRP</th><th>SNR</th><th>RSSI</th></tr></thead>
        <tbody>{rx.rsrp.map((n,k)=><tr key={k}><th>Rx{k}</th><td>{val(n,'dBm')}</td><td>{val(rx.snr[k],'dB')}</td><td>{val(rx.rssi[k],'dBm')}</td></tr>)}</tbody></table>
        : !error && <p className="hint-line">{data?'基带未上报此载波的接收链。':'等待读取基带测量…'}</p>}
    </div>
  </details>;
}
