import { t } from "./i18n.js";
import toast from "./toast.js";
import utils from "./utils.js";

export function copyText(text: string) {
    if (!text) {
        return;
    }
    try {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            return true;
        } 
        // Fallback method: https://stackoverflow.com/a/72239825
        const textArea = document.createElement("textarea");
        textArea.value = text;
        try {
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            return document.execCommand('copy');
        } finally {
            document.body.removeChild(textArea);
        }
        
    } catch (e) {
        console.warn(e);
        return false;
    }
}

export function copyTextWithToast(text: string) {
    if (copyText(text)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}

/**
 * Copies rich HTML — so it pastes with formatting into a note or another rich editor — with
 * `plainText` as the plain-text alternative, and reports the outcome as a toast.
 *
 * Goes through the copy event rather than `navigator.clipboard.write()`, which browsers expose
 * only in secure contexts; Trilium is routinely served over plain HTTP on a LAN, where the API is
 * simply undefined.
 */
export function copyHtmlWithToast(html: string, plainText: string = html) {
    if (utils.copyHtmlToClipboard(html, plainText)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}
