'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareHunks, materialize, normalize } = require('../src/patches');
const { streamEvents, toolRequest } = require('../src/forge');

test('selecting one hunk leaves rejected content and preserves original offsets', () => {
  const base = 'alpha\nbeta\ngamma\n';
  const hunks = prepareHunks(base, [
    { old_text: 'gamma', new_text: 'g' },
    { old_text: 'alpha', new_text: 'much longer alpha' },
    { old_text: 'beta', new_text: 'B' }
  ]);
  assert.deepEqual(hunks.map(hunk => hunk.line), [1, 2, 3]);
  assert.equal(materialize(base, hunks.filter(hunk => hunk.id !== 2)), 'much longer alpha\nbeta\ng\n');
});

test('inline anchors resolve only inside the selected text', () => {
  const base = normalize('foo\r\nfoo\r\noutside\r\n');
  const hunks = prepareHunks(base, [{ old_text: 'foo', new_text: 'bar' }], [4, 7]);
  assert.equal(materialize(base, hunks), 'foo\nbar\noutside\n');
  assert.throws(() => prepareHunks(base, [{ old_text: 'foo', new_text: 'bar' }]), /ambiguous/);
  assert.throws(() => prepareHunks(base, [{ old_text: 'outside', new_text: '' }], [4, 7]), /missing/);
});

test('overlapping proposals are refused before review', () => {
  assert.throws(() => prepareHunks('abcd', [
    { old_text: 'abc', new_text: 'z' }, { old_text: 'bcd', new_text: 'x' }
  ]), /overlap/);
});

test('the SSE reader keeps multibyte characters across network chunks', async () => {
  const raw = Buffer.from(': ping\r\ndata: {"data":{"type":"model.message.delta","content":"✓"}}\r\n\r\n');
  const body = new ReadableStream({ start(controller) {
    for (const byte of raw) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  const events = await Array.fromAsync(streamEvents(response));
  assert.deepEqual(events, [{ type: 'model.message.delta', content: '✓' }]);
});

test('approval parsing rejects tools from other connectors', () => {
  const call = { function: { arguments: '{"path":"one.txt"}' },
    tool_info: { type: 'mcp', name: 'read_file', server_name: 'other-connector' } };
  assert.throws(() => toolRequest(call, 'local-connector'), /handler/);
});
