import { Language, Problem } from '../types';
import { runSingleAndSave } from './processRunSingle';
import { compileFile, getBinSaveLocation } from '../compiler';
import { deleteBinary } from '../executions';
import { getLanguage } from '../utils';
import { getJudgeViewProvider } from '../extension';
import * as vscode from 'vscode';

/**
 * Run every testcase in a problem one by one. Waits for the first to complete
 * before running next. `runSingleAndSave` takes care of saving.
 **/
export default async (problem: Problem) => {
    globalThis.logger.log('Run all started', problem);
    let language: Language | null = null;
    try {
        language = getLanguage(problem.srcPath);
    } catch (err) {
        if (!problem.tioLanguage) {
            globalThis.logger.error(
                'Failed to detect language for run all',
                err,
            );
            vscode.window.showErrorMessage(
                'Unable to determine language for this problem. Please set a default language in the settings.',
            );
            return;
        }
    }
    let didCompile = true;
    if (language) {
        didCompile = await compileFile(problem.srcPath);
    }
    if (!didCompile) {
        return;
    }
    for (const testCase of problem.tests) {
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'running',
            id: testCase.id,
            problem: problem,
        });
        await runSingleAndSave(problem, testCase.id, true, true);
    }
    globalThis.logger.log('Run all finished');
    if (language) {
        deleteBinary(language, getBinSaveLocation(problem.srcPath));
    }
};
