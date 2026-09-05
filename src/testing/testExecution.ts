import { escapeTclString } from '../utils/tclUtils';

export type TclTestKind = 'procedure' | 'tcltest';
export const TEST_RESULT_PREFIX = '__VSCODE_TCL_TEST_RESULT__:';

/** Run one declaration without relying on tcltest counters after cleanupTests. */
export function createTestExecutionScript(file: string, name: string, kind: TclTestKind): string {
    return `
namespace eval ::vscode_test {
    variable status skipped
    variable found 0
}
set ::vscode_test::file "${escapeTclString(file)}"
set ::vscode_test::selected "${escapeTclString(name)}"
set ::vscode_test::kind ${kind}

# Install before the file imports tcltest::test. Unselected declarations do not run.
if {![catch {package require tcltest}]} {
    rename ::tcltest::test ::tcltest::__vscode_original_test
    proc ::tcltest::test {name description args} {
        if {$::vscode_test::kind ne "tcltest" || $name ne $::vscode_test::selected} {
            return
        }
        set ::vscode_test::found 1
        set failed $::tcltest::numTests(Failed)
        set passed $::tcltest::numTests(Passed)
        set code [catch {
            uplevel 1 [list ::tcltest::__vscode_original_test $name $description {*}$args]
        } result options]
        if {$code || $::tcltest::numTests(Failed) > $failed} {
            set ::vscode_test::status failed
        } elseif {$::tcltest::numTests(Passed) > $passed && $::vscode_test::status ne "failed"} {
            set ::vscode_test::status passed
        }
        return -options $options $result
    }
} elseif {$::vscode_test::kind eq "tcltest"} {
    puts stderr "The tcltest package is unavailable"
    exit 1
}

if {[catch {source $::vscode_test::file} result]} {
    puts stderr "Error sourcing test file: $result"
    set ::vscode_test::status failed
} elseif {$::vscode_test::kind eq "procedure"} {
    if {[namespace which -command $::vscode_test::selected] eq ""} {
        puts stderr "Test procedure not found: $::vscode_test::selected"
        set ::vscode_test::status failed
    } elseif {[catch {uplevel #0 [list $::vscode_test::selected]} result]} {
        puts stderr "Test failed: $result"
        set ::vscode_test::status failed
    } else {
        set ::vscode_test::status passed
    }
} elseif {!$::vscode_test::found} {
    puts stderr "Test not found: $::vscode_test::selected"
    set ::vscode_test::status failed
}
puts "${TEST_RESULT_PREFIX}$::vscode_test::status"
exit [expr {$::vscode_test::status eq "failed"}]
`;
}
