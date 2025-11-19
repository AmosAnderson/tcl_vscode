export interface TclCommand {
    name: string;
    signature: string;
    description: string;
    category: string;
}

const BASE_TCL_COMMANDS: TclCommand[] = [
    // String manipulation
    { name: 'append', signature: 'append varName ?value value value ...?', description: 'Append to variable', category: 'string' },
    { name: 'string', signature: 'string option arg ?arg ...?', description: 'Manipulate strings', category: 'string' },
    { name: 'format', signature: 'format formatString ?arg arg ...?', description: 'Format a string in the style of sprintf', category: 'string' },
    { name: 'scan', signature: 'scan string format ?varName varName ...?', description: 'Parse string using conversion specifiers', category: 'string' },
    { name: 'split', signature: 'split string ?splitChars?', description: 'Split a string into a list', category: 'string' },
    { name: 'join', signature: 'join list ?joinString?', description: 'Create string by joining list elements', category: 'string' },
    { name: 'regexp', signature: 'regexp ?options? exp string ?matchVar? ?subMatchVar ...?', description: 'Match regular expression', category: 'string' },
    { name: 'regsub', signature: 'regsub ?options? exp string subSpec ?varName?', description: 'Perform substitution based on regular expression', category: 'string' },
    
    // List manipulation
    { name: 'list', signature: 'list ?arg arg ...?', description: 'Create a list', category: 'list' },
    { name: 'lindex', signature: 'lindex list ?index ...?', description: 'Retrieve element from list', category: 'list' },
    { name: 'linsert', signature: 'linsert list index element ?element ...?', description: 'Insert elements into list', category: 'list' },
    { name: 'llength', signature: 'llength list', description: 'Count elements in list', category: 'list' },
    { name: 'lappend', signature: 'lappend varName ?value value value ...?', description: 'Append to list variable', category: 'list' },
    { name: 'lrange', signature: 'lrange list first last', description: 'Return range of elements from list', category: 'list' },
    { name: 'lreplace', signature: 'lreplace list first last ?element element ...?', description: 'Replace elements in list', category: 'list' },
    { name: 'lsearch', signature: 'lsearch ?options? list pattern', description: 'Search list for matching elements', category: 'list' },
    { name: 'lsort', signature: 'lsort ?options? list', description: 'Sort elements of list', category: 'list' },
    { name: 'lset', signature: 'lset varName ?index ...? newValue', description: 'Set element in list', category: 'list' },
    
    // Control flow
    { name: 'if', signature: 'if expr1 ?then? body1 elseif expr2 ?then? body2 elseif ... ?else? ?bodyN?', description: 'Execute scripts conditionally', category: 'control' },
    { name: 'for', signature: 'for start test next body', description: 'For loop', category: 'control' },
    { name: 'foreach', signature: 'foreach varname list body', description: 'Iterate over elements in list', category: 'control' },
    { name: 'while', signature: 'while test body', description: 'Execute script repeatedly while condition is true', category: 'control' },
    { name: 'switch', signature: 'switch ?options? string pattern body ?pattern body ...?', description: 'Evaluate one of several scripts', category: 'control' },
    { name: 'break', signature: 'break', description: 'Abort looping command', category: 'control' },
    { name: 'continue', signature: 'continue', description: 'Skip to next iteration of loop', category: 'control' },
    { name: 'return', signature: 'return ?-code code? ?-errorinfo info? ?-errorcode errorcode? ?value?', description: 'Return from procedure', category: 'control' },
    { name: 'catch', signature: 'catch script ?resultVarName? ?optionsVarName?', description: 'Evaluate script and trap errors', category: 'control' },
    { name: 'error', signature: 'error message ?info? ?code?', description: 'Generate an error', category: 'control' },
    
    // File I/O
    { name: 'open', signature: 'open fileName ?access? ?permissions?', description: 'Open file channel', category: 'file' },
    { name: 'close', signature: 'close channelId', description: 'Close channel', category: 'file' },
    { name: 'puts', signature: 'puts ?-nonewline? ?channelId? string', description: 'Write to channel', category: 'file' },
    { name: 'gets', signature: 'gets channelId ?varName?', description: 'Read line from channel', category: 'file' },
    { name: 'read', signature: 'read ?-nonewline? channelId ?numChars?', description: 'Read from channel', category: 'file' },
    { name: 'seek', signature: 'seek channelId offset ?origin?', description: 'Change access position for channel', category: 'file' },
    { name: 'tell', signature: 'tell channelId', description: 'Return current access position', category: 'file' },
    { name: 'eof', signature: 'eof channelId', description: 'Check for end of file', category: 'file' },
    { name: 'flush', signature: 'flush channelId', description: 'Flush buffered output', category: 'file' },
    { name: 'file', signature: 'file option name ?arg arg ...?', description: 'Manipulate file names and attributes', category: 'file' },
    { name: 'glob', signature: 'glob ?options? pattern ?pattern ...?', description: 'Return names matching patterns', category: 'file' },
    
    // Variables and procedures
    { name: 'set', signature: 'set varName ?newValue?', description: 'Read and write variables', category: 'variable' },
    { name: 'unset', signature: 'unset ?-nocomplain? ?--? ?name name name ...?', description: 'Delete variables', category: 'variable' },
    { name: 'upvar', signature: 'upvar ?level? otherVar myVar ?otherVar myVar ...?', description: 'Create link to variable in different stack frame', category: 'variable' },
    { name: 'global', signature: 'global varname ?varname ...?', description: 'Access global variables', category: 'variable' },
    { name: 'variable', signature: 'variable ?name value ...? name ?value?', description: 'Create and initialize namespace variable', category: 'variable' },
    { name: 'proc', signature: 'proc name args body', description: 'Create a procedure', category: 'procedure' },
    { name: 'rename', signature: 'rename oldName newName', description: 'Rename or delete command', category: 'procedure' },
    
    // Arrays and dictionaries
    { name: 'array', signature: 'array option arrayName ?arg arg ...?', description: 'Manipulate array variables', category: 'array' },
    { name: 'dict', signature: 'dict option ?arg arg ...?', description: 'Manipulate dictionaries', category: 'dict' },
    
    // Math and expressions
    { name: 'expr', signature: 'expr arg ?arg arg ...?', description: 'Evaluate an expression', category: 'math' },
    { name: 'incr', signature: 'incr varName ?increment?', description: 'Increment value of variable', category: 'math' },
    
    // System interaction
    { name: 'exec', signature: 'exec ?options? arg ?arg ...?', description: 'Invoke subprocesses', category: 'system' },
    { name: 'exit', signature: 'exit ?returnCode?', description: 'End the application', category: 'system' },
    { name: 'pid', signature: 'pid ?fileId?', description: 'Retrieve process identifiers', category: 'system' },
    { name: 'pwd', signature: 'pwd', description: 'Return current working directory', category: 'system' },
    { name: 'cd', signature: 'cd ?dirName?', description: 'Change working directory', category: 'system' },
    { name: 'clock', signature: 'clock option ?arg arg ...?', description: 'Time and date manipulation', category: 'system' },
    { name: 'time', signature: 'time script ?count?', description: 'Time execution of script', category: 'system' },
    
    // Interpreter and execution
    { name: 'eval', signature: 'eval arg ?arg ...?', description: 'Evaluate TCL script', category: 'interpreter' },
    { name: 'source', signature: 'source fileName', description: 'Evaluate file as TCL script', category: 'interpreter' },
    { name: 'info', signature: 'info option ?arg arg ...?', description: 'Return information about TCL interpreter', category: 'interpreter' },
    { name: 'interp', signature: 'interp option ?arg arg ...?', description: 'Create and manipulate interpreters', category: 'interpreter' },
    { name: 'namespace', signature: 'namespace subcommand ?arg ...?', description: 'Create and manipulate contexts for commands and variables', category: 'interpreter' },
    { name: 'package', signature: 'package option ?arg arg ...?', description: 'Facilities for package loading', category: 'interpreter' },
    { name: 'load', signature: 'load fileName ?packageName? ?interp?', description: 'Load machine code and initialize package', category: 'interpreter' },
    { name: 'unload', signature: 'unload ?options? fileName ?packageName? ?interp?', description: 'Unload machine code', category: 'interpreter' },
    
    // Other commands
    { name: 'after', signature: 'after ms ?script script ...?', description: 'Execute command after time delay', category: 'event' },
    { name: 'update', signature: 'update ?idletasks?', description: 'Process pending events', category: 'event' },
    { name: 'vwait', signature: 'vwait varName', description: 'Process events until variable is written', category: 'event' },
    { name: 'binary', signature: 'binary option ?arg arg ...?', description: 'Insert and manipulate binary data', category: 'binary' },
    { name: 'encoding', signature: 'encoding option ?arg arg ...?', description: 'Manipulate encodings', category: 'encoding' },
    { name: 'subst', signature: 'subst ?options? string', description: 'Perform backslash, command, and variable substitutions', category: 'string' },
    { name: 'uplevel', signature: 'uplevel ?level? arg ?arg ...?', description: 'Execute script in different stack frame', category: 'control' },
    { name: 'concat', signature: 'concat ?arg arg ...?', description: 'Join lists together', category: 'list' },
    { name: 'history', signature: 'history ?option? ?arg arg ...?', description: 'Manipulate command history list', category: 'interpreter' },
    { name: 'trace', signature: 'trace option ?arg arg ...?', description: 'Monitor variable accesses', category: 'debug' },
    { name: 'unknown', signature: 'unknown cmdName ?arg arg ...?', description: 'Handle unknown commands', category: 'interpreter' }
];

