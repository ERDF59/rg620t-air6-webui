import React, { useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Switch } from '@douyinfe/semi-ui';
import { Field } from '@/ui/widgets';
import { ubus } from '@/services/deviceUbus';
import { engineeringError, type SimStatus } from './engineering';

export const Toggle = ({name,value,disabled,onChange,label=name}: {
  name:string; label?:string; value?:boolean|null; disabled?:boolean; onChange:()=>void;
}) => <div className="engineering-setting control-toggle">
  <strong>{label}</strong>
  <span className="control-toggle-end">{typeof value === 'boolean' ?
    <span>{value ? '开启' : '关闭'}</span> : <span>未读到</span>}
    <Switch aria-label={name} checked={value === true} disabled={disabled || typeof value !== 'boolean'} onChange={onChange} />
  </span>
</div>;

type Action = 'enable'|'disable'|'verify'|'change'|'unblock';
const titles:Record<Action,string>={enable:'开启 PIN 保护',disable:'关闭 PIN 保护',verify:'用 PIN 解锁',change:'修改 PIN',unblock:'用 PUK 解锁'};
export function SimControls({sim,enabled,disabled,busy,onBusy,onRefresh,report}:{
  sim:SimStatus|null; enabled?:boolean|null; disabled:boolean; busy:boolean;
  onBusy:(v:boolean)=>void; onRefresh:()=>Promise<void>; report:(bad:boolean,text:string)=>void;
}){
  const [action,setAction]=useState<Action|null>(null),[secret,S]=useState(''),[newPin,P]=useState(''),[repeat,R]=useState('');
  const [last,L]=useState(false),guard=useRef(false);
  const puk=action==='unblock', reset=puk||action==='change';
  const left=puk?sim?.puk1:sim?.pin1;
  const secure=location.protocol==='https:' || (window.isSecureContext && ['localhost','127.0.0.1','[::1]'].includes(location.hostname));
  const tls=new URL(location.href);tls.protocol='https:'; if(location.port==='80')tls.port='';
  const close=()=>{setAction(null);S('');P('');R('');L(false);};
  const valid=!!left && (puk?/^\d{8}$/:/^\d{4,8}$/).test(secret) && (!reset || (/^\d{4,8}$/.test(newPin) && newPin===repeat)) && (left!==1 || last);
  async function submit(){
    if(!action||!valid||!secure||guard.current||busy)return;
    guard.current=true;onBusy(true);
    try{
      const r=await ubus<{ok:boolean}>('dlink-cellular','sim_action',{action,secret,new_pin:reset?newPin:'',remaining:left,confirm:true});
      if(!r.ok)throw Error('readback');
      report(false, action==='change'?'SIM 卡已接受新 PIN。':titles[action]+'成功。');
    }catch(e){report(true,engineeringError(e));}
    finally{close();await onRefresh();onBusy(false);guard.current=false;}
  }
  const pinLabel=puk?'运营商提供的 PUK':'当前 PIN';
  return <>
    <Toggle name="开机需要 PIN" value={enabled} disabled={disabled||sim?.state!=='ready'||!sim.pin1} onChange={()=>setAction(enabled?'disable':'enable')} />
    {sim?.state==='pin' && <Button size="small" disabled={disabled||!sim.pin1} onClick={()=>setAction('verify')}>用 PIN 解锁</Button>}
    {sim?.state==='puk' && <Button size="small" disabled={disabled||!sim.puk1} onClick={()=>setAction('unblock')}>用 PUK 解锁</Button>}
    {sim?.state==='ready' && enabled && <Button size="small" disabled={disabled||!sim.pin1} onClick={()=>setAction('change')}>修改 PIN</Button>}
    {action && <Modal title={titles[action]} visible width="min(430px, calc(100vw - 32px))"
      okText="确认提交" cancelText="取消" cancelButtonProps={{'aria-label':'取消'}} onCancel={()=>{if(!guard.current)close();}}
      okButtonProps={{disabled:!valid||!secure,'aria-label':'确认提交'}} confirmLoading={busy} onOk={submit}>
      {secure ? <div className="pin-fields">
        <p>{puk?'输入 PUK 并设置新 PIN。':'请输入这张 SIM 卡的当前 PIN。'}剩余 {left ?? '未知'} 次尝试。</p>
        <Field label={pinLabel}><Input mode="password" aria-label={pinLabel} autoComplete="off" inputMode="numeric" maxLength={8} value={secret} onChange={S}/></Field>
        {reset && <>
          <Field label="新 PIN（4–8 位数字）"><Input mode="password" aria-label="新 PIN" autoComplete="new-password" inputMode="numeric" maxLength={8} value={newPin} onChange={P}/></Field>
          <Field label="再次输入新 PIN"><Input mode="password" aria-label="再次输入新 PIN" autoComplete="new-password" inputMode="numeric" maxLength={8} value={repeat} onChange={R}/></Field>
        </>}
        {left===1 && <Checkbox checked={last} onChange={e=>L(!!e.target.checked)}>{puk?'最后一次 PUK 尝试，输错可能永久锁卡':'最后一次 PIN 尝试，输错将需要 PUK'}</Checkbox>}
      </div> : <p>当前连接是 HTTP。请<a href={tls.href}>通过 HTTPS 打开工程工具</a>，重新登录后再输入 SIM 密码。</p>}
    </Modal>}
  </>;
}
