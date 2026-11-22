# Truforgery

VISION-X · PES University · TrueFoundry Forge-a-thon

## 1. Team

All four members are in their third year at PES University.

| Member | Programme |
| --- | --- |
| Pratyush Bhatia | Electronics and Communication Engineering |
| Amogh Sharma | Computer Science and Engineering |
| Adarsh Rajesh | Computer Science and Engineering |
| Ananya Kulgod | Electronics and Communication Engineering |

GitHub handles are pending.

## 2. Starting point

Built from scratch in JavaScript. The extension uses VS Code’s native diff editor and workspace edit API. TrueForge runs the agent loop.

## 3. Architecture on TrueForge

A request opens a TrueForge session using `agent.json` and gets a temporary MCP connection back to VS Code. The agent can search the project, read line ranges, propose edits and run two read-only Git commands. Search and read tools are available at the start of the turn. TrueForge loads the edit and command tools on demand.

Each proposed replacement identifies the exact text to change. If that text is missing or appears twice, the proposal goes back to the agent. TrueForge pauses while the user reviews the hunks. Only accepted hunks enter the staged copy.

Apply checks the source buffers again because they can change during review. A single `WorkspaceEdit` puts the staged changes into those buffers. The user can save or undo the run. Cancelling before Apply discards the staged changes and closes the MCP connection.

## 4. How context is selected

`@file` comes first. `@symbol` favours definitions and includes references when space allows. For a plain-language request, the search scores words in filenames and source lines and reserves room for source, tests and docs. On Flask 3.1.3, the Task B prompt put `src/flask/cli.py`, `tests/test_cli.py` and `docs/cli.rst` first.

The first turn gets up to eight excerpts, with 1,100 characters per excerpt and 9,600 characters for the initial selection. VS Code shows the path and reason for each pick. An inline run starts with the selection and limits edits to that range.

## 5. Model setup

Model IDs and credentials live in TrueForge. The extension reads the chosen ID from VS Code settings. A second configured model can take over if the first fails before review begins. The protocol checks ran on TrueForge 0.185.1 against a scripted local endpoint at zero API cost.

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
