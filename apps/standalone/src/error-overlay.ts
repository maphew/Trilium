/**
 * Full-screen error overlay for fatal standalone startup failures.
 *
 * The SQLite worker initialises asynchronously, so a failure there surfaces as a
 * `WORKER_ERROR` message or the worker's `onerror` event — long after main.ts's
 * bootstrap try/catch has already returned. With nowhere to show it, the page
 * just sits on a blank white screen. This renders the failure straight into the
 * DOM from wherever it is caught instead.
 *
 * Deliberately framework-free and self-contained: it has to render in exactly
 * the cases where the client bundle never came up, so it depends on nothing the
 * failure might have taken down with it — the styles ship as an injected
 * stylesheet rather than a bundled `.css`, and every colour reads a Trilium Next
 * theme variable (so it matches the user's actual theme when that CSS did load)
 * behind a hard-coded fallback (so it still looks right when it didn't). The
 * card, gradient backdrop and caution accent mirror the standalone setup screen
 * (`setup.css`).
 */

const OVERLAY_ID = "trilium-error-overlay";
const STYLE_ID = "trilium-error-overlay-style";

/** First failure wins — a hung worker can emit both `onerror` and `WORKER_ERROR`,
 *  and the first message is the one that names the actual cause. */
let shown = false;

export function showErrorOverlay(title: string, message: string, detail?: string): void {
    if (shown) {
        return;
    }
    shown = true;

    // The pre-client shell may still be hiding the body; reveal it so the
    // overlay is actually visible (mirrors main.ts's bootstrap catch).
    document.body.style.display = "block";

    injectStyles();

    // Defensive: never stack two overlays if one was somehow left behind.
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");

    const card = document.createElement("div");
    card.className = "tn-eo-card";

    const illustration = document.createElement("div");
    illustration.className = "tn-eo-illustration";
    // Static markup, no user data — safe to set as innerHTML.
    illustration.innerHTML = WARNING_SVG;

    const heading = document.createElement("h1");
    heading.className = "tn-eo-title";
    heading.textContent = title;

    const body = document.createElement("p");
    body.className = "tn-eo-message";
    body.textContent = message;

    card.append(illustration, heading, body);

    if (detail) {
        const pre = document.createElement("pre");
        pre.className = "tn-eo-detail";
        pre.textContent = detail;
        card.append(pre);
    }

    const actions = document.createElement("div");
    actions.className = "tn-eo-actions";

    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "tn-eo-button";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => location.reload());
    actions.append(reload);

    card.append(actions);
    overlay.append(card);
    document.body.append(overlay);
}

const WARNING_SVG = `
<svg viewBox="0 0 24 24" width="56" height="56" fill="none" aria-hidden="true" focusable="false">
    <path d="M12 3.4 22.2 20.4H1.8L12 3.4Z" fill="currentColor" fill-opacity="0.14"/>
    <path d="M12 3.4 22.2 20.4H1.8L12 3.4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M12 9.6v4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="16.9" r="1.05" fill="currentColor"/>
</svg>`;

function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = OVERLAY_CSS;
    document.head.append(style);
}

