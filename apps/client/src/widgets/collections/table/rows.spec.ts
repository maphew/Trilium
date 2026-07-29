import { describe, expect, it } from "vitest";
import { buildNote } from "../../../test/easy-froca";
import getAttributeDefinitionInformation from "./rows.js";

describe("getAttributeDefinitionInformation", () => {
    it("handles attributes with colons in their names", async () => {
        const note = buildNote({
            title: "Note 1",
            "#label:TEST:TEST1(inheritable)": "promoted,alias=Test1,single,text",
            "#label:Test_Test2(inheritable)": "promoted,alias=Test2,single,text",
            "#label:TEST:Test3(inheritable)": "promoted,alias=test3,single,text",
            "#relation:TEST:TEST4(inheritable)": "promoted,alias=Test4,single",
            "#relation:TEST:TEST5(inheritable)": "promoted,alias=Test5,single",
            "#label:_TEST:TEST:TEST:Test1(inheritable)": "promoted,alias=Test01,single,text"
        });
        const infos = getAttributeDefinitionInformation(note);
        expect(infos).toMatchObject([
            { name: "TEST:TEST1", type: "text" },
            { name: "Test_Test2", type: "text" },
            { name: "TEST:Test3", type: "text" },
            { name: "TEST:TEST4", type: "relation" },
            { name: "TEST:TEST5", type: "relation" },
            { name: "_TEST:TEST:TEST:Test1", type: "text" }
        ]);
    });

    it("holds several values of the types a set means something for, and one of the rest", async () => {
        const note = buildNote({
            title: "Note 1",
            "#label:tags(inheritable)": "promoted,multi,text",
            "#label:due(inheritable)": "promoted,multi,date",
            "#label:site(inheritable)": "promoted,multi,url",
            "#label:status(inheritable)": "promoted,multi,select,options=Todo;Done",
            // A flag means what it means by being there at all, so several are the same one flag;
            // a colour is a single quality of the thing it describes.
            "#label:done(inheritable)": "promoted,multi,boolean",
            "#label:tint(inheritable)": "promoted,multi,color",
            "#label:owner(inheritable)": "promoted,single,text"
        });

        // Those left out still have a column — one holding the first value, as before they were
        // declared to hold many. They used to be dropped from the table altogether.
        expect(getAttributeDefinitionInformation(note)).toMatchObject([
            { name: "tags", type: "text", isMulti: true },
            { name: "due", type: "date", isMulti: true },
            { name: "site", type: "url", isMulti: true },
            { name: "status", type: "select", isMulti: true },
            { name: "done", type: "boolean", isMulti: false },
            { name: "tint", type: "color", isMulti: false },
            { name: "owner", type: "text", isMulti: false }
        ]);
    });
});
