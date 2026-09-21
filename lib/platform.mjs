import {join} from 'node:path';
import {homedir} from 'node:os';
export function appDataPath(root,platform=process.platform,home=homedir()) {
  return platform==='darwin' ? join(home,'Library','Application Support','ZEC Desk','data') : join(root,'data');
}
export function macWalletPath(home=homedir()) {
  return join(home,'Library','Application Support','ZEC Desk','wallet-mainnet');
}
