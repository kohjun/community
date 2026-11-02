import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {performance,monitorEventLoopDelay} from "node:perf_hooks";
import {Client} from "@colyseus/sdk";
import {createTownGateway} from "../src/server/town-gateway.ts";
import {issueTownTicket,townSignature} from "../src/server/town-ticket.ts";
import {townWalkable} from "../src/domain/town.ts";
const count=Number(process.env.TOWN_LOAD_CLIENTS??100),seconds=Number(process.env.TOWN_LOAD_SECONDS??15),scenario=process.env.TOWN_LOAD_SCENARIO??"dense";
if(![20,50,100,150].includes(count)||seconds<10||seconds>7200)throw new Error("Invalid load settings");
const key=randomBytes(48).toString("hex"),origin="http://127.0.0.1:31987",people=Array.from({length:count},(_,i)=>({actor:randomUUID(),publicId:randomUUID(),nickname:`시험${i}`,blocked:[]}));
const gateway=createTownGateway({key,origin,capacity:count,members:async ids=>people.filter(p=>ids.includes(p.actor))});const rooms=[],timers=[],positions=[];let received=0,bytes=0,corrections=0,disconnected=0;
const lag=monitorEventLoopDelay({resolution:10});lag.enable();
try{
 await gateway.listen(0);const port=gateway.server.address().port,sdk=new Client(`http://127.0.0.1:${port}`,{headers:{origin}});
 for(let i=0;i<count;i++){
  const person=people[i],room=await sdk.joinById(gateway.roomId,{ticket:issueTownTicket(person.actor,key)});room.reconnection.enabled=false;room.onMessage("world:ready",()=>{});room.onMessage("player:joined",v=>{received++;bytes+=JSON.stringify(v).length;});room.onMessage("player:left",()=>{});room.onMessage("world:meta",()=>{});room.onMessage("player:snapshots",v=>{received++;bytes+=JSON.stringify(v).length;});room.onMessage("world:state",v=>{received++;bytes+=JSON.stringify(v).length;});room.onMessage("voice:targets",()=>{});room.onMessage("town:error",()=>{});room.onMessage("player:correction",v=>{corrections++;if(positions[i]){positions[i].x=v.x;positions[i].z=v.z;}});room.onLeave(()=>disconnected++);rooms.push(room);
 }
 await new Promise(r=>setTimeout(r,500));
 const start=performance.now(),cpu=process.cpuUsage();
 for(let i=0;i<count;i++){
  let seq=0;const p=gateway.world.residents.get(people[i].actor).avatar;const point={x:p.x,z:p.z};positions[i]=point;
  const angle=i/count*Math.PI*2;
  timers.push(setInterval(()=>{
    const t=(performance.now()-start)/1000,dx=scenario==="dense"?Math.cos(t+i)*.5:Math.cos(angle),dz=scenario==="dense"?Math.sin(t+i)*.5:Math.sin(angle);let nx=point.x+dx*.3,nz=point.z+dz*.3;
    if(!townWalkable(nx,nz)){nx=point.x;nz=point.z;}seq++;const yaw=Math.atan2(dx,dz);rooms[i].send("player:input",{sequence:seq,moveX:dx,moveZ:dz,rotationY:yaw,clientTick:Math.floor(t*1000)});rooms[i].send("player:report",{sequence:seq,position:{x:nx,y:0,z:nz},rotationY:yaw});point.x=nx;point.z=nz;
  },50));
 }
 const renewal=setInterval(()=>{rooms.forEach((r,i)=>r.send("town:action",{type:"auth",ticket:issueTownTicket(people[i].actor,key)}));},45_000);timers.push(renewal);
 await new Promise(r=>setTimeout(r,seconds*1000));timers.forEach(clearInterval);
 const elapsed=(performance.now()-start)/1000,used=process.cpuUsage(cpu),body="{}",stamp=String(Date.now()),path="/internal/metrics";
 const metrics=await(await fetch(`http://127.0.0.1:${port}${path}`,{method:"POST",body,headers:{"x-town-time":stamp,"x-town-signature":townSignature(`${stamp}\n${path}\n${body}`,key)}})).json();
 const result={clients:count,scenario,seconds:elapsed,joined:gateway.world.residents.size,received,estimatedJsonBytes:bytes,corrections,disconnected,cpuCorePercent:(used.user+used.system)/1e6/elapsed*100,eventLoopP95Ms:lag.percentile(95)/1e6,rssMiB:process.memoryUsage().rss/1024**2,...metrics,environment:"local Windows; server and bots in the same process; no WebRTC or GPU",soakComplete:seconds>=7200};
 if(result.joined!==count||disconnected||!received)throw new Error("Load scenario lost clients");await mkdir(".local/town-load",{recursive:true});await writeFile(`.local/town-load/${count}-${scenario}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{timers.forEach(clearInterval);lag.disable();for(const r of rooms)await r.leave().catch(()=>{});await gateway.close();}
