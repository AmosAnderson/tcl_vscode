import * as path from 'path';
import { COVERAGE_BEGIN, COVERAGE_END } from './coverageExecution';

export interface CoverageData {
    file: string;
    lines: Map<number, { count: number; covered: boolean }>;
    totalLines: number;
    coveredLines: number;
    percentage: number;
}

/** Parse a run's reports independently from the shared editor-decoration state. */
export function parseCoverageReports(reports: readonly string[], prior: readonly CoverageData[] = []): CoverageData[] {
    const data = new Map(prior.map(entry => [entry.file, { ...entry, lines: new Map(entry.lines) }]));
    for (const report of reports) {
        const begin = report.lastIndexOf(COVERAGE_BEGIN);
        const end = report.indexOf(COVERAGE_END, begin);
        if (begin < 0 || end < 0) throw new Error('Coverage process did not produce a complete report');
        let currentFile = '';
        for (const line of report.slice(begin + COVERAGE_BEGIN.length, end).split(/\r?\n/)) {
            if (line.startsWith('FILEHEX:')) {
                currentFile = path.normalize(Buffer.from(line.substring(8), 'hex').toString('utf8'));
                if (!data.has(currentFile)) data.set(currentFile, { file: currentFile, lines: new Map(), totalLines: 0, coveredLines: 0, percentage: 0 });
            } else if (line.startsWith('LINE:') && currentFile) {
                const [lineNumber, count] = line.substring(5).split(':').map(Number);
                if (!Number.isInteger(lineNumber) || lineNumber < 1 || !Number.isInteger(count) || count < 0) continue;
                const coverage = data.get(currentFile)!;
                const total = count + (coverage.lines.get(lineNumber)?.count ?? 0);
                coverage.lines.set(lineNumber, { count: total, covered: total > 0 });
            }
        }
    }
    for (const coverage of data.values()) {
        coverage.totalLines = coverage.lines.size;
        coverage.coveredLines = [...coverage.lines.values()].filter(line => line.covered).length;
        coverage.percentage = coverage.totalLines ? coverage.coveredLines / coverage.totalLines * 100 : 0;
    }
    return [...data.values()];
}
