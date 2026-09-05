#!/usr/bin/env tclsh
# TCL Debug Server
# Communicates with the VS Code debug adapter over a TCP socket.
# Traces the user's original script at command boundaries to enable
# breakpoints, stepping, variable inspection, and call stack viewing.

package require Tcl 8.5

namespace eval ::debug {
    variable sock ""
    variable breakpoints
    variable breakpointConditions
    variable breakpointLogMessages
    variable paused 0
    variable stepMode "none"
    variable stepLevel -1
    variable currentFile ""
    variable currentLine 0
    variable running 1
    variable scriptFile ""
    variable inspectionLevel 0
    variable commandQueue {}
    variable commandReady 0
    variable scriptStack {}
    variable serverFile [file normalize [info script]]

    array set breakpoints {}
    array set breakpointConditions {}
    array set breakpointLogMessages {}
}

# ---- Socket Communication ----

proc ::debug::startServer {targetFile} {
    variable sock
    variable scriptFile

    set scriptFile [file normalize $targetFile]

    # Open server socket on random port
    set serverSock [socket -server ::debug::acceptConnection -myaddr 127.0.0.1 0]
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
    if {[gets $sock line] < 0} {
        if {[eof $sock]} {::debug::shutdown}
        return 0
    }
    if {$line eq ""} {return 1}
    # Event callbacks run at global scope. Queue commands so inspection is
    # executed by the paused checkpoint, where the user's call frames exist.
    lappend ::debug::commandQueue $line
    incr ::debug::commandReady
    return 1
}

proc ::debug::nextCommand {} {
    while {[llength $::debug::commandQueue] == 0} {
        vwait ::debug::commandReady
    }
    set command [lindex $::debug::commandQueue 0]
    set ::debug::commandQueue [lrange $::debug::commandQueue 1 end]
    return $command
}

proc ::debug::sendResponse {msg} {
    variable sock
    if {$sock ne ""} {
        catch {
            # Hex framing preserves embedded newlines in values and errors.
            binary scan [encoding convertto utf-8 $msg] H* encoded
            puts $sock "DATA $encoded"
            flush $sock
        }
    }
}

