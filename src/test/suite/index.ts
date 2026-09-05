import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import { spawnSync } from 'child_process';

export function run(): Promise<void> {
    // VS Code can resolve a login-shell PATH on macOS. Keep the launcher-selected
    // interpreter so a Tcl 9 test run cannot silently fall back to system Tcl 8.5.
    if (process.env.TCL_TEST_PATH) process.env.PATH = process.env.TCL_TEST_PATH;
    const interpreter = spawnSync('tclsh', [], {
        input: 'puts [info patchlevel]\n', encoding: 'utf8', timeout: 5000
    });
    console.log(`Extension-host Tcl: ${interpreter.stdout?.trim() || interpreter.error?.message || interpreter.stderr?.trim() || 'unavailable'}`);

    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        grep: process.env.TCL_TEST_GREP,
        timeout: 15000
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((c, e) => {
        glob('**/**.test.js', { cwd: testsRoot })
            .then((files: string[]) => {
                // Add files to the test suite
                files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

                try {
                    // Run the mocha test
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            e(new Error(`${failures} tests failed.`));
                        } else {
                            c();
                        }
                    });
                } catch (err) {
                    console.error(err);
                    e(err);
                }
            })
            .catch(e);
    });
}
