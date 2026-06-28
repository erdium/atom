import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
declare const webSearchSchema: Type.TObject<{
    query: Type.TString;
}>;
export type WebSearchToolInput = Static<typeof webSearchSchema>;
interface SearchResult {
    url: string;
    title: string;
    snippet: string;
    content: string;
}
export declare function createWebSearchToolDefinition(): ToolDefinition<typeof webSearchSchema, SearchResult[]>;
export declare function createWebSearchTool(): AgentTool<typeof webSearchSchema>;
export {};
//# sourceMappingURL=web-search.d.ts.map