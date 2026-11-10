# Testing Conventions: FIRST Principles

The test suite adheres to the **FIRST** principles: **Fast**, **Independent / Isolated**, **Repeatable**, **Self-validating**, and **Timely**.

Tests are designed to pinpoint behavioral regressions quickly and evolve alongside production code. Test sufficiency focuses on boundary conditions and failure paths rather than arbitrary code coverage metrics or rigid test pyramid ratios.

## Test Hierarchy & Entry Points

| Command | Scope | Environment & Constraints |
| --- | --- | --- |
| `pnpm test` | All frontend test suites | Runs both `unit` and `ui` Vitest projects |
| `pnpm test:unit` | Pure business rules, controllers, state, and contracts | Node environment; does not load Fluent DOM polyfills |
| `pnpm test:ui` | Components, browser APIs, and browser-dependent Svelte state | `jsdom` environment; targets `*.dom.test.ts` and `*.svelte.test.ts` |
| `pnpm test:shuffle` | Execution order independence | Shuffles test files and test suites with a deterministic seed |
| `pnpm test:scripts` | Tooling behavior (architecture, focus, and i18n checkers) | Node built-in test runner |
| `pnpm test:python` | Release validator behavior | Python `unittest` using isolated temporary directories |
| `pnpm test:stability` | Asynchronous flake-prone flows | Spawns a dedicated process per test case across 20 iterations; fails fast |
| `cargo test --workspace --no-default-features --locked -- --test-threads=4` | Complete Rust workspace | Memory rules, real cryptography, temporary I/O, and loopback networking |

`pnpm test:stability --iterations=1` provides a fast dry-run for the stability harness. Stability coverage targets asynchronous regression areas: avoiding transient flashes on sub-frame tasks, timer cleanup upon toast/notification unmount, directory query timeouts, and suppressing late errors after workspace teardown. The runner verifies execution counts to ensure tests do not pass silently when renamed.

### Execution Boundaries

* **Environment Isolation:** A test's environment is dictated by its actual runtime dependencies. Even if `render` is not called, tests relying on `sessionStorage`, browser navigation, or DOM timers must run in `ui` (`jsdom`). Static JSON schema checks stay in `Node`; SVG rendering compatibility belongs in `ui`.
* **Parallelism & Isolation:** File isolation and inter-file concurrency remain strictly enabled. Mocks restore automatically; tests must never rely on automatic retries to pass.
* **Strict Linting:** Focused executions (`.only`) are prohibited in both local pre-commit hooks and CI.

## Authoring, Cleanup & Lifecycle

* **Defect Remediation:** Always commit an isolated, failing reproduction test before patching production code.
* **Refactoring:** When modifying legacy or ambiguous behavior, first add characterization tests explicitly recording the current behavior before applying structural changes.
* **Scope & Naming:** Follow the `Scenario + Outcome` naming convention. Assertions within a test must describe facets of a single logical behavior rather than grouping unrelated workflows.
* **Contract Verification:** Assert on return values, observable domain state, accessibility trees, DOM mutations, or necessary side effects. Protocol fields, accessibility compliance, and resource cleanup are valid contracts; private internal counters (e.g., total active timers) are not.
* **Concurrency & Fixtures:** Handle asynchronous race conditions using per-case deferred promises (`src/test/deferred.ts`). Fixtures must return fresh factory instances and must never persist mutable shared state across runs.
* **Teardown & Leaks:** Components, stores, and subscriptions must clean up their own resources. The root test setup provides catch-all unmounting and restores global stubs, environment variables, and fake timers. Tests verifying teardown must advance time after unmount to confirm that no delayed tasks mutate unmounted state or emit late errors.
* **DOM & Media Stubs:** Use `src/test/dom-fixtures.ts` for media queries and Web Animations. Property overrides (`replaceProperty`) must run inside the test case or `beforeEach` hooks to ensure descriptor restoration on completion. Polyfills for Fluent form-associated components serve only as UI test scaffolding—they do not replace real browser engine verification for layout or canvas behaviors.
* **Diagnostic Logging:** Expected log messages should be captured and explicitly asserted. Never globally suppress warnings or unhandled exceptions.

## Timers, Randomness & Real I/O

* **Deterministic Time:** Domain logic must accept explicit timestamps or durations as inputs; platform adapters handle system clock retrieval. Retry policies must explicitly test backoff boundaries, iteration limits, server-specified headers, and jitter distributions.
* **Fake Timers:** Timer-dependent tests must use virtual timers advanced explicitly to behavioral boundaries. For asynchronous DOM polling, use `vi.waitFor` configured to advance virtual time. Arbitrary wall-clock sleeps are prohibited.
* **Async Runtime Semantics:** Pausing virtual time in asynchronous frameworks (such as Tokio's `time::pause`) controls only the framework's internal timer driver, not `std::time::Instant` or blocking OS operations.
* **Cryptography & Security Contracts:** Cryptographic random sources and production KDF parameters must remain uncompromised in security-critical paths, testing with known test vectors. Memory zeroing tests verify public API contracts (e.g., `Zeroizing<T>`), as reading deallocated memory produces undefined behavior.
* **Filesystem & Network Integration:** Tests touching disk locks, storage engines, or TCP/TLS loopbacks run as integration tests. They must use per-case unique temporary directories, dynamic loopback port assignment, and strict timeout boundaries.

## CI & Automated Gateways

* **PR Validation Pipeline:** Every pull request runs the full frontend suite, Rust workspace tests, Node scripts, Python validators, and a shuffled frontend test run with a deterministic seed.
* **Weekly & On-Demand Stability Matrix:** Runs on scheduled workflows across Windows and Linux runner matrixes:
* Executes frontend test suites across three fixed seeds for regression benchmarking, plus a dynamically generated seed (`Date.now()`) to detect ordering issues.
* Generates reproducible command strings in workflow summaries containing platform, Git commit SHA, and the exact seed used:
```sh
pnpm exec vitest run --sequence.shuffle --sequence.seed=<RUNNER_SEED>

```


* Executes the stability harness across isolated processes (20 iterations per target scenario).
* Runs Rust workspace tests under both single-threaded and multi-threaded (`--test-threads=4`) modes.


* **Static Gateways:** Routine checks enforce zero warnings and strict formatting:
* `pnpm check`
* `pnpm i18n:unused`
* `pnpm build`
* `cargo fmt --all -- --check`
* `cargo clippy --workspace --all-targets --no-default-features --locked -- -D warnings`

## References

* [FIRST Principles (Agile in a Flash)](https://agileinaflash.blogspot.com/2009/02/first.html)
* [Software Engineering at Google: Testing Overview & Test Doubles](https://abseil.io/resources/swe-book/html/ch11.html)
* [Vitest Documentation: Projects & Sequence Configuration](https://vitest.dev/guide/projects)
* [Testing Library: Mocking Timers](https://testing-library.com/docs/using-fake-timers/)
* [Tokio Documentation: Virtual Clock Manipulation](https://docs.rs/tokio/latest/tokio/time/fn.pause.html)
* [Rust `zeroize` Documentation: Zeroizing Wrappers](https://docs.rs/zeroize/latest/zeroize/struct.Zeroizing.html)
