import { DefinitionObject, LabelType, Multiplicity } from "@triliumnext/commons";

import utils from "./utils.js";

const { filterAttributeName } = utils;

function parse(value: string) {
    const tokens = value.split(",").map((t) => t.trim());
    const defObj: DefinitionObject = {};

    for (const token of tokens) {
        if (token === "promoted") {
            defObj.isPromoted = true;
        } else if (["text", "textarea", "number", "boolean", "date", "datetime", "time", "url", "color"].includes(token)) {
            defObj.labelType = token as LabelType;
        } else if (["single", "multi"].includes(token)) {
            defObj.multiplicity = token as Multiplicity;
        } else if (token.startsWith("precision")) {
            const chunks = token.split("=");

            defObj.numberPrecision = parseInt(chunks[1]);
        } else if (token.startsWith("alias")) {
            const chunks = token.split("=");

            defObj.promotedAlias = chunks[1];
        } else if (token.startsWith("inverse")) {
            const chunks = token.split("=");

            defObj.inverseRelation = chunks[1];
        } else {
            console.log("Unrecognized attribute definition token:", token);
        }
    }

    return defObj;
}

/**
 * Serializes a definition back into the comma separated form stored in the attribute value, e.g.
 * `promoted,alias=Foo,single,number,precision=2`. The inverse of {@link parse}.
 *
 * The multiplicity and the label type are always written out, falling back to the defaults their
 * consumers assume (`single` and `text`) rather than to the empty token {@link parse} would reject.
 *
 * @param definition the definition to serialize.
 * @param valueType whether the definition describes a label or a relation, which decides between
 *                  writing a label type and writing an inverse relation.
 */
function serialize(definition: DefinitionObject, valueType: "label" | "relation") {
    const props: string[] = [];

    if (definition.isPromoted) {
        props.push("promoted");

        if (definition.promotedAlias) {
            props.push(`alias=${definition.promotedAlias}`);
        }
    }

    props.push(definition.multiplicity ?? "single");

    if (valueType === "label") {
        const labelType = definition.labelType ?? "text";
        props.push(labelType);

        // A precision is only meaningful for numbers, and only once it has been set.
        if (labelType === "number" && definition.numberPrecision !== undefined) {
            props.push(`precision=${definition.numberPrecision}`);
        }
    } else if (definition.inverseRelation?.trim()) {
        props.push(`inverse=${filterAttributeName(definition.inverseRelation)}`);
    }

    return props.join(",");
}

/**
 * For an attribute definition name (e.g. `label:TEST:TEST1`), extracts its type (label) and name (TEST:TEST1).
 * @param definitionAttrName the attribute definition name, without the leading `#` (e.g. `label:TEST:TEST1`)
 * @return a tuple of [type, name].
 */
export function extractAttributeDefinitionTypeAndName(definitionAttrName: string): [ "label" | "relation", string ] {
    const valueType = definitionAttrName.startsWith("label:") ? "label" : "relation";
    const valueName = definitionAttrName.substring(valueType.length + 1);
    return [ valueType, valueName ];
}

export default {
    parse,
    serialize
};
