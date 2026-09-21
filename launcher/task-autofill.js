// Called by the native task window on the selected project origin only.
// Only a public receiving address is supplied; this never connects a signer.
(function taskAutofill(origin, address) {
  if (location.origin !== origin) return {status:'other-origin'};
  if (!/^(u1[023456789acdefghjklmnpqrstuvwxyz]{50,500}|zs[023456789acdefghjklmnpqrstuvwxyz]{50,150}|t[13][1-9A-HJ-NP-Za-km-z]{33})$/.test(address)) return {status:'invalid-address'};
  const fields = [...document.querySelectorAll('input')].filter(el => {
    if (!['text','search',''].includes(el.type) || el.disabled || el.readOnly || !el.getClientRects().length) return false;
    const style=getComputedStyle(el);if(style.visibility==='hidden'||style.display==='none'||style.opacity==='0')return false;
    const text=[el.name,el.id,el.placeholder,el.getAttribute('aria-label'),...[...(el.labels||[])].map(l=>l.textContent)].join(' ');
    if (/private|secret|seed|mnemonic|recovery|password|email|sender|pay.?to|recipient|destination|donation|私钥|助记词|密码|付款|捐赠|收款方/i.test(text)) return false;
    if (/ethereum|solana|bitcoin|\beth\b|\bbtc\b|\bsol\b|0x/i.test(text)) return false;
    return /(?:zcash|\bzec\b|unified|shielded|\bu1\b).{0,40}(?:address|wallet)|(?:address|wallet).{0,40}(?:zcash|\bzec\b|unified|shielded|\bu1\b)|wallet.?address|钱包地址|接收地址/i.test(text);
  });
  if (!fields.length) return {status:'not-found'};
  if (fields.length!==1) return {status:'ambiguous',count:fields.length};
  const field=fields[0];
  if (field.value===address) return {status:'present'};
  if (field.value.trim()) return {status:'occupied'};
  if (field.maxLength>0&&field.maxLength<address.length) return {status:'too-long'};
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  setter.call(field,address);
  field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
  return {status:field.value===address?'filled':'rejected'};
})
