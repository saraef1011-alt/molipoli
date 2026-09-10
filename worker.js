export class GameRoom {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.clients=new Map();this.state={started:false,turn:0,players:[],properties:{}};this.ready=this.load()}
 async load(){const s=await this.ctx.storage.get('state');if(s)this.state=s}
 async save(){await this.ctx.storage.put('state',this.state)}
 broadcast(type,data){for(const ws of this.clients.keys())try{ws.send(JSON.stringify({type,data}))}catch{}}
 async fetch(req){if(req.headers.get('Upgrade')!=='websocket')return new Response('WebSocket required',{status:426});const pair=new WebSocketPair(),[client,server]=Object.values(pair);server.accept();await this.ready;this.clients.set(server,{});server.send(JSON.stringify({type:'state',data:this.state}));server.addEventListener('message',e=>this.msg(server,e.data));server.addEventListener('close',()=>this.clients.delete(server));return new Response(null,{status:101,webSocket:client})}
 async msg(ws,raw){let m;try{m=JSON.parse(raw)}catch{return}let d=m.data||{};
 if(m.type==='create'&&!this.state.players.length){let n=Math.max(2,Math.min(6,+d.count||4));for(let i=0;i<n;i++)this.state.players.push({id:'p'+i,name:i?`بازیکن ${i+1}`:(d.name||'بازیکن'),avatar:['🐔','🦊','🐼','🐯','🦁','🐸'][i],money:1500,pos:0,properties:[]});this.state.started=true;await this.save();this.broadcast('state',this.state);this.broadcast('log','🎮 بازی شروع شد!');return}
 if(!this.state.started)return;
 let p=this.state.players[this.state.turn];
 if(m.type==='roll'){let a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6),old=p.pos;p.pos=(p.pos+a+b)%40;if(old>a+b)p.money+=200;this.resolve(p);await this.save();this.broadcast('state',this.state);this.broadcast('log',`🎲 ${p.name}: ${a}+${b}`)}
 if(m.type==='buy'){let pr=this.state.properties[p.pos];if(pr&&!pr.owner&&p.money>=pr.price){p.money-=pr.price;pr.owner=p.name;p.properties.push(p.pos);await this.save();this.broadcast('state',this.state);this.broadcast('log',`🏠 ${p.name} ملک را خرید.`)}}
 if(m.type==='endTurn'){this.state.turn=(this.state.turn+1)%this.state.players.length;await this.save();this.broadcast('state',this.state)}
 }
 resolve(p){let i=p.pos;if([2,17,33].includes(i))p.money+=100;if(i===4)p.money-=200;if(i===38)p.money-=100;if([10].includes(i)){p.pos=10;p.jail=1}
 const prices={1:60,3:60,6:100,8:100,9:120,11:140,13:140,14:160,16:180,18:180,19:200,21:220,23:220,24:240,26:260,27:260,29:280,31:300,32:300,34:320,37:350,39:400};if(prices[i]&&!this.state.properties[i])this.state.properties[i]={price:prices[i],owner:null};let pr=this.state.properties[i];if(pr?.owner&&pr.owner!==p.name){let r=Math.max(20,Math.floor(pr.price*.1));p.money-=r;let o=this.state.players.find(x=>x.name===pr.owner);if(o)o.money+=r}}
}
export default {async fetch(request,env){let u=new URL(request.url);if(u.pathname==='/ws')return env.GAME.getByName('main').fetch(request);return env.ASSETS.fetch(request)}}