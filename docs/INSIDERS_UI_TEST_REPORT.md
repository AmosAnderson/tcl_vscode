# VS Code Insiders UI verification

Verified September 5, 2026 with Computer Use in the installed VS Code Insiders 1.137.0 development host, running the development feature set now recorded as version 0.8.0 (before the manifest version bump). The host used the supplied `tcl_testcode` workspace and macOS Tcl 8.5.9. Edits used temporary fixtures; the supplied workspace has a clean Git status after verification.

## Observed results

| Workflow | UI action and observed result |
| --- | --- |
| Procedure signatures | Trigger Parameter Hints at the `connect` call in `examples/07_procs.tcl`: `connect host ?port=80? ?protocol=http?`. |
| Definition navigation | F12 on that call opens the `connect` declaration at line 11. |
| Reference CodeLens | Click `2 references` above `connect`: the references peek lists the calls on lines 14 and 15. |
| TclOO symbols | Go to Symbol in `oo/01_classes.tcl` lists Point, its constructor/destructor, and five methods. F12 on `origin toString` at line 48 opens the method at line 28. |
| Test discovery and selection | Testing discovers all 12 cases in `tests/tcltest_example.tcl`. Running only `mean-1` passes 1/1 while the other cases remain unrun. |
| Full sample suite | Run Tests from Testing passes 12/12. |
| Selected coverage | Run Test with Coverage on `mean-1` passes 1/1; native coverage shows 52.54% overall, 33.33% for `procs/math_utils.tcl`, and 100% for the test declaration file. Green/red source decorations appear; status reports 52.5%. Test output contains the normal Tcl summary without internal coverage/result records. |
| Selected debugging | F9 adds a visible breakpoint at `math_utils.tcl:18`. Debug Test on `mean-1` pauses there with `values = 1 2 3 4 5`, `sum = 0.0`, and `v = 1`. One F10 advances to line 15 with `sum = 1.0`, `v = 2`, and the reason `step`. Removing the temporary breakpoint and continuing passes the test. The console shows its summary without internal result markers or a generated-runner workspace warning. |
| Formatting | Format Document on a temporary copy of `examples/06_control_flow.tcl` restores deliberately removed switch-body indentation and expands bodies consistently. The saved formatted file has identical Tcl exit status, stdout, and stderr to the original. |
| Lint quick fix | On a temporary fixture, Quick Fix offers “Brace the expr argument” for `set total [expr 2 + 3]`. Applying it produces `set total [expr {2 + 3}]`, clears the warning, and preserves execution output. |
| REPL lifecycle | Start REPL evaluates `expr {6 * 7}` as 42. After `exit`, Start REPL creates a working session that evaluates `expr {7 * 8}` as 56. |

## Defects fixed during this pass

- Missing Tcl breakpoint-language contributions prevented editor gutter/F9 breakpoints even though programmatically inserted breakpoint tests passed. Added manifest contributions and a regression invoking the actual editor Toggle Breakpoint action.
- Tcl traced an expression and its enclosing scalar assignment separately, so the first Step Over could stop again on the same line without an updated value. Proven whole-value assignment continuations now share the original stop; regressions retain later loop visits, distinct semicolon commands, and nested Step In.
- Every debug stop was labeled `breakpoint`. Server and adapter now preserve `step`, `pause`, and `entry` reasons while retaining compatibility with earlier PAUSED messages.
- Coverage could display stale “Coverage cleared” status, and test/debug output exposed internal records or a misleading temporary-runner warning. Owned status messages and separate display filtering correct these without changing raw result/coverage parsing.

## Automated verification and limits

After these fixes, compilation and lint pass, the standalone runner passes **101 tests**, and the isolated VS Code 1.136.1 extension host passes **185 tests**. The standalone tests are a subset of the full suite. The debugger suite contains 19 tests, including real Tcl/Thread fixtures and new stepping/stop-reason regressions. The CRLF-aware diff check passes.

This is representative UI coverage of the implemented features. Remote attach, Thread controls, package installation, project scaffolding, multi-folder tasks, and broad refactoring cases retain automated coverage but were not manually exercised in this Insiders pass. TclOO navigation was checked statically; this system interpreter does not provide TclOO. Arbitrary nested substitutions may still expose multiple command stops on one line. Remote CI and live teacup sources remain unverified.