const ADDITIONAL_TCL_COMMANDS: TclCommand[] = [
    { name: 'apply', signature: 'apply {lambda ?arg ...?}', description: 'Invoke a lambda term', category: 'functional' },
    { name: 'auto_execok', signature: 'auto_execok command', description: 'Check if a command runs without invoking auto-load', category: 'interpreter' },
    { name: 'auto_import', signature: 'auto_import pattern', description: 'Control namespace auto-import behavior', category: 'interpreter' },
    { name: 'auto_load', signature: 'auto_load command ?namespace?', description: 'Automatically load Tcl procedures as needed', category: 'interpreter' },
    { name: 'auto_mkindex', signature: 'auto_mkindex dir pattern ?pattern ...?', description: 'Create index files for auto-loading', category: 'interpreter' },
    { name: 'auto_qualify', signature: 'auto_qualify command namespace', description: 'Resolve command names during auto-loading', category: 'interpreter' },
    { name: 'bgerror', signature: 'bgerror message', description: 'Handle background errors from the event loop', category: 'debug' },
    { name: 'chan', signature: 'chan subcommand ?arg ...?', description: 'Operate on channels (aliases, events, copying)', category: 'channel' },
    { name: 'clock format', signature: 'clock format time ?-format string? ?-timezone zone?', description: 'Format times with strftime-style specifiers', category: 'system' },
    { name: 'clock scan', signature: 'clock scan string ?options?', description: 'Parse textual time descriptions', category: 'system' },
    { name: 'close', signature: 'close channelId ?readOrWrite?', description: 'Close an open channel with optional flush control', category: 'file' },
    { name: 'coroutine', signature: 'coroutine name command ?arg ...?', description: 'Create or resume coroutines', category: 'control' },
    { name: 'dde', signature: 'dde option ?arg ...?', description: 'Windows Dynamic Data Exchange interface', category: 'system' },
    { name: 'dict create', signature: 'dict create ?key value ...?', description: 'Construct a dictionary from key-value pairs', category: 'dict' },
    { name: 'dict exists', signature: 'dict exists dictionary key ?key ...?', description: 'Test for key existence in dictionaries', category: 'dict' },
    { name: 'dict filter', signature: 'dict filter dictionary filterType arg ?arg ...?', description: 'Filter dictionary entries by pattern or script', category: 'dict' },
    { name: 'dict for', signature: 'dict for {keyVar valueVar} dictionary body', description: 'Iterate over dictionary entries', category: 'dict' },
    { name: 'dict get', signature: 'dict get dictionary key ?key ...?', description: 'Retrieve dictionary values by key path', category: 'dict' },
    { name: 'dict merge', signature: 'dict merge ?dict ...?', description: 'Merge dictionaries with later keys winning', category: 'dict' },
    { name: 'dict remove', signature: 'dict remove dictionary key ?key ...?', description: 'Remove keys from a dictionary', category: 'dict' },
    { name: 'dict set', signature: 'dict set dictionaryVar key ?key ...? value', description: 'Set dictionary values via variable', category: 'dict' },
    { name: 'dict update', signature: 'dict update dictionaryVar key varName ?key varName ...? script', description: 'Update dictionary values within a script', category: 'dict' },
    { name: 'dict values', signature: 'dict values dictionary ?pattern?', description: 'Return dictionary values optionally filtered by pattern', category: 'dict' },
    { name: 'encoding convertfrom', signature: 'encoding convertfrom ?encoding? data', description: 'Convert byte strings from an encoding to UTF-8', category: 'encoding' },
    { name: 'encoding convertto', signature: 'encoding convertto ?encoding? data', description: 'Convert strings to specific encodings', category: 'encoding' },
    { name: 'fblocked', signature: 'fblocked channelId', description: 'Check if a channel read has been blocked', category: 'file' },
    { name: 'fconfigure', signature: 'fconfigure channelId ?option? ?value option value ...?', description: 'Set or query channel options', category: 'file' },
    { name: 'fcopy', signature: 'fcopy input output ?-size size? ?-command callback?', description: 'Copy data between channels asynchronously', category: 'file' },
    { name: 'file copy', signature: 'file copy ?-force? source dest', description: 'Copy files or directories', category: 'file' },
    { name: 'file delete', signature: 'file delete ?-force? path ?path ...?', description: 'Delete files or directories', category: 'file' },
    { name: 'file mkdir', signature: 'file mkdir dir ?dir ...?', description: 'Create directories and parents', category: 'file' },
    { name: 'file rename', signature: 'file rename ?-force? source dest ?source dest ...?', description: 'Rename or move files', category: 'file' },
    { name: 'fileevent', signature: 'fileevent channelId event script', description: 'Bind scripts to channel readable/writable events', category: 'event' },
    { name: 'format clock', signature: 'format clock time ?format?', description: 'Alias for clock format (compatibility)', category: 'system' },
    { name: 'glob -directory', signature: 'glob -directory dir pattern ?pattern ...?', description: 'Glob patterns relative to a directory', category: 'file' },
    { name: 'history add', signature: 'history add command ?exec?', description: 'Add commands to the interactive history', category: 'interpreter' },
    { name: 'history event', signature: 'history event ?eventSpec?', description: 'Retrieve events from history', category: 'interpreter' },
    { name: 'info args', signature: 'info args procname', description: 'List arguments for a procedure', category: 'interpreter' },
    { name: 'info body', signature: 'info body procname', description: 'Return the body of a procedure', category: 'interpreter' },
    { name: 'info commands', signature: 'info commands ?pattern?', description: 'List currently defined commands', category: 'interpreter' },
    { name: 'info exists', signature: 'info exists varName', description: 'Test if a variable exists', category: 'interpreter' },
    { name: 'info globals', signature: 'info globals ?pattern?', description: 'List global variables matching a pattern', category: 'interpreter' },
    { name: 'info locals', signature: 'info locals ?pattern?', description: 'List local variables in the current stack frame', category: 'interpreter' },
    { name: 'info procs', signature: 'info procs ?pattern?', description: 'List procedure names matching a pattern', category: 'interpreter' },
    { name: 'interp alias', signature: 'interp alias slaveCmd masterCmd target ?arg ...?', description: 'Create or query aliases between interpreters', category: 'interpreter' },
    { name: 'interp eval', signature: 'interp eval slave script', description: 'Evaluate a script in another interpreter', category: 'interpreter' },
    { name: 'interp expose', signature: 'interp expose slave hiddenCommand', description: 'Expose hidden commands in interpreters', category: 'interpreter' },
    { name: 'interp hide', signature: 'interp hide slave command', description: 'Hide commands within an interpreter', category: 'interpreter' },
    { name: 'join -noclump', signature: 'join list ?joinString? -noclump', description: 'Join list elements without collapsing empty elements', category: 'list' },
    { name: 'lassign', signature: 'lassign list ?varName ...?', description: 'Assign list items to variables', category: 'list' },
    { name: 'lcontains', signature: 'lcontains list element', description: 'Check if list contains an element', category: 'list' },
    { name: 'lcount', signature: 'lcount list element', description: 'Count element occurrences in a list', category: 'list' },
    { name: 'lfilter', signature: 'lfilter list script', description: 'Filter list elements by script evaluation', category: 'list' },
    { name: 'lflatten', signature: 'lflatten list ?level?', description: 'Flatten nested lists', category: 'list' },
    { name: 'lmap', signature: 'lmap varName list body', description: 'Map a script over list elements', category: 'list' },
    { name: 'lrange -stride', signature: 'lrange list first last ?stride?', description: 'Return list elements with an optional stride', category: 'list' },
    { name: 'lrepeat', signature: 'lrepeat count element ?element ...?', description: 'Build a list by repeating elements', category: 'list' },
    { name: 'lreverse', signature: 'lreverse list', description: 'Reverse list order', category: 'list' },
    { name: 'lshuffle', signature: 'lshuffle list', description: 'Randomly shuffle list elements', category: 'list' },
    { name: 'lsort -dictionary', signature: 'lsort -dictionary list', description: 'Dictionary-style list sorting', category: 'list' },
    { name: 'lsort -integer', signature: 'lsort -integer list', description: 'Integer comparison list sorting', category: 'list' },
    { name: 'namespace children', signature: 'namespace children ?namespace? ?pattern?', description: 'List child namespaces', category: 'interpreter' },
    { name: 'namespace current', signature: 'namespace current', description: 'Return the current namespace', category: 'interpreter' },
    { name: 'namespace eval', signature: 'namespace eval namespace script', description: 'Evaluate a script within a namespace', category: 'interpreter' },
    { name: 'namespace export', signature: 'namespace export pattern ?pattern ...?', description: 'Specify exported commands', category: 'interpreter' },
    { name: 'namespace import', signature: 'namespace import pattern ?pattern ...?', description: 'Import namespace commands', category: 'interpreter' },
    { name: 'namespace path', signature: 'namespace path ?namespaceList?', description: 'Set or query auto-qualification path', category: 'interpreter' },
    { name: 'namespace qualifiers', signature: 'namespace qualifiers name', description: 'Return namespace qualifiers for a name', category: 'interpreter' },
    { name: 'namespace which', signature: 'namespace which ?-command? ?-variable? name', description: 'Resolve fully-qualified names', category: 'interpreter' },
    { name: 'next', signature: 'next ?arg ...?', description: 'Invoke the next method in OO dispatch', category: 'oo' },
    { name: 'oo::class', signature: 'oo::class create name ?definition script?', description: 'Define new TclOO classes', category: 'oo' },
    { name: 'oo::define', signature: 'oo::define class definitionScript', description: 'Augment an existing OO class', category: 'oo' },
    { name: 'oo::objdefine', signature: 'oo::objdefine object definitionScript', description: 'Modify TclOO objects', category: 'oo' },
    { name: 'oo::object', signature: 'oo::object create name ?definition script?', description: 'Construct TclOO object instances', category: 'oo' },
    { name: 'pack', signature: 'pack option window ?arg ...?', description: 'Geometry manager for Tk widgets', category: 'tk' },
    { name: 'parray', signature: 'parray arrayName ?pattern?', description: 'Pretty-print array variables', category: 'debug' },
    { name: 'pid', signature: 'pid ?channelId?', description: 'Return process identifiers', category: 'system' },
    { name: 'place', signature: 'place option window ?arg ...?', description: 'Geometry manager for Tk widgets', category: 'tk' },
    { name: 'proc', signature: 'proc name args body', description: 'Create a procedure', category: 'procedure' },
    { name: 'promise', signature: 'promise script', description: 'Create lazy evaluation promises', category: 'functional' },
    { name: 'refchan', signature: 'refchan create handler', description: 'Create reflected channels', category: 'channel' },
    { name: 'resource', signature: 'resource option ?arg ...?', description: 'Access platform-specific application resources', category: 'system' },
    { name: 'socket', signature: 'socket ?options? host port', description: 'Open TCP client or server sockets', category: 'network' },
    { name: 'tailcall', signature: 'tailcall command ?arg ...?', description: 'Perform optimized tail calls', category: 'control' },
    { name: 'throw', signature: 'throw type message', description: 'Raise a scripted error', category: 'control' },
    { name: 'timerate', signature: 'timerate script ?-calibrate? ?-overhead microseconds?', description: 'Benchmark scripts repetitively', category: 'debug' },
    { name: 'trace add execution', signature: 'trace add execution command opList callback', description: 'Trace command execution events', category: 'debug' },
    { name: 'trace add variable', signature: 'trace add variable varName opList callback', description: 'Trace variable read/write events', category: 'debug' },
    { name: 'try', signature: 'try body ?handler ...? ?finally clause?', description: 'Structured exception handling', category: 'control' },
    { name: 'unknown', signature: 'unknown cmdName ?arg arg ...?', description: 'Handle unknown commands', category: 'interpreter' },
    { name: 'unstack', signature: 'unstack channelId', description: 'Remove a channel transformation', category: 'channel' },
    { name: 'update idletasks', signature: 'update idletasks', description: 'Process only idle callbacks', category: 'event' },
    { name: 'uplevel', signature: 'uplevel ?level? arg ?arg ...?', description: 'Execute scripts in different stack frames', category: 'control' },
    { name: 'vwait', signature: 'vwait varName', description: 'Block until variable is written', category: 'event' },
    { name: 'yield', signature: 'yield ?value?', description: 'Suspend coroutine returning a value', category: 'control' },
    { name: 'yieldto', signature: 'yieldto command ?arg ...?', description: 'Transfer control between coroutines', category: 'control' },
    { name: 'zlib', signature: 'zlib option ?arg ...?', description: 'Compression and checksums', category: 'binary' },
    { name: 'zipfs', signature: 'zipfs option ?arg ...?', description: 'Work with ZIP file systems', category: 'file' }
];

