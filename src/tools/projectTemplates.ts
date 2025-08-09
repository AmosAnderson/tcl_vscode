import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ProjectTemplate {
    name: string;
    description: string;
    id: string;
    files: TemplateFile[];
}

interface TemplateFile {
    path: string;
    content: string;
}

export class TclProjectTemplates {
    private templates: ProjectTemplate[] = [];

    constructor() {
        this.initializeTemplates();
    }

    private initializeTemplates(): void {
        this.templates = [
            this.createBasicApplicationTemplate(),
            this.createTkGuiApplicationTemplate(),
            this.createPackageTemplate(),
            this.createTestSuiteTemplate(),
            this.createWebServerTemplate()
        ];
    }

    private createBasicApplicationTemplate(): ProjectTemplate {
        return {
            id: 'basic-app',
            name: 'Basic TCL Application',
            description: 'A simple TCL application with main script and configuration',
            files: [
                {
                    path: 'main.tcl',
                    content: `#!/usr/bin/env tclsh
# Main application entry point

# Application configuration
set APP_NAME "MyApp"
set APP_VERSION "1.0.0"

# Source required files
source [file join [file dirname [info script]] lib utils.tcl]

# Main procedure
proc main {args} {
    global APP_NAME APP_VERSION
    
    puts "$APP_NAME v$APP_VERSION"
    puts "Arguments: $args"
    
    # Your application logic here
    if {[llength $args] == 0} {
        show_usage
        exit 1
    }
    
    # Process arguments
    process_arguments $args
}

proc show_usage {} {
    global APP_NAME
    puts "Usage: $APP_NAME \[options\] <arguments>"
    puts "Options:"
    puts "  -h, --help     Show this help message"
    puts "  -v, --version  Show version information"
}

proc process_arguments {args} {
    # Implement argument processing
    puts "Processing: $args"
}

# Run main if this script is executed directly
if {[info script] eq $::argv0} {
    main {*}$::argv
}
`
                },
                {
                    path: 'lib/utils.tcl',
                    content: `# Utility procedures

namespace eval ::utils {
    namespace export *
    
    # Logger procedure
    proc log {level message} {
        set timestamp [clock format [clock seconds] -format "%Y-%m-%d %H:%M:%S"]
        puts stderr "\[$timestamp\] \[$level\] $message"
    }
    
    # File operations
    proc read_file {filename} {
        set fp [open $filename r]
        set content [read $fp]
        close $fp
        return $content
    }
    
    proc write_file {filename content} {
        set fp [open $filename w]
        puts -nonewline $fp $content
        close $fp
    }
}
`
                },
                {
                    path: 'config/app.conf',
                    content: `# Application configuration file

# General settings
app.name = MyApp
app.version = 1.0.0
app.debug = false

# Logging
log.level = info
log.file = app.log

# Add your configuration parameters here
`
                },
                {
                    path: '.gitignore',
                    content: `*.log
*.tmp
*.bak
*~
.DS_Store
`
                },
                {
                    path: 'README.md',
                    content: `# MyApp

A TCL application created with VS Code TCL extension.

## Requirements

- TCL 8.5 or higher

## Installation

\`\`\`bash
git clone <repository>
cd myapp
\`\`\`

## Usage

\`\`\`bash
tclsh main.tcl [options] <arguments>
\`\`\`

## Development

This project was created using the VS Code TCL extension.

## License

MIT License. See LICENSE for details.
`
                }
            ]
        };
    }

