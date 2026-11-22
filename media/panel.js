'use strict';

const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const send = (kind, data = {}) => vscode.postMessage({ kind, ...data });
const element = (tag, text, className) => {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
};

byId('form').addEventListener('submit', event => {
  event.preventDefault();
  send('run', { prompt: byId('prompt').value });
});
for (const id of ['cancel', 'apply', 'discard', 'undo', 'session']) {
  byId(id).addEventListener('click', () => send(id));
}

let renderedProposal;
let previousContext = '';
let previousStaged = '';

function button(label, handler, secondary = false) {
  const item = element('button', label, secondary ? 'secondary' : '');
  item.type = 'button';
  item.addEventListener('click', handler);
  return item;
}

function renderProposal(proposal) {
  const section = byId('review');
  section.hidden = !proposal;
  section.replaceChildren();
  if (!proposal) return;
  const heading = element('h2', proposal.kind === 'edit' ? 'Review proposed edits' : 'Allow command?');
  section.append(heading, element('p', proposal.title, 'filename'));
  const list = element('div', '');
  const choices = new Map();
  if (proposal.kind === 'edit') {
    for (const hunk of proposal.hunks) {
      const row = element('article', '', 'hunk');
      row.append(element('h3', 'Line ' + hunk.line));
      row.append(element('pre', hunk.before.split('\n').map(line => '− ' + line).join('\n'), 'removed'));
      row.append(element('pre', hunk.after
        ? hunk.after.split('\n').map(line => '+ ' + line).join('\n') : '(remove selected text)', 'added'));
      const controls = element('div', '', 'actions');
      const accept = button('Accept', () => select(true), true);
      const reject = button('Reject', () => select(false), true);
      function select(value) {
        choices.set(hunk.id, value);
        accept.setAttribute('aria-pressed', String(value));
        reject.setAttribute('aria-pressed', String(!value));
        submit.disabled = choices.size !== proposal.hunks.length;
      }
      accept.setAttribute('aria-pressed', 'false');
      reject.setAttribute('aria-pressed', 'false');
      controls.append(accept, reject, button('Open diff', () => send('preview', {
        proposal: proposal.id, hunk: hunk.id
      }), true));
      row.append(controls);
      list.append(row);
    }
  }
  const actions = element('div', '', 'actions');
  const submit = button(proposal.kind === 'edit' ? 'Finish review' : 'Allow', () => {
    submit.disabled = true;
    send('decide', { proposal: proposal.id, selected: proposal.kind === 'edit'
      ? [...choices].filter(([, selected]) => selected).map(([id]) => id) : [0] });
  });
  submit.disabled = proposal.kind === 'edit';
  actions.append(submit, button(proposal.kind === 'edit' ? 'Reject all' : 'Deny', () =>
    send('decide', { proposal: proposal.id, selected: [] }), true));
  section.append(list, actions);
}

window.addEventListener('message', ({ data }) => {
  byId('mode').textContent = data.mode === 'inline' && data.phase !== 'idle' ? 'Inline edit' : 'Agent';
  const running = ['running', 'review'].includes(data.phase);
  const ready = data.phase === 'ready';
  byId('form').hidden = running || ready || data.phase === 'applying';
  byId('status').textContent = data.status;
  byId('status').className = data.phase === 'error' ? 'error' : '';
  byId('cancel').hidden = !running;
  byId('apply').hidden = !ready;
  byId('discard').hidden = !ready;
  byId('undo').hidden = !data.canUndo || running || ready || data.phase === 'applying';
  byId('session').hidden = !data.session;
  byId('transcript').hidden = !data.output;
  if (byId('output').textContent !== data.output) {
    const output = byId('output');
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 30;
    output.textContent = data.output;
    if (atBottom) output.scrollTop = output.scrollHeight;
  }
  if (renderedProposal !== data.proposal?.id) {
    renderedProposal = data.proposal?.id;
    renderProposal(data.proposal);
  }
  const context = JSON.stringify(data.context);
  if (context !== previousContext) {
    previousContext = context;
    byId('context').hidden = !data.context.length;
    byId('context').querySelector('ul').replaceChildren(...data.context.map(({ path, reason }) =>
      element('li', path + ' (' + reason + ')')));
  }
  const staged = JSON.stringify(data.staged);
  if (staged !== previousStaged) {
    previousStaged = staged;
    byId('staged').hidden = !data.staged.length;
    byId('staged').querySelector('ul').replaceChildren(...data.staged.map(path => element('li', path)));
  }
});
send('ready');