const TK_WIDGET_COMMANDS: TclCommand[] = [
    { name: 'button', signature: 'button pathName ?options?', description: 'Create or configure a Tk button widget', category: 'tk' },
    { name: 'canvas', signature: 'canvas pathName ?options?', description: 'Create and manipulate a Tk canvas widget', category: 'tk' },
    { name: 'checkbutton', signature: 'checkbutton pathName ?options?', description: 'Create a Tk checkbutton widget', category: 'tk' },
    { name: 'entry', signature: 'entry pathName ?options?', description: 'Create a Tk single-line text entry widget', category: 'tk' },
    { name: 'frame', signature: 'frame pathName ?options?', description: 'Create a Tk container frame', category: 'tk' },
    { name: 'label', signature: 'label pathName ?options?', description: 'Create a Tk text or image label', category: 'tk' },
    { name: 'labelframe', signature: 'labelframe pathName ?options?', description: 'Frame widget with an optional label', category: 'tk' },
    { name: 'listbox', signature: 'listbox pathName ?options?', description: 'Create a scrolling listbox widget', category: 'tk' },
    { name: 'menu', signature: 'menu pathName ?options?', description: 'Create hierarchical menus', category: 'tk' },
    { name: 'menubutton', signature: 'menubutton pathName ?options?', description: 'Create a menubutton widget', category: 'tk' },
    { name: 'message', signature: 'message pathName ?options?', description: 'Create a multi-line message widget', category: 'tk' },
    { name: 'panedwindow', signature: 'panedwindow pathName ?options?', description: 'Create a paned window widget', category: 'tk' },
    { name: 'radiobutton', signature: 'radiobutton pathName ?options?', description: 'Create a Tk radiobutton widget', category: 'tk' },
    { name: 'scale', signature: 'scale pathName ?options?', description: 'Create a scale/slider widget', category: 'tk' },
    { name: 'scrollbar', signature: 'scrollbar pathName ?options?', description: 'Create a scrollbar widget', category: 'tk' },
    { name: 'spinbox', signature: 'spinbox pathName ?options?', description: 'Create a spinbox widget', category: 'tk' },
    { name: 'text', signature: 'text pathName ?options?', description: 'Create a multi-line text widget', category: 'tk' },
    { name: 'toplevel', signature: 'toplevel pathName ?options?', description: 'Create a new toplevel window', category: 'tk' },
    { name: 'ttk::button', signature: 'ttk::button pathName ?options?', description: 'Create a themed button widget', category: 'tk' },
    { name: 'ttk::checkbutton', signature: 'ttk::checkbutton pathName ?options?', description: 'Create a themed checkbutton', category: 'tk' },
    { name: 'ttk::combobox', signature: 'ttk::combobox pathName ?options?', description: 'Create a combo box widget', category: 'tk' },
    { name: 'ttk::entry', signature: 'ttk::entry pathName ?options?', description: 'Create a themed entry widget', category: 'tk' },
    { name: 'ttk::frame', signature: 'ttk::frame pathName ?options?', description: 'Create a themed frame', category: 'tk' },
    { name: 'ttk::label', signature: 'ttk::label pathName ?options?', description: 'Create a themed label', category: 'tk' },
    { name: 'ttk::labelframe', signature: 'ttk::labelframe pathName ?options?', description: 'Create a themed labelframe', category: 'tk' },
    { name: 'ttk::menubutton', signature: 'ttk::menubutton pathName ?options?', description: 'Create a themed menubutton', category: 'tk' },
    { name: 'ttk::notebook', signature: 'ttk::notebook pathName ?options?', description: 'Create a notebook/tab widget', category: 'tk' },
    { name: 'ttk::panedwindow', signature: 'ttk::panedwindow pathName ?options?', description: 'Create a themed paned window', category: 'tk' },
    { name: 'ttk::progressbar', signature: 'ttk::progressbar pathName ?options?', description: 'Create a progress bar widget', category: 'tk' },
    { name: 'ttk::radiobutton', signature: 'ttk::radiobutton pathName ?options?', description: 'Create a themed radiobutton', category: 'tk' },
    { name: 'ttk::scale', signature: 'ttk::scale pathName ?options?', description: 'Create a themed scale widget', category: 'tk' },
    { name: 'ttk::scrollbar', signature: 'ttk::scrollbar pathName ?options?', description: 'Create a themed scrollbar', category: 'tk' },
    { name: 'ttk::separator', signature: 'ttk::separator pathName ?options?', description: 'Create a themed separator', category: 'tk' },
    { name: 'ttk::sizegrip', signature: 'ttk::sizegrip pathName ?options?', description: 'Create a themed size grip', category: 'tk' },
    { name: 'ttk::spinbox', signature: 'ttk::spinbox pathName ?options?', description: 'Create a themed spinbox', category: 'tk' },
    { name: 'ttk::treeview', signature: 'ttk::treeview pathName ?options?', description: 'Create a treeview widget', category: 'tk' },
    { name: 'wm', signature: 'wm option window ?arg ...?', description: 'Manage window manager interactions', category: 'tk' }
];

