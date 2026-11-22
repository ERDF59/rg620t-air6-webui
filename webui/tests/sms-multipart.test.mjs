import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeParts } from '../src/modules/sms/decode.ts';

const epoch = Date.UTC(2026, 10, 20, 14, 29);
const item = (seq, seconds, extra = {}) => ({
  index: 10 + seq, number: '10000', content: String(seq),
  time: '26/11/20,22:29:' + String(seconds % 60).padStart(2, '0'),
  receivedAt: epoch + seconds * 1000,
  parts: { ref: 42, total: 4, seq, center: '00', identifier: 0 },
  records: [{ index: 10 + seq, pdu: 'AA' }], ...extra,
});

test('same long SMS does not split when its parts arrive at different seconds', () => {
  const messages = mergeParts([item(4, 61), item(2, 41), item(1, 40), item(3, 48)], true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, '1234');
  assert.deepEqual(messages[0].records.map(r => r.index), [11, 12, 13, 14]);
});

test('remaining 2/4 and 4/4 remain one actionable incomplete message', () => {
  const messages = mergeParts([item(4, 53), item(2, 31)], true);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].fragments, { available: 2, total: 4 });
  assert.match(messages[0].content, /2\n…\n4/);
  assert.deepEqual(messages[0].records.map(r => r.index), [12, 14]);
});

test('colliding sequence numbers stay separate and later reused references are distinct', () => {
  const duplicate = item(2, 44, { index: 22, records: [{ index: 22, pdu: 'AA' }] });
  assert.equal(mergeParts([item(2, 41), duplicate, item(4, 48)], true).length, 3);
  assert.equal(mergeParts([item(2, 41), item(4, 3600)], true).length, 2);
});

const sample = (seq, index, center, pdu, seconds=0) => ({
  ...item(seq, seconds), index, parts:{ref:79,total:2,seq,center,identifier:0},records:[{index,pdu}],
});
test('a complete same-time delivery across SMSCs includes every identical storage copy exactly once',()=>{
  const a=sample(1,6,'A','01'), b=sample(2,5,'B','02'), copy=sample(2,8,'B','02');
  const rows=mergeParts([b,a,copy],true);
  assert.equal(rows.length,1); assert.equal(rows[0].content,'12');
  assert.deepEqual(rows[0].fragments,{available:2,total:2});
  assert.deepEqual(rows[0].records.map(x=>x.index).sort((a,b)=>a-b),[5,6,8]);
  assert.deepEqual(mergeParts([b,copy],true)[0].fragments,{available:1,total:2});
});
test('different PDUs in the same position or different timestamps cannot bridge SMSCs',()=>{
  const a=sample(1,6,'A','01'), b=sample(2,5,'B','02');
  for (const group of [[a,sample(2,5,'B','02',1)],[a,b,sample(2,8,'B','03')]]) {
    const rows=mergeParts(group,true);
    assert.ok(rows.every(row=>!row.records.some(r=>r.index===6)||row.records.length===1));
    assert.deepEqual(rows.flatMap(row=>row.records).map(r=>r.index).sort(),group.map(x=>x.index).sort());
  }
});
