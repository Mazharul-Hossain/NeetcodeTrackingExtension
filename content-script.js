async function waitForElement(getElement, identifier) {
    console.log("Waiting for:", identifier);
    const targetElement = document[getElement](identifier);
    if (targetElement) {
        return targetElement;
    }

    return new Promise((resolve) => {
        const observer = new MutationObserver((_, observer) => {
            const element = document[getElement](identifier);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

function getDate() {
    const date = new Date();
    return date.toISOString().split('T')[0];
}


function showToast(message, color, duration = 3000) {
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
    toast.style.backgroundColor = color;
    document.body.appendChild(toast);

    void toast.offsetHeight;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}


async function findExistingFile(dataToFind, pathName) {
    const response = await fetch(
        `https://api.github.com/repos/${config.github.username}/${config.github.repo_name}/contents/${pathName}`,
        dataToFind
    );

    // 404 = file does NOT exist (normal case)
    if (response.status === 404) {
        return {
            response: null,
            status: 404
        };
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub GET failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    return {
        response: data,
        status: response.status
    };
}

async function uploadToGitHub(pathName, dataToAdd) {
    const response = await fetch(
        `https://api.github.com/repos/${config.github.username}/${config.github.repo_name}/contents/${pathName}`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.github.token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify(dataToAdd)
        }
    );
    const data = await response.json();
    const status = response.status;
    return {
        "response": data,
        "status": status
    };
}


function getLanguage(language) {
    if (language === "Python") {
        return "py";
    } else if (language === "Java") {
        return "java";
    } else if (language === "C++") {
        return "cpp";
    } else if (language === "C#") {
        return "c";
    } else if (language === "JavaScript") {
        return "js";
    }
    return "py";
}

async function waitForTopics() {
    const container = await waitForElement(
        'querySelector',
        '.company-tags-container'
    );

    return Array.from(
        container.querySelectorAll('.company-tag-reveal-btn')
    ).map(el => el.textContent.trim());
}

async function addContentToGitHub(code, questionTitle, questionContent, language) {
    const category = getCategory();
    const title = questionTitle.replaceAll(' ', '-').toLowerCase().trim();

    let solutionAdded = { status: 200 }; // default success
    if (code && code.trim() !== "") {
        solutionAdded = await addToGithub(code, title, "solution", getLanguage(language));
    }

    const date = getDate();
    const topics = await waitForTopics();
    const enrichedMarkdown = `
---
tags:
${topics.map(t => ` - ${t.replaceAll(' ', '-')}`).join('\n')}

created: ${date}

---

## Notes

<!-- Add your thoughts, edge cases, mistakes -->

---

${questionContent}
    `;

    const problemAdded = await addToGithub(enrichedMarkdown, title, "problem", "md");

    if (solutionAdded.status !== 201 && solutionAdded.status !== 200) {
        return solutionAdded;
    }

    if (problemAdded.status !== 201 && problemAdded.status !== 200) {
        return problemAdded;
    }

    return problemAdded;
}

async function addToGithub(content, title, contentType, fileType) {
    try {
        const date = getDate();
        // const pathName = `${date}/${title}/${contentType}.${fileType}`;
        const category = getCategory();
        const pathName = `${category}/${title}/${contentType}.${fileType}`;

        console.log("Step 2: sending to background / GitHub:", pathName);

        const dataToAdd = {
            owner: config.github.username,
            repo: config.github.repo_name,
            path: 'PATH',
            message: `Added ${title} on ${date}`,
            committer: {
                name: config.github.committer_name,
                email: config.github.committer_email
            },
            content: btoa(String.fromCharCode(...new TextEncoder().encode(content)))
        }
        const dataToFind = {
            owner: config.github.username,
            repo: config.github.repo_name,
            path: 'PATH',
            headers: {
                'Authorization': `Bearer ${config.github.token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            }
        }
        const existingFile = await findExistingFile(dataToFind, pathName);
        if (existingFile.status === 200) {
            dataToAdd.sha = existingFile.response.sha;
            const data = await uploadToGitHub(pathName, dataToAdd);
            console.log("PUT status:", data.status);
            console.log("PUT response:", data.response);
            return {
                "response": data,
                "status": data.status,
                "updated": true
            }
        } else {
            const data = await uploadToGitHub(pathName, dataToAdd);
            console.log("else PUT status:", data.status);
            console.log("PUT response:", data.response);
            return {
                "response": data,
                "status": data.status,
                "message": "File does not exist"
            };
        }
    } catch (error) {
        return {
            "response": error,
            "status": 500
        };
    }
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
                        olContent += (i + 1) + '. ' + orderedItems[i].textContent.trim() + '\n';
                    }
                    return olContent + '\n';

                case 'details':
                    if (node.classList.contains('hint-accordion')) {
                        const summary = node.querySelector('summary');
                        const content = node.querySelector('div') || node.querySelector('p');
                        if (summary && content) {
                            return '### ' + summary.textContent.trim() + '\n\n' +
                                content.textContent.trim() + '\n\n';
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
                    if (node.parentElement && node.parentElement.classList.contains('code-toolbar')) {
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

    if (text.includes("system design")) {
        return "System Design";
    }

    return "Data Structures & Algorithms";
}

// Central function that handles:
// - extracting problem data
// - formatting markdown
// - uploading to GitHub
// - showing toast messages
async function processAndUpload(code, source = 'auto') {
    try {
        console.log("Step 1: preparing data");
        // Wait for required DOM elements
        const questionTitle = await waitForElement('querySelector', 'h1');
        const articleComponent = await waitForElement('querySelector', 'main.my-article-component-container');
        // Convert problem description into markdown
        const markdownContent = formatArticleComponent(questionTitle.textContent, articleComponent);
        const languageElement = await waitForElement('querySelector', '.selected-language');

        // Extract and normalize title for file path
        const title = questionTitle.textContent.replaceAll(' ', '-').toLowerCase().trim();
        // If no code provided, warn but continue
        if (!code) {
            showToast('No code found — saving problem only', '#f39c12');
        }
        console.log("Generated content:", markdownContent);

        // Upload everything to GitHub
        const conentAdded = await addContentToGitHub(code, title, markdownContent, languageElement.textContent);
        // Handle success response
        if (conentAdded.status === 201 || conentAdded.status === 200) {
            let message;

            if (source === 'manual') {
                message = conentAdded.updated ? 'Updated via click' : 'Saved via click';
            } else {
                message = conentAdded.updated
                    ? 'Successfully updated in GitHub'
                    : 'Successfully added to GitHub';
            }

            showToast(message, '#007bff');
        } else {
            showToast('Failed to add to GitHub', '#e74c3c');
        }

    } catch (error) {
        console.error('processAndUpload error:', error);

        const failMessage =
            source === 'manual'
                ? 'Manual save failed'
                : 'Failed to add to GitHub';

        showToast(failMessage, '#e74c3c');
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


// Listener becomes very thin and clean
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    console.log("Received message:", message);

    // Case 1: Code comes from extension (auto capture)
    if (message.type === 'CODE_DATA' && message.code && message.title) {
        await processAndUpload(message.code, 'auto');
    }

    // Case 2: Manual trigger (pull from Monaco editor)
    else if (message.type === 'MANUAL_TRIGGER') {
        // let code = window.monaco?.editor?.getModels()[0]?.getValue();
        let code = getCode();
        if (!code) {
            console.log("No code found in DOM");
            code = ""; // explicit fallback
        }
        console.log("Manual trigger fired");
        // console.log("Extracted code:", code);
        await processAndUpload(code, 'manual');
    }
});