    private createTkGuiApplicationTemplate(): ProjectTemplate {
        return {
            id: 'tk-gui',
            name: 'Tk GUI Application',
            description: 'A TCL/Tk graphical user interface application',
            files: [
                {
                    path: 'main.tcl',
                    content: `#!/usr/bin/env wish
# Tk GUI Application

package require Tk

# Application metadata
set APP_NAME "MyTkApp"
set APP_VERSION "1.0.0"

# Source GUI components
source [file join [file dirname [info script]] gui mainwindow.tcl]
source [file join [file dirname [info script]] gui dialogs.tcl]

# Initialize application
proc init_app {} {
    global APP_NAME
    
    # Set window title
    wm title . $APP_NAME
    wm geometry . 800x600
    
    # Create main window
    create_main_window .
    
    # Center window on screen
    center_window .
}

proc center_window {w} {
    update idletasks
    set x [expr {([winfo screenwidth $w] - [winfo width $w]) / 2}]
    set y [expr {([winfo screenheight $w] - [winfo height $w]) / 2}]
    wm geometry $w +$x+$y
}

# Start application
init_app
`
                },
                {
                    path: 'gui/mainwindow.tcl',
                    content: `# Main window GUI components

proc create_main_window {parent} {
    # Create menu bar
    create_menubar $parent
    
    # Create toolbar
    create_toolbar $parent
    
    # Create main content area
    create_content_area $parent
    
    # Create status bar
    create_statusbar $parent
}

proc create_menubar {parent} {
    menu $parent.menubar
    $parent configure -menu $parent.menubar
    
    # File menu
    menu $parent.menubar.file -tearoff 0
    $parent.menubar add cascade -label "File" -menu $parent.menubar.file
    $parent.menubar.file add command -label "New" -command file_new
    $parent.menubar.file add command -label "Open..." -command file_open
    $parent.menubar.file add command -label "Save" -command file_save
    $parent.menubar.file add separator
    $parent.menubar.file add command -label "Exit" -command exit
    
    # Edit menu
    menu $parent.menubar.edit -tearoff 0
    $parent.menubar add cascade -label "Edit" -menu $parent.menubar.edit
    $parent.menubar.edit add command -label "Cut" -command edit_cut
    $parent.menubar.edit add command -label "Copy" -command edit_copy
    $parent.menubar.edit add command -label "Paste" -command edit_paste
    
    # Help menu
    menu $parent.menubar.help -tearoff 0
    $parent.menubar add cascade -label "Help" -menu $parent.menubar.help
    $parent.menubar.help add command -label "About" -command show_about
}

proc create_toolbar {parent} {
    frame $parent.toolbar -relief raised -bd 1
    pack $parent.toolbar -side top -fill x
    
    button $parent.toolbar.new -text "New" -command file_new
    button $parent.toolbar.open -text "Open" -command file_open
    button $parent.toolbar.save -text "Save" -command file_save
    
    pack $parent.toolbar.new $parent.toolbar.open $parent.toolbar.save -side left -padx 2
}

proc create_content_area {parent} {
    # Create a text widget with scrollbar
    frame $parent.content
    pack $parent.content -side top -fill both -expand 1
    
    text $parent.content.text -wrap word -yscrollcommand "$parent.content.scroll set"
    scrollbar $parent.content.scroll -command "$parent.content.text yview"
    
    pack $parent.content.scroll -side right -fill y
    pack $parent.content.text -side left -fill both -expand 1
}

proc create_statusbar {parent} {
    frame $parent.status -relief sunken -bd 1
    pack $parent.status -side bottom -fill x
    
    label $parent.status.label -text "Ready" -anchor w
    pack $parent.status.label -side left -fill x -expand 1
}

# File operations
proc file_new {} {
    .content.text delete 1.0 end
    .status.label configure -text "New file created"
}

proc file_open {} {
    set filename [tk_getOpenFile -title "Open File"]
    if {$filename ne ""} {
        set fp [open $filename r]
        set content [read $fp]
        close $fp
        
        .content.text delete 1.0 end
        .content.text insert 1.0 $content
        .status.label configure -text "Opened: $filename"
    }
}

proc file_save {} {
    set filename [tk_getSaveFile -title "Save File"]
    if {$filename ne ""} {
        set content [.content.text get 1.0 end-1c]
        set fp [open $filename w]
        puts -nonewline $fp $content
        close $fp
        .status.label configure -text "Saved: $filename"
    }
}

# Edit operations
proc edit_cut {} {
    event generate .content.text <<Cut>>
}

proc edit_copy {} {
    event generate .content.text <<Copy>>
}

proc edit_paste {} {
    event generate .content.text <<Paste>>
}
`
                },
                {
                    path: 'gui/dialogs.tcl',
                    content: `# Dialog procedures

proc show_about {} {
    global APP_NAME APP_VERSION
    
    tk_messageBox -title "About" \\
        -message "$APP_NAME\\nVersion $APP_VERSION\\n\\nA TCL/Tk Application" \\
        -type ok -icon info
}

proc confirm_dialog {title message} {
    return [tk_messageBox -title $title \\
        -message $message \\
        -type yesno -icon question]
}

proc error_dialog {message} {
    tk_messageBox -title "Error" \\
        -message $message \\
        -type ok -icon error
}

proc info_dialog {title message} {
    tk_messageBox -title $title \\
        -message $message \\
        -type ok -icon info
}
`
                }
            ]
        };
    }

