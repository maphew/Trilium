import "./database.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import {
    canBootToSetup,
    cancelStartOver,
    isStartOverPending,
    startOver
} from "../../../services/setup_mode";
import Admonition from "../../react/Admonition";
import Button from "../../react/Button";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsSection from "./components/OptionsSection";

/**
 * What can be done to the knowledge base as a whole, rather than to anything inside it.
 *
 * One entry for now, and the one that needed a page of its own: starting over is neither a backup
 * nor a setting, and it is the only thing in Options that leaves the application entirely.
 */
export default function DatabaseSettings() {
    return (
        <>
            <OptionsPageHeader />
            <StartOverSection />
        </>
    );
}

/**
 * Going back to the setup screen, from where the knowledge base can be replaced.
 *
 * Two shapes, decided by whether the instance can restart itself. The desktop and the browser-only
 * build go there and then, so the button is the whole of it. A server is restarted by whoever runs
 * it, so the request outlives the page that made it, and the section has to say that a start-over is
 * waiting and offer to call it off.
 */
function StartOverSection() {
    const [ pending, setPending ] = useState(false);
    const [ busy, setBusy ] = useState(false);

    useEffect(() => {
        // Only ever true where nothing acts on the request until a human restarts the server, which
        // is also the only place the answer is worth waiting for.
        if (canBootToSetup()) {
            return;
        }

        void isStartOverPending().then(setPending).catch(() => {
            // The section still works without knowing; the button is what matters here.
        });
    }, []);

    async function begin() {
        setBusy(true);
        try {
            setPending(await startOver() === "pending");
        } finally {
            setBusy(false);
        }
    }

    async function cancel() {
        setBusy(true);
        try {
            await cancelStartOver();
            setPending(false);
        } finally {
            setBusy(false);
        }
    }

    return (
        <OptionsSection title={t("database.start_over_title")} className="start-over">
            <p className="options-section-description">{t("database.start_over_description")}</p>

            {pending ? (
                <>
                    <Admonition type="warning" className="start-over-pending">
                        {t("database.start_over_pending")}
                    </Admonition>

                    <div className="start-over-actions">
                        <Button
                            name="cancel-start-over-button"
                            text={t("database.start_over_cancel")}
                            disabled={busy}
                            onClick={() => void cancel()}
                        />
                    </div>
                </>
            ) : (
                <div className="start-over-actions">
                    <Button
                        name="start-over-button"
                        className="start-over-button"
                        icon="bx bx-reset"
                        text={t("database.start_over")}
                        disabled={busy}
                        onClick={() => void begin()}
                    />
                </div>
            )}
        </OptionsSection>
    );
}
