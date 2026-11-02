import assert from "node:assert/strict";
import http from "node:http";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {build} from "esbuild";
import {chromium} from "playwright";
import {createTownGateway} from "../src/server/town-gateway.ts";
import {issueTownTicket} from "../src/server/town-ticket.ts";
const output=".local/town-browser";await mkdir(output,{recursive:true});
const bundle=await build({entryPoints:["tests/browser/town-fixture.tsx"],outfile:"town.js",bundle:true,write:false,format:"iife",platform:"browser",conditions:["style"],jsx:"automatic",define:{"process.env":"{}","process.env.NODE_ENV":'"production"'},plugins:[{name:"next-link",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"tsx",resolveDir:process.cwd(),contents:"export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}"}));}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith(".js")).text,css=bundle.outputFiles.find(f=>f.path.endsWith(".css")).text;
const key=randomBytes(48).toString("hex"),people=new Map([0,1].map(i=>{const actor=randomUUID();return [String(i),{actor,publicId:randomUUID(),nickname:i?"타운친구":"타운주민",blocked:[]}];}));let gateway;
const server=http.createServer(async(req,res)=>{
 const who=people.get(req.headers.cookie?.match(/town-test=(\d)/)?.[1]??"0");
 const json=data=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:true,data}));};
 if(req.url==="/town.js"){res.setHeader("Content-Type","application/javascript");res.end(js);return;}
 if(req.url==="/town.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
 if(req.url==="/api/auth/session"){json({available:true,authenticated:true,nickname:who.nickname});return;}
 if(req.url==="/api/v1/world/ticket"){json({roomId:gateway.roomId,path:`ws://127.0.0.1:${gateway.server.address().port}`,ticket:issueTownTicket(who.actor,key)});return;}
 if(req.url==="/api/v1/voice/token"){json({enabled:false});return;}
 if(req.url==="/api/town/safety"){let body="";for await(const c of req)body+=c;const v=JSON.parse(body),found=gateway.world.evidence(who.actor,v.target,v.kind);if(v.action==="block"){const target=[...people.values()].find(p=>p.publicId===found.publicId);who.blocked.push(target.actor);await gateway.refreshMembers();}json({saved:true});return;}
 res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/town.css"><div id="root"></div><script src="/town.js"></script>');
});await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;
gateway=createTownGateway({key,origin,members:async ids=>[...people.values()].filter(p=>ids.includes(p.actor))});await gateway.listen(0);
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});let passed=0;const errors=[];
try{
 const one=await browser.newContext({viewport:{width:1440,height:1000}}),two=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});await one.addInitScript("window.process={env:{NODE_ENV:\"production\"}}");await two.addInitScript("window.process={env:{NODE_ENV:\"production\"}}");await one.addCookies([{name:"town-test",value:"0",url:origin}]);await two.addCookies([{name:"town-test",value:"1",url:origin}]);const a=await one.newPage(),b=await two.newPage();for(const page of [a,b])page.on("pageerror",e=>{errors.push(e.message);console.error("PAGE",e.stack);});
 a.on("console",m=>{if(m.type()==="error")console.error("BROWSER",m.text());});a.on("requestfailed",r=>console.error("REQUEST",r.url(),r.failure()));await Promise.all([a.goto(origin),b.goto(origin)]);await Promise.all([a.getByRole("button",{name:"타운 입장",exact:true}).click(),b.getByRole("button",{name:"타운 입장",exact:true}).click()]);await a.getByText("2 / 8명",{exact:true}).waitFor();await b.getByText("2 / 8명",{exact:true}).waitFor();passed++;
 await a.locator("canvas").waitFor();await b.locator("canvas").waitFor();await a.waitForTimeout(3500);assert.equal(errors.length,0,errors.join("\n"));passed++;
 const actor=people.get("0").actor,start=gateway.world.residents.get(actor).avatar.x;await a.locator("h1").click();await a.keyboard.down("ArrowRight");await a.waitForTimeout(1000);await a.keyboard.up("ArrowRight");assert.ok(gateway.world.residents.get(actor).avatar.x>start+1);passed++;
 const second=people.get("1").actor,startTouch=gateway.world.residents.get(second).avatar.x;const touch=b.getByRole("button",{name:"오른쪽으로 이동",exact:true});await touch.scrollIntoViewIfNeeded();const rect=await touch.boundingBox();await b.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await b.mouse.down();await b.waitForTimeout(60);await b.mouse.up();await b.waitForTimeout(250);assert.ok(gateway.world.residents.get(second).avatar.x>startTouch+.01,"short touch updates movement immediately");passed++;
 await Promise.all([a.getByRole("button",{name:"채팅",exact:true}).click(),b.getByRole("button",{name:"채팅",exact:true}).click()]);await a.getByRole("textbox",{name:"광장에 보낼 메시지"}).fill("안녕하세요 타운친구!");await a.getByRole("button",{name:"메시지 보내기"}).click();await b.getByText("안녕하세요 타운친구!",{exact:true}).waitFor();passed++;
 for(const width of [320,393,720,1440]){await a.setViewportSize({width,height:width===1440?1000:852});await a.waitForTimeout(400);assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow at ${width}`);assert.ok((await a.getByRole("textbox",{name:"광장에 보낼 메시지"}).boundingBox()).width>100,`chat input at ${width}`);await a.screenshot({path:`${output}/town-${width}.png`,fullPage:true});}passed++;
 await b.getByRole("button",{name:"게임 라운지",exact:true}).click();await b.getByRole("link",{name:"건배의 눈치"}).waitFor();await b.getByRole("button",{name:"모임 게시판",exact:true}).click();assert.equal(await b.getByRole("link",{name:/오늘 가볍게/}).getAttribute("href"),"/lightning");passed++;
 await b.getByRole("button",{name:"참가자",exact:true}).click();await b.getByRole("button",{name:"신고·차단",exact:true}).click();await b.getByRole("button",{name:"차단하기",exact:true}).click();await b.getByText("차단했어요. 서로의 아바타와 채팅이 숨겨져요.").waitFor();assert.equal(gateway.world.view(people.get("1").actor).players.length,1);passed++;
 await a.getByRole("button",{name:"나가기",exact:true}).click();await a.getByRole("button",{name:"타운 입장",exact:true}).waitFor();await b.getByRole("button",{name:"나가기",exact:true}).click();passed++;
 assert.equal(errors.length,0,errors.join("\n"));await writeFile(`${output}/report.json`,JSON.stringify({passed,errors,actualColyseus:true,actualWebGL:true,actualRapier:true,physicalDevice:false},null,2));console.log(JSON.stringify({passed,errors}));
}finally{await browser.close();await gateway.close();await new Promise(r=>server.close(r));}