const TK_UTILITY_COMMANDS: TclCommand[] = [
    { name: 'bind', signature: 'bind window pattern ?script?', description: 'Bind scripts to widget events', category: 'tk' },
    { name: 'bindtags', signature: 'bindtags window ?tagList?', description: 'Query or modify bindtags for widgets', category: 'tk' },
    { name: 'clipboard', signature: 'clipboard option ?arg ...?', description: 'Access the system clipboard', category: 'tk' },
    { name: 'destroy', signature: 'destroy window ?window ...?', description: 'Destroy widgets', category: 'tk' },
    { name: 'event', signature: 'event option ?arg ...?', description: 'Generate and inspect events', category: 'tk' },
    { name: 'focus', signature: 'focus ?window?', description: 'Query or set keyboard focus', category: 'tk' },
    { name: 'grab', signature: 'grab option window', description: 'Control pointer grabs', category: 'tk' },
    { name: 'grid', signature: 'grid option window ?arg ...?', description: 'Geometry manager arranging widgets in a grid', category: 'tk' },
    { name: 'image', signature: 'image option ?arg ...?', description: 'Create and manage images', category: 'tk' },
    { name: 'lower', signature: 'lower window ?belowThis?', description: 'Lower a window in stacking order', category: 'tk' },
    { name: 'option', signature: 'option option ?arg ...?', description: 'Manipulate the option database', category: 'tk' },
    { name: 'raise', signature: 'raise window ?aboveThis?', description: 'Raise a window in stacking order', category: 'tk' },
    { name: 'selection', signature: 'selection option ?arg ...?', description: 'Manipulate the X selection', category: 'tk' },
    { name: 'send', signature: 'send ?options? app cmd ?arg ...?', description: 'Send commands to another Tk application', category: 'tk' },
    { name: 'tk', signature: 'tk option ?arg ...?', description: 'Access miscellaneous Tk subcommands', category: 'tk' },
    { name: 'tk_chooseColor', signature: 'tk_chooseColor ?options?', description: 'Show the native color chooser dialog', category: 'tk' },
    { name: 'tk_chooseDirectory', signature: 'tk_chooseDirectory ?options?', description: 'Show the native directory chooser', category: 'tk' },
    { name: 'tk_getOpenFile', signature: 'tk_getOpenFile ?options?', description: 'Show the open-file dialog', category: 'tk' },
    { name: 'tk_getSaveFile', signature: 'tk_getSaveFile ?options?', description: 'Show the save-file dialog', category: 'tk' },
    { name: 'tk_popup', signature: 'tk_popup menu x y ?entry?', description: 'Post a menu at the pointer position', category: 'tk' },
    { name: 'tkwait', signature: 'tkwait variable|visibility|window name', description: 'Wait for Tk events on a variable or window', category: 'tk' },
    { name: 'winfo', signature: 'winfo option window', description: 'Query widget/window state information', category: 'tk' }
];

