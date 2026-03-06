#!/usr/bin/env tclsh
# TCL Debug Server
# Communicates with the VS Code debug adapter over a TCP socket.
# Instruments the user's script with line-level checkpoints to enable
# breakpoints, stepping, variable inspection, and call stack viewing.

package require Tcl 8.5

namespace eval ::debug {
    variable sock ""
    variable breakpoints
    variable paused 0
    variable stepMode "none"
    variable stepLevel -1
    variable currentFile ""
    variable currentLine 0
    variable running 1
    variable scriptFile ""

    array set breakpoints {}
}

# ---- Socket Communication ----

proc ::debug::startServer {scriptFile} {
    variable sock
    variable ::debug::scriptFile

    set ::debug::scriptFile $scriptFile

    # Open server socket on random port
    set serverSock [socket -server ::debug::acceptConnection 0]
    set port [lindex [fconfigure $serverSock -sockname] 2]

    # Print port for the adapter to connect
    puts "DEBUG_PORT:$port"
    flush stdout

    # Wait for connection
    vwait ::debug::sock
    close $serverSock

    # Wait for initial configuration (breakpoints, etc.)
    ::debug::waitForCommand "CONFIGDONE"

    # Run the instrumented script
    ::debug::runScript
}

proc ::debug::acceptConnection {channel addr port} {
    variable sock
    set sock $channel
    fconfigure $sock -buffering line -translation lf -blocking 0
    fileevent $sock readable [list ::debug::readCommand]
}

proc ::debug::readCommand {} {
    variable sock
    variable paused

    if {[eof $sock]} {
        ::debug::shutdown
        return
    }

    gets $sock line
    if {$line eq ""} return

    ::debug::handleCommand $line
}

proc ::debug::sendResponse {msg} {
    variable sock
    if {$sock ne ""} {
        catch {
            puts $sock $msg
            flush $sock
        }
    }
}

proc ::debug::handleCommand {line} {
    set parts [split $line " "]
    set cmd [lindex $parts 0]

    switch $cmd {
        "BREAK" {
            set file [lindex $parts 1]
            set lineNum [lindex $parts 2]
            set ::debug::breakpoints($file,$lineNum) 1
            ::debug::sendResponse "OK BREAK $file $lineNum"
        }
        "CLEAR" {
            set file [lindex $parts 1]
            set lineNum [lindex $parts 2]
            catch {unset ::debug::breakpoints($file,$lineNum)}
            ::debug::sendResponse "OK CLEAR $file $lineNum"
        }
        "CLEARALL" {
            array unset ::debug::breakpoints
            array set ::debug::breakpoints {}
            ::debug::sendResponse "OK CLEARALL"
        }
        "CONTINUE" {
            set ::debug::stepMode "none"
            set ::debug::paused 0
        }
        "STEP" {
            set ::debug::stepMode "next"
            set ::debug::stepLevel [::debug::getCurrentLevel]
            set ::debug::paused 0
        }
        "STEPIN" {
            set ::debug::stepMode "in"
            set ::debug::paused 0
        }
        "STEPOUT" {
            set ::debug::stepMode "out"
            set ::debug::stepLevel [::debug::getCurrentLevel]
            set ::debug::paused 0
        }
        "VARS" {
            set scope [lindex $parts 1]
            ::debug::sendVariables $scope
        }
        "EVAL" {
            set expr [join [lrange $parts 1 end] " "]
            ::debug::evalExpression $expr
        }
        "STACK" {
            ::debug::sendCallStack
        }
        "SETVAR" {
            set name [lindex $parts 1]
            set value [join [lrange $parts 2 end] " "]
            ::debug::setVariable $name $value
        }
        "CONFIGDONE" {
            set ::debug::configDone 1
        }
        "DISCONNECT" {
            ::debug::shutdown
        }
        default {
            ::debug::sendResponse "ERROR Unknown command: $cmd"
        }
    }
}

proc ::debug::waitForCommand {expected} {
    variable sock

    # Use vwait-based approach to wait for a specific command
    set ::debug::configDone 0
    vwait ::debug::configDone
}

# ---- Script Instrumentation ----

