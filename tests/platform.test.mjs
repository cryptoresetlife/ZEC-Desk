import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {appDataPath,macWalletPath} from '../lib/platform.mjs';
test('macOS data survives app relocation and stays outside the app bundle',()=>{
  const expected=join('/example','Library','Application Support','ZEC Desk','data');
  assert.equal(appDataPath('/Applications/ZEC Desk.app','darwin','/example'),expected);
  assert.equal(appDataPath('/Downloads/ZEC Desk.app','darwin','/example'),expected);
  assert.equal(macWalletPath('/example'),join('/example','Library','Application Support','ZEC Desk','wallet-mainnet'));
});
test('Windows keeps its existing data directory',()=>assert.equal(appDataPath('example','win32'),join('example','data')));
