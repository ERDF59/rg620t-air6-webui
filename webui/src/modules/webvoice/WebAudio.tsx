import React, { useEffect, useRef } from 'react';
import controller from './controller';

type Call = { id:number; state:number; direction:number; number:string };
export default function WebAudio({call}: {call:Call|null}) {
  const host=useRef<HTMLDivElement>(null);
  const latest=useRef(call);
  const ui=useRef<ReturnType<typeof controller.create>>();
  latest.current=call;
  useEffect(()=>{
    const controls=controller.create(()=>latest.current,()=>true,()=>{});
    ui.current=controls;
    host.current?.replaceChildren(controls.panel);
    return ()=>{ui.current=undefined;controls.leave();controls.panel.remove();};
  },[]);
  useEffect(()=>{ui.current?.update();},[call]);
  return <div className="voice-web-audio" ref={host}/>;
}
