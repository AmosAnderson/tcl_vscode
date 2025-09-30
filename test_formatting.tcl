# Test file for formatter - intentionally poorly formatted
proc test_function { name value } {
    if { $name eq "" } {
        puts "Empty name"
        test 0
    } else {
        puts "Name: $name"
        if { $test > 100 }{
            puts "Large value"
            test 1
        } elseif { $test > 50 } {
            puts "Medium value"
            test 2
        } else {
            puts "Small value"
            test 3
        }
    }
}

namespace eval ::testns {
    variable counter 0

    proc increment {} {
        variable counter
        incr counter
        puts "Counter: $counter"
    }

    proc reset {} {
        variable counter
        set counter 0
    }
}

# More nested examples
for { set i 0 } { $i < 5 } { incr i } {
    puts "Loop $i"
    if { $i == 2 } {
        puts "Middle"
    } else {
        puts "Not middle"
    }
}

while { $x < 10 } {
    incr x
    if { $x % 2 == 0 } {
        puts "Even: $x"
    } else {
        puts "Odd: $x"
    }
}

# Procedure to search for a phone number in a string using regex
proc search_phone_number { input } {
    set pattern {\m(\d { 3 })[-]?(\d { 3 })[-]?(\d { 4 })\M}
    if { [regexp $pattern $input match area prefix line] } {
        puts "Found phone number: $match"
        test $match
    } else {
        puts "No phone number found"
        test ""
    }
}