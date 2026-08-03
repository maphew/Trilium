import { describe, expect, it } from "vitest";

import { IMAGE_MIMES, IMAGE_UPLOAD_SUBTYPES, isAcceptedImageMime } from "./image_mimes.js";

describe("isAcceptedImageMime", () => {
    it("accepts every listed type and nothing else", () => {
        for (const mime of IMAGE_MIMES) {
            expect(isAcceptedImageMime(mime), mime).toBe(true);
        }

        // TIFF is deliberately absent: an <img> cannot draw one outside Safari, so it is stored as
        // a file and gets a working reference link rather than a picture that never appears.
        for (const mime of [ "image/tiff", "application/pdf", "text/plain", "image/", "png" ]) {
            expect(isAcceptedImageMime(mime), mime).toBe(false);
        }

        expect(isAcceptedImageMime(undefined)).toBe(false);
        expect(isAcceptedImageMime(null)).toBe(false);
        expect(isAcceptedImageMime("")).toBe(false);
    });

    it("recognises both spellings of an icon, and both of an SVG", () => {
        // Servers send either icon spelling, and `image/svg` turns up in place of the registered
        // `image/svg+xml` often enough to be worth recognising.
        for (const mime of [ "image/x-icon", "image/vnd.microsoft.icon", "image/svg", "image/svg+xml" ]) {
            expect(isAcceptedImageMime(mime), mime).toBe(true);
        }
    });
});

describe("IMAGE_UPLOAD_SUBTYPES", () => {
    it("is the same list with the type stripped, in the same order", () => {
        expect(IMAGE_UPLOAD_SUBTYPES).toStrictEqual(IMAGE_MIMES.map((mime) => mime.replace("image/", "")));
        // The editor builds `^image/(<joined>)$` out of these, so a subtype carrying the prefix
        // would silently match nothing.
        for (const subtype of IMAGE_UPLOAD_SUBTYPES) {
            expect(subtype, subtype).not.toContain("/");
        }
    });
});
