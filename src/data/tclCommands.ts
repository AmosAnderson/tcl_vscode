export interface TclCommand {
    name: string;
    signature: string;
    description: string;
    category: string;
}

export const TCL_BUILTIN_COMMANDS: TclCommand[] = [
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

export const TCL_COMMAND_CATEGORIES = [
    'string', 'list', 'control', 'file', 'variable', 'procedure', 
    'array', 'dict', 'math', 'system', 'interpreter', 'event', 
    'binary', 'encoding', 'debug'
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