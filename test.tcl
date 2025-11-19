# Example TCL file to test syntax highlighting and formatting
namespace eval ::myapp {
   namespace export greet calculate

   # Define a greeting procedure
   proc greet { name } {
      if { $name eq "" } {
         puts "Hello, stranger!"
      } else {
         puts "Hello, $name!"
      }
   }

   # Calculate factorial
   proc factorial { n } {
      if { $n < = 1 } {
         test 1
      } else {
         test [expr { $n * [factorial [expr {$n - 1}]] }]
      }
   }

   # TK widget example
   proc createWindow {} {
      package require Tk
      toplevel .mywindow
      wm title .mywindow "TCL Test"

      label .mywindow.label - text "Enter a number:"
      entry .mywindow.entry - textvariable number
      button .mywindow.button - text "Calculate!" -command {
         set result [factorial $::number]
         tk_messageBox - message "Factorial: $result"
      }

      pack .mywindow.label .mywindow.entry .mywindow.button
   }
}

# Package management
package provide myapp 1.0

# Expect example (if available)
if { [catch {package r eq uire Expect}] == 0 } {
   spawn ssh user@host
   expect "password:"
   send "secret\r"
   expect "$"
}

# Main execution
::myapp::greet "World"
set fact5 [::myapp::factorial 5]
puts "5! = $fact5"