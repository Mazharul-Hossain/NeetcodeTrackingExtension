/*
 * Project tree (root -> file -> responsibilities):
 * NeetcodeTrackingExtension/
 * `-- content-script.js (loaded by manifest.json on NeetCode)
 *     |-- DOM helpers: wait for page elements, read code, and show toasts
 *     |-- Markdown helpers: format descriptions, math, topics, and dates
 *     |-- Upload preparation: send credential-free problem files to the worker
 *     `-- message listener: route CODE_DATA / MANUAL_TRIGGER to processAndUpload
 *
 * Purpose: extract NeetCode problem details and save them with optional solution
 * code under {category}/{problem-title}/ in the configured GitHub repository.
 * Depends on messages and sanitized results from background.js; no credentials.
 *
 * Agent skills: no additional Codex skill required. Relevant knowledge: browser
 * DOM/MutationObserver, Chrome messaging, Markdown/KaTeX, UTF-8/Base64 encoding,
 * and the GitHub Contents API (including file SHAs for updates). Use the
 * computer-use skill if validating the extension through a live browser UI.
 */

async function waitForElement(getElement, identifier, signal) {
    const unavailable = () =>
        Object.assign(new Error('Page is not ready'), { code: 'PAGE_NOT_READY' });
    if (signal?.aborted) throw unavailable();
    const read = () =>
        typeof getElement === 'function' ? getElement() : document[getElement](identifier);
    const targetElement = read();
    if (targetElement) {
        return targetElement;
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = element => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            if (element) resolve(element);
            else reject(unavailable());
        };
        const cancel = () => finish(null);
        const observer = new MutationObserver(() => {
            const element = read();
            if (element) finish(element);
        });
        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
        });
        // Declared after the callbacks that clear it: they only run asynchronously,
        // once this line has executed.
        const timer = setTimeout(cancel, 10000);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
    });
}

function getDate() {
    const date = new Date();
    return date.toISOString().split('T')[0];
}

function showToast(message, color, duration = 3000, action = null) {
    if (!document.getElementById('neetcode-tracking-toast-style')) {
        const style = document.createElement('style');
        style.id = 'neetcode-tracking-toast-style';
        style.textContent = `
      .neetcode-tracking-toast {
        position: fixed;
        top: 24px;
        right: 24px;
        color: white;
        padding: 12px 20px;
        border-radius: 5px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-family: sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
        transform: translateY(-20px);
        z-index: 9999;
      }
    
      .neetcode-tracking-toast.neetcode-tracking-toast-visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
    `;
        document.head.appendChild(style);
    }

    const toast = document.createElement('div');
    toast.className = 'neetcode-tracking-toast';
    toast.textContent = message;
    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Open settings';
        button.style.marginLeft = '12px';
        button.addEventListener('click', () => {
            Promise.resolve(action()).catch(() => {});
        });
        toast.appendChild(button);
    }
    toast.style.backgroundColor = color;
    document.body.appendChild(toast);

    void toast.offsetHeight;
    toast.classList.add('neetcode-tracking-toast-visible');

    setTimeout(() => {
        toast.classList.remove('neetcode-tracking-toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getLanguage(language) {
    const extensions = {
        python: 'py',
        python3: 'py',
        javascript: 'js',
        typescript: 'ts',
        java: 'java',
        'c++': 'cpp',
        cpp: 'cpp',
        c: 'c',
        'c#': 'cs',
        csharp: 'cs',
        go: 'go',
        golang: 'go',
        rust: 'rs',
        kotlin: 'kt',
        swift: 'swift',
        ruby: 'rb',
        php: 'php',
        scala: 'scala',
        dart: 'dart',
        racket: 'rkt',
        elixir: 'ex',
        erlang: 'erl',
        'f#': 'fs',
        fsharp: 'fs',
        r: 'r',
        perl: 'pl',
        haskell: 'hs',
        lua: 'lua',
        bash: 'sh',
        shell: 'sh',
        sql: 'sql',
    };
    return typeof language === 'string'
        ? Object.hasOwn(extensions, language.trim().toLowerCase())
            ? extensions[language.trim().toLowerCase()]
            : null
        : null;
}

async function waitForTopics() {
    // Tags are optional: their absence must not hold the solution upload open.
    const container = document.querySelector('.company-tags-container');
    if (!container) return [];

    return Array.from(container.querySelectorAll('.company-tag-reveal-btn')).map(el =>
        el.textContent.trim(),
    );
}

function slugProblemTitle(title) {
    let slug = title
        .normalize('NFC')
        .trim()
        .toLowerCase()
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '-')
        .replace(/\p{Cc}/gu, '')
        .replace(/-+/g, '-')
        .replace(/^[. -]+|[. -]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)) slug = `problem-${slug}`;
    // Truncate after reserved-name prefixes, without splitting a surrogate pair.
    slug = slug
        .slice(0, 200)
        .replace(/[\uD800-\uDBFF]$/, '')
        .replace(/[. -]+$/g, '');
    if (!slug) throw Object.assign(new Error(), { code: 'PAGE_NOT_READY' });
    return slug;
}