const EXPECT_COMMANDS: TclCommand[] = [
    { name: 'expect_before', signature: 'expect_before ?commandList?', description: 'Set default patterns executed before expect', category: 'expect' },
    { name: 'expect_after', signature: 'expect_after ?commandList?', description: 'Set default patterns executed after expect', category: 'expect' },
    { name: 'expect_background', signature: 'expect_background command', description: 'Run expect in background and register callbacks', category: 'expect' },
    { name: 'expect', signature: 'expect ?-options? pattern body ?pattern body ...?', description: 'Wait for patterns from a spawned process', category: 'expect' },
    { name: 'exp_continue', signature: 'exp_continue ?-continue_timer?', description: 'Continue expect processing after a match', category: 'expect' },
    { name: 'exp_internal', signature: 'exp_internal ?0|1?', description: 'Enable debugging output for expect', category: 'expect' },
    { name: 'exp_open', signature: 'exp_open spawnId', description: 'Retrieve Tcl channel for a spawned process', category: 'expect' },
    { name: 'exp_pid', signature: 'exp_pid ?spawnId?', description: 'Return the process id for a spawned process', category: 'expect' },
    { name: 'expect_out', signature: 'expect_out(field)', description: 'Access match variables from expect', category: 'expect' },
    { name: 'log_file', signature: 'log_file ?options? fileName', description: 'Log spawned process transcripts to files', category: 'expect' },
    { name: 'log_user', signature: 'log_user 0|1', description: 'Control logging to stdout', category: 'expect' },
    { name: 'match_max', signature: 'match_max size', description: 'Set expect match buffer size', category: 'expect' },
    { name: 'send', signature: 'send ?-options? string', description: 'Send data to a spawned process', category: 'expect' },
    { name: 'send_error', signature: 'send_error string', description: 'Send data to stderr of a spawned process', category: 'expect' },
    { name: 'send_log', signature: 'send_log string', description: 'Send data to log file', category: 'expect' },
    { name: 'send_tty', signature: 'send_tty string', description: 'Send data to controlling terminal', category: 'expect' },
    { name: 'spawn', signature: 'spawn ?-options? program ?arg ...?', description: 'Start a process for automation', category: 'expect' },
    { name: 'stty', signature: 'stty option ?arg ...?', description: 'Control terminal settings during expect', category: 'expect' },
    { name: 'timeout', signature: 'timeout seconds', description: 'Set global expect timeout', category: 'expect' },
    { name: 'wait', signature: 'wait ?-nowait? ?spawnId?', description: 'Wait for spawned process exit', category: 'expect' }
];

