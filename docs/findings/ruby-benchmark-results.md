# Ruby Benchmark Results

Date: 2026-06-17

## Scope

This Ruby slice adds two real-world Ruby/Rails navigation benchmarks:

- `rails-ruby`: Rails controller redirect flow and related controller tests.
- `discourse-ruby`: Discourse user email background job flow through skip checks, mailer dispatch, and job specs.

The fixtures live at:

- `benchmarks/navigation/rails-redirecting-controller-flow.json`
- `benchmarks/navigation/discourse-user-email-job-flow.json`

Both entries are registered in `benchmarks/navigation/suite.json` with upstream repositories:

- `https://github.com/rails/rails.git`
- `https://github.com/discourse/discourse.git`

## Command

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-ruby-repos \
  --index-root /tmp/agent-index-ruby-indexes \
  --artifacts-dir /tmp/agent-index-ruby-artifacts \
  --repo rails-ruby \
  --repo discourse-ruby \
  --reindex \
  --repos
```

The repositories were prepared with:

```bash
node scripts/prepare-navigation-repos.mjs benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-ruby-repos \
  --repo rails-ruby \
  --repo discourse-ruby
```

## Benchmark Design

The Rails task asks an agent to trace how controller redirects compute and protect redirect locations, then find the related controller redirect tests.

Rails expected source/test files:

- `actionpack/lib/action_controller/metal/redirecting.rb`
- `actionpack/test/controller/redirect_test.rb`

Rails expected source symbols:

- `ActionController::Redirecting`
- `ActionController::Redirecting.redirect_to`
- `ActionController::Redirecting.url_from`

The Discourse task asks an agent to trace user email delivery from the background job through skip conditions, Guardian visibility checks, mailer dispatch, and job spec coverage.

Discourse expected source/test files:

- `app/jobs/regular/user_email.rb`
- `spec/jobs/user_email_spec.rb`
- `app/mailers/user_notifications.rb`

Discourse expected source symbols:

- `Jobs::UserEmail`
- `Jobs::UserEmail.execute`
- `Jobs::UserEmail.send_user_email`
- `Jobs::UserEmail.message_for_email`
- `UserNotifications.digest`

The optimized `rg` baselines search realistic source and test roots, read snippets from source hits, then search tests from that evidence. They do not start by naming every exact expected file.

## Indexed Corpus

| Suite entry | Files | Symbols |
| --- | ---: | ---: |
| `rails-ruby` | 3,550 | 48,927 |
| `discourse-ruby` | 13,693 | 141,006 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Average commands | 3.00 | 2.00 | 4.50 |
| Average latency | 2,116 ms | 611 ms | 23 ms |
| Average context tokens | 678 | 2,165,230 | 2,513 |
| Average completion context tokens | 514 | 0 | 0 |
| Wins | 2 | 0 | 0 |

Average savings were 2,164,552 tokens versus broad `rg` and 1,835 tokens versus optimized `rg`.

## Agent Tool-Use Measurement

Both real Ruby/Rails cases now include `agentToolUse` expectations. These measure whether the authored bugfix/component-navigation workflow calls agent-index first, reaches a useful result on the expected command, and completes within a bounded context budget.

| Metric | Result |
| --- | ---: |
| Tool-use cases | 2 |
| Tool-use satisfied rate | 1.00 |
| Average first-useful latency | 904 ms |
| Average completion context tokens | 514 |

## Live-Agent Ruby Trial

A live worker subagent also performed a Ruby bugfix trial in an isolated Rails-style fixture at `/tmp/agent-index-ruby-live-trial`.

Task:

- Fix a redirect-safety bug where external redirect targets should fall back to `/dashboard`.

Setup:

- Prebuilt index: `/tmp/agent-index-ruby-live-trial/index.sqlite`
- Verification command: `ruby spec/requests/redirects_spec.rb`
- Initial failure: external redirect target returned `https://evil.example/phish` instead of `/dashboard`.

Observed agent behavior:

- First navigation tool: agent-index.
- First useful hit: `RedirectDecision.target` in `app/services/redirect_decision.rb`.
- Files inspected: service, controller, and request spec.
- Files edited: `app/services/redirect_decision.rb`.
- Broad `rg` fallback: none.

The subagent used agent-index before reading/editing files, then changed `RedirectDecision#target` to accept local absolute paths while rejecting external and protocol-relative URLs. Independent verification after the subagent completed:

