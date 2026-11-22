'use strict';

const { randomBytes } = require('node:crypto');
const definition = require('../agent.json');

const api = '/api/v1';
const escape = encodeURIComponent;

async function* streamEvents(response) {
  if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
    throw new Error('TrueForge did not return a turn event stream.');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let lines = [];
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
      if (!line && lines.length) {
        const data = lines.join('\n');
        lines = [];
        if (data !== '[DONE]') {
          const event = JSON.parse(data);
          yield event.data?.type ? event.data : event;
        }
      }
    }
    if (buffer.length + lines.reduce((sum, line) => sum + line.length, 0) > 2_000_000) {
      throw new Error('TrueForge sent an oversized stream frame.');
    }
  }
}

class Forge {
  constructor(baseUrl, signal) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Set Truforgery: Base Url to the local TrueForge origin.');
    }
    this.base = url.origin;
    this.signal = signal;
    this.connector = 'truforgery-' + randomBytes(6).toString('hex');
  }

  async request(method, path, body, { stream = false, cleanup = false } = {}) {
    const timeout = AbortSignal.timeout(stream ? 180000 : 8000);
    const signal = cleanup ? timeout : AbortSignal.any([this.signal, timeout]);
    let response;
    try {
      response = await fetch(this.base + api + path, {
        method, signal, redirect: 'error',
        headers: { accept: stream ? 'text/event-stream' : 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new Error('Could not reach local TrueForge at ' + this.base + '. Check that it is running.', { cause: error });
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const detail = data?.error?.message;
      throw new Error('TrueForge HTTP ' + response.status + (typeof detail === 'string' ? ' — ' + detail.slice(0, 300) : ''));
    }
    if (stream) return response;
    if (response.status === 204) return null;
    const data = await response.json();
    return data.data ?? data;
  }

  async connect(mcp) {
    this.connectorAttempted = true;
    await this.request('PUT', '/settings/mcp-servers', { manifest: {
      name: this.connector,
      description: 'Workspace editor tools for this Truforgery run',
      type: 'remote',
      url: mcp.url,
      auth: { type: 'header', headers: { Authorization: 'Bearer ' + mcp.token } }
    } });
  }

  async open(model, mode) {
    const spec = structuredClone(definition);
    spec.model = { name: model };
    spec.mcp_servers[0].name = this.connector;
    if (mode === 'inline') {
      spec.mcp_servers[0].enable_tools = ['read_file', 'propose_edit'];
      spec.mcp_servers[0].preload_tools = ['read_file'];
      spec.mcp_servers[0].require_approval_for_tools = ['propose_edit'];
    }
    const session = await this.request('POST', '/sessions', {
      agent: { spec }
    });
    if (!session?.id) throw new Error('Missing TrueForge session ID.');
    this.session = session.id;
  }

  async resolvedCalls(turnPath, pending, messages) {
    // Persisted events contain complete tool arguments even when streamed as deltas.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 120 * attempt));
      this.signal.throwIfAborted();
      const latest = await this.request('GET', turnPath + '/events?limit=100&order=desc');
      const events = Array.isArray(latest) ? latest : latest.events ?? latest.items ?? [];
      for (const item of events) {
        const event = item.event ?? item;
        if (event.type === 'model.message') messages.set(event.id, event);
      }
      const located = pending.map(({ ref, thread }) => ({
        id: ref.id,
        thread,
        call: messages.get(ref.source_event_id)?.tool_calls?.find(call => call.id === ref.id)
      }));
      if (located.every(entry => entry.call)) return located;
    }
    return pending.map(({ ref, thread }) => ({ id: ref.id, thread, call: null }));
  }

  async turn(prompt, onDelta, decide) {
    const sessionPath = '/sessions/' + escape(this.session);
    let response = await this.request('POST', sessionPath + '/turns', {
      input: [{ type: 'user.message', content: prompt }], stream: true
    }, { stream: true });
    let turnPath;
    const messages = new Map();
    while (true) {
      let pause;
      const pending = [];
      for await (const event of streamEvents(response)) {
        this.signal.throwIfAborted();
        switch (event.type) {
          case 'turn.created':
            turnPath = sessionPath + '/turns/' + escape(event.turn_id);
            break;
          case 'model.message':
            messages.set(event.id, event);
            if (typeof event.content === 'string' && event.content) onDelta(event.content);
            break;
          case 'model.message.delta':
            if (typeof event.content === 'string' && event.content) onDelta(event.content);
            break;
          case 'tool.approval_required':
            for (const ref of event.tool_calls ?? []) pending.push({ ref, thread: event.thread_id });
            break;
          case 'turn.update':
            if (event.state?.status === 'paused') pause = event.id;
            break;
          case 'turn.done':
            return event.state;
        }
        if (pause) break;
      }
      if (!pause || !turnPath || !pending.length) {
        throw new Error('TrueForge stopped without completing the turn or offering a supported approval.');
      }
      const calls = await this.resolvedCalls(turnPath, pending, messages);
      const events = [];
      for (const { id, thread, call } of calls) {
        this.signal.throwIfAborted();
        const approval = await decide(call);
        events.push({ type: 'user.tool_approval', thread_id: thread, tool_call_id: id, approval });
      }
      // Start the subscription before sending answers. The cursor also covers a fast resume.
      const subscribed = this.request('GET', turnPath + '/subscribe?after_event_id=' + escape(pause),
        undefined, { stream: true });
      try {
        [response] = await Promise.all([subscribed, this.request('POST', turnPath + '/events', { events })]);
      } catch (error) {
        void subscribed.then(value => value.body?.cancel()).catch(() => {});
        throw error;
      }
    }
  }

  async cancel() {
    if (!this.session) return;
    await this.request('POST', '/sessions/' + escape(this.session) + '/cancel', {}, { cleanup: true });
  }

  async close() {
    if (!this.connectorAttempted) return;
    await this.request('DELETE', '/settings/mcp-servers/' + escape(this.connector), undefined, { cleanup: true });
  }
}

function toolRequest(call, connector) {
  if (!call) throw new Error('TrueForge did not return the tool arguments for review.');
  const input = JSON.parse(call.function.arguments ?? '{}');
  if (call.tool_info?.type === 'mcp' && call.tool_info.server_name === connector) {
    return { name: call.tool_info.name, input };
  }
  if (call.tool_info?.name === 'call_tool' && input.mcp_server === connector) {
    return { name: input.tool_name, input: input.input ?? {} };
  }
  throw new Error('This tool has no workspace approval handler.');
}

module.exports = { Forge, streamEvents, toolRequest };