proc ::debug::instrumentScript {filePath} {
    set fd [open $filePath r]
    set content [read $fd]
    close $fd

    set lines [split $content \n]
    set output {}
    set lineNum 0
    set continuation 0

    foreach line $lines {
        incr lineNum
        set trimmed [string trim $line]

        # Pass through empty lines, comments, and continuation lines
        if {$continuation} {
            lappend output $line
            # Check if continuation ends (no trailing backslash)
            if {![string match {*\\} [string trimright $line]]} {
                set continuation 0
            }
            continue
        }

        if {$trimmed eq "" || [string index $trimmed 0] eq "#"} {
            lappend output $line
            continue
        }

        # Check for line continuation
        if {[string match {*\\} [string trimright $line]]} {
            set continuation 1
            # Insert checkpoint before the first line of the continuation
            set indent [::debug::getIndent $line]
            lappend output "${indent}::debug::checkpoint [list $filePath] $lineNum"
            lappend output $line
            continue
        }

        # Check for lines that are just closing braces — don't instrument
        if {[regexp {^\s*\}\s*$} $line]} {
            lappend output $line
            continue
        }

        # Check for proc/namespace/if/while/for/foreach/switch headers
        # These control structures should have the checkpoint before them
        set indent [::debug::getIndent $line]
        lappend output "${indent}::debug::checkpoint [list $filePath] $lineNum"
        lappend output $line
    }

    return [join $output \n]
}

proc ::debug::getIndent {line} {
    regexp {^(\s*)} $line -> indent
    return $indent
}

# ---- Execution Control ----

proc ::debug::checkpoint {file line} {
    variable breakpoints
    variable stepMode
    variable stepLevel
    variable currentFile
    variable currentLine
    variable paused

    set currentFile $file
    set currentLine $line

    set shouldPause 0

    # Check breakpoints
    if {[info exists breakpoints($file,$line)]} {
        set shouldPause 1
    }

    # Check stepping
    switch $stepMode {
        "in" {
            set shouldPause 1
        }
        "next" {
            set level [::debug::getCurrentLevel]
            if {$level <= $stepLevel} {
                set shouldPause 1
            }
        }
        "out" {
            set level [::debug::getCurrentLevel]
            if {$level < $stepLevel} {
                set shouldPause 1
            }
        }
    }

    if {$shouldPause} {
        set stepMode "none"
        set paused 1
        ::debug::sendResponse "PAUSED $file $line"

        # Enter event loop to process commands while paused
        vwait ::debug::paused
    }
}

proc ::debug::getCurrentLevel {} {
    # info level gives the stack depth
    # Subtract 2 to account for checkpoint and getCurrentLevel calls
    set level [info level]
    return [expr {$level - 2}]
}

proc ::debug::runScript {} {
    variable scriptFile
    variable currentFile

    set currentFile $scriptFile

    # Instrument the script
    set instrumented [::debug::instrumentScript $scriptFile]

    # Write instrumented script to temp file
    set tempFile [file join [::debug::tempDir] "tcl_debug_instrumented_[pid].tcl"]
    set fd [open $tempFile w]
    puts $fd $instrumented
    close $fd

    # Execute the instrumented script
    set errorOccurred 0
    set errorMsg ""
    set errorInfo ""

    if {[catch {source $tempFile} result]} {
        set errorOccurred 1
        set errorMsg $result
        if {[info exists ::errorInfo]} {
            set errorInfo $::errorInfo
        }
    }

    # Clean up temp file
    catch {file delete $tempFile}

    if {$errorOccurred} {
        ::debug::sendResponse "ERROR $errorMsg"
        if {$errorInfo ne ""} {
            ::debug::sendResponse "ERRORINFO $errorInfo"
        }
    }

    ::debug::sendResponse "TERMINATED"
    ::debug::shutdown
}

proc ::debug::tempDir {} {
    if {[info exists ::env(TMPDIR)]} {
        return $::env(TMPDIR)
    } elseif {[info exists ::env(TMP)]} {
        return $::env(TMP)
    } elseif {[info exists ::env(TEMP)]} {
        return $::env(TEMP)
    } elseif {$::tcl_platform(platform) eq "windows"} {
        return "C:/Temp"
    }
    return "/tmp"
}

# ---- Variable Inspection ----

