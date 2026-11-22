'use strict';

const vscode = require('vscode');
const { prepareHunks, materialize } = require('./patches');
const { toolRequest } = require('./forge');

const approve = { status: 'allow' };
const deny = reason => ({ status: 'deny', reason });

function signature(name, input) {
  if (name === 'run_command') return JSON.stringify([name, input.command]);
  return JSON.stringify([name, input.path, input.edits?.map(({ old_text, new_text }) => [old_text, new_text])]);
}

class Review {
  constructor(workspace, connector, show) {
    this.workspace = workspace;
    this.connector = connector;
    this.show = show;
    this.approvals = new Map();
    this.count = 0;
  }

  async decide(call) {
    this.count += 1;
    try {
      const { name, input } = toolRequest(call, this.connector);
      const key = signature(name, input);
      if (this.approvals.has(key)) return deny('Duplicate tool request. Follow the first decision.');
      if (name === 'run_command') {
        if (this.workspace.selection || !['git status --short', 'git diff --stat'].includes(input.command)) {
          return deny('That command is not available.');
        }
        const selected = await this.show({ kind: 'command', title: input.command });
        this.workspace.signal.throwIfAborted();
        if (!selected.includes(0)) return deny('The user declined the command.');
        this.approvals.set(key, {});
        return approve;
      }
      if (name !== 'propose_edit') return deny('Unsupported tool.');
      const file = await this.workspace.file(input.path);
      const base = this.workspace.text(file);
      if (this.workspace.selection && base !== file.base) {
        return deny('The selection already has an approved proposal.');
      }
      const hunks = prepareHunks(base, input.edits, this.workspace.selection?.range);
      const selected = await this.show({ kind: 'edit', title: file.relative, hunks, base });
      this.workspace.signal.throwIfAborted();
      const accepted = hunks.filter(hunk => selected.includes(hunk.id));
      if (!accepted.length) return deny('The user rejected every hunk.');
      const text = materialize(base, accepted);
      if (text.length > 512 * 1024) return deny('The proposed file exceeds the text size limit.');
      this.approvals.set(key, { file, base, text, accepted: accepted.length, rejected: hunks.length - accepted.length });
      return approve;
    } catch (error) {
      this.workspace.signal.throwIfAborted();
      return deny(error.message);
    }
  }

  async call(name, input) {
    this.workspace.signal.throwIfAborted();
    if (name === 'read_file') return this.workspace.read(input);
    if (name === 'search_workspace') return this.workspace.search(input);
    if (name !== 'propose_edit' && name !== 'run_command') throw new Error('Unknown tool.');
    const key = signature(name, input);
    const grant = this.approvals.get(key);
    if (!grant) throw new Error('This exact tool call has no editor approval.');
    this.approvals.delete(key);
    if (name === 'run_command') return this.workspace.command(input.command);
    const { file, base, text, accepted, rejected } = grant;
    if (this.workspace.text(file) !== base) {
      throw new Error('Another approved proposal changed this file. Read the staged text and try again.');
    }
    this.workspace.staged.set(file.key, { file, text });
    return { path: file.relative, staged_hunks: accepted, rejected_hunks: rejected };
  }
}

function physicalText(document, text) {
  return document.eol === vscode.EndOfLine.CRLF ? text.replace(/\n/g, '\r\n') : text;
}

function documentRange(document) {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

class EditTransaction {
  constructor() {
    this.last = [];
  }

  async apply(workspace) {
    const changes = [...workspace.staged.values()].filter(({ file, text }) => file.base !== text);
    const documents = await Promise.all(changes.map(async ({ file, text }) => {
      const uri = await workspace.uri(file.relative);
      const document = await vscode.workspace.openTextDocument(uri);
      return { file, document, after: physicalText(document, text) };
    }));
    const edit = new vscode.WorkspaceEdit();
    for (const { file, document, after } of documents) {
      if (document.getText() !== file.original
          || (document === file.document && document.version !== file.version)) {
        throw new Error(file.relative + ' changed during review. Discard this run and try again.');
      }
      edit.replace(file.uri, documentRange(document), after);
    }
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error('VS Code could not apply the reviewed edit.');
    }
    this.last = documents.map(({ file, after }) => ({
      workspace, relative: file.relative, before: file.original, after
    }));
    return changes.length;
  }

  async undo() {
    if (!this.last.length) throw new Error('There is no applied Truforgery run to undo.');
    const documents = await Promise.all(this.last.map(async (entry) => {
      const uri = await entry.workspace.uri(entry.relative);
      return { ...entry, document: await vscode.workspace.openTextDocument(uri) };
    }));
    const edit = new vscode.WorkspaceEdit();
    for (const { document, relative, before, after } of documents) {
      if (document.getText() !== after) throw new Error(relative + ' changed after Apply. Review it before undoing.');
      edit.replace(document.uri, documentRange(document), before);
    }
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code could not undo the edit.');
    this.last = [];
    return documents.length;
  }
}

module.exports = { Review, EditTransaction };
