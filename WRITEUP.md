# Truforgery

VISION-X · PES University · TrueFoundry Forge-a-thon

## 1. Team

Pratyush Bhatia, Amogh Sharma, Adarsh Rajesh, Ananya Kulgod

## 2. Starting point

From scratch. The extension is plain JavaScript. It uses VS Code’s diff editor for review and TrueForge for the model and tool loop.

## 3. Architecture on TrueForge

Each request starts a TrueForge session from `agent.json`. A local MCP connection gives the agent access to the project. TrueForge loads the search and read tools at the start of the turn and defers the edit and Git tools until the agent needs them.

An edit request supplies both the original text and its replacement. During a code review, any matching hunk can be accepted on its own. If the original text has moved and the anchor still matches uniquely, the extension finds it. If the anchor is ambiguous, the agent has to read the file again and choose a longer anchor.

Accepted hunks stay in memory until Apply. For example, if someone types in one of the files while reviewing a three-file change, Apply catches the stale buffer before editing any of the three. Otherwise, a single `WorkspaceEdit` puts the accepted changes into the editor. The user can still undo the run. Cancel drops the staged changes and ends the TrueForge turn.

## 4. How context is selected

The Flask CLI task asks for a command, a test and a documentation change in one sentence. In the pinned checkout, the first three search results were `src/flask/cli.py`, `tests/test_cli.py` and `docs/cli.rst`. A first pass that ranked all files together over-selected configuration code. The current search gives source, tests and docs a slot each when they have matches.

File mentions take priority. Symbol mentions search definitions and references, and the panel shows why each file was picked. The initial context has room for eight excerpts of up to 1,100 characters each, drawn from a 9,600-character budget. In inline mode, the selection is the initial context and sets the edit boundary.

## 5. Model setup

Paste a TrueForge model ID into VS Code’s user settings to switch models. The credentials stay in TrueForge. A configured fallback starts a fresh session if the first model fails before review. Protocol testing used TrueForge 0.185.1 with a scripted local endpoint at zero API cost.

## 6. Scorecard

The table lists the evidence to capture for a Round 1 submission. Video timestamps are open until the corresponding checks have been recorded.

| Criterion | Time | Evidence |
| --- | --- | --- |
| A1 Inline edit | Pending | Task A opens a diff and `FLASK_DEBUG=off` returns `False`. |
| A2 Agent mode | Pending | Task B finds three files from a prompt with no filenames. |
| A3 Streaming and cancellation | Pending | Cancel during streamed output and check Git status. |
| B1 Context assembly | Pending | Task B shows the selected paths and why they ranked. |
| B2 Diff safety | Pending | Accept one hunk, reject another, then undo the applied run. |
| B3 Resilience | Pending | Task C shows the failed model request and a clean worktree. |
| B4 TrueForge integration | Pending | The session shows deferred tool loading and an approval. |
| C1 Video | Pending | Tasks A, B and C appear in order with their checks. |
| C2 Write-up | Pending | This table locates the claims in the recording. |

## 7. Tools used

VS Code, Git, Node.js and TrueForge. OpenAI Codex assisted with the code, tests and write-up.

## 8. Known limitations and what you would do with another month

Literal search misses references when the issue and code use different names. Language server definitions and references would give search a way to follow a symbol across files. The command tool sees the saved checkout, so tests run in the user’s terminal after Apply and Save All. A disposable checkout could let tests run against the reviewed snapshot before Apply.
