import { escapeTclString } from '../utils/tclUtils';

export const COVERAGE_BEGIN = '__VSCODE_TCL_COVERAGE_BEGIN__';
export const COVERAGE_END = '__VSCODE_TCL_COVERAGE_END__';

/** Trace original source commands; never insert executable text into user data. */
export function createCoverageExecutionScript(files: string[], roots: string[], selectedExecution?: string): string {
    const quote = (value: string) => `"${escapeTclString(value)}"`;
    return String.raw`
namespace eval ::vscode_coverage {
    variable data {}
    variable seeded {}
    variable failed 0
    variable compiler [interp create -safe]
    variable runner [file normalize [info script]]
}
set ::vscode_coverage::files [list ${files.map(quote).join(' ')}]
set ::vscode_coverage::roots [list ${roots.map(quote).join(' ')}]
set ::vscode_coverage::selected ${quote(selectedExecution ?? '')}

proc ::vscode_coverage::allowed {file} {
    variable roots
    variable runner
    if {$file eq $runner} { return 0 }
    foreach root $roots {
        set root [file normalize $root]
        if {$file eq $root || [string first "$root/" $file] == 0} { return 1 }
    }
    return 0
}

# The compiler identifies executable commands, including unvisited branches,
# without evaluating the source. Source offsets count UTF-8 bytes.
proc ::vscode_coverage::seedCommands {file source firstLine} {
    variable data
    variable compiler
    # Compile in an untraced interpreter so Tcl retains branch command offsets.
    # Tcl 9 hides unsupported commands in safe interpreters. Invoke only the
    # compiler from the parent; user source remains data and is never evaluated.
    if {[catch {
        if {[lsearch -exact [interp hidden $compiler] tcl:unsupported:disassemble] >= 0} {
            interp invokehidden $compiler tcl:unsupported:disassemble script $source
        } else {
            interp eval $compiler [list ::tcl::unsupported::disassemble script $source]
        }
    } bytecode]} { return }
    set bytes [encoding convertto utf-8 $source]
    foreach {match offset} [regexp -all -inline {\d+: pc \d+-\d+, src (\d+)-\d+} $bytecode] {
        set prefix [string range $bytes 0 [expr {$offset - 1}]]
        set line [expr {$firstLine + [regexp -all {\n} $prefix]}]
        if {![dict exists $data $file $line]} { dict set data $file $line 0 }
    }
}

proc ::vscode_coverage::record {command operation} {
    # Keep this at callback level: wrapping info frame in catch changes its depth.
    set frame [info frame -2]
    catch {
        variable data
        variable seeded
        if {![dict exists $frame file] || ![dict exists $frame line]} { return }
        set file [file normalize [dict get $frame file]]
        if {![allowed $file]} { return }
        if {![dict exists $seeded $file]} {
            dict set seeded $file 1
            set fp [open $file r]
            set source [read $fp]
            close $fp
            seedCommands $file $source 1
        }
        set line [dict get $frame line]
        if {![dict exists $data $file]} { dict set data $file {} }
        set lines [dict get $data $file]
        dict incr lines $line
        dict set data $file $lines

        # Procedure bodies compile separately from their declarations.
        if {[lindex $command 0] in {proc ::proc} && [llength $command] == 4} {
            set body [lindex $command 3]
            set bodyOffset [string first $body [dict get $frame cmd]]
            if {$body ne "" && $bodyOffset >= 0} {
                set prefix [string range [dict get $frame cmd] 0 [expr {$bodyOffset - 1}]]
                seedCommands $file $body [expr {$line + [regexp -all {\n} $prefix]}]
            }
        }
    }
}

proc ::vscode_coverage::run {} {
    variable selected
    if {$selected ne ""} {
        if {[catch {uplevel #0 $selected} error]} {
            puts stderr $error
            set ::vscode_coverage::failed 1
        }
        if {[info exists ::vscode_test::status] && $::vscode_test::status eq "failed"} {set ::vscode_coverage::failed 1}
        return
    }
    variable files
    foreach file $files {
        if {[catch {uplevel #0 [list source $file]} error]} {
            puts stderr "Error sourcing $file: $error"
            set ::vscode_coverage::failed 1
        }
    }
    # tcltest declarations execute while sourced. Procedure tests need a call.
    foreach test [info procs ::test_*] {
        if {[catch {uplevel #0 [list $test]} error]} {
            puts stderr "Test $test failed: $error"
            set ::vscode_coverage::failed 1
        }
    }
}
# Remember assertion failures before test files call cleanupTests and reset counters.
if {![catch {package require tcltest}]} {
    rename ::tcltest::test ::tcltest::__vscode_coverage_test
    proc ::tcltest::test {name description args} {
        set failed $::tcltest::numTests(Failed)
        set code [catch {
            uplevel 1 [list ::tcltest::__vscode_coverage_test $name $description {*}$args]
        } result options]
        if {$code || $::tcltest::numTests(Failed) > $failed} {
            set ::vscode_coverage::failed 1
        }
        return -options $options $result
    }
}
trace add execution ::vscode_coverage::run enterstep ::vscode_coverage::record
::vscode_coverage::run
trace remove execution ::vscode_coverage::run enterstep ::vscode_coverage::record
interp delete $::vscode_coverage::compiler

puts "${COVERAGE_BEGIN}"
dict for {file lines} $::vscode_coverage::data {
    binary scan [encoding convertto utf-8 $file] H* fileHex
    puts "FILEHEX:$fileHex"
    foreach line [lsort -integer [dict keys $lines]] {
        puts "LINE:$line:[dict get $lines $line]"
    }
}
puts "${COVERAGE_END}"
exit $::vscode_coverage::failed
`;
}
