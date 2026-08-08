import { describe, expect, it } from "vitest";

import { asFileName, tidyFilesystemFriendlyName, toFilesystemFriendlyName } from "./filesystem_name.js";

describe("what a file name may hold", () => {
    it("keeps everything a file name can carry, other scripts included", () => {
        expect(toFilesystemFriendlyName("Backup 2026-08-08 16-30-32"))
            .toBe("Backup 2026-08-08 16-30-32");
        expect(toFilesystemFriendlyName("Sicherungskopie (Änderungen)"))
            .toBe("Sicherungskopie (Änderungen)");
        expect(toFilesystemFriendlyName("備份")).toBe("備份");
    });

    it("drops what no filesystem would take", () => {
        expect(toFilesystemFriendlyName('a<b>c:d"e/f\\g|h?i*j')).toBe("abcdefghij");
        // Control characters, which cannot be written down as themselves here.
        expect(toFilesystemFriendlyName(`before${String.fromCharCode(1)}after${String.fromCharCode(31)}end`))
            .toBe("beforeafterend");
    });

    it("leaves a half-typed name alone, since it runs on every keystroke", () => {
        // A trailing space or dot is on its way to becoming a word; tidying here would delete what
        // the user is in the middle of typing.
        expect(toFilesystemFriendlyName("Before the ")).toBe("Before the ");
        expect(toFilesystemFriendlyName("v1.")).toBe("v1.");
    });

    it("tidies the edges only once the name is finished", () => {
        expect(tidyFilesystemFriendlyName("  Before the import  ")).toBe("Before the import");
        // Legal to type, impossible to save on Windows.
        expect(tidyFilesystemFriendlyName("My backup...")).toBe("My backup");
        expect(tidyFilesystemFriendlyName("mixed. . ")).toBe("mixed");
    });
});

describe("asFileName", () => {
    it("hands back the tidied name where there is one to be had", () => {
        expect(asFileName("  Trilium data (2026-08-08 16-30-32) ")).toBe("Trilium data (2026-08-08 16-30-32)");
    });

    it("refuses a name that nothing usable is left of", () => {
        expect(asFileName("")).toBeNull();
        expect(asFileName("  ///  ")).toBeNull();
        expect(asFileName("...")).toBeNull();
    });

    it("refuses the device names Windows keeps for itself, in any case", () => {
        // A file called this cannot be created there whatever extension is put on the end of it.
        expect(asFileName("NUL")).toBeNull();
        expect(asFileName("com1")).toBeNull();
        expect(asFileName("Aux")).toBeNull();
        // Only the names themselves, not everything starting with them.
        expect(asFileName("nullify")).toBe("nullify");
    });

    it("never answers with something that reaches outside the directory it is resolved against", () => {
        // A name arriving over a request is not a name any field has vetted, and the side that
        // opens the file resolves it against a directory of its own choosing.
        expect(asFileName("../../etc/passwd")).toBe("....etcpasswd");
        expect(asFileName("..\\..\\Windows\\System32")).toBe("....WindowsSystem32");
        expect(asFileName("/absolute/path")).toBe("absolutepath");
        expect(asFileName("..")).toBeNull();
    });
});
