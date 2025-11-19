import config from './config';

type ExtensionKey = keyof typeof config.extensions;

const CHOICE_TO_TIO: Record<string, string> = {
    c: 'c-gcc',
    cpp: 'cpp-gcc',
    cc: 'cpp-gcc',
    cxx: 'cpp-gcc',
    csharp: 'cs-mono',
    python: 'python3',
    ruby: 'ruby',
    rust: 'rust',
    java: 'java-openjdk',
    js: 'javascript-node',
    go: 'go',
    hs: 'haskell',
};

const TIO_MATCHERS: Array<{ pattern: RegExp; choice: ExtensionKey }> = [
    { pattern: /^cpp/, choice: 'cpp' },
    { pattern: /^c\+\+/, choice: 'cpp' },
    { pattern: /^c(gcc|clang)/, choice: 'c' },
    { pattern: /^c$/, choice: 'c' },
    { pattern: /^python/, choice: 'python' },
    { pattern: /^pypy/, choice: 'python' },
    { pattern: /^ruby/, choice: 'ruby' },
    { pattern: /^rust/, choice: 'rust' },
    { pattern: /^java(?!script)/, choice: 'java' },
    { pattern: /^javascript/, choice: 'js' },
    { pattern: /^node/, choice: 'js' },
    { pattern: /^typescript/, choice: 'js' },
    { pattern: /^go/, choice: 'go' },
    { pattern: /^haskell/, choice: 'hs' },
    { pattern: /^hs/, choice: 'hs' },
    { pattern: /^cs/, choice: 'csharp' },
    { pattern: /^csharp/, choice: 'csharp' },
];

const normalize = (value: string): string => value.toLowerCase();

const isExtensionKey = (choice: string): choice is ExtensionKey =>
    Object.prototype.hasOwnProperty.call(config.extensions, choice);

export const choiceToDefaultTioLanguage = (
    choice: string,
): string | undefined => CHOICE_TO_TIO[normalize(choice)];

export const getChoiceForTioLanguage = (
    tioLanguage: string | undefined,
): ExtensionKey | undefined => {
    if (!tioLanguage) {
        return undefined;
    }

    const normalized = normalize(tioLanguage);
    for (const [choice, defaultTio] of Object.entries(CHOICE_TO_TIO)) {
        if (normalized === defaultTio) {
            const key = choice as ExtensionKey;
            return key;
        }
    }

    for (const { pattern, choice } of TIO_MATCHERS) {
        if (pattern.test(normalized)) {
            return choice;
        }
    }

    return undefined;
};

export const getExtensionForTioLanguage = (
    tioLanguage: string,
): string | undefined => {
    const choice = getChoiceForTioLanguage(tioLanguage);
    if (!choice) {
        return undefined;
    }
    return config.extensions[choice];
};

export const sanitizeExtensionFromTioLanguage = (
    tioLanguage: string,
): string => {
    const sanitized = normalize(tioLanguage).replace(/[^a-z0-9]+/g, '-');
    const trimmed = sanitized.replace(/^-+|-+$/g, '');
    return trimmed || 'tio';
};

export const isTioLanguageLocallySupported = (
    tioLanguage: string | undefined,
): boolean => getChoiceForTioLanguage(tioLanguage) !== undefined;

export const getSupportedChoice = (
    choice: string,
): ExtensionKey | undefined => {
    const normalized = normalize(choice);
    if (isExtensionKey(normalized)) {
        return normalized as ExtensionKey;
    }
    return undefined;
};