const ALL_COMMAND_GROUPS: TclCommand[][] = [
    BASE_TCL_COMMANDS,
    ADDITIONAL_TCL_COMMANDS,
    TK_WIDGET_COMMANDS,
    TK_UTILITY_COMMANDS,
    EXPECT_COMMANDS
];

export const TCL_BUILTIN_COMMANDS: TclCommand[] = (() => {
    const seen = new Set<string>();
    const merged: TclCommand[] = [];

    for (const group of ALL_COMMAND_GROUPS) {
        for (const command of group) {
            if (!seen.has(command.name)) {
                seen.add(command.name);
                merged.push(command);
            }
        }
    }

    return merged;
})();

export const TCL_COMMAND_CATEGORIES = [
    'string', 'list', 'control', 'file', 'variable', 'procedure',
    'array', 'dict', 'math', 'system', 'interpreter', 'event',
    'binary', 'encoding', 'debug', 'channel', 'functional', 'network',
    'oo', 'tk', 'expect'
];

// String command options
export const STRING_SUBCOMMANDS = [
    'bytelength', 'compare', 'equal', 'first', 'index', 'is', 
    'last', 'length', 'map', 'match', 'range', 'repeat', 
    'replace', 'reverse', 'tolower', 'totitle', 'toupper', 
    'trim', 'trimleft', 'trimright', 'wordend', 'wordstart'
];