    private createPackageTemplate(): ProjectTemplate {
        return {
            id: 'package',
            name: 'TCL Package',
            description: 'A reusable TCL package with proper structure',
            files: [
                {
                    path: 'Package.tcl',
                    content: `# Package definition file
name mypackage
version 1.0.0
description A reusable TCL package

# Dependencies
# require somepackage 1.0

# Source files
source [file join [file dirname [info script]] src main.tcl]
source [file join [file dirname [info script]] src utils.tcl]

# Package initialization
package provide mypackage 1.0.0
`
                },
                {
                    path: 'pkgIndex.tcl',
                    content: `# Package index file
package ifneeded mypackage 1.0.0 [list source [file join $dir src main.tcl]]
`
                },
                {
                    path: 'src/main.tcl',
                    content: `# Main package implementation

namespace eval ::mypackage {
    namespace export *
    variable version "1.0.0"
    
    # Public API
    proc hello {name} {
        return "Hello, $name from mypackage!"
    }
    
    proc process {data} {
        # Process data
        variable version
        return "Processed by mypackage v$version: $data"
    }
}

# Source additional modules
source [file join [file dirname [info script]] utils.tcl]
`
                },
                {
                    path: 'src/utils.tcl',
                    content: `# Utility procedures for the package

namespace eval ::mypackage::utils {
    namespace export *
    
    proc format_date {timestamp} {
        return [clock format $timestamp -format "%Y-%m-%d %H:%M:%S"]
    }
    
    proc validate_input {input pattern} {
        return [regexp $pattern $input]
    }
}
`
                },
                {
                    path: 'tests/test_mypackage.tcl',
                    content: `#!/usr/bin/env tclsh
# Test suite for mypackage

package require tcltest

# Add package directory to auto_path
lappend auto_path [file dirname [file dirname [info script]]]
package require mypackage

namespace eval ::mypackage::test {
    namespace import ::tcltest::*
    
    test hello-1.0 {Test hello procedure} {
        ::mypackage::hello "World"
    } "Hello, World from mypackage!"
    
    test process-1.0 {Test process procedure} {
        set result [::mypackage::process "test data"]
        string match "Processed by mypackage v*: test data" $result
    } 1
    
    test utils-format_date-1.0 {Test date formatting} {
        set timestamp 1234567890
        set result [::mypackage::utils::format_date $timestamp]
        expr {[string length $result] > 0}
    } 1
    
    # Run tests
    runAllTests
}
`
                },
                {
                    path: 'README.md',
                    content: `# mypackage

A reusable TCL package.

## Installation

Add the package directory to your TCL auto_path:

\`\`\`tcl
lappend auto_path /path/to/mypackage
package require mypackage
\`\`\`

## Usage

\`\`\`tcl
package require mypackage

# Use the package
puts [mypackage::hello "World"]
puts [mypackage::process "some data"]
\`\`\`

## Testing

Run the test suite:

\`\`\`bash
tclsh tests/test_mypackage.tcl
\`\`\`

## API Documentation

### mypackage::hello name
Returns a greeting message.

### mypackage::process data
Processes the input data and returns the result.

## License

MIT License. See LICENSE for details.
`
                }
            ]
        };
    }