// Folder name used before Windows-safe slugs. The worker reuses it only if it already exists.
function legacyProblemTitle(title) {
    const legacy = title.replaceAll(' ', '-').toLowerCase().trim();
    return /^[^/\\\p{Cc}]{1,200}$/u.test(legacy) && !['.', '..'].includes(legacy) ? legacy : null;
}

function getProblemHeading(article) {
    const scoped = article.querySelector('h1');
    if (scoped) return scoped;
    // NeetCode places the title beside app-article, inside the question panel.
    // Modal headings elsewhere in the document must not make it ambiguous.
    const panel = article.closest?.('.question-tab');
    if (panel) {
        const titles = panel.querySelectorAll('h1.problem-title');
        return titles.length === 1 ? titles[0] : null;
    }
    // A unique visible content heading is safer than the first h1 in navigation.
    const headings = Array.from(document.querySelectorAll('h1')).filter(
        heading =>
            !heading.closest('nav, aside, footer, [role="navigation"]') &&
            heading.getClientRects().length > 0,
    );
    return headings.length === 1 ? headings[0] : null;
}

async function buildUploadPayload(code, questionTitle, questionContent, language) {
    const category = getCategory();
    const title = slugProblemTitle(questionTitle);
    const date = getDate();
    const topics = await waitForTopics();
    const enrichedMarkdown = `---
tags:
${topics.map(t => ` - ${t.replaceAll(' ', '-')}`).join('\n')}

created: ${date}

---

## Notes

<!-- Add your thoughts, edge cases, mistakes -->

---

${questionContent.trim()}
`;

    const files = [];
    if (code && code.trim()) {
        const extension = getLanguage(language);
        if (!extension) throw Object.assign(new Error(), { code: 'UNSUPPORTED_LANGUAGE' });
        files.push({ kind: 'solution', extension, content: code });
    }
    files.push({ kind: 'problem', extension: 'md', content: enrichedMarkdown });
    const legacyTitle = legacyProblemTitle(questionTitle);
    return {
        category,
        title,
        ...(legacyTitle && legacyTitle !== title ? { legacyTitle } : {}),
        date,
        files,
    };
}

async function addContentToGitHub(
    code,
    questionTitle,
    questionContent,
    language,
    uploadTicket,
    pageUrl = null,
) {
    const payload = await buildUploadPayload(code, questionTitle, questionContent, language);
    if (pageUrl && location.href !== pageUrl) {
        return {
            ok: false,
            error: {
                code: 'PAGE_CHANGED',
                message:
                    'The page changed before saving. Click the extension again on the problem you want to save.',
            },
        };
    }
    return chrome.runtime.sendMessage({ type: 'UPLOAD_PROBLEM', payload, uploadTicket });
}

// Joins converted inline nodes with single spaces, but never before closing punctuation
// or around line breaks, so "<code>nums</code>, sorted" stays "`nums`, sorted".
function joinInlineParts(parts) {
    let joined = '';
    for (const part of parts) {
        if (!part) continue;
        if (
            joined &&
            !joined.endsWith(' ') &&
            !joined.endsWith('\n') &&
            !part.startsWith('\n') &&
            !/^[.,;:!?)]/.test(part)
        ) {
            joined += ' ';
        }
        joined += part;
    }
    return joined;
}

