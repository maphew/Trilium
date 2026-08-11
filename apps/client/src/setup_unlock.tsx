import { useState } from "preact/hooks";

import { t } from "./services/i18n";
import server from "./services/server";
import { setSetupAuthToken } from "./services/setup_auth";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import FormGroup from "./widgets/react/FormGroup";
import FormTextBox from "./widgets/react/FormTextBox";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";

/**
 * The password of the knowledge base the wizard is standing over.
 *
 * Ordinarily setup is the one part of Trilium nobody has to log into, and rightly so: it runs where
 * there is no database and therefore nobody to be. An instance the app sent back here is the other
 * case, and on a server it is served to whoever can reach the port, with a whole knowledge base one
 * button away from being replaced. So this comes first, before the wizard will say or do anything.
 *
 * Asked for only where it can be answered and where it is worth asking: a first run has no password
 * to check against, and the desktop's own window is not reachable by anyone the desktop is not.
 *
 * @param onUnlocked the wizard may carry on.
 *
 * @module
 */
export default function SetupUnlock({ onUnlocked }: { onUnlocked: () => void }) {
    const [ password, setPassword ] = useState("");
    const [ wrong, setWrong ] = useState(false);
    const [ busy, setBusy ] = useState(false);

    async function unlock() {
        setBusy(true);
        try {
            const { authenticated, token } = await server.post<{ authenticated: boolean; token?: string }>(
                "setup/auth", { password });

            if (!authenticated || !token) {
                setWrong(true);
                return;
            }

            setSetupAuthToken(token);
            onUnlocked();
        } finally {
            setBusy(false);
        }
    }

    return (
        <SetupPage
            className="setup-unlock"
            title={t("setup.unlock-title")}
            description={t("setup.unlock-description")}
            illustration={<Icon icon="bx bx-lock-alt" className="illustration-icon" />}
            footer={
                <Button
                    text={t("setup.continue")}
                    kind="primary"
                    disabled={!password || busy}
                    onClick={() => void unlock()}
                />
            }
        >
            <form onSubmit={(e) => {
                e.preventDefault();
                if (password && !busy) {
                    void unlock();
                }
            }}>
                <Card>
                    <CardSection>
                        <FormGroup
                            label={t("setup.unlock-password")} name="setupPassword"
                            error={wrong ? t("setup.wrong-password") : undefined}
                        >
                            <FormTextBox
                                type="password"
                                currentValue={password}
                                onChange={(value) => {
                                    setPassword(value);
                                    setWrong(false);
                                }}
                                autocomplete="current-password"
                                required
                            />
                        </FormGroup>
                    </CardSection>
                </Card>
            </form>
        </SetupPage>
    );
}