// Common TCL snippets
export const TCL_SNIPPETS = [
    {
        label: 'proc',
        insertText: 'proc ${1:name} {${2:args}} {\n\t${3:# body}\n}',
        detail: 'Procedure definition'
    },
    {
        label: 'if',
        insertText: 'if {${1:condition}} {\n\t${2:# then}\n}',
        detail: 'If statement'
    },
    {
        label: 'ifelse',
        insertText: 'if {${1:condition}} {\n\t${2:# then}\n} else {\n\t${3:# else}\n}',
        detail: 'If-else statement'
    },
    {
        label: 'foreach',
        insertText: 'foreach ${1:var} ${2:list} {\n\t${3:# body}\n}',
        detail: 'Foreach loop'
    },
    {
        label: 'while',
        insertText: 'while {${1:condition}} {\n\t${2:# body}\n}',
        detail: 'While loop'
    },
    {
        label: 'for',
        insertText: 'for {set ${1:i} 0} {$${1:i} < ${2:limit}} {incr ${1:i}} {\n\t${3:# body}\n}',
        detail: 'For loop'
    },
    {
        label: 'switch',
        insertText: 'switch ${1:string} {\n\t${2:pattern} {\n\t\t${3:# action}\n\t}\n\tdefault {\n\t\t${4:# default action}\n\t}\n}',
        detail: 'Switch statement'
    },
    {
        label: 'namespace',
        insertText: 'namespace eval ${1:name} {\n\t${2:# namespace body}\n}',
        detail: 'Namespace definition'
    },
    {
        label: 'catch',
        insertText: 'if {[catch {${1:# code}} ${2:result}]} {\n\t${3:# error handling}\n}',
        detail: 'Catch errors'
    }
];