import { emitProjectTrustEvent } from "./extensions/runner.js";
import { getProjectTrustOptions, hasTrustRequiringProjectResources, } from "./trust-manager.js";
function formatProjectTrustPrompt(cwd) {
    return `Confirm folder trust\n\n${cwd}\n\nAtom can read files in this folder and, with your permission, edit them or run code and shell commands. It will remember your permissions for the rest of this session.\n\nDo you trust the files in this folder?`;
}
async function selectProjectTrustOption(cwd, ctx) {
    const options = getProjectTrustOptions(cwd, { includeSessionOnly: true });
    const selected = await ctx.ui.select(formatProjectTrustPrompt(cwd), options.map((option) => option.label));
    return options.find((option) => option.label === selected);
}
function saveProjectTrustPromptResult(trustStore, result) {
    if (result.updates.length > 0) {
        trustStore.setMany(result.updates);
    }
}
export async function resolveProjectTrusted(options) {
    if (options.trustOverride !== undefined) {
        return options.trustOverride;
    }
    if (!hasTrustRequiringProjectResources(options.cwd)) {
        return true;
    }
    if (options.extensionsResult) {
        const { result, errors } = await emitProjectTrustEvent(options.extensionsResult, { type: "project_trust", cwd: options.cwd }, options.projectTrustContext);
        for (const error of errors) {
            options.onExtensionError?.(`Extension "${error.extensionPath}" project_trust error: ${error.error}`);
        }
        if (result) {
            const trusted = result.trusted === "yes";
            if (result.remember === true) {
                options.trustStore.set(options.cwd, trusted);
            }
            return trusted;
        }
    }
    const decision = options.trustStore.get(options.cwd);
    if (decision !== null) {
        return decision;
    }
    switch (options.defaultProjectTrust ?? "ask") {
        case "always":
            return true;
        case "never":
            return false;
        case "ask":
            break;
    }
    if (!options.projectTrustContext.hasUI) {
        return false;
    }
    const selected = await selectProjectTrustOption(options.cwd, options.projectTrustContext);
    if (selected !== undefined) {
        saveProjectTrustPromptResult(options.trustStore, selected);
        return selected.trusted;
    }
    return false;
}
//# sourceMappingURL=project-trust.js.map