// Every colour is `var(--trilium-token, fallback)`: the token wins when the
// theme CSS loaded, the fallback (the theme's own light value, or its dark value
// under prefers-color-scheme) covers the case where it never did.
const OVERLAY_CSS = `
#${OVERLAY_ID} {
    --tn-eo-bg: var(--main-background-color, #fff);
    --tn-eo-text: var(--main-text-color, #1a1a1a);
    --tn-eo-muted: var(--muted-text-color, #666);
    --tn-eo-border: var(--main-border-color, #dbdbdb);
    --tn-eo-surface: var(--left-pane-background-color, #f2f2f2);
    --tn-eo-accent: var(--admonition-caution-accent-color, #ff2e2e);
    --tn-eo-detail-bg: var(--card-background-color, #0000000d);
    --tn-eo-btn-bg: var(--cmd-button-background-color, #0000000f);
    --tn-eo-btn-text: var(--cmd-button-text-color, #000000ad);
    --tn-eo-btn-hover: var(--cmd-button-hover-background-color, #00000016);
    --tn-eo-btn-shadow: var(--cmd-button-shadow-color, #00000040);

    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: calc(1.5rem + env(safe-area-inset-top)) calc(1.5rem + env(safe-area-inset-right))
             calc(1.5rem + env(safe-area-inset-bottom)) calc(1.5rem + env(safe-area-inset-left));
    font-family: var(--main-font-family, "Inter", system-ui, -apple-system, sans-serif);
    color: var(--tn-eo-text);
    background:
        radial-gradient(ellipse at 20% 50%, rgba(99, 102, 241, 0.3) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(168, 85, 247, 0.25) 0%, transparent 50%),
        radial-gradient(ellipse at 60% 80%, rgba(59, 130, 246, 0.25) 0%, transparent 50%),
        var(--tn-eo-surface);
}

#${OVERLAY_ID} .tn-eo-card {
    box-sizing: border-box;
    width: 100%;
    max-width: 460px;
    max-height: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 2.25rem 2rem;
    background: var(--tn-eo-bg);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
    animation: tn-eo-in 0.18s ease-out;
}

#${OVERLAY_ID} .tn-eo-illustration {
    color: var(--tn-eo-accent);
    line-height: 0;
    margin-bottom: 0.25rem;
}

#${OVERLAY_ID} .tn-eo-title {
    margin: 0;
    font-size: 1.4em;
    font-weight: 600;
}

#${OVERLAY_ID} .tn-eo-message {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--tn-eo-muted);
    white-space: pre-wrap;
    word-break: break-word;
}

#${OVERLAY_ID} .tn-eo-detail {
    align-self: stretch;
    margin: 0.5rem 0 0;
    padding: 0.75rem 0.85rem;
    text-align: start;
    background: var(--tn-eo-detail-bg);
    border: 1px solid var(--tn-eo-border);
    border-radius: 8px;
    font-size: 0.75rem;
    line-height: 1.45;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    /* The message is meant to be copied into bug reports — opt back out of the
       app-wide user-select: none. */
    user-select: text;
}

#${OVERLAY_ID} .tn-eo-actions {
    margin-top: 1rem;
}

#${OVERLAY_ID} .tn-eo-button {
    min-width: 120px;
    padding: 7px 18px;
    border: none;
    border-radius: 6px;
    background: var(--tn-eo-btn-bg);
    color: var(--tn-eo-btn-text);
    box-shadow: 1px 1px 1px var(--tn-eo-btn-shadow);
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    transition: background 0.15s ease-out;
}

#${OVERLAY_ID} .tn-eo-button:hover {
    background: var(--tn-eo-btn-hover);
}

#${OVERLAY_ID} .tn-eo-button:active {
    opacity: 0.85;
    box-shadow: none;
    transform: scale(0.96);
}

#${OVERLAY_ID} .tn-eo-button:focus-visible {
    outline: 2px solid var(--input-focus-outline-color, #00000063);
    outline-offset: 1px;
}

@keyframes tn-eo-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
    #${OVERLAY_ID} .tn-eo-card { animation: none; }
}

@media (prefers-color-scheme: dark) {
    #${OVERLAY_ID} {
        --tn-eo-bg: var(--main-background-color, #242424);
        --tn-eo-text: var(--main-text-color, #ccc);
        --tn-eo-muted: var(--muted-text-color, #bbb);
        --tn-eo-border: var(--main-border-color, #454545);
        --tn-eo-surface: var(--left-pane-background-color, #1f1f1f);
        --tn-eo-detail-bg: var(--card-background-color, #ffffff12);
        --tn-eo-btn-bg: var(--cmd-button-background-color, #ffffff28);
        --tn-eo-btn-text: var(--cmd-button-text-color, #ffffffc2);
        --tn-eo-btn-hover: var(--cmd-button-hover-background-color, #ffffff37);
        --tn-eo-btn-shadow: var(--cmd-button-shadow-color, #00000080);
    }
    #${OVERLAY_ID} .tn-eo-card {
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
}`;
