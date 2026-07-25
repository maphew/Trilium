{
  description = "Trilium Notes (experimental flake)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    pnpm2nix = {
      url = "github:FliegendeWurst/pnpm2nix-nzbr/main";
      inputs = {
        flake-utils.follows = "flake-utils";
        nixpkgs.follows = "nixpkgs";
      };
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pnpm2nix,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        electronVersion = packageJsonDesktop.devDependencies.electron;
        electronFromNixpkgs = pkgs."electron_${lib.versions.major electronVersion}";

        # nixpkgs lags behind the Electron version pinned in apps/desktop/package.json
        # (electron_42 is still 42.5.1), and its source build cannot be bumped without
        # upstream's Chromium dependency hashes. Build the exact pinned version from
        # Electron's official binary release instead, reusing the nixpkgs builder.
        #
        # When bumping Electron, refresh these hashes:
        #   zips:    curl -sL https://github.com/electron/electron/releases/download/v<version>/SHASUMS256.txt
        #   headers: nix-prefetch-url --unpack https://artifacts.electronjs.org/headers/dist/v<version>/node-v<version>-headers.tar.gz
        pinnedElectronVersion = "42.7.1";
        pinnedElectronHashes = {
          x86_64-linux = "e85b28245deaa75c3c4f2cf5da084f4c7fbedd5af1630c59a827c41ac1f5e1af";
          armv7l-linux = "32d446a7a8f1f430c2030a1b2cd4220e52f95d24a607db28539b00ac6141c1d5";
          aarch64-linux = "ba1f8055a6b601e9cd771a7c750ed37b912c486a51f51e58654ed9414bc898ba";
          x86_64-darwin = "a2f361b66b24b694715b057a9d4ba8c30457ce994e19acd9185c131539bc8900";
          aarch64-darwin = "13b7c3782ac73ba64410542410a2d06f022c515730e97c5149aff2190a6c8e80";
          headers = "1aidb6q7hfz0569qm8ah77dgw2zzp157ls1kbs0ylsifgvxc0zkd";
        };
        mkElectronBin = pkgs.callPackage (
          pkgs.path + "/pkgs/development/tools/electron/binary/generic.nix"
        ) { };

        electron =
          if electronFromNixpkgs.version == electronVersion then
            electronFromNixpkgs
          else
            lib.throwIf (pinnedElectronVersion != electronVersion) ''
              flake.nix pins Electron ${pinnedElectronVersion}, but apps/desktop/package.json wants ${electronVersion}.
              Refresh pinnedElectronVersion/pinnedElectronHashes in flake.nix, or drop the override if nixpkgs ships ${electronVersion}.
            '' (mkElectronBin pinnedElectronVersion pinnedElectronHashes);

        nodejs = pkgs.nodejs_24;
        # pnpm creates an overly long PATH env variable for child processes.
        # This patch deduplicates entries in PATH, which results in an equivalent but shorter entry.
        # https://github.com/pnpm/pnpm/issues/6106
        # https://github.com/pnpm/pnpm/issues/8552
        pnpm = (pkgs.pnpm_11.overrideAttrs (prev: {
          postInstall = prev.postInstall + ''
            patch $out/libexec/pnpm/dist/pnpm.mjs ${./patches/pnpm-PATH-reduction.patch}
          '';
          # pnpm sometimes fails with ERR_PNPM_ENOENT
          # https://github.com/pnpm/pnpm/issues/12880
          # "fix" from https://github.com/dniku/selfhostblocks/commit/ee6fc4f04fe34714fb8676704048d8d76aba85b7
          postFixup = (prev.postFixup or "") + (if pkgs.stdenv.hostPlatform.isLinux then ''
            mv "$out/bin/pnpm" "$out/bin/.pnpm-unwrapped"
            cat > "$out/bin/pnpm" <<EOF
            #!${stdenv.shell}
            if [ "\''${1-}" = install ]; then
              cpuMask="\$(${lib.getExe' pkgs.util-linux "taskset"} -cp "\$\$")"
              # Keep only the cpuset reported after the colon.
              cpuMask="\''${cpuMask##*: }"
              # Pick the first comma-separated segment from the cpuset.
              firstCpu="\''${cpuMask%%,*}"
              # If that segment is a range, pick its first CPU.
              firstCpu="\''${firstCpu%%-*}"
              exec ${lib.getExe' pkgs.util-linux "taskset"} -c "\$firstCpu" "$out/bin/.pnpm-unwrapped" "\$@"
            else
              exec "$out/bin/.pnpm-unwrapped" "\$@"
            fi
            EOF
            chmod +x "$out/bin/pnpm"
          '' else "");
        }));
        inherit (pkgs)
          copyDesktopItems
          darwin
          lib
          makeBinaryWrapper
          makeDesktopItem
          makeShellWrapper
removeReferencesTo
          stdenv
          wrapGAppsHook3
          xcodebuild
          which
          ;

        fullCleanSourceFilter =
          name: type:
          (lib.cleanSourceFilter name type)
          && (
            let
              baseName = baseNameOf (toString name);
            in
            # No need to copy the flake.
            # No need to copy local copy of node_modules.
            baseName != "flake.nix" && baseName != "flake.lock" && baseName != "node_modules"
          );
        fullCleanSource =
          src:
          lib.cleanSourceWith {
            filter = fullCleanSourceFilter;
            src = src;
          };

        # Minimal source used for pnpm2nix's dependency-fetching derivation.
        # Only the files pnpm actually needs to resolve and fetch dependencies
        # are included, so unrelated source changes don't bust the deps cache.
        workspaceSourceFilter =
          name: type:
          let
            baseName = baseNameOf (toString name);
            rootStr = toString ./.;
            relPath = lib.removePrefix "${rootStr}/" (toString name);
            inPatches = relPath == "patches" || lib.hasPrefix "patches/" relPath;
          in
          (lib.cleanSourceFilter name type)
          && baseName != "node_modules"
          && (
            type == "directory"
            || baseName == "package.json"
            || baseName == "pnpm-workspace.yaml"
            || baseName == "pnpm-lock.yaml"
            || inPatches
          );
        workspaceSource = lib.cleanSourceWith {
          filter = workspaceSourceFilter;
          src = ./.;
        };
        packageJson = builtins.fromJSON (builtins.readFile ./package.json);
        packageJsonDesktop = builtins.fromJSON (builtins.readFile ./apps/desktop/package.json);

        makeApp =
          {
            app,
            buildTask,
            mainProgram,
            installCommands,
            preBuildCommands ? "",
          }:
          pnpm2nix.packages.${system}.mkPnpmPackage rec {
            pname = "trilium-${app}";
            version = packageJson.version + (lib.optionalString (self ? shortRev) "-${self.shortRev}");

            src = fullCleanSource ./.;
            packageJSON = ./package.json;
            pnpmLockYaml = ./pnpm-lock.yaml;

            workspace = workspaceSource;
            pnpmWorkspaceYaml = ./pnpm-workspace.yaml;

            inherit nodejs pnpm;

            extraNodeModuleSources = [
              rec {
                name = "patches";
                value = ./patches;
              }
            ];

            # avoid ERR_PNPM_RESOLUTION_SHAPE_MISMATCH errors
            env.PNPM_CONFIG_TRUST_LOCKFILE = "true";

            # remove pnpm version override
            preConfigure = ''
              node -e "const p = require('./package.json'); delete p.packageManager; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n')"
            '';

            postConfigure =
              ''
                chmod +x node_modules/electron/install.js
                patchShebangs --build node_modules
              '';

            extraNativeBuildInputs =
              [
nodejs.python
                removeReferencesTo
              ]
              ++ lib.optionals (app == "desktop" || app == "edit-docs") [
                copyDesktopItems
                # required for NIXOS_OZONE_WL expansion
                # https://github.com/NixOS/nixpkgs/issues/172583
                makeShellWrapper
                wrapGAppsHook3

                # For the launcher wrapper generated in installCommands:
                which
                electron
              ]
              ++ lib.optionals (app == "server" || app == "build-docs") [
                makeBinaryWrapper
              ]
              ++ lib.optionals stdenv.hostPlatform.isDarwin [
                xcodebuild
                darwin.cctools
              ];
            dontWrapGApps = true;

            preBuild = ''
              ${preBuildCommands}
            '';

            scriptFull = "pnpm run ${buildTask}";

            installPhase = ''
              runHook preInstall

              ${installCommands}

              runHook postInstall
            '';

            # Symlinks pointing to /build directory are not allowed in the Nix store.
            # This removes all dangling symlinks that point to the temporary build directory.
            postFixup = ''
              find $out/opt -type l -lname '/build/*' -delete || true
            '';

            components = [
              "packages/ckeditor5"
              "packages/ckeditor5-admonition"
              "packages/ckeditor5-footnotes"
              "packages/ckeditor5-keyboard-marker"
              "packages/ckeditor5-math"
              "packages/ckeditor5-mermaid"
              "packages/codemirror"
              "packages/commons"
              "packages/express-partial-content"
              "packages/highlightjs"
              "packages/turndown-plugin-gfm"

              "apps/build-docs"
              "apps/client"
              "apps/db-compare"
              "apps/desktop"
              "apps/dump-db"
              "apps/edit-docs"
              "apps/server"
              "packages/trilium-e2e"
            ];

            desktopItems = lib.optionals (app == "desktop") [
              (makeDesktopItem {
                name = "Trilium Notes";
                exec = meta.mainProgram;
                icon = "trilium";
                comment = meta.description;
                desktopName = "Trilium Notes";
                categories = [ "Office" ];
                startupWMClass = "Trilium Notes";
              })
            ];

            meta = {
              description = "Trilium: ${app}";
              inherit mainProgram;
            };
          };

        desktop = makeApp {
          app = "desktop";
          # better-sqlite3 v13 is N-API based and ships prebuilt binaries that
          # load unchanged under Electron, so there is no native rebuild step
          # (and no need for ELECTRON_NODEDIR) any more.
          preBuildCommands = ''
            pnpm postinstall
          '';
          buildTask = "desktop:build";
          mainProgram = "trilium";
          installCommands = ''
            mkdir -p $out/{bin,share/icons/hicolor/512x512/apps,opt/trilium}
            cp --archive apps/desktop/dist/* $out/opt/trilium
            cp apps/client/src/assets/icon.png $out/share/icons/hicolor/512x512/apps/trilium.png
            makeShellWrapper ${lib.getExe electron} $out/bin/trilium \
              "''${gappsWrapperArgs[@]}" \
              --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}" \
              --set-default ELECTRON_IS_DEV 0 \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium \
              --add-flags $out/opt/trilium/main.cjs
          '';
        };

        server = makeApp {
          app = "server";
          # Important note: if pnpm throws an error similar to the follow at the end of `pnpm rebuild`,
          # you should ensure the version of tsx (and other dependencies mentioned in the error) is identical project-wide.
          # ERR_PNPM_MISSING_HOISTED_LOCATIONS
          # vite@7.1.5(@types/node@24.3.0)(jiti@2.5.1)(less@4.1.3)(lightningcss@1.30.1)
          # (sass-embedded@1.91.0)(sass@1.91.0)(terser@5.43.1)(tsx@4.20.5)(yaml@2.8.1)
          # is not found in hoistedLocations inside node_modules/.modules.yaml
          preBuildCommands = ''
            pushd apps/server
            pnpm rebuild
            popd
          '';
          buildTask = "server:build";
          mainProgram = "trilium-server";
          installCommands = ''
            #remove-references-to -t ${nodejs.python} apps/server/dist/node_modules/better-sqlite3/build/config.gypi
            #remove-references-to -t ${pnpm} apps/server/dist/node_modules/better-sqlite3/build/config.gypi

            pushd apps/server/dist
            rm -rf node_modules/better-sqlite3/build/Release/obj \
                   node_modules/better-sqlite3/build/Release/obj.target \
                   node_modules/better-sqlite3/build/Release/sqlite3.a \
                   node_modules/better-sqlite3/build/{Makefile,better_sqlite3.target.mk,test_extension.target.mk,binding.Makefile} \
                   node_modules/better-sqlite3/deps/sqlite3
            popd

            mkdir -p $out/{bin,opt/trilium-server}
            cp --archive apps/server/dist/* $out/opt/trilium-server
            makeWrapper ${lib.getExe nodejs} $out/bin/trilium-server \
              --add-flags $out/opt/trilium-server/main.cjs
          '';
        };

        edit-docs = makeApp {
          app = "edit-docs";
          preBuildCommands = ''
            pnpm postinstall
          '';
          buildTask = "edit-docs:build";
          mainProgram = "trilium-edit-docs";
          installCommands = ''
            mkdir -p $out/{bin,opt/trilium-edit-docs}
            cp --archive apps/edit-docs/dist/* $out/opt/trilium-edit-docs
            makeShellWrapper ${lib.getExe electron} $out/bin/trilium-edit-docs \
              --set-default ELECTRON_IS_DEV 0 \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium-edit-docs \
              --add-flags $out/opt/trilium-edit-docs/edit-docs.cjs
          '';
        };

        build-docs = makeApp {
          app = "build-docs";
          preBuildCommands = ''
            pushd apps/server
            pnpm rebuild || true
            popd
          '';
          buildTask = "client:build && pnpm run server:build && pnpm run --filter build-docs build";
          mainProgram = "trilium-build-docs";
          installCommands = ''
            mkdir -p $out/{bin,opt/trilium-build-docs}

            # Copy build-docs dist
            cp --archive apps/build-docs/dist/* $out/opt/trilium-build-docs

            # Copy server dist (needed for runtime)
            mkdir -p $out/opt/trilium-build-docs/server
            cp --archive apps/server/dist/* $out/opt/trilium-build-docs/server/

            # Copy client dist (needed for runtime)
            mkdir -p $out/opt/trilium-build-docs/client
            cp --archive apps/client/dist/* $out/opt/trilium-build-docs/client/

            # Copy share-theme (needed for exports)
            mkdir -p $out/opt/trilium-build-docs/packages/share-theme
            cp --archive packages/share-theme/dist/* $out/opt/trilium-build-docs/packages/share-theme/

            # Create wrapper script
            makeWrapper ${lib.getExe nodejs} $out/bin/trilium-build-docs \
              --add-flags $out/opt/trilium-build-docs/cli.cjs \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium-build-docs/server
          '';
        };

      in
      {
        packages.desktop = desktop;
        packages.server = server;
        packages.edit-docs = edit-docs;
        packages.build-docs = build-docs;

        packages.default = desktop;

        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pnpm
            electron
            nodejs.python
          ];
        };
      }
    );
}
