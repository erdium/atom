import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { POOLSIDE_MODELS } from "./poolside.models.js";
export function poolsideProvider() {
    return createProvider({
        id: "poolside",
        name: "Poolside AI",
        baseUrl: "https://inference.poolside.ai/v1",
        auth: { apiKey: envApiKeyAuth("Poolside AI API key", ["POOLSIDE_API_KEY"]) },
        models: Object.values(POOLSIDE_MODELS),
        api: openAICompletionsApi(),
    });
}
//# sourceMappingURL=poolside.js.map