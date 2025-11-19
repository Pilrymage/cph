import { randomBytes } from 'crypto';
import { deflateRawSync, gunzipSync } from 'zlib';
import type { TioResponse } from 'tio.js';

const SCRIPT_REGEX =
    /<script src="(\/static\/[0-9a-f]+-frontend\.js)" defer><\/script>/;
const RUN_URL_REGEX = /^var runURL = "\/cgi-bin\/static\/([^"]+)";$/m;
const DEBUG_REGEX =
    /([\s\S]*)Real time: ([\d.]+) s\nUser time: ([\d.]+) s\nSys\. time: ([\d.]+) s\nCPU share: ([\d.]+) %\nExit code: (\d+)$/;

const TIO_BASE_URL = 'https://tio.run';
const RUN_URL_REFRESH_MS = 850_000;
const MIN_TIMEOUT_MS = 500;

let runUrl: string | null = null;
let nextRefreshAt = 0;

export class ExecutionAbortedError extends Error {
    constructor() {
        super('Execution aborted');
        this.name = 'ExecutionAbortedError';
    }
}

const fetchText = async (path: string): Promise<string> => {
    const response = await fetch(`${TIO_BASE_URL}${path}`);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch ${path} from tio.run (${response.status})`,
        );
    }
    return response.text();
};

const ensureRunUrl = async () => {
    if (runUrl !== null && Date.now() < nextRefreshAt) {
        return;
    }

    const landingHtml = await fetchText('/');
    const scriptPath = landingHtml.match(SCRIPT_REGEX)?.[1];

    if (!scriptPath) {
        throw new Error('Unable to resolve tio.run frontend script URL');
    }

    const frontendScript = await fetchText(scriptPath);
    const newRunUrl = frontendScript.match(RUN_URL_REGEX)?.[1];

    if (!newRunUrl) {
        throw new Error('Unable to resolve tio.run execution URL');
    }

    runUrl = newRunUrl;
    nextRefreshAt = Date.now() + RUN_URL_REFRESH_MS;
};

const encodeLength = (value: string): number =>
    Buffer.byteLength(value, 'utf8');

const encodeField = (label: string, value: string): string =>
    `${label}\0${encodeLength(value)}\0${value}`;

type NormalizedOptions = {
    language: string;
    stdin: string;
    timeout: number;
    argv: string[];
    cflags: string[];
    signal?: AbortSignal;
};

const buildRequestBody = (code: string, options: NormalizedOptions): Buffer => {
    const cflags = options.cflags.map((flag) => `${flag}\0`).join('');
    const argv = options.argv.map((arg) => `${arg}\0`).join('');
    const payload = `Vargs\0${options.argv.length}\0${argv}Vlang\0\x31\0${
        options.language
    }\0VTIO_CFLAGS\0${
        options.cflags.length
    }\0${cflags}VTIO_OPTIONS\0\x30\0${encodeField(
        'F.code.tio',
        code,
    )}${encodeField('F.input.tio', options.stdin)}R`;

    return deflateRawSync(payload, { level: 9 });
};

const executeRequest = async (
    body: Buffer,
    options: NormalizedOptions,
): Promise<{ buffer: Buffer | null; timedOut: boolean }> => {
    const controller = new AbortController();
    let timedOut = false;

    const timeoutId =
        Number.isFinite(options.timeout) && options.timeout > 0
            ? setTimeout(() => {
                  timedOut = true;
                  controller.abort();
              }, options.timeout)
            : undefined;

    const handleAbort = () => controller.abort();

    if (options.signal) {
        if (options.signal.aborted) {
            throw new ExecutionAbortedError();
        }
        options.signal.addEventListener('abort', handleAbort);
    }

    try {
        const response = await fetch(
            `${TIO_BASE_URL}/cgi-bin/static/${runUrl}/${randomBytes(
                16,
            ).toString('hex')}`,
            {
                method: 'POST',
                body,
                signal: controller.signal,
            },
        );

        if (!response.ok) {
            throw new Error(
                `tio.run responded with ${response.status} ${response.statusText}`,
            );
        }

        const data = await response.arrayBuffer();
        return { buffer: Buffer.from(data), timedOut: false };
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            if (timedOut) {
                return { buffer: null, timedOut: true };
            }
            if (options.signal?.aborted) {
                throw new ExecutionAbortedError();
            }
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (options.signal) {
            options.signal.removeEventListener('abort', handleAbort);
        }
    }
};

export type TioRunOptions = {
    language: string;
    stdin: string;
    timeout: number;
    argv?: string[];
    cflags?: string[];
    signal?: AbortSignal;
};

export const runOnTio = async (
    code: string,
    options: TioRunOptions,
): Promise<TioResponse> => {
    const normalized: NormalizedOptions = {
        language: options.language,
        stdin: options.stdin ?? '',
        timeout: Math.max(MIN_TIMEOUT_MS, options.timeout),
        argv: options.argv ?? [],
        cflags: options.cflags ?? [],
        signal: options.signal,
    };

    await ensureRunUrl();
    const body = buildRequestBody(code, normalized);
    const { buffer, timedOut } = await executeRequest(body, normalized);

    if (!buffer) {
        const seconds = normalized.timeout / 1000;
        return {
            output: `Request timed out after ${normalized.timeout}ms`,
            timedOut: true,
            realTime: seconds,
            userTime: seconds,
            sysTime: seconds,
            CPUshare: 0,
            exitCode: 124,
        };
    }

    const content = gunzipSync(buffer).toString();
    const delimiter = content.substring(0, 16);
    const sections = content.substring(16).split(delimiter);

    if (sections.length < 2) {
        throw new Error('Unexpected response format received from tio.run');
    }

    const match = sections[1].match(DEBUG_REGEX);

    if (!match) {
        throw new Error('Unable to parse tio.run diagnostics output');
    }

    const [, debug, realTime, userTime, sysTime, CPUshare, exitCode] = match;

    return {
        output: sections[0] || debug,
        timedOut: timedOut,
        realTime: parseFloat(realTime),
        userTime: parseFloat(userTime),
        sysTime: parseFloat(sysTime),
        CPUshare: parseFloat(CPUshare),
        exitCode: Number(exitCode),
    };
};
