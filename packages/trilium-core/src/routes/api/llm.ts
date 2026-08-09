/**
 * LLM endpoints that every runtime can serve.
 *
 * Streaming a chat is not here: it is Server-Sent Events, which the browser
 * build's request bridge cannot carry (it answers a request with one buffered
 * body). That route stays in `apps/server` until the worker grows a chunk
 * channel of its own.
 */

import { ValidationError } from "../../errors.js";

interface ProviderModelsRequest {
    provider: string;
    apiKey?: string;
    baseURL?: string;
}

/**
 * List the live models for a provider described by raw credentials. Used by the
 * model-selection screen while adding or editing a provider — the config need
 * not be saved yet, so credentials come in the request body rather than by id.
 */
export async function getProviderModels(req: { body: ProviderModelsRequest }) {
    const { provider, apiKey, baseURL } = req.body;
    if (!provider) {
        throw new ValidationError("provider is required");
    }

    // Imported here rather than at module scope so the AI SDK lands in a lazy
    // chunk. This module is reachable from the shared route table, which the
    // standalone worker builds during startup — a static import would put
    // ~200 KB of provider SDK in that startup path for every user, whether or
    // not they have ever enabled the feature.
    const { listProviderModels } = await import("../../services/llm/index.js");

    try {
        return { models: await listProviderModels(provider, apiKey ?? "", baseURL) };
    } catch (error) {
        // A live-listing failure is almost always a bad credential or an
        // unreachable endpoint the user just entered — surface it as a 400 so
        // the model-selection screen shows the reason instead of a generic 500.
        throw new ValidationError(error instanceof Error ? error.message : String(error));
    }
}

export default {
    getProviderModels
};
