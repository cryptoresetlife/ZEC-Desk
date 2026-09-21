// Noir's injected provider API. No seed, private key, cookie or signing bypass.
export function currentAccount(raw){
 if(!raw||!/^u1[023456789acdefghjklmnpqrstuvwxyz]{50,500}$/.test(raw.shielded||'')||!/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(raw.transparent||''))throw Error('Noir 未返回主网 Unified / 透明地址，请在插件切到正确主网账户');
 return {address:raw.shielded,transparent:raw.transparent};
}
export function units(v){if(typeof v!=='string'||!/^(0|[1-9]\d{0,7})(\.\d{1,8})?$/.test(v))throw Error('钱包金额格式无法核实');const [a,b='']=v.split('.');return BigInt(a)*100000000n+BigInt(b.padEnd(8,'0'));}
export async function checkNoir(provider,expected,invoice,config){
 const account=currentAccount(await provider.request({method:'zcash_getAccounts'}));if(account.address!==expected.address||account.transparent!==expected.transparent)throw Error('Noir 账户已改变，请重新连接并预检');
 const estimate=await provider.request({method:'zcash_getMaxTransfer',params:[{to:invoice.to,memo:invoice.memo,fundingSource:config.fundingSource,feeTier:'standard'}]});
 if(units(estimate.fee)>units(config.maxFee))throw Error('Noir 估算手续费超过你设置的上限');if(units(estimate.maxAmount)<units(invoice.price))throw Error('所选 Noir 余额不足以支付价格和手续费');return estimate;
}
export async function sendNoir(provider,ticket,expected,stillActive=()=>true){
 const account=currentAccount(await provider.request({method:'zcash_getAccounts'}));if(account.address!==expected.address||account.transparent!==expected.transparent)throw Error('Noir 账户已改变，未请求付款');
 if(!stillActive())throw Error('等待已停止，未请求付款');
 if(Date.now()>ticket.config.expiresAt)throw Error('任务已过期，未请求付款');
 const txid=await provider.request({method:'zcash_sendTransaction',params:[{to:ticket.invoice.to,amount:ticket.invoice.price,memo:ticket.invoice.memo,fundingSource:ticket.config.fundingSource}]});
 if(typeof txid!=='string'||!/^[a-f0-9]{64}$/i.test(txid))throw Error('Noir 未返回可核对的交易 ID');return txid;
}