    private createTestSuiteTemplate(): ProjectTemplate {
        return {
            id: 'test-suite',
            name: 'Test Suite',
            description: 'A comprehensive test suite using tcltest',
            files: [
                {
                    path: 'run_tests.tcl',
                    content: `#!/usr/bin/env tclsh
# Test runner script

package require tcltest

# Configure test options
::tcltest::configure -verbose {pass fail error}
::tcltest::configure -singleproc 1

# Add source directory to auto_path
lappend auto_path [file join [file dirname [info script]] src]

# Source all test files
foreach testFile [glob -nocomplain [file join tests *.test]] {
    source $testFile
}

# Run all tests
::tcltest::runAllTests

# Exit with appropriate code
exit [expr {$::tcltest::numTests(Failed) > 0}]
`
                },
                {
                    path: 'tests/example.test',
                    content: `# Example test file

package require tcltest
namespace import ::tcltest::*

# Test fixtures
proc setup {} {
    # Setup code here
    variable testData "test value"
}

proc cleanup {} {
    # Cleanup code here
    variable testData
    unset -nocomplain testData
}

# Test cases
test example-1.0 {Basic test} -setup {
    setup
} -body {
    variable testData
    return $testData
} -cleanup {
    cleanup
} -result "test value"

test example-2.0 {Test with constraints} -constraints {
    unix
} -body {
    # This test only runs on Unix systems
    file exists /etc/passwd
} -result 1

test example-3.0 {Test expecting error} -body {
    error "This is an error"
} -returnCodes error -result "This is an error"

test example-4.0 {Test with match} -body {
    return "The answer is 42"
} -match glob -result "The answer is *"

# Run tests in this namespace
cleanupTests
`
                },
                {
                    path: 'tests/test_helpers.tcl',
                    content: `# Test helper procedures

namespace eval ::test::helpers {
    namespace export *
    
    # Create a temporary file for testing
    proc make_temp_file {content} {
        set filename [file join [::tcltest::temporaryDirectory] \\
            "test_[clock seconds]_[expr {int(rand() * 10000)}].tmp"]
        set fp [open $filename w]
        puts -nonewline $fp $content
        close $fp
        return $filename
    }
    
    # Compare two lists ignoring order
    proc lists_equal {list1 list2} {
        if {[llength $list1] != [llength $list2]} {
            return 0
        }
        foreach item $list1 {
            if {[lsearch -exact $list2 $item] == -1} {
                return 0
            }
        }
        return 1
    }
    
    # Capture output from a command
    proc capture_output {script} {
        set output ""
        set savedStdout [dup stdout]
        
        try {
            set temp [::tcltest::makeFile "" capture.tmp]
            set fp [open $temp w]
            dup2 $fp stdout
            close $fp
            
            uplevel 1 $script
            
            set fp [open $temp r]
            set output [read $fp]
            close $fp
            file delete $temp
        } finally {
            dup2 $savedStdout stdout
        }
        
        return $output
    }
}
`
                }
            ]
        };
    }

