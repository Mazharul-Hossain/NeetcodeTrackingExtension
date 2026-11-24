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
    const targetElement = document[getElement](identifier);
    if (targetElement) {
        return targetElement;
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
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
            const element = document[getElement](identifier);
            if (element) finish(element);
        });
        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
        });
        timer = setTimeout(cancel, 10000);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
    });
}

function getDate() {
    const date = new Date();
    return date.toISOString().split('T')[0];
}

function showToast(message, color, duration = 3000, action = null) {
    if (!document.getElementById('toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `
      .toast {
        position: fixed;
        top: 24px;
        right: 24px;
        background-color: ${color};
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
    
      .toast.show {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
    `;
        document.head.appendChild(style);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
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
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getLanguage(language) {
    if (language === 'Python') {
        return 'py';
    } else if (language === 'Java') {
        return 'java';
    } else if (language === 'C++') {
        return 'cpp';
    } else if (language === 'C#') {
        return 'c';
    } else if (language === 'JavaScript') {
        return 'js';
    }
    return 'py';
}

async function waitForTopics() {
    // Tags are optional: their absence must not hold the solution upload open.
    const container = document.querySelector('.company-tags-container');
    if (!container) return [];

    return Array.from(container.querySelectorAll('.company-tag-reveal-btn')).map(el =>
        el.textContent.trim(),
    );
}

async function buildUploadPayload(code, questionTitle, questionContent, language) {
    const category = getCategory();
    const title = questionTitle.replaceAll(' ', '-').toLowerCase().trim();
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

${questionContent}
    `;

    const files = [];
    if (code && code.trim())
        files.push({ kind: 'solution', extension: getLanguage(language), content: code });
    files.push({ kind: 'problem', extension: 'md', content: enrichedMarkdown });
    return { category, title, date, files };
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
    if (pageUrl && location.href !== pageUrl)
        return {
            ok: false,
            error: {
                code: 'PAGE_CHANGED',
                message:
                    'The page changed before saving. Click the extension again on the problem you want to save.',
            },
        };
    return chrome.runtime.sendMessage({ type: 'UPLOAD_PROBLEM', payload, uploadTicket });
}

function formatArticleComponent(title, articleComponent) {
    if (!articleComponent) return '';

    let markdown = `# **${title}**\n\n`;

    function processNode(node) {
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
                case 'span':
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

                case 'p':
                    let pContent = '';
                    for (const child of node.childNodes) {
                        const part = processNode(child).trim();

                        if (!part) continue;

                        // Add space if needed (avoid merging words)
                        if (
                            pContent &&
                            !pContent.endsWith(' ') &&
                            !part.startsWith('\n') &&
                            !part.startsWith('.') &&
                            !part.startsWith(',') &&
                            !part.startsWith(')')
                        ) {
                            pContent += ' ';
                        }

                        pContent += part;
                    }

                    return pContent.trim() + '\n\n';

                case 'div':
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

                case 'ul':
                    let ulContent = '';
                    const listItems = node.querySelectorAll('li');
                    for (const li of listItems) {
                        const li_text = li.textContent.trim();
                        // Detect math-like patterns
                        if (/[\^<>=]/.test(li_text)) {
                            ulContent += `- $${li_text}$\n`;
                        } else {
                            ulContent += `- ${li_text}\n`;
                        }
                    }
                    return ulContent + '\n';

                case 'ol':
                    let olContent = '';
                    const orderedItems = node.querySelectorAll('li');
                    for (let i = 0; i < orderedItems.length; i++) {
                        olContent += i + 1 + '. ' + orderedItems[i].textContent.trim() + '\n';
                    }
                    return olContent + '\n';

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

                case 'br':
                    return '\n';

                case 'strong':
                case 'b':
                    return '**' + textContent + '**';

                case 'em':
                case 'i':
                    return '*' + textContent + '*';

                case 'code':
                    if (
                        node.parentElement &&
                        node.parentElement.classList.contains('code-toolbar')
                    ) {
                        return '```\n' + textContent + '\n```\n\n';
                    }
                    return '\`' + textContent + '\`';

                case 'pre':
                    return '```\n' + textContent + '\n```\n\n';

                case 'h1':
                case 'h2':
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6':
                    const level = parseInt(tagName.charAt(1));
                    const prefix = '#'.repeat(level);
                    return prefix + ' ' + textContent + '\n\n';

                default:
                    let content = '';
                    for (const child of node.childNodes) {
                        content += processNode(child);
                    }
                    return content;
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
    const text = document.body.innerText.toLowerCase();

    if (text.includes('system design')) {
        return 'System Design';
    }

    return 'Data Structures & Algorithms';
}

// Central function that handles:
// - extracting problem data
// - formatting markdown
// - uploading to GitHub
// - showing toast messages
async function processAndUpload(code, source = 'auto', uploadTicket = null, pageUrl = null) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const deadline = setTimeout(cancel, 10000);
    globalThis.addEventListener?.('pagehide', cancel, { once: true });
    try {
        // Wait for required DOM elements
        const questionTitle = await waitForElement('querySelector', 'h1', controller.signal);
        const articleComponent = await waitForElement(
            'querySelector',
            'main.my-article-component-container',
            controller.signal,
        );
        // Convert problem description into markdown
        const markdownContent = formatArticleComponent(questionTitle.textContent, articleComponent);
        const languageElement = await waitForElement(
            'querySelector',
            '.selected-language',
            controller.signal,
        );
        clearTimeout(deadline);

        // Extract and normalize title for file path
        const title = questionTitle.textContent.replaceAll(' ', '-').toLowerCase().trim();
        // If no code provided, warn but continue
        if (!code) {
            showToast('No code found — saving problem only', '#f39c12');
        }

        // Upload everything to GitHub
        const uploadResult = await addContentToGitHub(
            code,
            title,
            markdownContent,
            languageElement.textContent,
            uploadTicket,
            pageUrl,
        );
        // Handle success response
        if (uploadResult?.ok) {
            let message;

            if (source === 'manual') {
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
            error?.code === 'PAGE_NOT_READY'
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

function getCode() {
    // Try hidden textarea first
    const textarea = document.querySelector('.inputarea');
    if (textarea && textarea.value) return textarea.value;

    // Fallback to DOM lines
    const lines = document.querySelectorAll('.view-lines .view-line');

    if (!lines.length) return null;

    return Array.from(lines)
        .map(line => line.innerText)
        .join('\n');
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
                sendResponse?.({ accepted: false, reason: 'PAGE_CHANGED' });
                return false;
            }
            void processAndUpload(message.code, 'auto', message.uploadTicket, pageUrl);
        } else if (message.type === 'MANUAL_TRIGGER') {
            if (message.pageUrl !== location.href) {
                sendResponse?.({ accepted: false, reason: 'PAGE_CHANGED' });
                return false;
            }
            void processAndUpload(getCode() || '', 'manual', message.uploadTicket, message.pageUrl);
        } else {
            return false;
        }
        // Acknowledge delivery separately from the eventual upload result/toast.
        sendResponse?.({ accepted: true });
        return false;
    });
    globalThis.__neetcodeTrackingReceiverId = chrome.runtime.id;
}
