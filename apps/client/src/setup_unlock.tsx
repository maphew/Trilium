import "./setup_unlock.css";

import { useRef, useState } from "preact/hooks";

import logo from "./assets/icon-color.svg?url";
import { t } from "./services/i18n";
import server from "./services/server";
import { setSetupAuthToken } from "./services/setup_auth";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import PasswordField from "./widgets/react/PasswordField";
import SetupPage from "./widgets/react/SetupPage";

/**
 * The password of the knowledge base the wizard is standing over.
 *
 * Ordinarily setup is the one part of Trilium nobody has to log into, and rightly so: it runs where
 * there is no database and therefore nobody to be. An instance the app sent back here is the other
 * case, and on a server it is served to whoever can reach the port, with a whole knowledge base one
 * button away from being replaced. So this comes first, before the wizard will say or do anything.
 *
 * Deliberately the login screen over again, down to the wording: the same logo, the same field, the
 * same button. The user is being asked the one question they already know the answer to, and saying
 * anything more about why would only invite them to read it as a different question.
 *
 * Asked for only where it can be answered and where it is worth asking: a first run has no password
 * to check against, and the desktop's own window is not reachable by anyone the desktop is not.
 *
 * @param onUnlocked the wizard may carry on.
 *
 * @module
 */
export default function SetupUnlock({ onUnlocked }: { onUnlocked: () => void }) {
    const passwordRef = useRef<HTMLInputElement>(null);
    const [ error, setError ] = useState<string | null>(null);
    const [ errorId, setErrorId ] = useState(0);
    const [ submitting, setSubmitting ] = useState(false);

    function raiseError(message: string) {
        setError(message);
        setErrorId((id) => id + 1);
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();
        if (submitting) {
            return;
        }

        setSubmitting(true);
        try {
            const { authenticated, token } = await server.post<{ authenticated: boolean; token?: string }>(
                "setup/auth", { password: passwordRef.current?.value ?? "" });

            if (!authenticated || !token) {
                raiseError(t("login.incorrect-password"));
                return;
            }

            setSetupAuthToken(token);
            onUnlocked();
        } catch {
            // A wrong password is answered, not thrown, so anything landing here is the connection
            // or the rate limiter the attempts are counted by.
            raiseError(t("login.connection-error"));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="setup-unlock-form" onSubmit={(e) => void handleSubmit(e)}>
            <SetupPage
                className="setup-unlock"
                title={t("login.heading")}
                illustration={<img src={logo} alt="" className="illustration-logo" />}
                error={error}
                errorId={errorId}
                footer={<Button text={t("login.button")} kind="primary" disabled={submitting} />}
            >
                <Card>
                    <CardSection>
                        <PasswordField inputRef={passwordRef} />
                    </CardSection>
                </Card>
            </SetupPage>
        </form>
    );
}
