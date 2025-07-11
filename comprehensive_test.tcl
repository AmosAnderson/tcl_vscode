# TCL Language Support Test File
# This file demonstrates all features of the TCL VS Code extension

# ========================================
# SYNTAX HIGHLIGHTING TESTS
# ========================================

# Comments and basic syntax
set version "1.0"
set debug_mode true
set pi 3.14159
set binary_value 0b1010
set hex_value 0xFF

# ========================================
# NAMESPACE AND PACKAGE TESTS
# ========================================

# Test namespace definition and usage
namespace eval ::myapp {
    namespace export greet calculate process_data
    
    # Namespace variables
    variable app_name "My TCL Application"
    variable version "1.0"
    
    # Test procedure with comments (for hover documentation)
    # This procedure greets a user with optional personalization
    # @param name - The name to greet (optional)
    proc greet {name} {
        global debug_mode
        variable app_name
        
        if {$name eq ""} {
            puts "Hello, stranger! Welcome to $app_name"
        } else {
            puts "Hello, $name! Welcome to $app_name"
        }
    }
    
    # Mathematical calculation procedure
    # Calculates factorial of a number recursively
    # @param n - The number to calculate factorial for
    proc factorial {n} {
        if {$n <= 1} {
            return 1
        } else {
            return [expr {$n * [factorial [expr {$n - 1}]]}]
        }
    }
    
    # String manipulation examples
    proc process_data {input_string} {
        set length [string length $input_string]
        set upper [string toupper $input_string]
        set words [split $input_string " "]
        
        puts "Original: $input_string"
        puts "Length: $length"
        puts "Uppercase: $upper"
        puts "Words: $words"
        
        return [list $length $upper $words]
    }
}

# ========================================
# CONTROL STRUCTURES TESTS
# ========================================

# Test various control structures
proc test_control_structures {} {
    # For loop
    for {set i 0} {$i < 5} {incr i} {
        puts "Count: $i"
    }
    
    # Foreach loop
    set fruits {apple banana orange grape}
    foreach fruit $fruits {
        puts "Fruit: $fruit"
    }
    
    # While loop
    set count 0
    while {$count < 3} {
        puts "While count: $count"
        incr count
    }
    
    # Switch statement
    set day "Monday"
    switch $day {
        "Monday" {
            puts "Start of work week"
        }
        "Friday" {
            puts "TGIF!"
        }
        default {
            puts "Regular day"
        }
    }
    
    # Try-catch example
    if {[catch {
        set result [expr {10 / 0}]
    } error]} {
        puts "Error caught: $error"
    }
}

# ========================================
# TK GUI TESTS
# ========================================

# Test Tk widget creation
proc createWindow {} {
    package require Tk
    
    # Create main window
    toplevel .mywindow
    wm title .mywindow "TCL Test Application"
    wm geometry .mywindow "300x200"
    
    # Create widgets
    label .mywindow.label -text "Enter a number:" -font {Arial 12}
    entry .mywindow.entry -textvariable number -width 20
    button .mywindow.button -text "Calculate Factorial!" -command {
        set result [::myapp::factorial $::number]
        tk_messageBox -message "Factorial of $::number is $result" -title "Result"
    }
    
    # Layout widgets
    pack .mywindow.label -pady 10
    pack .mywindow.entry -pady 5
    pack .mywindow.button -pady 10
    
    # Menu example
    menu .mywindow.menubar
    .mywindow configure -menu .mywindow.menubar
    
    menu .mywindow.menubar.file
    .mywindow.menubar add cascade -label "File" -menu .mywindow.menubar.file
    .mywindow.menubar.file add command -label "New" -command {puts "New file"}
    .mywindow.menubar.file add command -label "Exit" -command {destroy .mywindow}
}

# ========================================
# EXPECT AUTOMATION TESTS
# ========================================

# Test Expect commands (if available)
proc test_expect {} {
    if {[catch {package require Expect}] == 0} {
        spawn ssh user@example.com
        expect {
            "password:" {
                send "secret\r"
                exp_continue
            }
            "$ " {
                send "ls -la\r"
                expect "$ "
                send "exit\r"
            }
            timeout {
                puts "Connection timed out"
            }
        }
    } else {
        puts "Expect package not available"
    }
}

# ========================================
# ARRAY AND DICTIONARY TESTS
# ========================================

proc test_data_structures {} {
    # Array example
    array set user_info {
        name "John Doe"
        age 30
        city "New York"
        email "john@example.com"
    }
    
    puts "User name: $user_info(name)"
    puts "User age: $user_info(age)"
    
    # Dictionary example (TCL 8.5+)
    set config [dict create \
        database_host "localhost" \
        database_port 5432 \
        database_name "myapp" \
        debug_enabled true \
    ]
    
    puts "Database host: [dict get $config database_host]"
    puts "Debug enabled: [dict get $config debug_enabled]"
}

# ========================================
# FILE I/O TESTS
# ========================================

proc test_file_operations {} {
    # Write to file
    set filename "test_output.txt"
    set filehandle [open $filename "w"]
    puts $filehandle "Hello, World!"
    puts $filehandle "This is a test file."
    close $filehandle
    
    # Read from file
    set filehandle [open $filename "r"]
    while {[gets $filehandle line] != -1} {
        puts "Read: $line"
    }
    close $filehandle
    
    # File operations
    if {[file exists $filename]} {
        puts "File size: [file size $filename] bytes"
        puts "File modified: [clock format [file mtime $filename]]"
    }
}

# ========================================
# PACKAGE MANAGEMENT
# ========================================

package provide myapp 1.0

# ========================================
# MAIN EXECUTION
# ========================================

# Test all features
puts "=== TCL Language Support Test ==="
puts "Testing namespace and procedures..."
::myapp::greet "World"

puts "\nTesting calculations..."
set fact5 [::myapp::factorial 5]
puts "5! = $fact5"

puts "\nTesting string processing..."
::myapp::process_data "Hello World Test"

puts "\nTesting control structures..."
test_control_structures

puts "\nTesting data structures..."
test_data_structures

puts "\nTesting file operations..."
test_file_operations

puts "\n=== Test Complete ==="

# Variables for testing completion and hover
set local_var "test value"
global global_var
variable namespace_var "namespace value"