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
import { Card, CardOption } from "../../react/Card";
import OptionsPageHeader from "./components/OptionsPageHeader";

/**
 * What can be done to the knowledge base as a whole, rather than to anything inside it.
 *
 * One entry for now, and the one that needed a page of its own: starting over is neither a backup
 * nor a setting, and it is the only thing in Options that leaves the application entirely.
 */
export default function DatabaseSettings() {
    const startOverState = useStartOver();

    return (
        <>
            <OptionsPageHeader />

            {/* Above the card rather than under the button that caused it: a request left standing
                is the state of the whole page from here on, and the first thing its owner needs to
                know when they open this page again. */}
            {startOverState.pending && (
                <Admonition type="warning" className="start-over-pending">
                    <p>{t("database.start_over_pending")}</p>

                    <Button
                        name="cancel-start-over-button"
                        text={t("database.start_over_cancel")}
                        size="micro"
                        disabled={startOverState.busy}
                        onClick={() => void startOverState.cancel()}
                    />
                </Admonition>
            )}

            {/* Headingless: the row names the feature itself, and this card is to be folded into
                another one later. */}
            <div className="options-section start-over">
                <Card>
                    <CardOption
                        label={t("database.start_over")}
                        description={t("database.start_over_description")}
                    >
                        <Button
                            name="start-over-button"
                            text={t("database.start_over")}
                            icon="bx-reset"
                            size="micro"
                            disabled={startOverState.busy || startOverState.pending}
                            onClick={() => void startOverState.begin()}
                        />
                    </CardOption>
                </Card>
            </div>
        </>
    );
}

/**
 * Going back to the setup screen, from where the knowledge base can be replaced.
 *
 * Two shapes, decided by whether the instance can restart itself. The desktop and the browser-only
 * build go there and then, so pressing the button is the whole of it. A server is restarted by
 * whoever runs it, so the request outlives the page that made it, and the page has to say that a
 * start-over is waiting and offer to call it off.
 */
function useStartOver() {
    const [ pending, setPending ] = useState(false);
    const [ busy, setBusy ] = useState(false);

    useEffect(() => {
        // Only ever true where nothing acts on the request until a human restarts the server, which
        // is also the only place the answer is worth waiting for.
        if (canBootToSetup()) {
            return;
        }

        void isStartOverPending().then(setPending).catch(() => {
            // The page still works without knowing; the button is what it is for.
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

    return { pending, busy, begin, cancel };
}
