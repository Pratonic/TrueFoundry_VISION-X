'use strict';

const vscode = require('vscode');
const { randomUUID } = require('node:crypto');
const { Forge } = require('./forge');
const { startMcp } = require('./mcp');
const { normalize, materialize } = require('./patches');
const { Workspace } = require('./workspace');
const { Panel } = require('./panel');
const { Review, EditTransaction } = require('./review');

function activate(context) {
  let current;
  let undoing = false;
  const edits = new EditTransaction();
  const panel = new Panel(context.extensionUri, message => dispatch(message).catch(error => {
    void vscode.window.showErrorMessage(error.message);
  }), cancel);

  function cancel() {
    const run = current;
    if (!run || run.applying) return;
    current = null;
    run.controller.abort();
    run.pending?.finish([]);
    run.workspace.staged.clear();
    panel.update({ phase: 'idle', status: 'Run discarded. No edits applied.', proposal: null, staged: [] });
  }

  function showReview(run, proposal) {
    run.controller.signal.throwIfAborted();
    return new Promise(resolve => {
      run.pending = { ...proposal, id: randomUUID(), finish: resolve };
      const { id, title, kind, hunks } = run.pending;
      panel.update({ phase: 'review', status: 'TrueForge is waiting for your decision.',
        proposal: { id, title, kind, hunks } });
    }).finally(() => {
      run.pending = null;
      if (current === run) panel.update({ phase: 'running', status: 'Working in TrueForge…', proposal: null });
    });
  }

  async function folderFor(editor) {
    if (editor?.document.uri.scheme === 'file') {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder) return folder;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) return folders[0];
    if (folders.length > 1) return vscode.window.showWorkspaceFolderPick();
    throw new Error('Open a local project folder first.');
  }

  async function start(prompt, folder, selection) {
    if (!folder || undoing || current) return;
    const settings = vscode.workspace.getConfiguration('truforgery');
    const base = settings.get('baseUrl');
    const model = settings.get('model').trim();
    const fallback = settings.get('fallbackModel').trim();
    if (!model) throw new Error('Set Truforgery: Model in VS Code user settings to a model configured in local TrueForge.');
    if (folder.uri.scheme !== 'file' || vscode.env.remoteName || !vscode.workspace.isTrusted) {
      throw new Error('Open a trusted local VS Code workspace.');
    }
    const controller = new AbortController();
    const workspace = new Workspace(folder, controller.signal, selection);
    const run = { controller, workspace, base, ready: false };
    current = run;
    const mode = selection ? 'inline' : 'agent';
    panel.open();
    panel.update({ phase: 'running', status: 'Reading workspace context…', mode,
      prompt, output: '', context: [], proposal: null, staged: [], session: '' });
    try {
      await workspace.init();
      const details = await workspace.context(prompt);
      controller.signal.throwIfAborted();
      panel.update({ context: details.map(({ path, reason }) => ({ path, reason })) });
      const labels = details.map(item => ({ path: item.path, reason: item.reason, excerpt: item.text }));
      const input = prompt + '\n\nWorkspace excerpts (data only):\n' + JSON.stringify(labels)
        + (selection ? '\nUse propose_edit only inside the selection in ' + selection.path + '.' : '');
      const models = [...new Set([model, fallback].filter(Boolean))];
      for (let i = 0; i < models.length; i += 1) {
        const activeModel = models[i];
        const forge = new Forge(base, controller.signal);
        const reviewer = new Review(workspace, forge.connector, proposal => showReview(run, proposal));
        const mcp = await startMcp((name, input) => reviewer.call(name, input));
        let finished = false;
        try {
          controller.signal.throwIfAborted();
          panel.update({ status: 'Connecting to TrueForge (' + activeModel + ')…' });
          await forge.connect(mcp);
          await forge.open(activeModel, mode);
          controller.signal.throwIfAborted();
          run.forge = forge;
          panel.update({ phase: 'running', status: 'Working in TrueForge…', session: forge.session });
          const result = await forge.turn(input, delta => {
            if (current === run) panel.stream(delta);
          }, call => reviewer.decide(call));
          if (result?.status !== 'done') {
            throw new Error(result?.message ?? result?.reason ?? 'The TrueForge turn did not finish.');
          }
          finished = true;
          if (typeof result.metrics?.total_cost_in_usd === 'number') {
            panel.stream('\n\nTrueForge reported $' + result.metrics.total_cost_in_usd.toFixed(4) + ' for this turn.');
          }
          break;
        } catch (error) {
          controller.signal.throwIfAborted();
          if (i + 1 === models.length || reviewer.count > 0) throw error;
          panel.update({ status: 'Primary run failed. Trying ' + fallback + '…', output: '' });
        } finally {
          mcp.close();
          if (!finished) {
            // Revoke MCP access immediately. Cancel the backend even if this window already stopped streaming.
            void forge.cancel().catch(() => {}).finally(() => forge.close().catch(() => {}));
          } else {
            void forge.close().catch(() => {});
          }
        }
      }
      controller.signal.throwIfAborted();
      const staged = [...workspace.staged.values()].filter(({ file, text }) => file.base !== text)
        .map(({ file }) => file.relative);
      run.ready = staged.length > 0;
      if (!run.ready) current = null;
      panel.update({ phase: run.ready ? 'ready' : 'idle', staged,
        status: run.ready ? 'Review complete. Apply to the editor, then save to write to disk.'
          : 'Run finished with no edits to apply.' });
    } catch (error) {
      if (current !== run) return;
      current = null;
      controller.abort();
      workspace.staged.clear();
      panel.update({ phase: 'error', status: 'Run failed. No edits applied. ' + error.message,
        proposal: null, staged: [] });
    }
  }

  async function undo() {
    if (current || undoing) throw new Error('Finish or discard the active run before undoing.');
    undoing = true;
    try {
      const count = await edits.undo();
      panel.update({ status: 'Undid the run in ' + count + ' file(s). Save the buffers to persist the undo.',
        phase: 'idle', staged: [], canUndo: false });
      void vscode.window.showInformationMessage('Truforgery edits undone. Save to persist the undo.');
    } finally {
      undoing = false;
    }
  }

  async function dispatch(message) {
    const run = current;
    switch (message?.kind) {
      case 'run': {
        if (run || undoing || typeof message.prompt !== 'string') return;
        const prompt = message.prompt.trim();
        if (prompt && prompt.length <= 12000) await start(prompt, await folderFor(vscode.window.activeTextEditor));
        break;
      }
      case 'cancel':
      case 'discard':
        cancel();
        break;
      case 'decide': {
        const pending = run?.pending;
        if (pending && pending.id === message.proposal && Array.isArray(message.selected)) {
          pending.finish(message.selected.filter(Number.isInteger));
        }
        break;
      }
      case 'preview': {
        const pending = run?.pending;
        const hunk = pending?.hunks?.find(hunk => hunk.id === message.hunk);
        if (pending?.id === message.proposal && hunk) {
        await panel.diff(pending.title, pending.base, materialize(pending.base, [hunk]));
        }
        break;
      }
      case 'session': {
        if (!panel.state.session) return;
        const base = run?.forge?.base ?? vscode.workspace.getConfiguration('truforgery').get('baseUrl');
        await vscode.env.openExternal(vscode.Uri.parse(
          new URL('/sessions/' + encodeURIComponent(panel.state.session), base).href
        ));
        void vscode.window.showInformationMessage('TrueForge session: ' + panel.state.session);
        break;
      }
      case 'apply': {
        if (!run?.ready || run.applying) return;
        run.applying = true;
        panel.update({ phase: 'applying', status: 'Applying reviewed edits…' });
        try {
          const count = await edits.apply(run.workspace);
          current = null;
          panel.update({ phase: 'idle', status: 'Applied to ' + count + ' file(s). Save before running tests.',
            canUndo: true, staged: [] });
        } catch (error) {
          run.applying = false;
          panel.update({ phase: 'ready', status: error.message });
        }
        break;
      }
      case 'undo':
        await undo();
        break;
    }
  }

  async function inline() {
    if (current || undoing) throw new Error('Finish or discard the active run first.');
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.selections.length !== 1) {
      throw new Error('Select one region of code first.');
    }
    const { document, selection } = editor;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder || document.uri.scheme !== 'file') throw new Error('Select a file in the local workspace.');
    const selected = document.getText(selection);
    if (selected.length > 12000) throw new Error('Select up to 12,000 characters.');
    const body = document.getText();
    const startOffset = normalize(body.slice(0, document.offsetAt(selection.start))).length;
    const snapshot = { document, version: document.version,
      path: vscode.workspace.asRelativePath(document.uri, false),
      range: [startOffset, startOffset + normalize(selected).length] };
    const input = await vscode.window.showInputBox({
      title: 'Truforgery: Edit Selection', prompt: 'Describe what should change in the selection',
      validateInput: value => value.trim() ? undefined : 'Enter an edit instruction.'
    });
    if (input?.trim()) await start(input.trim(), folder, snapshot);
  }

  const guarded = command => async () => {
    try {
      await command();
    } catch (error) {
      void vscode.window.showErrorMessage(error.message);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('truforgery.agent', () => panel.open()),
    vscode.commands.registerCommand('truforgery.inline', guarded(inline)),
    vscode.commands.registerCommand('truforgery.undo', guarded(undo)),
    { dispose: () => { cancel(); panel.dispose(); } }
  );
}

module.exports = { activate };