proc ::debug::handleCommand {line} {
    # Use lindex instead of split to properly handle brace-quoted elements
    # (e.g. file paths with spaces sent as {/path/with spaces})
    set cmd [lindex $line 0]

    switch $cmd {
        "BREAK" {
            set file [file normalize [lindex $line 1]]
            set lineNum [lindex $line 2]
            set condition [lindex $line 3]
            set logMessage [lindex $line 4]
            set ::debug::breakpoints($file,$lineNum) 1
            set ::debug::breakpointConditions($file,$lineNum) $condition
            set ::debug::breakpointLogMessages($file,$lineNum) $logMessage
            ::debug::sendResponse "OK BREAK $file $lineNum"
        }
        "CLEAR" {
            set file [file normalize [lindex $line 1]]
            set lineNum [lindex $line 2]
            catch {unset ::debug::breakpoints($file,$lineNum)}
            catch {unset ::debug::breakpointConditions($file,$lineNum)}
            catch {unset ::debug::breakpointLogMessages($file,$lineNum)}
            ::debug::sendResponse "OK CLEAR $file $lineNum"
        }
        "CLEARFILE" {
            set file [file normalize [lindex $line 1]]
            foreach key [array names ::debug::breakpoints] {
                set separator [string last , $key]
                if {[string range $key 0 [expr {$separator - 1}]] eq $file} {
                    unset ::debug::breakpoints($key)
                    catch {unset ::debug::breakpointConditions($key)}
                    catch {unset ::debug::breakpointLogMessages($key)}
                }
            }
            ::debug::sendResponse "OK CLEARFILE"
        }
        "CLEARALL" {
            array unset ::debug::breakpoints
            array set ::debug::breakpoints {}
            array unset ::debug::breakpointConditions
            array set ::debug::breakpointConditions {}
            array unset ::debug::breakpointLogMessages
            array set ::debug::breakpointLogMessages {}
            ::debug::sendResponse "OK CLEARALL"
        }
        "CONTINUE" {
            set ::debug::stepMode "none"
            ::debug::sendResponse "OK CONTINUE"
            set ::debug::paused 0
        }
        "STEP" {
            set ::debug::stepMode "next"
            set ::debug::stepLevel [::debug::getCurrentLevel]
            ::debug::sendResponse "OK STEP"
            set ::debug::paused 0
        }
        "STEPIN" {
            set ::debug::stepMode "in"
            ::debug::sendResponse "OK STEPIN"
            set ::debug::paused 0
        }
        "STEPOUT" {
            set ::debug::stepMode "out"
            set ::debug::stepLevel [::debug::getCurrentLevel]
            ::debug::sendResponse "OK STEPOUT"
            set ::debug::paused 0
        }
        "VARS" {
            set scope [lindex $line 1]
            ::debug::sendVariables $scope
        }
        "EVAL" {
            set expr [lindex $line 1]
            ::debug::evalExpression $expr
        }
        "STACK" {
            ::debug::sendCallStack
        }
        "ARRAY" {
            set name [lindex $line 1]
            set scope [lindex $line 2]
            ::debug::sendArrayElements $name $scope
        }
        "SETVAR" {
            set name [lindex $line 1]
            set value [lindex $line 2]
            ::debug::setVariable $name $value
        }
        "CONFIGDONE" {
            ::debug::sendResponse "OK CONFIGDONE"
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

    set ::debug::configDone 0
    while {!$::debug::configDone} {
        ::debug::handleCommand [::debug::nextCommand]
    }
}

# ---- Execution Tracing ----

proc ::debug::traceCommand {command operation} {
    # This must run directly in the callback: -1 is the synthetic trace call,
    # and -2 is the original command, with Tcl's source-file/line metadata.
    set frame [info frame -2]
    if {![dict exists $frame file] || ![dict exists $frame line]} return
    set file [file normalize [dict get $frame file]]
    if {$file eq $::debug::serverFile} return

    set ::debug::inspectionLevel [expr {[info level] - 1}]
    set ::debug::scriptStack {}
    set seenLevels {}
    # Snapshot real source frames before entering the debugger's event loop.
    set lastFrame [expr {[info frame] - 2}]
    for {set i $lastFrame} {$i > 0} {incr i -1} {
        set caller [info frame $i]
        if {![dict exists $caller file] || ![dict exists $caller level]} continue
        set callerFile [file normalize [dict get $caller file]]
        if {$callerFile eq $::debug::serverFile} continue
        set level [dict get $caller level]
        if {$level in $seenLevels} continue
        lappend seenLevels $level
        set name "<main>"
        if {[dict exists $caller proc]} {set name [dict get $caller proc]}
        lappend ::debug::scriptStack [list $name $callerFile [dict get $caller line]]
    }
    ::debug::checkpoint $file [dict get $frame line]
}

# ---- Execution Control ----

proc ::debug::checkpoint {file line} {
    variable breakpoints
    variable breakpointConditions
    variable breakpointLogMessages
    variable stepMode
    variable stepLevel
    variable currentFile
    variable currentLine
    variable paused

    set currentFile $file
    set currentLine $line

    # Observe breakpoint edits even in scripts that never enter an event loop.
    # The socket is nonblocking; this does not execute unrelated Tcl events.
    while {[::debug::readCommand]} {}
    while {[llength $::debug::commandQueue] > 0} {
        ::debug::handleCommand [::debug::nextCommand]
    }

    set shouldPause 0

    # Check breakpoints
    if {[info exists breakpoints($file,$line)]} {
        # Check if this is a logpoint (logMessage takes priority over condition)
        if {[info exists breakpointLogMessages($file,$line)] &&
            $breakpointLogMessages($file,$line) ne ""} {
            set logMsg $breakpointLogMessages($file,$line)
            set level [::debug::getInspectionLevel]
            # Interpolate {expression} placeholders by evaluating in user's frame
            set interpolated [::debug::interpolateLogMessage $logMsg $level]
            ::debug::sendResponse "LOG $interpolated"
            # Logpoints do not pause — continue execution
        } else {
            set shouldPause 1
            # Evaluate conditional breakpoint
            if {[info exists breakpointConditions($file,$line)] &&
                $breakpointConditions($file,$line) ne ""} {
                set condition $breakpointConditions($file,$line)
                set level [::debug::getInspectionLevel]
                if {[catch {set result [uplevel #$level [list expr $condition]]} err]} {
                    ::debug::sendResponse "OUTPUT WARNING: Breakpoint condition error at $file:$line: $err"
                } elseif {!$result} {
                    set shouldPause 0
                }
            }
        }
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

        # Return from the event loop before inspecting the user's call frame.
        while {$paused} {
            ::debug::handleCommand [::debug::nextCommand]
        }
    }
}

proc ::debug::interpolateLogMessage {msg level} {
    # Replace {expression} placeholders with evaluated results from user's frame.
    # Uses a regex to find all {...} groups and substitutes each one.
    set result ""
    set remaining $msg
    while {[regexp -indices {\{([^\}]*)\}} $remaining match exprRange]} {
        set matchStart [lindex $match 0]
        set matchEnd [lindex $match 1]
        set exprStart [lindex $exprRange 0]
        set exprEnd [lindex $exprRange 1]
        # Append text before the match
        append result [string range $remaining 0 [expr {$matchStart - 1}]]
        # Extract and evaluate the expression
        set expression [string range $remaining $exprStart $exprEnd]
        if {[catch {set val [uplevel #$level [list set $expression]]} err]} {
            # If simple variable lookup fails, try evaluating as an expression
            if {[catch {set val [uplevel #$level [list expr $expression]]} err2]} {
                set val "<error: $err2>"
            }
        }
        append result $val
        # Advance past the match
        set remaining [string range $remaining [expr {$matchEnd + 1}] end]
    }
    append result $remaining
    return $result
}

proc ::debug::getCurrentLevel {} {
    return $::debug::inspectionLevel
}

proc ::debug::runScript {} {
    variable scriptFile
    variable currentFile

    set currentFile $scriptFile
    # Tracing source observes actual commands, including procedure and sourced
    # file bodies, without rewriting Tcl literal words or structured lists.
    trace add execution ::source enterstep ::debug::traceCommand
    set code [catch {uplevel #0 [list source $scriptFile]} result options]
    trace remove execution ::source enterstep ::debug::traceCommand

    if {$code != 0} {
        ::debug::sendResponse "ERROR $result"
        if {[dict exists $options -errorinfo]} {
            ::debug::sendResponse "ERRORINFO [dict get $options -errorinfo]"
        }
    }

    ::debug::sendResponse "TERMINATED"
    ::debug::shutdown
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
                    set val [uplevel #$level [list array size $name]]
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
                    set val [array size ::$name]
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

proc ::debug::sendArrayElements {name scope} {
    set response "ARRAY"

    if {$scope eq "local"} {
        set level [::debug::getInspectionLevel]
        if {[catch {
            if {[uplevel #$level [list array exists $name]]} {
                set keys [lsort [uplevel #$level [list array names $name]]]
                foreach key $keys {
                    if {[catch {set val [uplevel #$level [list set "${name}($key)"]]} err]} {
                        set val "<error: $err>"
                    }
                    append response "\x1E${name}(${key})\x1F$val"
                }
            }
        }]} {
            # Error accessing array — return empty response
        }
    } elseif {$scope eq "global"} {
        if {[array exists ::$name]} {
            set keys [lsort [array names ::$name]]
            foreach key $keys {
                if {[catch {set val [set "::${name}($key)"]} err]} {
                    set val "<error: $err>"
                }
                append response "\x1E${name}(${key})\x1F$val"
            }
        }
    }

    ::debug::sendResponse $response
}

proc ::debug::getInspectionLevel {} {
    return $::debug::inspectionLevel
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
    set stack $::debug::scriptStack
    if {[llength $stack] == 0} {
        lappend stack [list "<main>" $::debug::currentFile $::debug::currentLine]
    }
    set response "STACK"
    foreach frame $stack {
        append response "\x1E[lindex $frame 0]\x1F[lindex $frame 1]\x1F[lindex $frame 2]"
    }
    ::debug::sendResponse $response
}

# ---- Expression Evaluation ----
# SECURITY NOTE: The EVAL command executes arbitrary TCL in the debugged
# process's context.  This is standard debugger functionality but means any
# client connected to the debug socket can run code with the same privileges
# as the debugged script.  The server only accepts connections on localhost
# (see startServer) to mitigate remote exploitation.

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

# Match normal tclsh invocation, including scripts that inspect argv0.
set argv0 [file normalize $scriptFile]
# Pass remaining args to the user script
set argv [lrange $argv 1 end]
set argc [llength $argv]

::debug::startServer $scriptFile
