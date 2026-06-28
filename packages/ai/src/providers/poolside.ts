import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { POOLSIDE_MODELS } from "./poolside.models.ts";

export function poolsideProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "poolside",
		name: "Poolside AI",
		baseUrl: "https://inference.poolside.ai/v1",
		auth: { apiKey: envApiKeyAuth("Poolside AI API key", ["POOLSIDE_API_KEY"]) },
		models: Object.values(POOLSIDE_MODELS),
		api: openAICompletionsApi(),
	});
}
