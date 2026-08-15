import type { AiQuickActionFooter } from "@triliumnext/ckeditor5";
import type { LlmChatConfig } from "@triliumnext/commons";

import { t } from "../../../services/i18n.js";
import { type ModelOption, readSelectedModels, resolveSelectedModel } from "../../../services/llm_providers.js";
import options from "../../../services/options.js";
import { shortModelName } from "../llm_chat/model_name.js";

/**
 * The row closing the assistant's menu: which model a run speaks to, and a submenu to change it.
 *
 * The models are the ones the chat's own picker lists — both read `llmProviders` through
 * `readSelectedModels`, so the two can never disagree about what is on offer. What differs is where
 * the *choice* is kept: a chat stores it in its own note, and the assistant has no note of its own,
 * so it goes to the synced `aiAssistantModel` option and holds across notes and devices.
 *
 * Returns nothing when there is one model or none to choose between — a picker offering a single
 * answer is a row that only takes up space.
 */
export function buildAiModelPicker(): AiQuickActionFooter[] {
    const { models, groups } = readSelectedModels();
    if (models.length < 2) {
        return [];
    }

    // The same model can be reached through two configured providers, so the rows have to say which
    // one they mean — but only where there is more than one to confuse them with.
    const name = (model: ModelOption) => {
        const short = shortModelName(model.name, model.provider);
        return groups.length > 1 && model.providerName ? `${short} (${model.providerName})` : short;
    };

    const current = resolveStoredModel(models);
    return [{
        label: t("ai_assistant.model", { model: current ? name(current) : t("ai_assistant.model_default") }),
        iconClass: "bx bx-chip",
        children: models.map((model) => ({
            label: name(model),
            // The tick every checked row in Trilium wears, and the reserver that keeps the labels
            // of the unticked ones lined up with it.
            iconClass: model === current ? "bx bx-check" : "bx bx-empty",
            run: () => void options.save("aiAssistantModel", JSON.stringify({
                model: model.id,
                provider: model.provider,
                providerId: model.providerId
            } satisfies StoredModel))
        }))
    }];
}

/**
 * The model a run should use: the stored one while it is still on offer, and otherwise the same
 * first-provider default the assistant used before there was anything to store — a model can be
 * deselected or its provider deleted long after it was picked.
 *
 * The provider is always named, even when no model can be: the server falls back to
 * `getProviderByType("anthropic")` for a request that names none (`runChat` in
 * `packages/trilium-core/src/services/llm/chat.ts`), which would fail outright for an
 * OpenAI-only setup and silently use the wrong provider for a mixed one. Naming the provider
 * without a model instead lets the server resolve that provider's own default.
 */
export function pickModel(): LlmChatConfig {
    const { models, groups } = readSelectedModels();

    const chosen = resolveStoredModel(models) ?? models.find((model) => model.isDefault) ?? models[0];
    if (chosen) {
        return { model: chosen.id, provider: chosen.provider, providerId: chosen.providerId };
    }

    const [first] = groups;
    return first ? { provider: first.provider, providerId: first.id } : {};
}

/** What the `aiAssistantModel` option holds — the three fields it takes to name a model exactly. */
interface StoredModel {
    model: string;
    provider?: string;
    providerId?: string;
}

function resolveStoredModel(models: ModelOption[]): ModelOption | undefined {
    const stored = options.getJson("aiAssistantModel") as StoredModel | null;
    return stored
        ? resolveSelectedModel(models, stored.model, stored.provider, stored.providerId)
        : undefined;
}

