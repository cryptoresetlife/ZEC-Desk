// Keep both desktop and Noir-compatible loopback names; never accept arbitrary hosts.
export function localOrigin(host, port=8793) {
  return host===`127.0.0.1:${port}`||host===`localhost:${port}` ? `http://${host}` : null;
}
export function localRequestAllowed(headers, token, port=8793) {
  const origin=localOrigin(headers.host,port);
  return Boolean(origin&&headers['x-zec-desk']===token&&(!headers.origin||headers.origin===origin));
}
