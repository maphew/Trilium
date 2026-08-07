/**
 * Full-screen error overlay for fatal standalone startup failures.
 *
 * The SQLite worker initialises asynchronously, so a failure there surfaces as a
 * `WORKER_ERROR` message or the worker's `onerror` event — long after main.ts's
 * bootstrap try/catch has already returned. With nowhere to show it, the page
 * just sits on a blank white screen. This renders the failure straight into the
 * DOM from wherever it is caught instead.
 *
 * Deliberately framework-free and self-contained (inline styles, no imports): it
 * has to render in exactly the cases where the client bundle never came up, so
 * it must not depend on anything the failure might have taken down with it.
 */

const OVERLAY_ID = "trilium-error-overlay";

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

    // Defensive: never stack two overlays if one was somehow left behind.
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.style.cssText = [
        "position: fixed",
        "inset: 0",
        "z-index: 2147483647",
        "display: flex",
        "align-items: center",
        "justify-content: center",
        "padding: 24px",
        "background: rgba(15, 18, 20, 0.72)",
        "font-family: system-ui, -apple-system, sans-serif"
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
        "max-width: 560px",
        "width: 100%",
        "max-height: 100%",
        "overflow: auto",
        "background: #ffffff",
        "color: #1a1a1a",
        "border-radius: 10px",
        "box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35)",
        "padding: 28px"
    ].join(";");

    const heading = document.createElement("h1");
    heading.textContent = title;
    heading.style.cssText = "margin: 0 0 12px; font-size: 20px; color: #c0392b;";

    const body = document.createElement("p");
    body.textContent = message;
    body.style.cssText = "margin: 0 0 20px; font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;";

    card.append(heading, body);

    if (detail) {
        const pre = document.createElement("pre");
        pre.textContent = detail;
        pre.style.cssText = [
            "margin: 0 0 20px",
            "padding: 12px",
            "background: #f4f5f6",
            "border-radius: 6px",
            "font-size: 12px",
            "line-height: 1.45",
            "max-height: 220px",
            "overflow: auto",
            "white-space: pre-wrap",
            "word-break: break-word"
        ].join(";");
        card.append(pre);
    }

    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload";
    reload.style.cssText = [
        "padding: 10px 22px",
        "background: #1976d2",
        "color: #ffffff",
        "border: none",
        "border-radius: 6px",
        "font-size: 15px",
        "cursor: pointer"
    ].join(";");
    reload.addEventListener("click", () => location.reload());
    card.append(reload);

    overlay.append(card);
    document.body.append(overlay);
}
