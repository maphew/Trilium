import { statSync } from "fs";
import { join } from "path";

import BuildHelper from "../../../scripts/build-utils";

const build = new BuildHelper("apps/server");

/** Generous next to the few KB the probe needs, far below what a stray import costs. */
const HEALTHCHECK_MAX_KB = 100;

async function main() {
    await build.buildBackend([ "src/main.ts", "src/docker_healthcheck.ts" ])
    // Its own call so it lands beside the bundle rather than under a `services/` path: the pool
    // looks for it next to whatever is running, and desktop builds it the same way.
    await build.buildBackend([ "src/services/image_worker.ts" ]);

    // Copy assets
    build.copy("src/assets", "assets/");
    // schema.sql lives in trilium-core but is loaded at server startup. The
    // bundled main.cjs can't `require.resolve("@triliumnext/core/...")` in
    // Docker (no workspace symlinks in the image), so we copy the file
    // alongside the server's own assets and read it via RESOURCE_DIR at
    // runtime. See main.ts.
    build.copy("/packages/trilium-core/src/assets/schema.sql", "assets/schema.sql");
    // Same story for the LLM skill sheets: core owns them, the server reads them
    // from RESOURCE_DIR at runtime. See core_assets.ts.
    build.copy("/packages/trilium-core/src/assets/llm/skills", "assets/llm/skills/");
    build.triggerBuildAndCopyTo("packages/share-theme", "share-theme/assets/");
    build.copy("/packages/share-theme/src/templates", "share-theme/templates/");

    // Copy node modules dependencies
    build.copyNodeModules([ "better-sqlite3" ]);
    build.trimBetterSqlite3();
    build.copy("/node_modules/ckeditor5/dist/ckeditor5-content.css", "ckeditor5-content.css");

    build.buildFrontend();

    assertHealthcheckStaysSmall();
}

/**
 * Docker runs the healthcheck every 60 seconds, and each run is a cold node process that parses
 * the whole bundle. It resolves its target in healthcheck_target.ts rather than through config.ts
 * so that it pulls in nothing else; importing a server service here costs megabytes and puts that
 * cost on every probe. The limit is generous, so tripping it means a dependency crept back in.
 */
function assertHealthcheckStaysSmall() {
    const bundle = join(build.outDir, "docker_healthcheck.cjs");
    const sizeKb = statSync(bundle).size / 1024;

    if (sizeKb > HEALTHCHECK_MAX_KB) {
        throw new Error(
            `${bundle} is ${sizeKb.toFixed(0)} KB, over the ${HEALTHCHECK_MAX_KB} KB limit. `
            + "Something it imports now pulls in a server service; keep the probe standalone."
        );
    }
}

main();