    private createWebServerTemplate(): ProjectTemplate {
        return {
            id: 'web-server',
            name: 'Web Server',
            description: 'A simple HTTP web server in TCL',
            files: [
                {
                    path: 'server.tcl',
                    content: `#!/usr/bin/env tclsh
# Simple HTTP Web Server

set PORT 8080
set DOCUMENT_ROOT [file join [pwd] public]

# HTTP response codes
array set HTTP_STATUS {
    200 "OK"
    404 "Not Found"
    500 "Internal Server Error"
}

# MIME types
array set MIME_TYPES {
    .html "text/html"
    .css  "text/css"
    .js   "application/javascript"
    .json "application/json"
    .png  "image/png"
    .jpg  "image/jpeg"
    .gif  "image/gif"
    .txt  "text/plain"
}

# Start server
proc start_server {port} {
    set server [socket -server handle_connection $port]
    puts "Server listening on port $port"
    puts "Document root: $::DOCUMENT_ROOT"
    puts "Press Ctrl+C to stop"
    vwait forever
}

# Handle incoming connections
proc handle_connection {client addr port} {
    puts "Connection from $addr:$port"
    
    # Read request
    set request [gets $client]
    if {[eof $client]} {
        close $client
        return
    }
    
    # Parse request
    if {[regexp {^(GET|POST)\\s+([^\\s]+)\\s+HTTP} $request -> method path]} {
        puts "Request: $method $path"
        
        # Read headers
        set headers [dict create]
        while {[gets $client line] > 0} {
            if {[regexp {^([^:]+):\\s*(.+)$} $line -> key value]} {
                dict set headers [string tolower $key] $value
            }
        }
        
        # Handle request
        switch $method {
            GET {
                handle_get $client $path $headers
            }
            POST {
                handle_post $client $path $headers
            }
            default {
                send_error $client 501 "Not Implemented"
            }
        }
    } else {
        send_error $client 400 "Bad Request"
    }
    
    close $client
}

# Handle GET requests
proc handle_get {client path headers} {
    global DOCUMENT_ROOT MIME_TYPES
    
    # Remove query string
    set path [lindex [split $path "?"] 0]
    
    # Default to index.html
    if {$path eq "/" || $path eq ""} {
        set path "/index.html"
    }
    
    # Security: prevent directory traversal
    set path [string map {.. ""} $path]
    set filepath [file join $DOCUMENT_ROOT [string trimleft $path "/"]]
    
    if {[file exists $filepath] && [file isfile $filepath]} {
        # Determine content type
        set ext [file extension $filepath]
        set content_type "application/octet-stream"
        if {[info exists MIME_TYPES($ext)]} {
            set content_type $MIME_TYPES($ext)
        }
        
        # Send file
        send_file $client $filepath $content_type
    } else {
        send_error $client 404 "File not found: $path"
    }
}

# Handle POST requests
proc handle_post {client path headers} {
    # Read body if Content-Length is provided
    set body ""
    if {[dict exists $headers content-length]} {
        set length [dict get $headers content-length]
        set body [read $client $length]
    }
    
    # Simple echo endpoint
    if {$path eq "/api/echo"} {
        send_response $client 200 "application/json" \\
            [format {{"received": %s}} [json_escape $body]]
    } else {
        send_error $client 404 "Endpoint not found"
    }
}

# Send file response
proc send_file {client filepath content_type} {
    set fp [open $filepath rb]
    set content [read $fp]
    close $fp
    
    send_response $client 200 $content_type $content
}

# Send HTTP response
proc send_response {client status content_type body} {
    global HTTP_STATUS
    
    puts $client "HTTP/1.1 $status $HTTP_STATUS($status)"
    puts $client "Content-Type: $content_type"
    puts $client "Content-Length: [string length $body]"
    puts $client "Connection: close"
    puts $client ""
    puts -nonewline $client $body
}

# Send error response
proc send_error {client status message} {
    set body "<html><body><h1>Error $status</h1><p>$message</p></body></html>"
    send_response $client $status "text/html" $body
}

# JSON escape helper
proc json_escape {str} {
    string map {\\ \\\\ \" \\\" \\n \\\\n \\r \\\\r \\t \\\\t} $str
}

# Create document root if it doesn't exist
if {![file exists $DOCUMENT_ROOT]} {
    file mkdir $DOCUMENT_ROOT
}

# Create default index.html if it doesn't exist
set index_file [file join $DOCUMENT_ROOT index.html]
if {![file exists $index_file]} {
    set fp [open $index_file w]
    puts $fp {<!DOCTYPE html>
<html>
<head>
    <title>TCL Web Server</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>Welcome to TCL Web Server</h1>
    <p>This server is running on TCL!</p>
    <p>Server time: <span id="time"></span></p>
    <script>
        document.getElementById('time').textContent = new Date().toLocaleString();
    </script>
</body>
</html>}
    close $fp
}

# Start the server
start_server $PORT
`
                },
                {
                    path: 'public/.gitkeep',
                    content: ''
                }
            ]
        };
    }

    public getTemplates(): ProjectTemplate[] {
        return this.templates;
    }

    public async createProject(templateId: string, projectPath: string): Promise<void> {
        const template = this.templates.find(t => t.id === templateId);
        if (!template) {
            throw new Error(`Template ${templateId} not found`);
        }

        // Create project directory
        await fs.promises.mkdir(projectPath, { recursive: true });

        // Create all template files
        for (const file of template.files) {
            const filePath = path.join(projectPath, file.path);
            const dir = path.dirname(filePath);
            
            // Create directory if needed
            await fs.promises.mkdir(dir, { recursive: true });
            
            // Write file
            await fs.promises.writeFile(filePath, file.content);
        }
    }

    public async showProjectWizard(): Promise<void> {
        // Select template
        const templateItems = this.templates.map(t => ({
            label: t.name,
            description: t.description,
            id: t.id
        }));

        const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
            placeHolder: 'Select a project template'
        });

        if (!selectedTemplate) return;

        // Select location
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        });

        if (!folderUri || folderUri.length === 0) return;

        // Get project name
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name',
            value: 'my-tcl-project',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Project name cannot be empty';
                }
                if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
                    return 'Project name can only contain letters, numbers, hyphens and underscores';
                }
                return null;
            }
        });

        if (!projectName) return;

        // Create project
        const projectPath = path.join(folderUri[0].fsPath, projectName);
        
        try {
            await this.createProject(selectedTemplate.id, projectPath);
            
            // Open project in new window
            const openInNewWindow = await vscode.window.showInformationMessage(
                `Project '${projectName}' created successfully!`,
                'Open in New Window',
                'Open Here'
            );

            if (openInNewWindow === 'Open in New Window') {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), true);
            } else if (openInNewWindow === 'Open Here') {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), false);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create project: ${error}`);
        }
    }
}