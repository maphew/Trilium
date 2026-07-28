import * as parseRangeHeaderModule from "./parseRangeHeader.js";
import * as utils from "./utils.js";
import { ContentDoesNotExistError } from "./ContentDoesNotExistError.js";
import { createPartialContentHandler } from "./createPartialContentHandler.js";
import type { ContentProvider } from "./ContentProvider.js";
import type { Logger } from "./Logger.js";
import type { Request, Response } from "express";
import type { Content } from "./Content.js";
import { Stream } from "stream";
import type { Range } from "./Range.js";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createPartialContentHandler tests", () => {
  let logger: Logger;
  beforeEach(() => {
    logger = {
      debug: vi.fn() as (message: string, extra?: any) => void
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("returns a handler", () => {
    const contentProvider = vi.fn().mockResolvedValue({}) as ContentProvider<{}>;
    const handler = createPartialContentHandler(contentProvider, logger);
    expect(typeof handler === "function");
  });

  describe("handler tests", () => {
    let req: Request;
    let res: Response;
    let statusSpy: MockInstance;
    let sendSpy: MockInstance;
    let sendStatusSpy: MockInstance;
    beforeEach(() => {
      // `headers` must exist: getRangeHeader reads `req.headers["range"]`, so a bare `{}` makes the
      // handler reject with a TypeError before it reaches anything worth asserting.
      req = { headers: {} } as unknown as Request;
      res = {
        status: (code: number) => res,
        send: (message: string) => res,
        sendStatus: (code: number) => res,
        setHeader: vi.fn() as (name: string, value: string) => void
      } as Response;
      statusSpy = vi.spyOn(res, "status");
      sendSpy = vi.spyOn(res, "send");
      sendStatusSpy = vi.spyOn(res, "sendStatus");
    });
    it("invokes contentProvider with the specified request", async () => {
      const contentProvider = vi.fn().mockResolvedValue({}) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      try {
        await handler(req, res);
      } catch {}
      expect(contentProvider).toHaveBeenCalledExactlyOnceWith(req);
    });
    it("returns 404 if contentProvider throws ContentDoesNotExistError error", async () => {
      const error = new ContentDoesNotExistError("404-File not found!");
      const contentProvider = vi.fn().mockRejectedValue(error) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      await handler(req, res);
      expect(statusSpy).toHaveBeenCalledExactlyOnceWith(404);
      expect(sendSpy).toHaveBeenCalledExactlyOnceWith(error.message);
    });
    it("returns 500 if contentProvider throws any other error", async () => {
      const error = new Error("Something went wrong!");
      const contentProvider = vi.fn().mockRejectedValue(error) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      await handler(req, res);
      expect(sendStatusSpy).toHaveBeenCalledExactlyOnceWith(500);
    });
    it("returns 416 if parseRangeHeader throws RangeParserError error", async () => {
      const contentProvider = vi.fn().mockResolvedValue({ totalSize: 20 }) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      req.headers = { range: "bytes=30-10" };
      await handler(req, res);
      expect(statusSpy).toHaveBeenCalledExactlyOnceWith(416);
      expect(sendSpy).toHaveBeenCalledExactlyOnceWith("Invalid value for Range: bytes=30-10");
    });
    it("returns 500 if parseRangeHeader throws any other error", async () => {
      // Only a RangeParserError maps to 416; anything else escaping the parser is a server fault.
      vi.spyOn(parseRangeHeaderModule, "parseRangeHeader").mockImplementation(() => {
        throw new Error("Something went wrong!");
      });
      const contentProvider = vi.fn().mockResolvedValue({ totalSize: 10 }) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      req.headers = { range: "bytes=0-5" };
      await handler(req, res);
      expect(sendStatusSpy).toHaveBeenCalledExactlyOnceWith(500);
      expect(statusSpy).not.toHaveBeenCalled();
    });
    it("returns correct response if range is not specified", async () => {
      const result = ({
        pipe() {
          return result;
        }
      } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        getStream(range?: Range) {
          return result;
        }
      };
      const pipeSpy = vi.spyOn(result, "pipe");
      const getStreamSpy = vi.spyOn(content, "getStream");
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setContentTypeHeaderSpy = vi.spyOn(utils, "setContentTypeHeader");
      const setContentDispositionHeaderSpy = vi.spyOn(utils, "setContentDispositionHeader");
      const setAcceptRangesHeaderSpy = vi.spyOn(utils, "setAcceptRangesHeader");
      const setContentLengthHeaderSpy = vi.spyOn(utils, "setContentLengthHeader");
      const setContentRangeHeaderSpy = vi.spyOn(utils, "setContentRangeHeader");
      await handler(req, res);
      expect(setContentTypeHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.mimeType, res);
      expect(setContentDispositionHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.fileName, res);
      expect(setAcceptRangesHeaderSpy).toHaveBeenCalledExactlyOnceWith(res);
      expect(setContentLengthHeaderSpy).toHaveBeenCalledExactlyOnceWith(String(content.totalSize), res);
      expect(getStreamSpy).toHaveBeenCalledExactlyOnceWith();
      expect(pipeSpy).toHaveBeenCalledExactlyOnceWith(res);
      expect(setContentRangeHeaderSpy).not.toHaveBeenCalled();
    });
    it("returns correct partial response if range is specified", async () => {
      req.headers = {
        range: "bytes=0-5"
      };
      const result = ({
        pipe() {
          return result;
        }
      } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        getStream(range?: Range) {
          return result;
        }
      };
      const range = { start: 0, end: 5 };
      const pipeSpy = vi.spyOn(result, "pipe");
      const getStreamSpy = vi.spyOn(content, "getStream");
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setContentTypeHeaderSpy = vi.spyOn(utils, "setContentTypeHeader");
      const setContentDispositionHeaderSpy = vi.spyOn(utils, "setContentDispositionHeader");
      const setAcceptRangesHeaderSpy = vi.spyOn(utils, "setAcceptRangesHeader");
      const setContentLengthHeaderSpy = vi.spyOn(utils, "setContentLengthHeader");
      const setContentRangeHeaderSpy = vi.spyOn(utils, "setContentRangeHeader");
      await handler(req, res);
      expect(setContentTypeHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.mimeType, res);
      expect(setContentDispositionHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.fileName, res);
      expect(setAcceptRangesHeaderSpy).toHaveBeenCalledExactlyOnceWith(res);
      expect(setContentRangeHeaderSpy).toHaveBeenCalledExactlyOnceWith(range, content.totalSize, res);
      expect(setContentLengthHeaderSpy).toHaveBeenCalledExactlyOnceWith("6", res);
      expect(getStreamSpy).toHaveBeenCalledExactlyOnceWith(range);
      expect(pipeSpy).toHaveBeenCalledExactlyOnceWith(res);
      expect(statusSpy).toHaveBeenCalledExactlyOnceWith(206);
    });
    it("reports a zero content length for a single-byte-collapsed range", async () => {
      // `bytes=5-5` parses to start === end, which the handler reports as length 0 rather than 1.
      req.headers = { range: "bytes=5-5" };
      const result = ({ pipe() { return result; } } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        getStream(range?: Range) {
          return result;
        }
      };
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setContentLengthHeaderSpy = vi.spyOn(utils, "setContentLengthHeader");
      await handler(req, res);
      expect(setContentLengthHeaderSpy).toHaveBeenCalledExactlyOnceWith("0", res);
    });
    it("sets the ETag header when the content provides one", async () => {
      req.headers = { range: "bytes=0-5" };
      const result = ({ pipe() { return result; } } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        etag: "abc123",
        getStream(range?: Range) {
          return result;
        }
      };
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setETagHeaderSpy = vi.spyOn(utils, "setETagHeader");
      await handler(req, res);
      expect(setETagHeaderSpy).toHaveBeenCalledExactlyOnceWith("abc123", res);
    });
    it("does not set the ETag header when the content omits one", async () => {
      req.headers = { range: "bytes=0-5" };
      const result = ({ pipe() { return result; } } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        getStream(range?: Range) {
          return result;
        }
      };
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider<{}>;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setETagHeaderSpy = vi.spyOn(utils, "setETagHeader");
      await handler(req, res);
      expect(setETagHeaderSpy).not.toHaveBeenCalled();
    });
  });
});