proc ::debug::sendVariables {scope} {
    set vars {}

    if {$scope eq "local"} {
        # Get local variables from the calling context
        # We need to go up several frames: sendVariables -> handleCommand -> readCommand -> checkpoint context
        set level [::debug::getInspectionLevel]
        if {[catch {
            set varNames [uplevel #$level {info locals}]
            foreach name $varNames {
                if {[catch {set val [uplevel #$level [list set $name]]} err]} {
                    set val "<error: $err>"
                }
                # Check if it's an array
                if {[uplevel #$level [list array exists $name]]} {
                    set val [uplevel #$level [list array get $name]]
                    lappend vars [list $name "(array)" $val]
                } else {
                    lappend vars [list $name $val]
                }
            }
        }]} {
            # If we can't get locals, return empty
        }
    } elseif {$scope eq "global"} {
        # Get global variables (filtering out internal debug vars)
        foreach name [info globals] {
            if {[string match "::debug::*" $name] || [string match "debug_*" $name]} continue
            if {$name in {auto_path auto_index env tcl_platform tcl_library tcl_version tcl_patchLevel}} continue
            if {[catch {set val [set ::$name]}]} {
                if {[array exists ::$name]} {
                    set val [array get ::$name]
                    lappend vars [list $name "(array)" $val]
                }
                continue
            }
            lappend vars [list $name $val]
        }
    }

    # Format as a simple protocol: VAR name|value pairs separated by \x1E (record separator)
    set response "VARS"
    foreach varInfo $vars {
        set name [lindex $varInfo 0]
        if {[llength $varInfo] == 3} {
            set type [lindex $varInfo 1]
            set val [lindex $varInfo 2]
            append response "\x1E$name\x1F$type\x1F$val"
        } else {
            set val [lindex $varInfo 1]
            append response "\x1E$name\x1F$val"
        }
    }

    ::debug::sendResponse $response
}

proc ::debug::getInspectionLevel {} {
    # Find the user code level by looking for checkpoint in the stack
    set levels [info level]
    for {set i $levels} {$i >= 0} {incr i -1} {
        if {[catch {set frame [info level $i]} err]} continue
        set cmd [lindex $frame 0]
        if {$cmd eq "::debug::checkpoint"} {
            # The frame below checkpoint is the user code
            return [expr {$i - 1}]
        }
    }
    # Default: return global level
    return 0
}

proc ::debug::setVariable {name value} {
    set level [::debug::getInspectionLevel]
    if {[catch {uplevel #$level [list set $name $value]} result]} {
        ::debug::sendResponse "ERROR Cannot set variable: $result"
    } else {
        ::debug::sendResponse "OK SETVAR $name $result"
    }
}

# ---- Call Stack ----

proc ::debug::sendCallStack {} {
    variable currentFile
    variable currentLine

    set stack {}

    # Build stack from info level
    set levels [info level]

    # Find where user code starts
    set userLevel [::debug::getInspectionLevel]

    for {set i $userLevel} {$i >= 0} {incr i -1} {
        if {[catch {set frame [info level $i]}]} continue
        set procName [lindex $frame 0]

        # Skip debug namespace procs
        if {[string match "::debug::*" $procName]} continue

        set file $currentFile
        set line $currentLine

        # Try to get file/line info from info frame (8.5+)
        if {![catch {set frameInfo [info frame $i]}]} {
            if {[dict exists $frameInfo file]} {
                set file [dict get $frameInfo file]
            }
            if {[dict exists $frameInfo line]} {
                set line [dict get $frameInfo line]
            }
        }

        lappend stack [list $procName $file $line]
    }

    # Always include at least the current position
    if {[llength $stack] == 0} {
        lappend stack [list "<main>" $currentFile $currentLine]
    }

    # Format response
    set response "STACK"
    foreach frame $stack {
        append response "\x1E[lindex $frame 0]\x1F[lindex $frame 1]\x1F[lindex $frame 2]"
    }

    ::debug::sendResponse $response
}

# ---- Expression Evaluation ----

proc ::debug::evalExpression {expr} {
    set level [::debug::getInspectionLevel]
    if {[catch {set result [uplevel #$level $expr]} err]} {
        ::debug::sendResponse "EVALRESULT ERROR $err"
    } else {
        ::debug::sendResponse "EVALRESULT OK $result"
    }
}

# ---- Shutdown ----

proc ::debug::shutdown {} {
    variable sock
    if {$sock ne ""} {
        catch {close $sock}
        set sock ""
    }
    exit 0
}

# ---- Entry Point ----

if {$argc < 1} {
    puts stderr "Usage: debugServer.tcl <script.tcl> \[args...\]"
    exit 1
}

set scriptFile [lindex $argv 0]
if {![file exists $scriptFile]} {
    puts stderr "Script file not found: $scriptFile"
    exit 1
}

# Pass remaining args to the user script
set argv [lrange $argv 1 end]
set argc [llength $argv]

::debug::startServer $scriptFile
