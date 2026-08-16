import { useCallback, useMemo } from "preact/hooks";

import { type ExperimentalFeatureId, getAvailableExperimentalFeatures } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import FormText from "../../react/FormText";
import { useTriliumOptionJson } from "../../react/hooks";
import OptionsPageHeader from "./components/OptionsPageHeader";
import { OptionsRowWithButton, OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function AdvancedSettings() {
    return <>
        <OptionsPageHeader />
        <ExperimentalOptions />
        <AdvancedSyncOptions />
    </>;
}

function ExperimentalOptions() {
    const [enabledFeatures, setEnabledFeatures] = useTriliumOptionJson<ExperimentalFeatureId[]>("experimentalFeatures", true);
    // Features with dedicated controls elsewhere (appearance settings and the AI/LLM page, respectively).
    const integratedFeatures: ExperimentalFeatureId[] = ["new-layout", "llm"];
    const filteredFeatures = useMemo(() => getAvailableExperimentalFeatures().filter(e => !integratedFeatures.includes(e.id)), []);

    const toggleFeature = useCallback((featureId: ExperimentalFeatureId, enabled: boolean) => {
        if (enabled) {
            setEnabledFeatures([...enabledFeatures, featureId]);
        } else {
            setEnabledFeatures(enabledFeatures.filter(id => id !== featureId));
        }
    }, [enabledFeatures, setEnabledFeatures]);

    if (filteredFeatures.length === 0) {
        return null;
    }

    return (
        <OptionsSection title={t("experimental_features.title")}>
            <FormText>{t("experimental_features.disclaimer")}</FormText>

            {filteredFeatures.map((feature) => (
                <OptionsRowWithToggle
                    key={feature.id}
                    name={`experimental-${feature.id}`}
                    label={feature.name}
                    description={feature.description}
                    currentValue={enabledFeatures.includes(feature.id)}
                    onChange={(enabled) => toggleFeature(feature.id, enabled)}
                />
            ))}
        </OptionsSection>
    );
}

function AdvancedSyncOptions() {
    return (
        <OptionsSection title={t("sync.title")}>
            <OptionsRowWithButton
                label={t("sync.force_full_sync_label")}
                description={t("sync.force_full_sync_description")}
                buttonText={t("sync.force_full_sync_button")}
                onClick={async () => {
                    await server.post("sync/force-full-sync");
                    toast.showMessage(t("sync.full_sync_triggered"));
                }}
            />

            <OptionsRowWithButton
                label={t("sync.fill_entity_changes_label")}
                description={t("sync.fill_entity_changes_description")}
                buttonText={t("sync.fill_entity_changes_button")}
                onClick={async () => {
                    toast.showMessage(t("sync.filling_entity_changes"));
                    await server.post("sync/fill-entity-changes");
                    toast.showMessage(t("sync.sync_rows_filled_successfully"));
                }}
            />
        </OptionsSection>
    );
}
