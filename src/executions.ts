import { Language, Run } from './types';
import { spawn } from 'child_process';
import { platform } from 'os';
import { getTimeOutPref } from './preferences';
import * as vscode from 'vscode';
import path from 'path';
import telmetry from './telmetry';
import { promises as fs } from 'fs';
import { runOnTio, ExecutionAbortedError } from './tioRunner';
import type { TioLanguage } from 'tio.js';

const runningExecutions = new Set<AbortController>();

const normalizeCompiler = (compiler: string) => compiler.toLowerCase();

const mapLanguageToTio = (language: Language): TioLanguage => {
    const compiler = normalizeCompiler(language.compiler);
    switch (language.name) {
        case 'cpp':
        case 'cc':
        case 'cxx': {
            return compiler.includes('clang') ? 'cpp-clang' : 'cpp-gcc';
        }
        case 'c': {
            return compiler.includes('clang') ? 'c-clang' : 'c-gcc';
        }
        case 'python': {
            return compiler.includes('python2') ? 'python2' : 'python3';
        }
        case 'ruby': {
            return 'ruby';
        }
        case 'js': {
            return 'javascript-node';
        }
        case 'java': {
            return 'java-openjdk';
        }
        case 'rust': {
            return 'rust';
        }
        case 'go': {
            return 'go';
        }
        case 'hs': {
            return 'haskell';
        }
        case 'csharp': {
            return 'cs-mono';
        }
        default: {
            throw new Error(
                `Unsupported language for tio.run: ${language.name}`,
            );
        }
    }
};

/**
 * Run a single testcase, and return the raw results, without judging.
 *
 * @param binPath path to the executable binary
 * @param input string to be piped into the stdin of the spawned process
 */
export const runTestCase = async (
    language: Language | null,
    binPath: string,
    input: string,
    srcPath: string,
    overrideTioLanguage?: string,
): Promise<Run> => {
    const sourcePath = srcPath ?? binPath;
    const result: Run = {
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        time: 0,
        timeOut: false,
    };

    const tioLanguage =
        overrideTioLanguage ??
        (language ? mapLanguageToTio(language) : undefined);

    if (!tioLanguage) {
        result.stderr =
            'Unable to resolve a tio.run language. Please configure a default language.';
        result.signal = 'ERROR';
        vscode.window.showErrorMessage(result.stderr);
        return result;
    }

    globalThis.logger.log(
        'Running testcase via tio.run',
        tioLanguage,
        sourcePath,
    );

    const abortController = new AbortController();
    runningExecutions.add(abortController);

    try {
        const code = await fs.readFile(sourcePath, 'utf8');
        const tioResponse = await runOnTio(code, {
            language: tioLanguage,
            stdin: input,
            timeout: getTimeOutPref(),
            signal: abortController.signal,
        });

        result.stdout = tioResponse.output;
        result.stderr = '';
        result.code = tioResponse.exitCode;
        result.signal = null;
        result.time = Math.max(0, Math.round(tioResponse.realTime * 1000));
        result.timeOut = tioResponse.timedOut;
        globalThis.logger.log('Run Result:', result);
    } catch (err: any) {
        if (err instanceof ExecutionAbortedError) {
            result.stderr = 'Execution aborted by user.';
            result.signal = 'ABORTED';
            globalThis.logger.log('Run aborted by user request');
        } else {
            result.stderr = err instanceof Error ? err.message : String(err);
            result.signal = 'ERROR';
            vscode.window.showErrorMessage(
                `Could not execute testcase via tio.run: ${result.stderr}`,
            );
            globalThis.logger.error('Remote execution failed', err);
        }
    } finally {
        runningExecutions.delete(abortController);
    }

    return result;
};

/** Remove the generated binary from the file system, if present */
export const deleteBinary = (language: Language, binPath: string) => {
    if (language.skipCompile) {
        globalThis.logger.log(
            "Skipping deletion of binary as it's not a compiled language.",
        );
        return;
    }
    globalThis.logger.log('Deleting binary', binPath);
    try {
        const isLinux = platform() == 'linux';
        const isFile = path.extname(binPath);

        if (isLinux) {
            if (isFile) {
                spawn('rm', [binPath]);
            } else {
                spawn('rm', ['-r', binPath]);
            }
        } else {
            const nrmBinPath = '"' + binPath + '"';
            if (isFile) {
                spawn('cmd.exe', ['/c', 'del', nrmBinPath], {
                    windowsVerbatimArguments: true,
                });
            } else {
                spawn('cmd.exe', ['/c', 'rd', '/s', '/q', nrmBinPath], {
                    windowsVerbatimArguments: true,
                });
            }
        }
    } catch (err) {
        globalThis.logger.error('Error while deleting binary', err);
    }
};

/** Kill all running binaries. Usually, only one should be running at a time. */
export const killRunning = () => {
    globalThis.reporter.sendTelemetryEvent(telmetry.KILL_RUNNING);
    globalThis.logger.log('Killling binaries');
    runningExecutions.forEach((controller) => controller.abort());
    runningExecutions.clear();
};