function formatArticleComponent(title, articleComponent, titleHeading = null) {
    if (!articleComponent) return '';
    if (!titleHeading) {
        const candidate = articleComponent.querySelector?.('h1');
        if (candidate?.textContent.trim() === title.trim()) titleHeading = candidate;
    }

    let markdown = `# **${title}**\n\n`;

    function processNode(node) {
        // The selected title is already emitted above, even when nested inside the article.
        if (node === titleHeading) return '';
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            // Skip empty or duplicate math fragments
            if (!text) return '';

            return text;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            const textContent = node.textContent.trim();

            switch (tagName) {
                case 'span': {
                    if (node.classList.contains('katex')) {
                        const annotation = node.querySelector('annotation');
                        if (annotation) {
                            return ` $${annotation.textContent.trim()}$ `;
                        }
                        return '';
                    }

                    // normal span fallback
                    let spanContent = '';
                    for (const child of node.childNodes) {
                        spanContent += processNode(child);
                    }
                    return spanContent;
                }

                case 'p': {
                    const parts = Array.from(node.childNodes).map(child =>
                        processNode(child).trim(),
                    );
                    return joinInlineParts(parts).trim() + '\n\n';
                }

                case 'div': {
                    if (node.classList.contains('code-toolbar')) {
                        const codeElement = node.querySelector('code');
                        if (codeElement) {
                            return '```\n' + codeElement.textContent + '\n```\n\n';
                        }
                    }
                    let divContent = '';
                    for (const child of node.childNodes) {
                        divContent += processNode(child);
                    }
                    return divContent;
                }

                case 'ul':
                case 'ol': {
                    const items = Array.from(node.childNodes).filter(
                        child =>
                            child.nodeType === Node.ELEMENT_NODE &&
                            child.tagName.toLowerCase() === 'li',
                    );
                    return (
                        items
                            .map((li, index) => {
                                const marker = tagName === 'ol' ? `${index + 1}. ` : '- ';
                                const content = joinInlineParts(
                                    Array.from(li.childNodes).map(child => {
                                        const part = processNode(child);
                                        return child.nodeType === Node.ELEMENT_NODE &&
                                            ['ul', 'ol'].includes(child.tagName.toLowerCase())
                                            ? `\n${part.trimEnd()}\n`
                                            : part.trim();
                                    }),
                                ).trim();
                                const lines = content.split('\n').map(line => line.trimEnd());
                                return (
                                    marker +
                                    lines[0] +
                                    lines
                                        .slice(1)
                                        .map(line => `\n${' '.repeat(marker.length)}${line}`)
                                        .join('') +
                                    '\n'
                                );
                            })
                            .join('') + '\n'
                    );
                }

                case 'details':
                    if (node.classList.contains('hint-accordion')) {
                        const summary = node.querySelector('summary');
                        const content = node.querySelector('div') || node.querySelector('p');
                        if (summary && content) {
                            return (
                                '### ' +
                                summary.textContent.trim() +
                                '\n\n' +
                                content.textContent.trim() +
                                '\n\n'
                            );
                        }
                    }
                    break;

                case 'img': {
                    const alt = (node.getAttribute('alt') || '')
                        .replace(/\\/g, '\\\\')
                        .replaceAll('[', '\\[')
                        .replaceAll(']', '\\]')
                        .replace(/[\r\n]+/g, ' ');
                    const source = node.currentSrc || node.getAttribute('src');
                    if (!source) return alt;
                    try {
                        const url = new URL(source, location.href);
                        if (!['https:', 'http:'].includes(url.protocol)) return alt;
                        return `![${alt}](<${url.href.replaceAll('\\', '%5C')}>)\n\n`;
                    } catch {
                        return alt;
                    }
                }

                case 'br':
                    return '\n';

                case 'strong':
                case 'b':
                    return '**' + Array.from(node.childNodes).map(processNode).join('') + '**';

                case 'em':
                case 'i':
                    return '*' + Array.from(node.childNodes).map(processNode).join('') + '*';

                case 'code':
                    if (
                        node.parentElement &&
                        node.parentElement.classList.contains('code-toolbar')
                    ) {
                        return '```\n' + textContent + '\n```\n\n';
                    }
                    return '`' + textContent + '`';

                case 'pre':
                    return '```\n' + textContent + '\n```\n\n';

                case 'h1':
                case 'h2':
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6': {
                    const level = parseInt(tagName.charAt(1));
                    const prefix = '#'.repeat(level);
                    return prefix + ' ' + textContent + '\n\n';
                }

                default: {
                    let content = '';
                    for (const child of node.childNodes) {
                        content += processNode(child);
                    }
                    return content;
                }
            }
        }

        return '';
    }

    for (const child of articleComponent.childNodes) {
        markdown += processNode(child);
    }

    return markdown.trim();
}

