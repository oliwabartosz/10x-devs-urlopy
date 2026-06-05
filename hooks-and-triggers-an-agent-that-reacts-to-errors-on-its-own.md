---
title: "Hooks and triggers: an agent that reacts to errors on its own"
course: "10xdevs-3"
language: "en"
source: "Przeprogramowani.pl"
exported: "2026-06-05"
format: "markdown"
---

![cover](https://images.przeprogramowani.pl/images/2026/06/tv4caojfN62hnsEPydOBiAY.jpeg)

In the previous lesson, you wrote tests with the agent. At the end, you ran them manually: you start the test runner via a script, wait for the result, fix it, and run it again.

Does it work? Yes. But think about how many times during a session with the agent you manually checked lint, types, and tests. How many times did the agent edit a file, and after a few minutes, you discovered that something wasn’t working.

When working on a single task in a small project, it's no big deal. But over time it accumulates into hours lost repeating the same cycle: editing, manual verification, correction, manual verification again.

What if the tool could do it for you? Not incidentally as part of a CI/CD pipeline, which is time-consuming. But at the right moment, locally, after the agent has finished work.

Harnesses provide us with hooks that will help us deal with this problem.

![Diagram](https://images.przeprogramowani.pl/images/2026/06/2_4capiiAq21nsEP942uyQw.jpeg)

### Hook lifecycle

Before you configure the first hook, it's worth seeing the pattern you will find in every AI programming tool that supports hooks.

Each hook consists of four parts:

1. **Trigger** — an event in the tool. For example, the agent has just saved the file.
2. **Matcher** — a filter that decides whether this specific hook should run. It can react to specific tools (`Write`, `Edit`), file types, or name patterns.
3. **Handler** — a command, script, or other action that is executed. Most often it is a shell command.
4. **Signal** — the hook's result returns to the tool. The exit code indicates whether everything is OK, and stdout can be sent to the agent's context as feedback.
![Diagram](https://images.przeprogramowani.pl/images/2026/06/-v4cavvTK5HkkdUP4vWE-As.jpeg)

The pattern is universal: Claude Code, Cursor, Codex, Windsurf, Copilot - you will find the same four steps everywhere. The event names and the depth of configuration differ, but the architecture is the same.

### First hook in practice

You have the pattern. It's time to connect it to something specific.

Before you configure the first hook, download the artifact package for this lesson:

```bash
npx @przeprogramowani/10x-cli@latest get m3l3
```

This package provides the `CLAUDE-m3l3` rule (added to your `CLAUDE.md`). The rule summarizes the hook model from this lesson — the hook lifecycle, three layers of local quality, and the cross-tool portable pattern — so the agent has these principles handy when helping you configure hooks.

The most common first hook is an automatic lint after each file edit. The configuration in Claude Code looks like this:

```json
{
```

We configure hooks in the harness settings, for Claude Code this is `settings.json`, which can live in three places:

- `~/.claude/settings.json` — user's global settings,
- `.claude/settings.json` — project settings (commit to repo),
- `.claude/settings.local.json` — local overrides (add to `.gitignore`).

How does it work? The agent edits the file using the Write or Edit tool. The `PostToolUse` hook runs after this action.

The `Write|Edit` matcher checks if the tool matches. If so, ESLint with `--fix` fixes what it can automatically. Exit code 0 means success.

Note that this command runs ESLint on the entire project. In small projects, this is sufficient and simpler than parsing the file path. More precise per-file matching can be seen in the section on test hooks.

### Typecheck and a question about speed

Since lint works, the natural next step is a type check. To the list of `PostToolUse` hooks, you add another one:

```json
{
```

And here arises the question that returns with every new hook: how fast does it have to work to be worth it?

Hooks have their cost: they block the agent's loop. As long as the hook does not finish, the agent waits. This is not a flaw, it is a mechanism: the agent receives feedback before the next iteration.

But if the hook takes 30 seconds, you wait those 30 seconds for every edit. You multiply that by dozens of edits in a session and it becomes serious.

Practical heuristic: if the check takes longer than a few seconds, consider moving it to the moment of commit or push.

Lint and format with path detection? Ideal per-edit, fast. Typecheck? In small projects it works per-edit. In larger ones, it works better as a commit gate. Full test suite? Definitely at commit or push time.

There are no fixed thresholds. Observe how the hook affects the agent's work pace, and adjust accordingly. If it starts to annoy you, that's a sign that the check should change the layer or be improved by running on a limited set of files.

### Tests only where necessary

Lint and typecheck enforce syntax. But real errors are caught by tests.

The most valuable hook is one that runs tests related to the edited file. Not the entire suite. Only those that import the modified module.

Most test running tools support this scenario. In Vitest it looks like this:

```bash
vitest related src/server/auth.ts --run
```

Note on syntax: `related` is a subcommand, not the `--related` flag. Vitest checks the static import graph and runs only the tests that directly or indirectly depend on the specified file.

The `--run` flag prevents watch mode. Without it, the hook will not finish and will not return an exit code.

PostToolUse hooks receive the event context as JSON on stdin. To extract the path of the edited file, parse `tool_input.file_path`. This example uses `jq` — make sure you have it installed (`brew install jq` on macOS, `apt install jq` on Ubuntu/Debian, `winget install jqlang.jq` or `choco install jq` on Windows):

```json
{
```

But not every edit requires running tests. Utility helpers, configuration files, presentation components — these do not have to be files for which it makes sense to run tests after every edit.

Here returns `context/foundation/test-plan.md` from M3L1\. The risk areas described there tell you which parts of the code are worth automatically checking after editing.

![Diagram](https://images.przeprogramowani.pl/images/2026/06/G_8cauXaMJnknsEPk8bj2QI.jpeg)

One limitation is worth knowing right away: PostToolUse triggers once per tool use. If the agent edits three files in one turn, the hook will trigger three times independently. If your tests run quickly (and they should), this won't be problematic. Otherwise, you need to add a more restrictive Matcher, which largely depends on the technology stack and project architecture – it's worth iterating on this together with the agent.

If you use Vitest 4.1+, set the hook environment variable `AI_AGENT=1`. Vitest will switch to a compact output format that only displays failures. Less noise in the agent context, fewer consumed tokens:

```
"command": "AI_AGENT=1 bash -c 'FILE=$(jq -r .tool_input.file_path) && npx vitest related \"$FILE\" --run'",
```

### Agent sees and reacts

Here begins the difference between an agent hook and a classic git hook.

When the PostToolUse hook returns exit code 2, the tool treats it as a blocking error. The agent sees the hook's result in its context during the next query to the model.

Three exit codes worth remembering:

- **0** — success, the hook passed, continue.
- **2** — blocking error, the agent sees the feedback and should respond.
- **other** — non-blocking error, logged but does not interrupt operation.

What does this mean in practice? If lint or typecheck returns an error, the agent not only knows that something went wrong. It sees the specific message: missing type, unimported module, incorrectly formatted line.

And maybe fix it myself in the next iteration, without your intervention.

There is, however, a limit. Trivial fixes (correcting formatting, adding a missing import, fixing a type) the agent can handle on its own.

But what if the test fails due to faulty business logic? The hook will show this, but the agent may not necessarily diagnose the real cause. It says "something is wrong" and tries to fix it "using common sense" (which may only result in a superficial success).

For more complex problems, when the agent admits failure or you are not satisfied with its fix, it is worth creating a dedicated change with a full workflow: /10x-new → /10x-research (optional) → /10x-plan → /10x-implement

### Three layers of local quality

So far we have talked about per-edit hooks. This is just the first layer.

The full model of local quality consists of three layers plus CI as the fourth:

![Diagram](https://images.przeprogramowani.pl/images/2026/06/Of8catjKHfSX28oPvezasA8.jpeg)

Each layer catches something different and operates at a different time.

**Per-edit (agent hooks)** work the fastest. They catch formatting, simple type errors, and failing unit tests.

Feedback returns to the agent in seconds. This is the only layer that can provide the agent with feedback during its operation.

**Pre-commit (git hooks)** catch what slipped through per-edit: manual edits without the agent, files changed outside the hook, or checks too slow for per-edit. They operate on staged files, so they check exactly what goes into the commit.

**Pre-push** runs heavier checks before pushing the code to the remote. A good place for a full typecheck or a wider set of tests.

**CI** is the last safety net. It catches integration issues, dependencies between modules, and checks requiring infrastructure unavailable locally.

Local three layers do not replace CI. CI is still a key verification for the shared state of the repository and environments that you do not control. But every local layer that catches an error is one less cycle waiting for a response from CI.

Sounds like many layers? In practice, each is just a few lines of configuration.

### Commit-level gate

Agent hooks work when the agent is running. But not every change goes through the agent. Sometimes you edit a file manually, sometimes a colleague pushes a commit from a laptop without hooks.

The pre-commit layer requires a tool for managing git hooks — and here the choice depends on your stack. The principle is simple and universal: run checks on staged files before the commit. The tool itself is an implementation detail, so use the standard of your ecosystem:

- **Node/TypeScript** — Husky with lint-staged. If you have them from 10x-astro-start, then you have this layer ready and you don't need to change anything.
- **Python** — the `pre-commit` framework (pre-commit.com) is the de facto standard, with a ready-made catalog of hooks for `ruff`, `black`, `mypy`, and hundreds of other tools.
- **Any language** — Lefthook is stack-agnostic: a single YAML configuration, parallel command execution, no dependency on Node.js. You plug in any commands — `gofmt` and `golangci-lint` in Go, `cargo fmt` and `cargo clippy` in Rust, `rubocop` in Ruby.

Mechanics are the same everywhere, so I will show it on Lefthook, as it works independently of the language. A minimal `lefthook.yml` — here with commands for a TypeScript project, but replace them with tools from your own stack:

```yaml
pre-commit:
```

`{staged_files}` inserts a list of files added to the staging area. Lint and tests operate on exactly those changes you intend to commit. `pre-commit` and lint-staged have their own counterparts of this mechanism.

`parallel: true` runs the commands in parallel.

Installation:

```bash
brew install lefthook   # or: npm install lefthook
```

After `lefthook install`, git hooks run automatically on `git commit`. You don't have to remember it, and that's the point. An automatic gate you won't accidentally bypass.

### The same pattern in every tool

We showed the details in Claude Code, but the trigger → match → check → signal pattern applies to every tool. The differences concern depth, not architecture.

| Tool        | Events | Handlers                                | Context injection | Configuration                              |
| ----------- | ------ | --------------------------------------- | ----------------- | ------------------------------------------ |
| Claude Code | \~30   | command, http, mcp\_tool, prompt, agent | yes               | .claude/settings.json                      |
| Cursor      | \~18   | command, prompt                         | yes               | .cursor/hooks.json                         |
| Codex       | 10     | command                                 | yes               | \~/.codex/config.toml or .codex/hooks.json |
| Windsurf    | 12     | command                                 | **no**            | .windsurf/hooks.json                       |
| Copilot     | \~13   | command, http, prompt                   | yes (VS Code)     | .github/hooks/\*.json                      |

The most important difference: context injection. Claude Code, Cursor, Codex, and Copilot (in VS Code) can provide the hook result to the agent. Windsurf does not have this capability. Links to the documentation for hooks of each tool can be found in the Additional Materials section.

Windsurf hooks may block the action (exit code 2), but they cannot communicate to the agent what went wrong. The agent knows that something failed. It does not know what. This is a significant limitation for automatic correction.

A second difference that is easy to trip over: Codex has a hash-based trust model. Hooks defined in the repository (`.codex/hooks.json` or the `[hooks]` section in the project-level `config.toml`) will not fire until you review and approve them with the `/hooks` command — and every change to a hook requires re-approval. User-level hooks in `~/.codex/config.toml` do not go through the project trust gate, which is why for many people "config.toml works, but hooks.json doesn't". This is not a configuration bug but a deliberate security barrier: a hook from the repo is code someone could have slipped in via a pull request.

Copilot's compatibility with the Claude format also has its limits. VS Code reads `.claude/settings.json`, but it ignores matchers (the hook fires on every event of a given type), uses different tool names (`create_file` instead of `Write`) and different payload field names (camelCase: `tool_input.filePath` instead of `tool_input.file_path`). A hook copied 1:1 from Claude Code usually needs adaptation before it works.

1Password has published the `agent-hooks` repository, which installs the same hooks into `.cursor/hooks.json`, `.claude/settings.json`, and `.windsurf/hooks.json` with a single script. One source of hooks, multiple tools: this demonstrates a strong similarity at the architectural level. Perhaps we will see an official standard emerge, like with Agent Skills.

### Hooks and test-plan.md

Let's go back to the starting point. In m3-l1 you created `context/foundation/test-plan.md` with the strategy and quality gates, in m3-l2 you wrote tests based on risk areas.

Hooks close this loop. They turn gates from declarations into automatic verification.

A question worth asking at every gate in the plan: is this check fast enough to run per edit? Should it wait for commit? Or maybe it requires a full environment and belongs to pre-push or CI?

Let's take a concrete example. In the 10xcards project, the Quality Gates section in `test-plan.md` defines gates with labels indicating when they become required:

- **lint + typecheck** — required from the start. Fast, so they can run per edit or as a commit gate. The project chose pre-commit through Husky.
- **unit + integration** — required after the first rollout phase. Tests on staged files in pre-commit.
- **e2e on critical flows** — required after the sixth phase. Heavier, so pre-push (manual, until CI is established).
- **CI gating** — explicitly deferred, not in v1.
- **post-edit hooks / visual diff** — explicitly deferred, not in v1.

Note: the test plan itself decided that per-edit hooks are not yet worthwhile at this stage of the project. And that is a valid choice. The three layers are a menu, not a mandate. Start where the cost-to-signal ratio is best for your project.

You don't need to configure this perfectly the first time. Start with one per-edit hook (lint) and one commit gate. Add additional layers as you see which problems slip through.

Hooks catch errors at the code level: formatting, types, unit tests. They don’t catch what the user sees: shifting layout, broken navigation, inaccessible form. For that, you need a browser, Playwright, and E2E scenarios, which we will set up in the next lesson.

## 🧑🏻‍💻 Practical tasks

### Configure the lint + typecheck hook

In your course project, configure a per-edit hook that runs the linter after each file edit by the agent. Add a second hook with a typecheck.

Depending on the tool:

- **Claude Code**: `PostToolUse` with matcher `Write|Edit` in `.claude/settings.json` ([documentation](https://docs.anthropic.com/en/docs/claude-code/hooks))
- **Cursor**: `afterFileEdit` in `.cursor/hooks.json` ([documentation](https://docs.cursor.com/configuration/hooks))
- **Codex**: `PostToolUse` in `~/.codex/config.toml` (the `[hooks]` section) or `.codex/hooks.json`; remember that hooks from the repository must first be approved with the `/hooks` command ([documentation](https://developers.openai.com/codex/hooks))
- **Copilot**: hooks in `.github/hooks/*.json`; in VS Code Copilot also reads the `.claude/settings.json` format, but compatibility is partial — matchers are ignored, tool and payload field names differ (`create_file` instead of `Write`, `tool_input.filePath` instead of `tool_input.file_path`), so a hook from Claude Code requires adaptation ([documentation](https://code.visualstudio.com/docs/copilot/customization/hooks))

Choose your tool, configure both hooks, and test: ask the agent to edit the file and check if the hooks are triggered.

If the hook triggers but the agent does not see the feedback, check the exit code. Remember: exit code 2 is a blocking signal that goes to the context. Codes other than 0 and 2 are logged but do not block the operation.

If typecheck slows down the agent in a larger project, move it to pre-commit.

### (Optional) Add a scoped test trigger

Select the highest risk area from `context/foundation/test-plan.md` and configure a hook that runs only the tests related to the edited file. Most test runners have such an option — in Vitest it is `vitest related $FILE --run`, in Jest `jest --findRelatedTests $FILE`.

- Parse the path of the edited file from the hook's stdin (e.g., using `jq -r .tool_input.file_path`)
- If you are using Vitest 4.1+, set `AI_AGENT=1` in the hook environment for compact output
- Test: ask the agent to edit a file in the risk area and check if the tests run
- Compare: edit the file outside the risk area and make sure the tests do not run (or run quickly, without false alarms)

Your test runner probably has a similar option — check the documentation.

### (Optional) Add a pre-commit hook

Add a `pre-commit` git hook to the project that runs lint and tests on staged files before the commit. We do not enforce a specific tool; use the standard from your stack – if you have no experience or opinion here, do some research with the agent.

If you want to understand what these tools are based on, check the [git hooks documentation](https://git-scm.com/docs/githooks) — it describes the `pre-commit` hook and other git hook points that these tools merely wrap.

### (Optional) Translate the hook to the second tool

Take one of the hooks you have just configured and write its equivalent for the other tool (Cursor, Codex, or Copilot). You don't need to implement it. The goal is to practice transferring the pattern: trigger → match → check → signal works the same way, only the configuration format changes.

## Claim your badge

After completing this lesson, collect your badge in the [10xDevs Mission Log](https://platforma.przeprogramowani.pl/10xdevs-3/mission-log) section and then show off your achievement!

## 🔎 Deep Dive

This section contains additional in-depth knowledge on selected topics related to the lesson. In this Deep Dive, you will find:

- **Hooks performance** — how to balance the accuracy of checks with the speed of the agent loop and when to move heavier checks to higher layers.
- **Other types of handlers** — what hooks can do besides shell commands: HTTP, MCP, and experimental agent handler.
- **Reliability of hooks** — when a hook might not trigger and how to diagnose it.

This lesson section is not mandatory, but it is worth getting familiar with if you want to become an expert.

### Performance of hooks

In the main part of the lesson, we talked about the general heuristic: if a check takes longer than a few seconds, move it higher. Here are a few more details.

**Per-edit (PostToolUse):** formatter on a single file takes a fraction of a second. Typecheck in a small project takes a few seconds.

Related tests depend on the size of the import graph. A few simple unit tests take seconds, an extensive suite takes much longer.

**Pre-commit (Lefthook / lint-staged):** lint + format on staged files work quickly. Typecheck works well as a commit gate, even in larger projects.

`vitest --changed` runs tests related to files modified in git, which limits the scope to what has actually changed.

Claude Code supports `async: true` on hooks that do not need to block. Such a hook runs in the background and does not pause the agent. Useful for informational validations, for example, logging statistics or sending notifications.

### Other types of handlers

Besides the standard `command`, Claude Code supports additional types of handlers:

- **`http`** — sends a request to an external endpoint. Useful in teams that centralize validation logic on the server.
- **`mcp_tool`** — invokes the MCP tool. The hook uses the same tool ecosystem as the agent.
- **`prompt`** — instruction for the model evaluating the hook result. Default timeout 30 seconds.
- **`agent`** — experimental handler that launches a mini-agent in response to an event. Default timeout is 60 seconds. For now, treat it as a curiosity to watch rather than a production-ready mechanism.

Cursor and Copilot support `command` and `prompt`. Codex parses other types, but actually executes only `command`. Windsurf supports only shell commands.

PreToolUse hooks in Claude Code can also modify tool input data (through `updatedInput`) and make permission decisions (`allow`, `deny`, `ask`). This opens up an interesting possibility: a hook that automatically adds context to the agent's operations or blocks dangerous actions before they are executed.

### Reliability of Hooks

Hooks are a deterministic mechanism: you configure, the environment triggers it. The thing is, the environment actually has to trigger the hook. And that is not always obvious.

Known limitations as of mid-2026:

- Stop hooks in Claude Code have reported issues in the context of Skills and Plugins. The PostToolUse hooks, which this lesson is based on, are not affected by these issues.
- Codex has incomplete PreToolUse capturing for some types of tools.
- Codex skips project-level hooks (from `.codex/` in the repo) until you approve them with the `/hooks` command — and it does so silently. If a hook from the repo does not fire while the one from `~/.codex/config.toml` works, it is almost certainly a missing approval, not bad syntax.
- Copilot in VS Code parses matchers from the Claude format but does not enforce them — the hook fires on every event of a given type. On top of that, the payload uses camelCase, so a script reading `tool_input.file_path` will get an empty value.
- Copilot Cloud Agent (cloud version) has the narrowest set of capabilities: short-lived sandbox, `ask` treated as `deny`. An organization can also disable hooks entirely via policies.

Practical rule: test your hooks after configuration. If a hook does not trigger as expected, check your tool’s GitHub Issues. PostToolUse hooks with a `command` handler are the most reliable combination across all tools.

It is worth emphasizing: hooks are a deterministic layer. They will survive context compression, changes in system instructions, and the model "forgetting."

The instructions in `CLAUDE.md` may be compressed or ignored in a long context. The hook will always trigger because it operates outside the model.

## 📚 Additional materials

- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) — official documentation: events, handlers, matchers, exit codes, configuration at three levels
- [Cursor Hooks](https://docs.cursor.com/configuration/hooks) — hooks documentation: events, `afterFileEdit`, `failClosed` option
- [Codex Hooks](https://developers.openai.com/codex/hooks) — hooks documentation: events, configuration locations (`config.toml` and `hooks.json`), hash-based trust model, limitations
- [Windsurf Cascade Hooks](https://docs.windsurf.com/windsurf/cascade/hooks) — hooks documentation: events, no context injection
- [Copilot Coding Agent Hooks](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-coding-agent/configuring-coding-agent-hooks) — documentation of hooks: runtimes (cloud, VS Code, CLI), compatibility with `.claude/settings.json`
- [VS Code Copilot Hooks](https://code.visualstudio.com/docs/copilot/customization/hooks) — VS Code hooks documentation: configuration locations (`chat.hookFilesLocations`), differences from Claude Code (ignored matchers, camelCase, different tool names)
- [Vitest CLI](https://vitest.dev/guide/cli.html) — CLI documentation with the `related` subcommand and the `--changed` flag to run tests related to a file
- [Vitest 4.1](https://vitest.dev/blog/vitest-4-1.html) — agent reporter, compact output for AI agents, `AI_AGENT=1`
- [Lefthook](https://github.com/evilmartians/lefthook) — git hook manager with a single YAML file, `{staged_files}` interpolation, parallel execution, and no dependency on Node.js
- [pre-commit](https://pre-commit.com/) — a multilingual git hook framework, the de facto standard in the Python ecosystem, with a ready catalog of hooks for many tools
- [Git Hooks](https://git-scm.com/docs/githooks) — official git documentation: the `pre-commit` hook and other hooks on which Husky, Lefthook, and pre-commit are based
- [1Password agent-hooks](https://github.com/1Password/agent-hooks) — a script installing the same hooks to multiple tools at once, a practical proof of convergence of hook architectures
- [Git Hooks with Lefthook](https://stevekinney.com/courses/self-testing-ai-agents/git-hooks-with-lefthook) — Steve Kinney, practical Lefthook setup in the context of AI agent workflows
- [AI agent hooks](https://www.speakeasy.com/resources/ai-agent-hooks) — Speakeasy, analysis of hooks as an interface for controlling AI agents
- [Commit Hooks with AI Agents](https://egghead.io/commit-hooks-are-critical-with-ai-agents-in-cursor~jhoer) — Egghead.io, why pre-commit hooks are crucial when working with agents
- Prework [\[2.4\]](https://platforma.przeprogramowani.pl/external/10xdevs-3-prework/pl/07) _Agent-Native IDE_ — security discipline (clean repo, tests, review, diffs) automated by hooks
- Prework [\[1.3\]](https://platforma.przeprogramowani.pl/external/10xdevs-3-prework/pl/03) _How to learn and develop with AI_ — tutor mode, here applied to a hook that teaches the agent to respond to errors
- Prework [\[2.2\]](https://platforma.przeprogramowani.pl/external/10xdevs-3-prework/pl/05) _Cursor — Operational Basics_ and [\[2.3\]](https://platforma.przeprogramowani.pl/external/10xdevs-3-prework/pl/06) _Claude Code — Operational Basics_ — basics of tool configuration on which hook configuration is based