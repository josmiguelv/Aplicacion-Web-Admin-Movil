import test from 'node:test'
import assert from 'node:assert/strict'
import {validReceiptImageUrl} from './payment-receipt-validation.mjs'
test('receipt image accepts HTTPS media link with signed query',()=>{
 assert.equal(validReceiptImageUrl('https://cdn.example.com/recibo.png?token=abc'),true)
})
test('receipt image rejects local, IP, insecure, credential and non-url input',()=>{
 for(const url of ['http://cdn.example.com/file.jpg','https://127.0.0.1/receipt.png',
  'https://localhost/file.jpg','https://user:pass@cdn.example.com/a.png',
  'https://[::1]/receipt.png','file:///etc/passwd','https://cdn.example.com:8443/x.png',
  'https://cdn.example.com/x.png#fragment','https://assets.internal/a.png',
  'https://cdn.example.com/a image.png','https://domain.test/a.png',null])
  assert.equal(validReceiptImageUrl(url),false,String(url))
})