function getCategory() {
    const isSystemDesign = url =>
        new URL(url, location.href).pathname.split('/').includes('system-design');
    if (isSystemDesign(location.href)) return 'System Design';
    const links = document.querySelectorAll(
        '[aria-label="breadcrumb" i] a[href], .breadcrumb a[href], .breadcrumbs a[href]',
    );
    for (const link of links) {
        const url = new URL(link.href, location.href);
        if (url.origin === new URL(location.href).origin && isSystemDesign(url.href)) {
            return 'System Design';
        }
    }
    return 'Data Structures & Algorithms';
}

// Central function that handles:
// - extracting problem data
// - formatting markdown
// - uploading to GitHub
// - showing toast messages
async function processAndUpload(
    code,
    source = 'auto',
    uploadTicket = null,
    pageUrl = null,
    language = document.querySelector('.selected-language')?.textContent,
) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const deadline = setTimeout(cancel, 10000);
    globalThis.addEventListener?.('pagehide', cancel, { once: true });
    try {
        if (code && code.trim() && language === null) {
            throw Object.assign(new Error(), { code: 'CAPTURE_LANGUAGE_UNAVAILABLE' });
        }
        // Wait for required DOM elements
        const articleComponent = await waitForElement(
            'querySelector',
            'main.my-article-component-container',
            controller.signal,
        );
        const questionTitle = await waitForElement(
            () => getProblemHeading(articleComponent),
            null,
            controller.signal,
        );
        // Convert problem description into markdown
        const markdownContent = formatArticleComponent(
            questionTitle.textContent,
            articleComponent,
            questionTitle,
        );
        clearTimeout(deadline);

        // If no code provided, warn but continue
        if (!code) {
            showToast('No code found — saving problem only', '#f39c12');
        }

        // Upload everything to GitHub
        const uploadResult = await addContentToGitHub(
            code,
            questionTitle.textContent,
            markdownContent,
            language,
            uploadTicket,
            pageUrl,
        );
        // Handle success response
        if (uploadResult?.ok) {
            let message;

            if (uploadResult.unchanged) {
                message = 'Already saved, nothing to update.';
            } else if (source === 'manual') {
                message = uploadResult.updated ? 'Updated via click' : 'Saved via click';
            } else {
                message = uploadResult.updated
                    ? 'Successfully updated in GitHub'
                    : 'Successfully added to GitHub';
            }

            showToast(message, '#007bff');
        } else {
            const actionable = ['NOT_CONFIGURED', 'VAULT_LOCKED'].includes(
                uploadResult?.error?.code,
            );
            const message = uploadResult?.error?.message || 'Failed to add to GitHub';
            showToast(
                message,
                '#e74c3c',
                actionable ? 10000 : 3000,
                actionable ? () => chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }) : null,
            );
        }
    } catch (error) {
        const failMessage =
            error?.code === 'CAPTURE_LANGUAGE_UNAVAILABLE'
                ? 'Could not determine the submitted language. Click the extension to save the current editor instead.'
                : error?.code === 'UNSUPPORTED_LANGUAGE'
                  ? 'This language is not supported. No files were saved.'
                  : error?.code === 'PAGE_NOT_READY'
                    ? 'Problem details did not load. Try again when the NeetCode page finishes loading.'
                    : source === 'manual'
                      ? 'Manual save failed'
                      : 'Failed to add to GitHub';

        showToast(failMessage, '#e74c3c');
    } finally {
        clearTimeout(deadline);
        globalThis.removeEventListener?.('pagehide', cancel);
    }
}