```text
3 runs, 3 assertions, 0 failures, 0 errors, 0 skips
```

This is stronger than the authored `agentToolUse` benchmark because it tests whether a live coding agent chooses agent-index during a real bugfix loop. It is still a small fixture rather than a large production Rails repository, so the mature Discourse trial below provides the stronger real-repo signal.

## Mature-Repo Live-Agent Trial

A second live worker subagent performed a bugfix trial inside the mature Discourse repository at `/tmp/agent-index-ruby-repos/discourse`.

Task:

- Fix `DiscourseWorkflows::WebhookRequestParser` so a blank JSON webhook request body parses as `{}` instead of raising `Invalid JSON in request body`.

Setup:

- Repository: `https://github.com/discourse/discourse.git`
- Prebuilt index: `/tmp/agent-index-ruby-indexes/discourse-ruby-live.sqlite`
- Verification command: `ruby tmp/agent_index_live_trial/webhook_request_parser_blank_body_test.rb`
- Initial failure: blank request body raised `Discourse::InvalidParameters`.

Observed agent behavior:

- First navigation tool: agent-index.
- First useful hit: `DiscourseWorkflows::WebhookRequestParser.parse_json_body` in `plugins/discourse-workflows/lib/discourse_workflows/webhook_request_parser.rb`.
- Files inspected: implementation, temporary live-trial test, and existing webhook request parser spec.
- Files edited: `plugins/discourse-workflows/lib/discourse_workflows/webhook_request_parser.rb`.
- Broad `rg` fallback: none.

The subagent used agent-index before broad search or editing, then added a conservative blank-body branch before `JSON.parse`. Independent verification after the subagent completed:

```text
1 runs, 1 assertions, 0 failures, 0 errors, 0 skips
```

This mature-repo trial is still targeted rather than a full Discourse test-suite run. The full Discourse RSpec command could not run in this environment because the required Bundler version from `Gemfile.lock` was unavailable, so the trial used a small Ruby harness that loads the real Discourse plugin file and stubs only the minimum framework surface.

## Per-Repository Result

| Suite entry | agent complete | tool-use satisfied | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| `rails-ruby` | 1.00 | 1.00 | 494 | 2,111,629 | 3,000 |
| `discourse-ruby` | 1.00 | 1.00 | 862 | 2,218,830 | 2,026 |

## Extractor Notes

Ruby extraction is intentionally line-based and dependency-light. It emits:

- file/module symbols
- modules and classes, including compact namespaces such as `Admin::UsersController`
- instance methods and `self.foo` class methods
- inheritance and `include`/`extend`/`prepend` conformance edges
- `require`, `require_relative`, and `load` import edges
- RSpec `describe`/`context`/`it` symbols
- Rake `namespace` and `task` symbols
- Rails route `namespace`, `resources`, and verb route symbols
- common ActiveRecord association, validation, scope, and callback symbols
- ActiveJob `queue_as`, `retry_on`, and `discard_on` symbols
- Sidekiq worker option symbols for queue and retry settings
- migration `create_table` and column/index helper symbols inside migration methods
- route-to-controller action call edges for simple Rails route declarations with `to: "controller#action"`
- Cucumber `Feature` and `Scenario` symbols
- simple call-name edges from method bodies
- exact sibling method call edges for deterministic intra-class calls such as `execute -> send_user_email`, `parse_body -> parse_json_body`, and simple `self.foo` class-method calls

Rails-aware clustering now gives deterministic topology boosts for common application paths such as routes, controllers, models, jobs, mailers, serializers, policies, concerns, and migrations. Related-test discovery also recognizes common RSpec source mentions and request-spec route exercises.

Known limitations:

- It does not parse every Ruby metaprogramming or DSL construct.
- It extracts high-signal DSL declarations with deterministic patterns, not full framework semantics.
- Rails route target edges cover simple `to: "controller#action"` declarations; complex route helpers and mounted engines are not fully resolved.
- RSpec linking is intentionally conservative and does not infer every `let`, `subject`, shared example, or factory relationship.
- Cucumber `.feature` files emit feature/scenario symbols, but step definitions are not linked to Gherkin steps yet.
- It resolves lexical Ruby block scopes well enough for common Rails class/module/method files, but it is not a full Ruby parser.
