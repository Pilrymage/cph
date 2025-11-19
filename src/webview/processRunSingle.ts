import { Language, Problem, RunResult } from '../types';
import { getLanguage } from '../utils';
import { getBinSaveLocation, compileFile } from '../compiler';
import { saveProblem } from '../parser';
import { runTestCase, deleteBinary } from '../executions';
import { isResultCorrect } from '../judge';
import * as vscode from 'vscode';
import { getJudgeViewProvider } from '../extension';
import { getIgnoreSTDERRORPref } from '../preferences';
import telmetry from '../telmetry';

export const runSingleAndSave = async (
    problem: Problem,
    id: number,
    skipCompile = false,
    skipTelemetry = false,
) => {
    if (!skipTelemetry) {
        globalThis.reporter.sendTelemetryEvent(telmetry.RUN_TESTCASE);
    }
    globalThis.logger.log('Run and save started', problem, id);
    const srcPath = problem.srcPath;
    let language: Language | null = null;
    try {
        language = getLanguage(srcPath);
    } catch (err) {
        if (!problem.tioLanguage) {
            vscode.window.showErrorMessage(
                'Unable to determine language for this file. Please set a default language in the settings.',
            );
            globalThis.logger.error('Failed to detect language', err);
            return;
        }
    }
    const binPath = language ? getBinSaveLocation(srcPath) : srcPath;
    const idx = problem.tests.findIndex((value) => value.id === id);
    const testCase = problem.tests[idx];

    const textEditor = await vscode.workspace.openTextDocument(srcPath);
    await vscode.window.showTextDocument(textEditor, vscode.ViewColumn.One);
    await textEditor.save();

    if (!testCase) {
        globalThis.logger.error('Invalid id', id, problem);
        return;
    }

    saveProblem(srcPath, problem);

    if (!skipCompile && language) {
        if (!(await compileFile(srcPath))) {
            globalThis.logger.error('Failed to compile', problem, id);
            return;
        }
    }

    const run = await runTestCase(
        language,
        binPath,
        testCase.input,
        srcPath,
        problem.tioLanguage,
    );

    if (!skipCompile && language) {
        deleteBinary(language, binPath);
    }

    const stderrorFailure = getIgnoreSTDERRORPref() ? false : run.stderr !== '';

    const didError =
        (run.code !== null && run.code !== 0) ||
        run.signal !== null ||
        stderrorFailure;
    const result: RunResult = {
        ...run,
        pass: didError ? false : isResultCorrect(testCase, run.stdout),
        id,
    };

    globalThis.logger.log('Testcase judging complete. Result:', result);
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'run-single-result',
        result,
        problem,
    });
};