function editorFailureCode(code) {
    const allowed = [
        'EDITOR_UNAVAILABLE',
        'EDITOR_API_UNAVAILABLE',
        'EDITOR_DISCOVERY_FAILED',
        'EDITOR_NOT_FOUND',
        'EDITOR_AMBIGUOUS',
        'EDITOR_MODEL_UNAVAILABLE',
        'EDITOR_SNAPSHOT_INVALID',
        'EDITOR_TOO_LARGE',
        'EDITOR_READ_FAILED',
        'EDITOR_INJECTION_FAILED',
        'EDITOR_READ_TIMEOUT',
        'EDITOR_MESSAGE_FAILED',
        'EDITOR_RESPONSE_INVALID',
        'PAGE_CHANGED',
        'SETTINGS_CHANGED',
        'STORAGE_UNAVAILABLE',
        'UNAUTHORIZED',
    ];
    return allowed.includes(code) ? code : 'EDITOR_RESPONSE_INVALID';
}

async function getCode(pageUrl) {
    let result;
    try {
        result = await chrome.runtime.sendMessage({ type: 'GET_EDITOR_CODE', pageUrl });
    } catch {
        throw { code: 'EDITOR_MESSAGE_FAILED' };
    }
    if (!result?.ok) throw { code: editorFailureCode(result?.error?.code) };
    if (typeof result.code !== 'string' || typeof result.language !== 'string') {
        throw { code: 'EDITOR_RESPONSE_INVALID' };
    }
    return { code: result.code, language: result.language };
}

async function saveManual(message) {
    try {
        const snapshot = await getCode(message.pageUrl);
        if (location.href !== message.pageUrl) throw { code: 'PAGE_CHANGED' };
        await processAndUpload(
            snapshot.code,
            'manual',
            message.uploadTicket,
            message.pageUrl,
            snapshot.language,
        );
    } catch (error) {
        showToast(
            `[${editorFailureCode(error?.code)}] Could not read the complete editor code. No files were saved. Try again on the problem page.`,
            '#e74c3c',
        );
    }
}

// Only the extension worker may trigger extraction. No credential messages here.
// Declarative loading and toolbar recovery may both run; install one receiver.
if (globalThis.__neetcodeTrackingReceiverId !== chrome.runtime.id) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (sender.id !== chrome.runtime.id) return false;
        if (message.type === 'PAGE_READY') {
            sendResponse?.({ ready: true });
            return false;
        } else if (message.type === 'SAVE_BLOCKED') {
            showToast(
                message.error?.message || 'Open settings before saving.',
                '#e74c3c',
                10000,
                () => chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }),
            );
        } else if (
            message.type === 'CODE_DATA' &&
            typeof message.code === 'string' &&
            message.title
        ) {
            const pageUrl = location.href;
            if (pageUrl !== message.pageUrl) {
                showToast(
                    'The page changed before the automatic save arrived. Click the extension again to save this problem.',
                    '#f39c12',
                );
                sendResponse?.({ accepted: false, reason: 'PAGE_CHANGED' });
                return false;
            }
            void processAndUpload(
                message.code,
                'auto',
                message.uploadTicket,
                pageUrl,
                message.language ?? null,
            );
        } else if (message.type === 'MANUAL_TRIGGER') {
            if (message.pageUrl !== location.href) {
                sendResponse?.({ accepted: false, reason: 'PAGE_CHANGED' });
                return false;
            }
            void saveManual(message);
        } else {
            return false;
        }
        // Acknowledge delivery separately from the eventual upload result/toast.
        sendResponse?.({ accepted: true });
        return false;
    });
    globalThis.__neetcodeTrackingReceiverId = chrome.runtime.id;
}
