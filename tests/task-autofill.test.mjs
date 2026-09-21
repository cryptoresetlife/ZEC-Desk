import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../launcher/task-autofill.js',import.meta.url),'utf8');
const address='u1'+'q'.repeat(80),origin='https://project.example';
function fixture(specs,actualOrigin=origin){
 class Input {constructor(s){Object.assign(this,{type:'text',name:'',id:'',placeholder:'',labels:[],disabled:false,readOnly:false,maxLength:-1,visible:true,style:{},events:[],_value:''},s);this.labels=this.labels.map(textContent=>({textContent}));}get value(){return this._value;}set value(v){this._value=v;}getClientRects(){return this.visible?[{}]:[];}getAttribute(n){return n==='aria-label'?this.ariaLabel:null;}dispatchEvent(e){this.events.push(e.type);if(this.reject)this.value='';}}
 const fields=specs.map(s=>new Input(s));
 const context=vm.createContext({document:{querySelectorAll:()=>fields},location:{origin:actualOrigin},getComputedStyle:e=>({visibility:'visible',display:'block',opacity:'1',...e.style}),HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}}});
 return {fields,run:(a=address)=>vm.runInContext(source,context)(origin,a)};
}
test('fills one visible empty Unified Address field and emits form events, never submits',()=>{const f=fixture([{labels:['Zcash Unified Address']},{type:'submit',name:'submit'}]);assert.equal(f.run().status,'filled');assert.equal(f.fields[0].value,address);assert.deepEqual(f.fields[0].events,['input','change']);assert.equal(f.fields[1].value,'');assert.equal(f.run().status,'present');assert.equal(f.fields[0].events.length,2);});
test('cross-origin authentication pages never receive the address',()=>{const f=fixture([{name:'wallet_address'}],'https://login.example');assert.equal(f.run().status,'other-origin');assert.equal(f.fields[0].value,'');});
test('existing addresses are preserved',()=>{const f=fixture([{name:'walletAddress',_value:'u1existing'}]);assert.equal(f.run().status,'occupied');assert.equal(f.fields[0].value,'u1existing');});
test('ambiguous address forms do not get filled',()=>{const f=fixture([{name:'walletAddress'},{labels:['Unified Address']}]);assert.equal(f.run().status,'ambiguous');assert(f.fields.every(x=>!x.value));});
test('hidden, disabled and read-only fields are ignored',()=>{const f=fixture([{name:'walletAddress',visible:false},{name:'walletAddress',disabled:true},{name:'walletAddress',readOnly:true},{name:'walletAddress',style:{opacity:'0'}}]);assert.equal(f.run().status,'not-found');});
test('password, recovery, recipient and foreign-chain fields are never filled',()=>{for(const s of [{type:'password',name:'walletAddress'},{name:'walletAddress',labels:['Secret recovery seed']},{name:'walletAddress',labels:['Recipient address']},{labels:['Ethereum wallet address']},{labels:['捐赠钱包地址']},{name:'email'}]){const f=fixture([s]);assert.equal(f.run().status,'not-found');assert.equal(f.fields[0].value,'');}});
test('rejects malformed address and incompatible input length',()=>{assert.equal(fixture([{name:'walletAddress'}]).run('recovery words here').status,'invalid-address');const f=fixture([{name:'walletAddress',maxLength:35}]);assert.equal(f.run().status,'too-long');assert.equal(f.fields[0].value,'');});
test('reports when controlled form rejects the injected value',()=>{const f=fixture([{name:'walletAddress',reject:true}]);assert.equal(f.run().status,'rejected');});
test('dynamic fields become eligible on a later pass without touching other inputs',()=>{const f=fixture([{name:'walletAddress',visible:false},{name:'username'}]);assert.equal(f.run().status,'not-found');f.fields[0].visible=true;assert.equal(f.run().status,'filled');assert.equal(f.fields[1].value,'');});
