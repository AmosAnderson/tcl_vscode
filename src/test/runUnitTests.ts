import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

async function main(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', timeout: 15000, grep: process.env.TCL_TEST_GREP });
    const names = ['formatter', 'formatterSemantics', 'formatterRange', 'languageParser', 'tclUtils', 'testingScripts', 'testSelection', 'testOutput', 'packageSemantics', 'debug'];
    for (const file of await glob(`{${names.join(',')}}.test.js`, { cwd: __dirname })) mocha.addFile(path.join(__dirname, file));
    mocha.run(failures => { process.exitCode = failures ? 1 : 0; });
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
