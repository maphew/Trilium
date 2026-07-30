import { describe, expect, it } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import getAttributeDefinitionInformation, { buildRowDefinitions } from "./rows.js";

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

    it("holds several values of every kind of label, a relation excepted", async () => {
        const note = buildNote({
            title: "Note 1",
            "#label:tags(inheritable)": "promoted,multi,text",
            "#label:due(inheritable)": "promoted,multi,date",
            "#label:site(inheritable)": "promoted,multi,url",
            "#label:status(inheritable)": "promoted,multi,select,options=Todo;Done",
            "#label:tint(inheritable)": "promoted,multi,color",
            "#label:done(inheritable)": "promoted,multi,boolean",
            "#label:owner(inheritable)": "promoted,single,text"
        });

        expect(getAttributeDefinitionInformation(note)).toMatchObject([
            { name: "tags", type: "text", isMulti: true },
            { name: "due", type: "date", isMulti: true },
            { name: "site", type: "url", isMulti: true },
            { name: "status", type: "select", isMulti: true },
            { name: "tint", type: "color", isMulti: true },
            { name: "done", type: "boolean", isMulti: true },
            { name: "owner", type: "text", isMulti: false }
        ]);
    });
});

describe("buildRowDefinitions", () => {
    it("carries each relation target's title, so a relation column can sort by what it shows", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const beta = buildNote({ title: "Beta" });
        const parent = buildNote({
            title: "Collection",
            "#relation:assignee(inheritable)": "promoted,alias=Assignee,single",
            children: [
                { title: "Task 1", "~assignee": beta.noteId },
                { title: "Task 2", "~assignee": alpha.noteId },
                // A row without the relation sorts as nothing rather than as an id or a crash.
                { title: "Task 3" }
            ]
        });

        const info = getAttributeDefinitionInformation(parent);
        const { definitions } = await buildRowDefinitions(parent, info, false);
        expect(definitions).toMatchObject([
            { title: "Task 1", relations: { assignee: beta.noteId }, relationTitles: { assignee: "Beta" } },
            { title: "Task 2", relations: { assignee: alpha.noteId }, relationTitles: { assignee: "Alpha" } },
            { title: "Task 3", relations: { assignee: null }, relationTitles: { assignee: "" } }
        ]);
    });
});
