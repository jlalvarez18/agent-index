# Poetry Benchmark Results

## Current Status

Poetry is the eighth validation corpus, cloned locally at `/Users/juan/Repos/poetry`.

Revision:

```text
d5709039
```

This corpus was chosen because it is packaging and CLI infrastructure rather than a web framework, renderer, or validation library. It adds dependency solving, installer orchestration, command handlers, lockfile behavior, repositories, virtualenv management, and plugin activation.

## Benchmark Setup

Commands:

```bash
node dist/cli.js index /Users/juan/Repos/poetry --source-only --index-path /tmp/agent-index-poetry.sqlite
node dist/cli.js benchmark ./benchmarks/poetry-python.json --target /Users/juan/Repos/poetry --index-path /tmp/agent-index-poetry.sqlite --mode hybrid
```

Source-only index summary:

```text
Indexed 191 files, 1547 symbols, 1547 chunks, 6936 edges at /tmp/agent-index-poetry.sqlite (mode: source-only)
```

## Golden Questions

The seed set contains 12 source-audited questions covering factory setup, installer flow, lockfile repositories, solver orchestration, provider candidate search, repository pool lookup, virtualenv creation, build command behavior, CLI entrypoint wiring, installer option application, and plugin activation.

## Mode Comparison

Run date: 2026-06-13

Plain FTS:

```text
Mode: fts
Questions: 12
Symbol Hit@1: 0.25
Symbol Hit@5: 0.83
Symbol MRR: 0.48
File Hit@1: 0.75
File Hit@5: 0.92
File MRR: 0.80
Partial file hits: 0.08
Avg latency: 7ms
```

Symbol mode:

```text
Mode: symbol
Questions: 12
Symbol Hit@1: 0.58
Symbol Hit@5: 0.92
Symbol MRR: 0.73
File Hit@1: 0.92
File Hit@5: 1.00
File MRR: 0.96
Partial file hits: 0.08
Avg latency: 44ms
```

Hybrid mode before the Poetry ranking fixes and installer benchmark correction:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 0.67
Symbol Hit@5: 0.92
Symbol MRR: 0.75
File Hit@1: 0.75
File Hit@5: 0.92
File MRR: 0.81
Partial file hits: 0.00
Avg latency: 39ms
```

Hybrid mode after the source audit and ranking fixes:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 53ms
```

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 Poetry benchmark rows. The structured queries use code-shaped terms such as `Factory.create_poetry`, `Installer._do_install`, `Solver.solve`, `RepositoryPool.find_packages`, `EnvManager.create_venv`, `BuildHandler.build`, `InstallCommand.handle`, and `PluginManager.activate`.

Index:

```text
node dist/cli.js index /Users/juan/Repos/poetry --source-only --index-path /tmp/agent-index-poetry-structured.sqlite
Indexed 191 files, 1547 symbols, 1547 chunks, 6936 edges at /tmp/agent-index-poetry-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 0.83
Symbol Hit@5: 1.00
Symbol MRR: 0.92
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Avg latency: 31ms
rg-style File Hit@1: 0.33
rg-style File Hit@5: 0.83

Misses:
install-command-apply-installer-options  top=InstallCommand.activated_groups
plugin-manager-activate                  top=PluginManager.load_plugins
```

Source audit: both misses were query-shaping issues. `InstallCommand.activated_groups` is a helper property used by `InstallCommand.handle`, which applies installer options and runs the installer. `PluginManager.load_plugins` loads entry points before `PluginManager.activate` loops over loaded plugins and calls `plugin.activate`.

Final structured pass after removing adjacent helper names from the structured query terms:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 34ms
rg-style File Hit@1: 0.33
rg-style File Hit@5: 0.75
rg-style File MRR: 0.50
rg-style Avg latency: 31ms

Misses: none
```

Interpretation: Poetry reinforces the structured-agent pattern from Click and Pytest. The tool performs well when the LLM supplies discriminating implementation terms, but exact helper names can overpower the intended orchestration symbol if the agent includes them casually. The useful user-facing guidance is to include exact symbol names only when the agent believes they are the target, and otherwise prefer broader behavior terms in `terms` with directory/module clues in `pathHints`.

## Hybrid Detail

```text
factory-create-poetry                   symbolRank=1  fileRank=1  top=Factory.create_poetry                  file=src/poetry/factory.py
installer-run                           symbolRank=1  fileRank=1  top=Installer.run                          file=src/poetry/installation/installer.py
installer-do-install                    symbolRank=1  fileRank=1  top=Installer._do_install                  file=src/poetry/installation/installer.py
locker-locked-repository                symbolRank=1  fileRank=1  top=Locker.locked_repository               file=src/poetry/packages/locker.py
solver-solve                            symbolRank=1  fileRank=1  top=Solver.solve                           file=src/poetry/puzzle/solver.py
provider-search-for                     symbolRank=1  fileRank=1  top=Provider.search_for                    file=src/poetry/puzzle/provider.py
repository-pool-find-packages           symbolRank=1  fileRank=1  top=RepositoryPool.find_packages           file=src/poetry/repositories/repository_pool.py
env-manager-create-venv                 symbolRank=1  fileRank=1  top=EnvManager.create_venv                 file=src/poetry/utils/env/env_manager.py
build-command-build                     symbolRank=1  fileRank=1  top=BuildHandler.build                     file=src/poetry/console/commands/build.py
application-main                        symbolRank=1  fileRank=1  top=main                                   file=src/poetry/console/application.py
install-command-apply-installer-options symbolRank=1  fileRank=1  top=InstallCommand.handle                  file=src/poetry/console/commands/install.py
plugin-manager-activate                 symbolRank=1  fileRank=1  top=PluginManager.activate                 file=src/poetry/plugins/plugin_manager.py
```

## Examples

Good result: `where does Poetry solve dependencies using provider progress use_latest overrides marker simplification and return a transaction?`

- Top result: `Solver.solve` in `src/poetry/puzzle/solver.py`
- Before the fix, provider helper methods outranked the solver because they contained many override and marker terms.
- The fix treats dependency-solving orchestration as distinct from provider helper internals.

Corrected benchmark row: `where does Poetry install command apply dry run extras activated groups sync compile and extras options to the installer before running it?`

- Top result: `InstallCommand.handle` in `src/poetry/console/commands/install.py`
- The earlier row incorrectly expected `Application.configure_installer_for_command`, but that function only constructs an `Installer` and attaches it to the command.
- `InstallCommand.handle` is where extras, activated groups, dry run, synchronization, compile behavior, verbosity, and `installer.run()` are applied.

Fixed result: `where does Poetry plugin manager activate loaded plugins by calling plugin activate with poetry and io arguments?`

- Before the fix, `PluginManager.load_plugins` ranked first and `PluginManager.activate` ranked fourth.
- After the plugin-activation intent, `PluginManager.activate` ranks first with the explicit reason `plugin activation intent`.

## Finding

Poetry supports the current dogfood claim but also repeats the main caution: source audit must happen before ranking work. One miss was not a retrieval failure at all; the benchmark expected the installer-construction hook when the question described command option application.

The real ranking misses were generalizable enough to justify guarded rules:

- Solver orchestration should beat adjacent provider helpers when a query asks for solving dependencies and returning a transaction.
- CLI entrypoint questions should strongly prefer `main` functions that instantiate and run an application.
- Command option application should prefer handler methods over command containers.
- Plugin activation should distinguish activation from plugin loading.

## Next Step

The current eight-corpus set is saturated again. The next useful evidence should come from either a different domain, such as scientific/data tooling, or a larger adversarial question set for one existing corpus.
