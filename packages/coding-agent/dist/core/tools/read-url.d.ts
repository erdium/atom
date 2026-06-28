import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
declare const readUrlSchema: Type.TObject<{
    url: Type.TString;
}>;
export type ReadUrlToolInput = Static<typeof readUrlSchema>;
export declare function createReadUrlToolDefinition(): ToolDefinition<typeof readUrlSchema, number>;
export declare function createReadUrlTool(): AgentTool<typeof readUrlSchema>;
export {};
//# sourceMappingURL=read-url.d.ts.map